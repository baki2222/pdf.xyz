// @vitest-environment node
/**
 * The page inventory — what each page will make pdf.js decode, read from the
 * file before pdf.js runs — held to what pdf.js ACTUALLY decodes.
 *
 * The decode budget (`decodeBudgetPlan`) and the fidelity instrument's
 * health check both stand on this set. A set that silently lost members
 * would make the budget decorative (pdf.js decodes what it never counted)
 * and the health check blind; one that gained them would charge a page for
 * a whole book's shared resources. So the inventory is compared, page by
 * page, with the images pdf.js's own operator list paints, over every
 * fixture the export is proven on — and the comparison is held to a size, so
 * it cannot pass by being empty.
 */
import {
  concatTransformationMatrix,
  drawObject,
  PDFDict,
  PDFDocument,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  setTextRenderingMode,
  TextRenderingMode,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  bigPhotosPdf,
  PPTX_FIDELITY_FIXTURES,
  undecodablePicturePdf,
} from "@/tests/pptx-fidelity-fixtures";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import {
  contentOperators,
  decodedBytes,
  inventoryPages,
  type PageInventory,
} from "./page-inventory";
import { decodeBudgetPlan } from "./page-scan";
import { openNodePdf } from "./pdfjs-node";

/** "w×h" of every raster pdf.js paints on each page, opened with no ceiling. */
async function pdfjsImages(pdf: Uint8Array): Promise<string[][]> {
  const { pdfjs, doc, close } = await openNodePdf(pdf, { maxImageSize: -1 });
  try {
    const out: string[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const ol = await page.getOperatorList();
      const seen = new Set<string>();
      ol.fnArray.forEach((fn, i) => {
        const args = ol.argsArray[i] as unknown[];
        if (fn === pdfjs.OPS.paintImageXObject)
          seen.add(`${args[0]}=${args[1]}x${args[2]}`);
        else if (fn === pdfjs.OPS.paintInlineImageXObject) {
          const img = args[0] as { width: number; height: number };
          seen.add(`inline:${i}=${img.width}x${img.height}`);
        }
      });
      out.push([...seen].map((s) => s.split("=")[1]!).sort());
      page.cleanup();
    }
    return out;
  } finally {
    await close();
  }
}

const dims = (page: PageInventory) =>
  page.images
    .filter((i) => !i.mask)
    .map((i) => `${i.width}x${i.height}`)
    .sort();

describe("the inventory names the images pdf.js decodes, page by page", () => {
  it("on every fixture the export is proven on, and on the cost fixtures", async () => {
    const builds = [
      ...PPTX_FIDELITY_FIXTURES,
      undecodablePicturePdf,
      () => bigPhotosPdf(2, 1200),
    ];
    let compared = 0;
    for (const build of builds) {
      const fixture = await build();
      const inventory = (await inventoryPages(fixture.pdf))!;
      expect(inventory, fixture.name).not.toBeNull();
      const actual = await pdfjsImages(fixture.pdf);
      expect(inventory.map(dims), fixture.name).toEqual(actual);
      expect(inventory.every((p) => p.exact)).toBe(true);
      compared += actual.flat().length;
    }
    // Health: the comparison saw real images, not two empty lists agreeing.
    expect(compared).toBeGreaterThanOrEqual(14);
  }, 120_000);

  it("places each picture where the fixture drew it, on the displayed page", async () => {
    let checked = 0;
    for (const build of PPTX_FIDELITY_FIXTURES) {
      const fixture = await build();
      const inventory = (await inventoryPages(fixture.pdf))!;
      fixture.pages.forEach((page, i) => {
        for (const img of page.images.filter((m) => !m.crop)) {
          const r = img.shown;
          const hit = inventory[i]!.placements.find(
            ({ box }) =>
              Math.abs(box[0] - r.x) < 0.5 &&
              Math.abs(box[1] - r.y) < 0.5 &&
              Math.abs(box[2] - r.x - r.width) < 0.5 &&
              Math.abs(box[3] - r.y - r.height) < 0.5,
          );
          expect(
            hit,
            `${fixture.name} p${i + 1}: no placement at ${JSON.stringify(r)}; got ${JSON.stringify(inventory[i]!.placements)}`,
          ).toBeDefined();
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it("counts a page's visible text, and not an invisible (OCR) layer", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawText("shown", { x: 20, y: 200, size: 12 });
    const ocr = doc.addPage([300, 300]);
    ocr.pushOperators(
      pushGraphicsState(),
      setTextRenderingMode(TextRenderingMode.Invisible),
    );
    ocr.drawText("hidden", { x: 20, y: 200, size: 12 });
    ocr.pushOperators(popGraphicsState());
    const inventory = (await inventoryPages(await doc.save()))!;
    expect(inventory.map((p) => p.visibleTextOps)).toEqual([1, 0]);
  });

  it("falls back to what an encrypted file DECLARES, and says it is inexact", async () => {
    const pdf = rc4EncryptedPdf({
      userPassword: "",
      ownerPassword: "owner",
      text: "Owner locked but readable",
    });
    const inventory = (await inventoryPages(pdf))!;
    expect(inventory).toHaveLength(1);
    expect(inventory[0]!.exact).toBe(false);
  });

  it("returns null for bytes pdf-lib cannot read", async () => {
    expect(await inventoryPages(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("the content lexer", () => {
  const ops = (src: string | Uint8Array) =>
    [
      ...contentOperators(
        typeof src === "string" ? new TextEncoder().encode(src) : src,
      ),
    ].map((o) => o.op);

  it("does not read operators inside strings, hex strings or comments", () => {
    expect(
      ops("(a Do (b) \\) Q) Tj <446F> Tj % 1 0 0 1 0 0 cm /X Do\nq Q"),
    ).toEqual(["Tj", "Tj", "q", "Q"]);
  });

  it("reads an inline image whole, past data that spells EI", () => {
    const head = new TextEncoder().encode(
      "q 10 0 0 10 0 0 cm BI /W 4 /H 2 /BPC 8 /CS /G ID ",
    );
    const data = new TextEncoder().encode("AEI BEI ");
    const tail = new TextEncoder().encode(" EI Q /Im1 Do");
    const all = new Uint8Array(head.length + data.length + tail.length);
    all.set(head, 0);
    all.set(data, head.length);
    all.set(tail, head.length + data.length);
    const seen = [...contentOperators(all)];
    expect(seen.map((o) => o.op)).toEqual(["q", "cm", "BI", "Q", "Do"]);
    const inline = seen.find((o) => o.op === "BI")!.inline!;
    expect(inline.get("W")).toBe(4);
    expect(inline.get("H")).toBe(2);
  });

  it("keeps a dictionary operand whole (marked content)", () => {
    expect(ops("/OC << /Type /OCMD /OCGs [1 0 R] >> BDC /X Do EMC")).toEqual([
      "BDC",
      "Do",
      "EMC",
    ]);
  });
});

describe("the decode budget", () => {
  const page = (...images: [number, number, number][]): PageInventory => ({
    pageNumber: 1,
    width: 100,
    height: 100,
    images: images.map(([w, h, bytes], k) => ({
      ref: `${k + 1}R`,
      inline: false,
      width: w,
      height: h,
      mask: false,
      bytes,
    })),
    placements: [],
    visibleTextOps: 0,
    exact: true,
  });

  it("admits a page's smallest images first, and puts the ceiling between admitted and left out", () => {
    const plan = decodeBudgetPlan(
      [page([100, 100, 40], [200, 100, 40], [300, 300, 40])],
      { pageBytes: 100, floorPixels: 50 },
    );
    // pdf.js leaves out images of MORE pixels than the cap: the floor (50)
    // may not cut an admitted image (20,000 px), so the cap is that image's.
    expect(plan.pages[0]).toEqual({ cap: 20_000, tooLarge: 1, bytes: 80 });
    const plan2 = decodeBudgetPlan(
      [page([100, 100, 40], [200, 100, 40], [300, 300, 40])],
      { pageBytes: 100, floorPixels: 1_000_000 },
    );
    expect(plan2.pages[0]!.cap).toBeGreaterThanOrEqual(20_000);
    expect(plan2.pages[0]!.cap).toBeLessThan(90_000);
    expect(plan2.pages[0]!.tooLarge).toBe(1);
  });

  it("admits or leaves out images of one pixel count together: the ceiling cannot split them", () => {
    const plan = decodeBudgetPlan(
      [page([100, 100, 60], [100, 100, 60], [10, 10, 1])],
      { pageBytes: 100, floorPixels: 1 },
    );
    expect(plan.pages[0]).toMatchObject({ tooLarge: 2, bytes: 1 });
    expect(plan.pages[0]!.cap).toBeLessThan(10_000);
    expect(plan.pages[0]!.cap).toBeGreaterThanOrEqual(100);
  });

  it("gives every page that leaves nothing out one shared ceiling, at least the floor", () => {
    const plan = decodeBudgetPlan(
      [page([10, 10, 1]), page([9000, 9000, 50]), page()],
      { pageBytes: 100, floorPixels: 1000 },
    );
    expect(plan.pages.map((p) => p.cap)).toEqual([
      81_000_000, 81_000_000, 81_000_000,
    ]);
    expect(plan.pages.every((p) => p.tooLarge === 0)).toBe(true);
    expect(plan.bytes).toBe(51);
  });
});

describe("the byte estimates", () => {
  it("a 1-bit drawing is a sixteenth of a pixel's RGB, an RGB photo three bytes and more", () => {
    const base = {
      width: 8000,
      height: 8000,
      mask: false,
      alpha: null,
      decode: false,
    };
    const bilevel = decodedBytes({
      ...base,
      bpc: 1,
      comps: 1,
      filter: "FlateDecode",
      deviceRgb: false,
    });
    const rgb = decodedBytes({
      ...base,
      bpc: 8,
      comps: 3,
      filter: "FlateDecode",
      deviceRgb: true,
    });
    expect(bilevel).toBeLessThan(8000 * 8000 * 0.25);
    expect(rgb).toBeGreaterThanOrEqual(8000 * 8000 * 3);
    // Measured peaks (see decodedBytes): 394 MB for this photo.
    expect(rgb / 1e6).toBeGreaterThanOrEqual(394);
  });

  it("the shared-resources trap: a page charged for the images it USES, not all it can reach", async () => {
    // Every page hangs off one /Resources dictionary naming every photo; each
    // page draws one. Charging each page for all of them is how a 33-page
    // deck would lose all its pictures to the budget.
    const doc = await PDFDocument.create();
    const src = await PDFDocument.load((await bigPhotosPdf(3, 600)).pdf);
    const [first] = await doc.copyPages(src, [0]);
    doc.addPage(first!);
    const shared = first!.node.Resources()!;
    const xobjects = shared.lookup(PDFName.of("XObject"), PDFDict);
    const names = xobjects.keys().map((k) => k.asString().slice(1));
    // Health: the shared dictionary names all three photos.
    expect(names).toHaveLength(3);
    for (const name of names) {
      const p = doc.addPage([200, 200]);
      p.node.set(PDFName.of("Resources"), shared);
      p.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(100, 0, 0, 100, 50, 50),
        drawObject(name),
        popGraphicsState(),
      );
    }
    const inventory = (await inventoryPages(await doc.save()))!;
    expect(inventory.map((p) => p.images.length)).toEqual([3, 1, 1, 1]);
  });
});
