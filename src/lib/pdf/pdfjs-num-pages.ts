import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "./engine-errors";

/**
 * pdf.js's page count, or a typed refusal. pdf.js reports the root /Count as
 * given when it is 0 or negative, and `getPage(1)` then refuses ("Invalid
 * page request"), so there is no page it can read: the honest answer is the
 * unreadable-file copy, never "-1 pages" or "no text" (hostile CO-03, PS-11).
 *
 * Its own module, so Compare's card count (which imports it statically) does
 * not carry the stream preflight in ./pdfjs-guard into its chunk.
 */
export function pdfjsPageCount(numPages: unknown): number {
  if (typeof numPages === "number" && Number.isInteger(numPages)) {
    if (numPages >= 1) return numPages;
  }
  throw new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable" });
}
