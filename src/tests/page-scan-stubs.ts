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
      picturesUnverified: false,
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

/**
 * A page reader that finds no page and so no picture: for tests about PDF to
 * Word's TEXT — its paragraphs, page breaks, refusals and coverage — run on
 * bytes that are not a real PDF, where the stub extraction IS the document.
 * Never for a test about what the .docx keeps of a real PDF: those run the
 * real reader over a real one (`pdf-office-export/docx-pictures.test.ts`).
 * Since 2026-10-17 PDF to Word answers `unsupported` without a page reader.
 */
export const noPictures: PdfPageScanner = async () => ({
  pageCount: 0,
  pages: [],
  undecodedImages: 0,
  tooLargeImages: 0,
});

/**
 * A page reader that SAW `pageCount` pages and found nothing on them: for
 * tests about which pages of a Word export put nothing in the file. Since
 * the review of 2026-10-17 only a page the reader saw to be empty is called
 * that (`emptyPageCount`); {@link noPictures} sees no page at all, so of its
 * pages nothing is claimed.
 */
export function blankPages(pageCount: number): PdfPageScanner {
  return async () => ({
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      width: 612,
      height: 792,
      items: [],
      picturesTooLarge: 0,
      picturesUndecoded: 0,
      picturesUnverified: false,
      flattened: false,
    })),
    undecodedImages: 0,
    tooLargeImages: 0,
  });
}
