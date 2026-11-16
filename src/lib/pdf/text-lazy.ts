import type { ExtractedPdfText } from "./text";

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
