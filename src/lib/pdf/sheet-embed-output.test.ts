// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { bookletPdf, DEFAULT_BOOKLET_OPTIONS } from "./booklet";
import { nUpPdf, DEFAULT_N_UP_OPTIONS } from "./n-up";
import { loadPdfjs } from "./pdfjs";
import { renderPdfPages, type RenderedPage } from "@/tests/pdf-render";

/**
 * What the two tools that place source pages on new sheets (`embedSourcePages`,
 * shared by Multiple Pages per Sheet and PDF Booklet Maker) put on paper, read
 * back the way a READER receives it: pdf.js pixels, and pdf.js's own
 * optional-content configuration. Both tools make a file to PRINT.
 *
 * WHY THIS FILE EXISTS (review of feat/booklet-pdf, 2026-11-10):
 *  1. LAYERS. The embedded page still marks a layer `/OC /MC0 BDC ... EMC`
 *     and still names its group in the Form XObject's `/Resources
 *     /Properties`, but the output catalog had no `/OCProperties`, so a
 *     viewer had no configuration to read and drew EVERY layer: an answer
 *     key OFF by default measured 0 red pixels in the source, 99,225 on the
 *     booklet and 87,025 on the n-up sheet. The page assembler had the same
 *     defect and its fix (`page-copy-layers.test.ts`, audit #1); this is the
 *     same fix on the other embedding path.
 *  2. PRINT FLAGS. Annotations were baked by their SCREEN flags (skip Hidden
 *     and NoView): a print-only stamp (F = NoView|Print) never reached the
 *     printed booklet, and a screen-only one (F = 0) was baked into the page
 *     content, so it printed. The output must print what printing the
 *     original prints.
 */

const RED = (p: RenderedPage) => {
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i]! > 200 && p.data[i + 1]! < 60 && p.data[i + 2]! < 60) n++;
  }
  return n;
};

/** Red pixels on every page together. */
const redOn = async (bytes: Uint8Array, intent?: "display" | "print") =>
  (await renderPdfPages(bytes, 400, intent ? { intent } : {})).reduce(
    (sum, p) => sum + RED(p),
    0,
  );

/** A 4-page PDF; page 1 draws a red square inside a layer OFF by default. */
async function hiddenLayerPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const ocg = ctx.register(
    ctx.obj({ Type: "OCG", Name: PDFString.of("Answer key") }) as PDFDict,
  );
  const shown = ctx.register(
    ctx.obj({ Type: "OCG", Name: PDFString.of("Body") }) as PDFDict,
  );
  for (let i = 0; i < 4; i++) doc.addPage([200, 200]);
  const page = doc.getPage(0);
  page.node.set(
    PDFName.of("Resources"),
    ctx.obj({ Properties: { MC0: ocg, MC1: shown } }),
  );
  page.node.set(
    PDFName.of("Contents"),
    ctx.register(
      ctx.flateStream(
        "/OC /MC0 BDC 1 0 0 rg 10 10 150 150 re f EMC\n/OC /MC1 BDC 0 0 1 rg 170 170 20 20 re f EMC",
      ),
    ),
  );
  doc.catalog.set(
    PDFName.of("OCProperties"),
    ctx.register(
      ctx.obj({
        OCGs: [ocg, shown],
        D: { Name: PDFString.of("Default"), OFF: [ocg], Order: [ocg, shown] },
      }),
    ),
  );
  return doc.save();
}

/** Each optional-content group pdf.js sees, by name, and whether it shows. */
async function layers(bytes: Uint8Array): Promise<Record<string, boolean>> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const config = await pdf.getOptionalContentConfig();
    const out: Record<string, boolean> = {};
    for (const [id, group] of config) {
      const name = (group as { name: string | null }).name ?? id;
      out[name] = config.isVisible({ type: "OCG", id } as never);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

const TOOLS = {
  booklet: async (b: Uint8Array) =>
    (await bookletPdf(b, { ...DEFAULT_BOOKLET_OPTIONS })).bytes,
  "n-up": async (b: Uint8Array) =>
    (await nUpPdf(b, { ...DEFAULT_N_UP_OPTIONS })).bytes,
} as const;

describe("a layer hidden by default stays hidden on the new sheets", () => {
  it("POSITIVE CONTROL: the source's hidden layer paints nothing, and pdf.js sees it hidden", async () => {
    const src = await hiddenLayerPdf();
    expect(await redOn(src)).toBe(0);
    expect(await layers(src)).toEqual({ "Answer key": false, Body: true });
    // And the predicate can see red at all: with the layer ON it paints.
    const shown = await PDFDocument.load(src);
    const d = shown.catalog
      .lookup(PDFName.of("OCProperties"), PDFDict)
      .lookup(PDFName.of("D"), PDFDict);
    d.delete(PDFName.of("OFF"));
    expect(await redOn(await shown.save())).toBeGreaterThan(1000);
  });

  for (const [tool, run] of Object.entries(TOOLS)) {
    it(`${tool}: the answer key is not drawn, and the output lists it hidden`, async () => {
      const out = await run(await hiddenLayerPdf());
      expect(await layers(out)).toEqual({ "Answer key": false, Body: true });
      expect(await redOn(out)).toBe(0);
      expect(await redOn(out, "print")).toBe(0);
      // The tag that finds each group's copy does not ship.
      expect(Buffer.from(out).toString("latin1")).not.toContain(
        "PdfxyzLayerGroup",
      );
    });
  }

  it("a source with no layers gets no /OCProperties (nothing invented)", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 4; i++) doc.addPage([200, 200]).drawText("x");
    for (const run of Object.values(TOOLS)) {
      const out = await PDFDocument.load(await run(await doc.save()));
      expect(out.catalog.get(PDFName.of("OCProperties"))).toBeUndefined();
    }
  });
});

/** Annotation flags (PDF 32000 §12.5.3). */
const PRINT = 4;
const NO_VIEW = 32;
const HIDDEN = 2;

/** A 4-page PDF; page 1 has a red /Stamp annotation with flags `f`. */
async function stampPdf(f: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (let i = 0; i < 4; i++) doc.addPage([200, 200]);
  const ap = ctx.register(
    ctx.flateStream("1 0 0 rg 0 0 100 100 re f", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 100, 100],
    }),
  );
  const annot = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Stamp",
      Rect: [50, 50, 150, 150],
      F: f,
      AP: { N: ap },
    }),
  );
  doc.getPage(0).node.set(PDFName.of("Annots"), ctx.obj([annot]));
  return doc.save();
}

describe("annotations print on the new sheets exactly when printing the original prints them", () => {
  const CASES: [string, number][] = [
    ["printable (Print)", PRINT],
    ["screen-only (no Print flag)", 0],
    ["print-only (NoView | Print)", NO_VIEW | PRINT],
    ["hidden (Hidden | Print)", HIDDEN | PRINT],
  ];

  it("POSITIVE CONTROL: pdf.js's print intent tells the four apart on the source", async () => {
    const printed: Record<string, boolean> = {};
    for (const [name, f] of CASES) {
      printed[name] = (await redOn(await stampPdf(f), "print")) > 0;
    }
    expect(printed).toEqual({
      "printable (Print)": true,
      "screen-only (no Print flag)": false,
      "print-only (NoView | Print)": true,
      "hidden (Hidden | Print)": false,
    });
  });

  for (const [tool, run] of Object.entries(TOOLS)) {
    for (const [name, f] of CASES) {
      it(`${tool}: a ${name} stamp`, async () => {
        const src = await stampPdf(f);
        const sourcePrints = (await redOn(src, "print")) > 0;
        const out = await run(src);
        // Baked into the content, so the sheet prints what it shows.
        expect((await redOn(out, "print")) > 0).toBe(sourcePrints);
        expect((await redOn(out)) > 0).toBe(sourcePrints);
      });
    }
  }
});
