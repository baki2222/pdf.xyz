import { pagesWithoutText, type ExtractedPdfText } from "./text";

type ExtractedForSummary = Pick<
  ExtractedPdfText,
  "pageCount" | "pages" | "text" | "hasText"
>;

/**
 * Which pages PDF to Text's result came from: "3 pages", or "28 of 40 pages"
 * when some gave nothing ({@link pagesWithoutText}). The join leaves no marker
 * where an empty page was, so without the "of" a partly scanned document read
 * as "from 40 pages" when twelve of them contributed nothing.
 *
 * The ONE definition: the result line and the screen-reader announcement both
 * read it, so they cannot disagree about the pages.
 */
export function extractedPagesLabel(result: ExtractedForSummary): string {
  const empty = pagesWithoutText(result.pages);
  return empty.length > 0
    ? `${result.pageCount - empty.length} of ${result.pageCount} pages`
    : `${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`;
}

/**
 * PDF to Text's result line: "<n> characters from <pages>". Null when there
 * is no text.
 *
 * <n> counts Unicode code points, not `characterCount`: that field is
 * `text.length`, UTF-16 code units, and is kept so because the AI tools
 * declare it against a worker that measures `.length` too. Shown to a reader
 * as "characters", it counted every emoji, mathematical alphanumeric or CJK
 * Extension B ideograph twice (audit #50, 2026-11-06).
 *
 * Lives outside `./text` on purpose: that module's exports each carry a
 * reading-order role (text-reading-order.test.ts), and this reads nothing —
 * it describes text a route already read.
 */
export function extractedTextSummary(
  result: ExtractedForSummary,
): string | null {
  if (!result.hasText) return null;
  let characters = 0;
  for (const _ of result.text) characters += 1;
  return `${characters.toLocaleString()} characters from ${extractedPagesLabel(result)}`;
}
