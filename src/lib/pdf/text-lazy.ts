import type { ExtractedPdfText, PdfTextReader } from "./text";

/**
 * `extractPdfText`, with the text module fetched when it is first called
 * rather than with the page. The per-call AI panels (Summarize, AI Extract)
 * read text only once Run is pressed — the preflight and the declared count —
 * and loaded `./text` up front until 2026-10-30. pdfjs behind it was already
 * on demand.
 *
 * Destructured from the `import()` on purpose: webpack then keeps only the
 * export used here, so the pages that import `./text` statically (PDF to
 * Text, Compare, Split, PDF to Markdown) do not pay for every export name a
 * namespace import would keep (+0.17 KB gz each, measured on the first
 * draft, which used `(await import(...)).extractPdfText`).
 */
export async function extractPdfTextOnDemand(
  bytes: Uint8Array,
): Promise<ExtractedPdfText> {
  const { extractPdfText } = await import("./text");
  return extractPdfText(bytes);
}

/**
 * One extraction plus the selection function, for a Run that may summarize
 * only some pages: the browser's half of "charged for == sent" (see
 * `./page-selection`, which the worker calls too).
 *
 * The two chunks are fetched in PARALLEL — chained `await import()`s cost one
 * round trip each — because the selection chunk's request starts before the
 * text chunk is awaited. `extractPdfText` is destructured straight from its
 * `await import()` for the reason given above (and so the text-reading-order
 * guard can see which export is taken).
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
