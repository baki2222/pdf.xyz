import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { parseBboxLayout } from "../pdf-text/parse";
import { OCR_SCAN_BBOX } from "@/tests/ocr-layer-samples";
import {
  detectTablesOnPage,
  PHRASE_GAP_HEIGHTS,
  type PdfLayoutPage,
} from "./detect";
import { runTableExtract } from "./engine";
import {
  restoreTesseractWordWidths,
  TESSERACT_LAYER_FONT,
  tesseractLayerPages,
} from "./ocr-geometry";

/**
 * Extract Tables reported a scanned letter's two lines of prose as a
 * four-column table (production proof "extract-tables (ocr, page without a
 * table)", 2026-11-08): table-2.csv held "Thank,you,for shopping with,us this
 * winter". The words here are the ones the worker really read off that page
 * (`@/tests/ocr-layer-samples`, captured in the production image).
 */
const layout = parseBboxLayout(OCR_SCAN_BBOX);
const page = (n: number): PdfLayoutPage => {
  const found = layout.pages.find((p) => p.pageNumber === n);
  if (!found) throw new Error(`no page ${n} in the captured layout`);
  return found;
};

const SCAN_TABLE = [
  ["Item", "Count", "Price"],
  ["Apple", "12", "340"],
  ["Bread", "30", "125"],
  ["Cheese", "18", "760"],
  ["Grapes", "25", "410"],
];
const PROSE = [
  ["Thank", "you", "for", "shopping", "with", "us", "this", "winter"],
  ["Returns", "are", "accepted", "within", "thirty", "days"],
];

/** Each row's gaps between neighbouring words, in that row's line heights. */
function gapsInHeights(p: PdfLayoutPage): number[] {
  const rows = new Map<number, PdfLayoutPage["items"]>();
  for (const item of p.items) {
    const key = Math.round(item.y);
    rows.set(key, [...(rows.get(key) ?? []), item]);
  }
  return [...rows.values()].flatMap((items) => {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    return sorted
      .slice(1)
      .map(
        (w, i) => (w.x - (sorted[i]!.x + sorted[i]!.width)) / sorted[i]!.height,
      );
  });
}

describe("the captured OCR layer (health check)", () => {
  it("holds the two pages, the table's words and the letter's words", () => {
    expect(layout.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(
      page(1)
        .items.map((i) => i.text)
        .sort(),
    ).toEqual(SCAN_TABLE.flat().sort());
    expect(page(2).items.map((i) => i.text)).toEqual(PROSE.flat());
  });
});

describe("Tesseract word boxes, as poppler reports them", () => {
  // The defect, kept as the control: without the restore, every word space
  // of the letter is a candidate gutter and two lines line up by chance.
  it("make every word space of the letter wider than a word space", () => {
    const gaps = gapsInHeights(page(2));
    expect(gaps).toHaveLength(12);
    expect(Math.min(...gaps)).toBeGreaterThan(PHRASE_GAP_HEIGHTS);
  });

  it("read two lines of a letter as a table (the defect this file fixes)", () => {
    expect(detectTablesOnPage(page(2)).map((t) => t.rows)).toEqual([
      [
        ["Thank", "you", "for shopping with", "us this winter"],
        ["Returns", "are", "accepted within", "thirty days"],
      ],
    ]);
  });
});

describe("restoreTesseractWordWidths", () => {
  it("gives the letter word spaces again, and so no table", () => {
    const restored = restoreTesseractWordWidths(page(2));
    const gaps = gapsInHeights(restored);
    expect(gaps).toHaveLength(12);
    expect(Math.max(...gaps)).toBeLessThan(PHRASE_GAP_HEIGHTS);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
    expect(detectTablesOnPage(restored)).toEqual([]);
  });

  it("keeps the scan's real table, cell for cell", () => {
    expect(
      detectTablesOnPage(restoreTesseractWordWidths(page(1))).map(
        (t) => t.rows,
      ),
    ).toEqual([SCAN_TABLE]);
    // And the captured boxes held it before the restore too.
    expect(detectTablesOnPage(page(1)).map((t) => t.rows)).toEqual([
      SCAN_TABLE,
    ]);
  });

  // A second, independent bound: the restored boxes against the INK, read
  // off the same page with `pdftoppm -r 288 -gray` in the production image
  // (dark columns of each text band, in points). The rule is derived from how
  // Tesseract writes its layer; this checks it against what is printed.
  it("restores each word to its printed ink, within half a point", () => {
    const INK: Record<string, [number, number]> = {
      Thank: [60.5, 109.8],
      you: [115.3, 142.8],
      for: [149.3, 169.8],
      shopping: [175.8, 247.0],
      with: [253.3, 284.0],
      us: [291.3, 308.5],
      this: [314.5, 341.5],
      winter: [347.3, 395.0],
      Returns: [61.5, 122.3],
      are: [128.8, 153.3],
      accepted: [159.8, 231.0],
      within: [237.3, 282.0],
      thirty: [288.5, 327.0],
    };
    const restored = restoreTesseractWordWidths(page(2));
    const checked = restored.items.filter((w) => INK[w.text]);
    expect(checked).toHaveLength(Object.keys(INK).length);
    for (const w of checked) {
      const [, inkEnd] = INK[w.text]!;
      expect(Math.abs(w.x + w.width - inkEnd), w.text).toBeLessThan(0.5);
    }
    // "days" ends the block, so Tesseract wrote it with no trailing space:
    // its box was already its ink (332.96 + 36.36 against 333.0–369.5), and
    // the restore over-widens it by one cell, past the end of its line.
    const days = restored.items.find((w) => w.text === "days")!;
    expect(days.x + days.width).toBeGreaterThan(369.5);
  });
});

/** A PDF whose pages carry the given fonts, page 1 inside a form XObject. */
async function fontPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const glyphless = (base: string) =>
    doc.context.register(
      doc.context.obj({ Type: "Font", Subtype: "Type0", BaseFont: base }),
    );
  // 1: the Tesseract layer drawn from a form, as OCRmyPDF grafts it.
  const form = doc.context.register(
    doc.context.stream("", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 10, 10],
      Resources: { Font: { "f-0-0": glyphless(TESSERACT_LAYER_FONT) } },
    }),
  );
  const p1 = doc.addPage();
  p1.node.set(
    PDFName.of("Resources"),
    doc.context.obj({ XObject: { Fm0: form } }),
  );
  // 2: typed text only.
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("Typed", { font: helvetica });
  // 3: typed text beside a Tesseract layer.
  const p3 = doc.addPage();
  p3.drawText("Typed", { font: helvetica });
  p3.node
    .Resources()!
    .set(PDFName.of("XObject"), doc.context.obj({ Fm0: form }));
  // 4: no text at all.
  doc.addPage();
  // 5: a subset-tagged Tesseract font, directly on the page.
  const p5 = doc.addPage();
  p5.node.set(
    PDFName.of("Resources"),
    doc.context.obj({
      Font: { "f-0-0": glyphless(`ABCDEF+${TESSERACT_LAYER_FONT}`) },
    }),
  );
  return doc.save();
}

describe("tesseractLayerPages", () => {
  it("names the pages whose only font is Tesseract's, forms included", async () => {
    expect([...(await tesseractLayerPages(await fontPdf()))]).toEqual([1, 5]);
  });

  it("names none in a PDF it cannot read", async () => {
    expect(
      (await tesseractLayerPages(new TextEncoder().encode("not a pdf"))).size,
    ).toBe(0);
  });
});

describe("runTableExtract over an OCR'd scan", () => {
  const extractLayout = async () => layout;

  it("finds the table on page 1 and none in the letter on page 2", async () => {
    const run = await runTableExtract(new Uint8Array(), {
      extractLayout,
      tesseractPages: async () => new Set([1, 2]),
    });
    expect(run.ok && run.findings.tablePages).toEqual([1]);
  });

  it("restores nothing on a page it is not told is Tesseract's (the control)", async () => {
    const run = await runTableExtract(new Uint8Array(), {
      extractLayout,
      tesseractPages: async () => new Set(),
    });
    expect(run.ok && run.findings.tablePages).toEqual([1, 2]);
  });

  // The composed chain: the DEFAULT probe, reading the PDF's fonts, decides.
  it("asks the PDF's own fonts when no probe is injected", async () => {
    const doc = await PDFDocument.load(await fontPdf());
    doc.removePage(4);
    doc.removePage(3);
    doc.removePage(2);
    doc.removePage(1);
    // Two pages, both Tesseract's: page 1 of fontPdf twice.
    const [copy] = await doc.copyPages(doc, [0]);
    doc.addPage(copy);
    const run = await runTableExtract(await doc.save(), { extractLayout });
    expect(run.ok && run.findings.tablePages).toEqual([1]);
  });
});
