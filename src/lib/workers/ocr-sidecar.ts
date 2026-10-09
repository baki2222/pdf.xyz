/**
 * Filling the pages OCRmyPDF skipped back into its text sidecar.
 *
 * OCR runs with `--skip-text` by default (see `nativeOcrArgs`): a page that
 * already carries text keeps it, untouched. That is what stops a searchable or
 * partly-digital PDF from aborting the whole job. But OCRmyPDF's `--sidecar`
 * does not copy a skipped page's text — it writes a placeholder instead,
 * `[OCR skipped on page N]`, one chunk per page separated by form feeds. So a
 * user who asked for the text of a mixed document would get the scanned pages'
 * text and a placeholder where every digital page should be, in a job that
 * "succeeded" with a non-empty .txt.
 *
 * The existing text layer IS the text of those pages, so it is read with
 * poppler (already on the worker for the text tools) and put where the
 * placeholder was. Anything that cannot be mapped with certainty is left as
 * OCRmyPDF wrote it: a page count that disagrees, a placeholder naming a
 * different page than its position, or an empty extraction. The placeholder is
 * honest; a misplaced page would not be.
 *
 * Node-free and pure, so it is tested without an engine.
 */

/** OCRmyPDF's page separator in a merged sidecar. */
export const SIDECAR_PAGE_BREAK = "\f";

/**
 * A skipped page's placeholder. Tolerant of the wording variants OCRmyPDF has
 * used (`page`, `pages`, `page(s)`), but the first number must be the page.
 */
const SKIPPED_PLACEHOLDER =
  /^\[OCR skipped on page(?:s|\(s\))?\s+(\d+)[^\]]*\]$/;

/** The 1-based page numbers whose sidecar chunk is a skip placeholder. */
export function skippedSidecarPages(sidecar: string): number[] {
  const pages: number[] = [];
  sidecar.split(SIDECAR_PAGE_BREAK).forEach((chunk, index) => {
    if (SKIPPED_PLACEHOLDER.test(chunk.trim())) pages.push(index + 1);
  });
  return pages;
}

/**
 * Replace each skip placeholder with that page's existing text.
 *
 * `pageTexts[i]` is page `i + 1`'s text layer. Returns the sidecar unchanged
 * (and `filled: []`) when the page counts disagree — there is then no safe way
 * to say which chunk is which page.
 */
export function fillSkippedSidecarPages(
  sidecar: string,
  pageTexts: readonly string[],
): { text: string; filled: number[] } {
  const chunks = sidecar.split(SIDECAR_PAGE_BREAK);
  if (chunks.length !== pageTexts.length) return { text: sidecar, filled: [] };
  const filled: number[] = [];
  const out = chunks.map((chunk, index) => {
    const match = SKIPPED_PLACEHOLDER.exec(chunk.trim());
    if (!match || Number(match[1]) !== index + 1) return chunk;
    const existing = pageTexts[index] ?? "";
    if (existing.trim().length === 0) return chunk;
    filled.push(index + 1);
    return existing;
  });
  return { text: out.join(SIDECAR_PAGE_BREAK), filled };
}
