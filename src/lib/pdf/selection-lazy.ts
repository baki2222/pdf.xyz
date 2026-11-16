import type { ExtractedPdfText, PdfTextReader } from "./text";

/**
 * One extraction plus the selection function, for a Summarize Run that may
 * read only some pages: the browser's half of "charged for == sent" (see
 * `./page-selection`, which the worker calls too).
 *
 * A module of its own, not an export of `./text-lazy` (review of audit
 * summarize-pdf#5, measured 2026-11-16 on the merged build): `./text-lazy`
 * is on AI Extract's first load as well as Summarize's, and an export there
 * rode AI Extract's page (+82 B gz of module) for a function only Summarize
 * calls.
 *
 * The two chunks are fetched in PARALLEL — chained `await import()`s cost one
 * round trip each — because the selection chunk's request starts before the
 * text chunk is awaited. `extractPdfText` is destructured straight from its
 * `await import()` (so the text-reading-order guard can see which export is
 * taken).
 */
export async function extractSelectionOnDemand(
  bytes: Uint8Array,
  /** See `PdfTextReader`; tests pass pdfjs's legacy build. */
  loadReader?: PdfTextReader,
): Promise<{
  extracted: ExtractedPdfText;
  select: typeof import("./page-selection").selectExtraction;
}> {
  const selection = import("./page-selection");
  // Handled here so a failed text chunk does not leave it rejecting unseen.
  selection.catch(() => undefined);
  const { extractPdfText } = await import("./text");
  const { selectExtraction } = await selection;
  return {
    extracted: await extractPdfText(bytes, loadReader),
    select: selectExtraction,
  };
}
