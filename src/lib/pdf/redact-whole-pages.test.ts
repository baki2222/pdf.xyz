// @native-canvas
/**
 * WHOLE-PAGE REDACTION (audit redact-pdf#5, 2026-11-06).
 *
 * Blacking out a whole page — a scanned ID, an appendix — took a typed box the
 * size of the page, one page at a time, and the panel told people with
 * scanned pages to "Cover them with areas by position". iLovePDF and pdf.net
 * let you pick pages. `wholePageRedactions` turns a page list ("3, 7-9") into
 * one box per page the size of that page AS DISPLAYED — the same coordinate
 * space every other box uses — so both methods and the validator take it as
 * they take a typed box.
 *
 * The composed chain is run here, not only the helper: a whole-page box made
 * by the helper goes through `redactPdfByRemoval`, and the page's text is
 * gone from the output while the next page's is not — including a rotated
 * page with an offset crop box, where a box in the wrong space would miss.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import {
  getRedactPageSizes,
  validateRedactions,
  wholePageRedactions,
} from "./redact";
import { redactPdfByRemoval } from "./redact-remove";
import { extractPdfText, type PdfTextReader } from "./text";
import { PageRangeError } from "./ranges";

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

/** Three pages of text; page 2 is rotated 90° and cropped off-origin. */
async function threePages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, words] of [
    "Alpha keep",
    "Bravo secret",
    "Charlie keep",
  ].entries()) {
    const page = doc.addPage([612, 792]);
    page.drawText(words, { x: 120, y: 500, size: 18, font });
    page.drawText(`${words} footer`, { x: 120, y: 120, size: 12, font });
    if (i === 1) {
      page.setCropBox(50, 60, 500, 700);
      page.setRotation(degrees(90));
    }
  }
  return doc.save({ useObjectStreams: false });
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const { pages } = await extractPdfText(bytes, legacy);
  return pages.map((p) => p.text);
}

describe("wholePageRedactions", () => {
  const sizes = [
    { width: 612, height: 792 },
    { width: 700, height: 500 },
    { width: 612, height: 792 },
  ];

  it("one box per listed page, the size of that page as displayed", () => {
    expect(wholePageRedactions("2-3", sizes)).toEqual([
      { page: 2, x: 0, y: 0, width: 700, height: 500 },
      { page: 3, x: 0, y: 0, width: 612, height: 792 },
    ]);
    expect(wholePageRedactions("3, 1, 3", sizes).map((r) => r.page)).toEqual([
      1, 3,
    ]);
  });

  it("every box it makes passes the validator both methods run", () => {
    expect(validateRedactions(wholePageRedactions("1-", sizes), sizes)).toEqual(
      [],
    );
  });

  it("refuses an empty list or a page past the end, in the range parser's words", () => {
    expect(() => wholePageRedactions("", sizes)).toThrow(PageRangeError);
    expect(() => wholePageRedactions("4", sizes)).toThrow(PageRangeError);
  });

  it("composed: a whole-page box removes that page's text, and only that page's", async () => {
    const bytes = await threePages();
    const before = await pageTexts(bytes);
    // Health: the fixture's text is readable, so an absence below means something.
    expect(before[1]).toContain("Bravo secret");
    expect(before[0]).toContain("Alpha keep");

    const sizes = await getRedactPageSizes(bytes);
    // The rotated, cropped page is displayed 700 × 500.
    expect(sizes[1]).toEqual({ width: 700, height: 500 });
    const rects = wholePageRedactions("2", sizes);
    const done = await redactPdfByRemoval(
      bytes,
      {
        rects,
        loadReader: legacy,
      },
      { decodeJpeg: null },
    );
    const after = await pageTexts(done.bytes);
    expect(after[1]).not.toMatch(/Bravo|secret|footer/);
    expect(after[0]).toContain("Alpha keep footer");
    expect(after[2]).toContain("Charlie keep footer");
  });
});
