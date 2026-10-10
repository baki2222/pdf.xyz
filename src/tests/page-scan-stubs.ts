/**
 * Page scans built by hand, for tests about what the PowerPoint WRITER does
 * with text it is given — characters XML cannot carry, a page with nothing on
 * it, slide naming — where the page reader (`pdf-office-export/page-scan`) is
 * not the subject. Tests about what the deck KEEPS from a PDF run the real
 * reader over a real PDF instead (`./pptx-fidelity-fixtures`).
 */
import type {
  PdfPageScan,
  PdfPageScanner,
  ScannedTextLine,
} from "@/lib/workers/pdf-office-export/page-scan";

/** One text line at a fixed left margin, `index` lines down the page. */
export function stubLine(
  text: string,
  index: number,
  size = 18,
): ScannedTextLine {
  return {
    kind: "text",
    x: 72,
    y: 72 + index * size * 1.5,
    width: text.length * size * 0.5,
    height: size * 1.1,
    rotation: 0,
    flipH: false,
    flipV: false,
    baseline: size * 0.85,
    runs: [
      {
        text,
        family: "Helvetica",
        fontClass: "sans",
        bold: false,
        italic: false,
        size,
        color: "000000",
        alpha: 1,
        invisible: false,
        spacing: 0,
      },
    ],
  };
}

/**
 * A scan of `pages`, each a list of lines; `pageNumbers` overrides the
 * numbering (a scan's pages are numbered from 1 unless a test says otherwise).
 */
export function textScan(
  pages: readonly (readonly string[])[],
  pageNumbers?: readonly number[],
): PdfPageScan {
  return {
    pageCount: pages.length,
    pages: pages.map((lines, i) => ({
      pageNumber: pageNumbers?.[i] ?? i + 1,
      width: 720,
      height: 540,
      items: lines.map((line, k) => stubLine(line, k)),
      picturesTooLarge: 0,
      picturesUndecoded: 0,
      flattened: false,
    })),
    undecodedImages: 0,
    tooLargeImages: 0,
  };
}

/** A scanner that returns `scan` for any input. */
export function scanning(scan: PdfPageScan): PdfPageScanner {
  return async () => scan;
}
