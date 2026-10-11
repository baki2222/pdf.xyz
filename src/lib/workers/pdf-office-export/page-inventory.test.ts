// @vitest-environment node
// @native-canvas
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
  damageContentStreams,
  imageCaptionPdf,
  PPTX_FIDELITY_FIXTURES,
  undecodablePicturePdf,
} from "@/tests/pptx-fidelity-fixtures";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { ownerOnlyObjectStreamPdf } from "@/tests/encrypted-pdf-fixture";
import {
  contentOperators,
  decodedBytes,
  documentImages,
  inventoryOf,
  inventoryPages,
  readInventory,
  type PageInventory,
} from "./page-inventory";
import { decodeBudgetPlan } from "./page-scan";
import { COMPARISON_MAX_IMAGE_PIXELS } from "./fidelity";
import { openNodePdf } from "./pdfjs-node";

/**
 * "w×h" of every raster pdf.js paints on each page, opened with a ceiling
 * above every fixture picture. (CHANGED 2026-10-11: "with no ceiling", -1,
 * until `openNodePdf` stopped accepting one — `image-ceiling.test.ts`.)
 */
async function pdfjsImages(pdf: Uint8Array): Promise<string[][]> {
  const { pdfjs, doc, close } = await openNodePdf(pdf, {
    maxImageSize: COMPARISON_MAX_IMAGE_PIXELS,
  });
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

  /*
   * INVERTED 2026-10-11 (the second re-review). This test pinned that an
   * encrypted file falls back to what its pages DECLARE, "and says it is
   * inexact" — a limitation of the reader (pdf-lib does not decrypt), and
   * the root of two defects on one day: a page charged for every image it
   * declared lost all of an album's photos; one charged for nothing decoded
   * 2.2 GB from a 1 MB upload. A viewer opens this file with no password,
   * and so, now, does the reader (`./standard-security`). The file is
   * `rc4EncryptedPdf`'s: revision 2, RC4-40, from a helper of its own.
   */
  it("reads an owner-password file's page exactly, as a viewer opens it", async () => {
    const pdf = rc4EncryptedPdf({
      userPassword: "",
      ownerPassword: "owner",
      text: "Owner locked but readable",
    });
    const inventory = (await inventoryPages(pdf))!;
    expect(inventory).toHaveLength(1);
    expect(inventory[0]!.exact).toBe(true);
    // Health: the content was READ — its one line of text is counted — not
    // merely called exact.
    expect(inventory[0]!.visibleTextOps).toBe(1);
  });

  /*
   * 2026-10-11, the second re-review: every Standard-handler cipher a viewer
   * opens with no password, in both layouts, over every fixture the export
   * is proven on. The fixtures' encryption is the test helper's own, and
   * pdf.js — an independent implementation — is its oracle: a locked
   * variant must paint exactly what the unlocked file paints, or the
   * comparison below would be agreeing with a broken fixture.
   */
  const CIPHERS = [
    "rc4-40",
    "rc4-128",
    "aes-128",
    "aes-256-r5",
    "aes-256",
  ] as const;
  it.each(
    CIPHERS.flatMap((cipher) =>
      [false, true].map((objectStreams) => [cipher, objectStreams] as const),
    ),
  )(
    "%s (object streams: %s): a locked file's inventory is the unlocked file's",
    async (cipher, objectStreams) => {
      const lock = (pdf: Uint8Array) =>
        encryptPdf(pdf, {
          userPassword: "",
          ownerPassword: "owner",
          objectStreams,
          cipher,
        });
      const oracle = await imageCaptionPdf();
      expect(await pdfjsImages(await lock(oracle.pdf))).toEqual(
        await pdfjsImages(oracle.pdf),
      );
      let images = 0;
      for (const build of PPTX_FIDELITY_FIXTURES) {
        const fixture = await build();
        const plain = (await inventoryPages(fixture.pdf))!;
        const locked = await inventoryPages(await lock(fixture.pdf));
        expect(locked, fixture.name).toEqual(plain);
        images += plain.flatMap((p) => p.images).length;
      }
      // Health: equal, and not equal by being empty.
      expect(images).toBeGreaterThanOrEqual(10);
      // A file that needs a password is not read as plaintext: its key does
      // not check against /U, and the page falls back, inexact.
      const userLocked = await inventoryPages(
        await encryptPdf(oracle.pdf, {
          userPassword: "secret",
          ownerPassword: "owner",
          cipher,
        }),
      );
      expect(userLocked?.[0]?.exact).toBe(false);
    },
    60_000,
  );

  it("an unreadable page's fallback reaches every image its resources can: forms, tiling patterns, soft-mask groups, Type3 fonts", async () => {
    // The fallback is an upper bound on what the page paints only if it
    // reaches every place a content walk would go. Each place here holds
    // an image of its own size; the page paints none of them.
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const image = (w: number, h: number) =>
      ctx.register(
        ctx.flateStream(new Uint8Array(w * h), {
          Type: "XObject",
          Subtype: "Image",
          Width: w,
          Height: h,
          BitsPerComponent: 8,
          ColorSpace: "DeviceGray",
        }),
      );
    const holding = (w: number, h: number) =>
      ctx.obj({ XObject: ctx.obj({ Im: image(w, h) }) });
    const form = ctx.register(
      ctx.flateStream(new Uint8Array(0), {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 1, 1],
        Resources: holding(11, 3),
      }),
    );
    const tiling = ctx.register(
      ctx.flateStream(new Uint8Array(0), {
        Type: "Pattern",
        PatternType: 1,
        PaintType: 1,
        TilingType: 1,
        BBox: [0, 0, 1, 1],
        XStep: 1,
        YStep: 1,
        Resources: holding(13, 3),
      }),
    );
    const group = ctx.register(
      ctx.flateStream(new Uint8Array(0), {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 1, 1],
        Group: ctx.obj({ S: "Transparency" }),
        Resources: holding(17, 3),
      }),
    );
    const type3 = ctx.register(
      ctx.obj({
        Type: "Font",
        Subtype: "Type3",
        FontBBox: [0, 0, 1, 1],
        FontMatrix: [1, 0, 0, 1, 0, 0],
        CharProcs: ctx.obj({}),
        Encoding: ctx.obj({ Differences: [] }),
        FirstChar: 0,
        LastChar: 0,
        Widths: [0],
        Resources: holding(19, 3),
      }),
    );
    const page = doc.addPage([200, 200]);
    page.node.set(
      PDFName.of("Resources"),
      ctx.obj({
        XObject: ctx.obj({ Fm: form }),
        Pattern: ctx.obj({ P0: tiling }),
        ExtGState: ctx.obj({
          GS0: ctx.obj({ SMask: ctx.obj({ S: "Luminosity", G: group }) }),
        }),
        Font: ctx.obj({ T3: type3 }),
      }),
    );
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    const plain = await doc.save({ useObjectStreams: false });
    const sizes = (inv: PageInventory[]) =>
      inv[0]!.images.map((i) => `${i.width}x${i.height}`).sort();
    // Control: read exactly, the page paints none of them.
    const exact = (await inventoryPages(plain))!;
    expect(exact[0]!.exact).toBe(true);
    expect(sizes(exact)).toEqual([]);
    // CHANGED 2026-10-11 (the second re-review): the page is made
    // unreadable by a broken checksum on its content stream, not by
    // encryption — an encrypted page is now read like any other.
    const damaged = await damageContentStreams(plain);
    const declared = (await inventoryPages(damaged))!;
    expect(declared[0]!.exact).toBe(false);
    expect(sizes(declared)).toEqual(["11x3", "13x3", "17x3", "19x3"]);
  });

  it("returns null for bytes pdf-lib cannot read", async () => {
    expect(await inventoryPages(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  /*
   * 2026-10-11, the second review: the same owner-password lock in the
   * layout Acrobat and Word write, the catalog and page tree inside an
   * encrypted object stream. pdf-lib LOADS it and then has no catalog, and
   * the walk threw "Cannot read properties of undefined (reading 'Pages')"
   * — outside any try in the page scan, so the whole export failed.
   *
   * INVERTED the same day (the second re-review): "has no inventory" was
   * the fix for the throw, and it pinned a reader that knew nothing about
   * such a file's pages. The object stream is now decrypted and read, so
   * the page tree is there. What stays pinned is that the raw walk over
   * pdf-lib's own load still throws — the shape the scan meets first.
   */
  it("an AES stream's padding is not page content: a stream ending in Do keeps its picture", async () => {
    // AES pads each stream to whole blocks with bytes of the pad's length
    // (here 0x05, not PDF whitespace). Left on an uncompressed content
    // stream that ends at its last operator, they fuse with it: "Do" reads
    // as "Do\x05\x05…", and the page's only picture goes unseen. The
    // mutation check of 2026-10-11 found nothing held the unpadding.
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const image = ctx.register(
      ctx.flateStream(new Uint8Array(30 * 20 * 3), {
        Type: "XObject",
        Subtype: "Image",
        Width: 30,
        Height: 20,
        BitsPerComponent: 8,
        ColorSpace: "DeviceRGB",
      }),
    );
    const page = doc.addPage([200, 200]);
    page.node.set(
      PDFName.of("Resources"),
      ctx.obj({ XObject: ctx.obj({ Im: image }) }),
    );
    const content = "q 30 0 0 20 10 10 cm /Im Do";
    // Health: 27 bytes pad with five 0x05 bytes, which are not whitespace.
    expect(16 - (content.length % 16)).toBe(5);
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(content)));
    const plain = await doc.save({ useObjectStreams: false });
    const want = (await inventoryPages(plain))!;
    expect(want[0]!.images).toHaveLength(1);
    for (const cipher of ["aes-128", "aes-256"] as const) {
      const locked = await encryptPdf(plain, {
        userPassword: "",
        ownerPassword: "owner",
        cipher,
      });
      expect(await inventoryPages(locked), cipher).toEqual(want);
    }
  });

  it("reads the page tree out of an encrypted object stream, and does not throw", async () => {
    const doc = await PDFDocument.load(ownerOnlyObjectStreamPdf(), LOAD);
    // Health: loaded, encrypted, and the raw walk does throw on it — the
    // shape the scan met, not a file pdf-lib refuses outright.
    expect(doc.isEncrypted).toBe(true);
    expect(() => inventoryOf(doc)).toThrow();
    expect(readInventory(doc)).toBeNull();
    const inventory = await inventoryPages(ownerOnlyObjectStreamPdf());
    expect(inventory?.map((p) => p.exact)).toEqual([true]);
  });

  it("still names every picture such a file holds, from the dictionaries left in the clear", async () => {
    // An image is a stream, a stream is never inside an object stream, and
    // encryption leaves a dictionary's names and numbers alone (ISO
    // 32000-1 §7.5.7, §7.6.1): each picture's size is readable.
    const fixture = await imageCaptionPdf();
    const locked = await encryptPdf(fixture.pdf, {
      userPassword: "",
      ownerPassword: "owner",
      objectStreams: true,
    });
    const doc = await PDFDocument.load(locked, LOAD);
    expect(readInventory(doc)).toBeNull();
    const plain = (await inventoryPages(fixture.pdf))!;
    const distinct = new Map(
      plain.flatMap((p) => p.images.map((i) => [i.ref, i] as const)),
    );
    const want = [...distinct.values()]
      .map((i) => `${i.width}x${i.height}:${i.bytes}`)
      .sort();
    // Health: the unlocked file paints two distinct pictures.
    expect(want).toHaveLength(2);
    expect(
      documentImages(doc)!
        .map((i) => `${i.width}x${i.height}:${i.bytes}`)
        .sort(),
    ).toEqual(want);
  });
});

const LOAD = {
  ignoreEncryption: true,
  updateMetadata: false,
  throwOnInvalidObject: false,
} as const;

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
    expect(plan.pages[0]).toEqual({
      cap: 20_000,
      tooLarge: 1,
      bytes: 80,
      unverified: false,
    });
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

  /*
   * 2026-10-11, the second review. An INEXACT page — its content could not
   * be read, so `images` is what its resources DECLARE — was budgeted like
   * an exact one: its ceiling fell below the floor and every declared image
   * over it was counted too large. An owner-password file of twelve 6-MP
   * photos under one shared /Resources lost all twelve, and its note said
   * 144 pictures were too large.
   *
   * INVERTED the same day (the second re-review). The repair let such a
   * page's ceiling "never fall below the floor" — and so let it decode
   * anything up to 64 MP, as many times as the page paints one: one page of
   * six 8000² photos decoded 2.2 GB, encrypted with an owner password or
   * merely with a broken checksum on its content stream. The ceiling is
   * held to the page budget over everything the page can reach again (an
   * upper bound on what it paints, so the bound holds whatever it paints);
   * what stays is that nothing it only declares is COUNTED, and the
   * encrypted album no longer reaches this branch (`./standard-security`).
   */
  it("an inexact page is held to the page budget over all it can reach, and counts nothing it only declares", () => {
    const declared = page([100, 100, 60], [100, 100, 60]);
    const opts = { pageBytes: 100, floorPixels: 1_000_000 };
    // Control: read exactly, the pair is over the budget, left out, counted.
    const exact = decodeBudgetPlan([declared], opts);
    expect(exact.pages[0]!.tooLarge).toBe(2);
    expect(exact.pages[0]!.cap).toBeLessThan(10_000);
    const plan = decodeBudgetPlan([{ ...declared, exact: false }], opts);
    // The same ceiling: what it can reach does not fit, so none of it is
    // admitted ...
    expect(plan.pages[0]!.cap).toBe(exact.pages[0]!.cap);
    // ... nothing is counted, and the page cannot be called empty.
    expect(plan.pages[0]!.tooLarge).toBe(0);
    expect(plan.pages[0]!.unverified).toBe(true);
  });

  it("an inexact page is unverified exactly when it declares an image over its ceiling", () => {
    const opts = { pageBytes: 100, floorPixels: 1_000_000 };
    const big = page([2000, 1000, 60], [2000, 1000, 60]);
    expect(
      decodeBudgetPlan([{ ...big, exact: false }], opts).pages[0],
    ).toMatchObject({ cap: 1_000_000, tooLarge: 0, unverified: true });
    // Declared images that fit the budget whole are admitted whole.
    expect(
      decodeBudgetPlan([{ ...big, exact: false }], { ...opts, pageBytes: 1000 })
        .pages[0],
    ).toMatchObject({ cap: 2_000_000, tooLarge: 0, unverified: false });
    // INVERTED 2026-10-11 (the second re-review): this pair, under the
    // floor but over the page budget together, was "under the floor: pdf.js
    // removes nothing it could paint" — the unbounded ceiling. Held to the
    // budget, the page leaves both out and cannot say it painted neither.
    const small = page([100, 100, 60], [100, 100, 60]);
    expect(
      decodeBudgetPlan([{ ...small, exact: false }], opts).pages[0],
    ).toMatchObject({ cap: 9_999, tooLarge: 0, unverified: true });
    // ... and one that fits the budget leaves nothing out, so it is not.
    expect(
      decodeBudgetPlan([{ ...page([100, 100, 60]), exact: false }], opts)
        .pages[0]!.unverified,
    ).toBe(false);
    // An exact page's losses are COUNTED, so it is never unverified.
    expect(decodeBudgetPlan([big], opts).pages[0]).toMatchObject({
      tooLarge: 2,
      unverified: false,
    });
  });

  it("refuses a document only for what its pages are SEEN to decode", () => {
    const plan = decodeBudgetPlan(
      [page([10, 10, 10]), { ...page([10, 10, 50]), exact: false }],
      { pageBytes: 100, floorPixels: 1 },
    );
    // Control: both pages admitted what they hold.
    expect(plan.pages.map((p) => p.bytes)).toEqual([10, 50]);
    expect(plan.bytes).toBe(10);
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
