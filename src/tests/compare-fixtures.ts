/**
 * Real PDFs for Compare PDF's tests, read by the extractor that ships.
 *
 * Each document is written page by page with pdf-lib — one entry per page,
 * one string per line, `[]` for a page with no text — and read back through
 * `extractPdfText` with pdf.js's LEGACY build (the same parser and text layer
 * as the browser build, with the polyfills Node lacks). A test file that
 * uses these loads the native canvas and must carry `// @native-canvas`.
 *
 * The font goes through the product's own boundary (`embedDrawingFont`), as
 * `pdf-text-fixtures.ts` explains: the text-drawing guards scan every
 * non-test module, this one included.
 */
import { PDFDocument } from "pdf-lib";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

export type PageLines = readonly string[];

/** One page per entry, each line drawn 18 pt below the one before. */
export async function linesPdf(
  pages: readonly PageLines[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, pages.flat());
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => {
      page.drawText(line, { x: 48, y: 740 - i * 18, size: 11, font });
    });
  }
  return doc.save();
}

export const legacyReader = () => import("pdfjs-dist/legacy/build/pdf.mjs");

/** `extractPdfText`, reading with pdf.js's legacy build. */
export function extractLegacy(bytes: Uint8Array): Promise<ExtractedPdfText> {
  return extractPdfText(bytes, legacyReader);
}

/** A document as the comparison takes it, from its pages. */
export async function comparablePdf(
  name: string,
  pages: readonly PageLines[],
): Promise<ComparablePdfText> {
  const bytes = await linesPdf(pages);
  return {
    name,
    size: bytes.byteLength,
    extracted: await extractLegacy(bytes),
  };
}

/** `count` body lines tagged with `tag`, so no two pages share one. */
export function body(tag: string, count = 8): string[] {
  return Array.from({ length: count }, (_, i) => `${tag} body line ${i + 1}`);
}

/**
 * The page-header case (audit compare-pdf#4): a three-page original, and a
 * revision that inserts a page before page 2 and edits one line of the old
 * page 2 — so the edit sits on page 2 of the first file and page 3 of the
 * second. `blank` puts an empty page before the inserted one in the
 * revision, so a page number counted from the text chunks instead of read
 * from the page is off by one there.
 */
export function pageHeaderPair(
  opts: { insert?: boolean; blank?: boolean } = {},
): { left: PageLines[]; right: PageLines[]; edited: [string, string] } {
  const { insert = true, blank = false } = opts;
  const p1 = body("alpha");
  const p2 = body("bravo");
  const p3 = body("charlie");
  const before = "Total due: 100";
  const after = "Total due: 120";
  const left = [p1, [...p2.slice(0, 6), before, ...p2.slice(6)], p3];
  const revised = [...p2.slice(0, 6), after, ...p2.slice(6)];
  const right = [
    p1,
    ...(blank ? [[]] : []),
    ...(insert ? [body("inserted")] : []),
    revised,
    p3,
  ];
  return { left, right, edited: [before, after] };
}
