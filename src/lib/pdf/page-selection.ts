/**
 * The ONE place a page selection is applied to extracted text.
 *
 * Two parties measure a selection and must get the same number: the browser,
 * which DECLARES the characters it is about to send (and is charged on that
 * declaration), and the worker, which READS them and sends them to the model.
 * Both call {@link selectExtraction}, so "charged for" and "sent" come from one
 * function over one shape — the pdfjs extractor and `parseLayoutText` both
 * produce `ExtractedPdfText`, and both put every page, blank ones included, in
 * `pages` with its real `pageNumber`.
 *
 * Pages are selected by `pageNumber`, never by position in a list of text
 * chunks: `pageTextChunks` drops empty pages, so a chunk's index is not its
 * page number, and selecting "page 3" by position would read page 4 of a
 * document whose page 2 is blank.
 *
 * Pure. Browser callers reach it only through `extractSelectionOnDemand`
 * (`./text-lazy`), so it never rides a page's first load.
 */

import type { PageSpan } from "./page-spans";
import { joinPageTexts, type ExtractedPdfText } from "./text";

/** Whether 1-based `page` lies inside one of `spans`. */
export function pageInSpans(page: number, spans: readonly PageSpan[]): boolean {
  for (const [first, last] of spans) {
    if (page >= first && page <= last) return true;
  }
  return false;
}

/**
 * `extracted` narrowed to the pages in `spans`, joined exactly as a whole
 * extraction is (`joinPageTexts`: the same normalization, the same
 * separator, empty pages dropped), so `text`, `characterCount` and `hasText`
 * describe only the chosen pages. `pageCount` stays the DOCUMENT's total:
 * notices say "pages 3–5 of 40".
 *
 * Built from `joinPageTexts` (text already read) rather than the extractors'
 * own `assembleExtraction`, which `text-reading-order.test.ts` reserves for
 * the routes; `page-selection.test.ts` holds "every page selected" equal to
 * the extraction itself on both extractors' shapes, so the two cannot drift.
 */
export function selectExtraction(
  extracted: ExtractedPdfText,
  spans: readonly PageSpan[],
): ExtractedPdfText {
  const pages = extracted.pages.filter((page) =>
    pageInSpans(page.pageNumber, spans),
  );
  const text = joinPageTexts(pages);
  return {
    pageCount: extracted.pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

/**
 * The first span that ends past the document (`pageCount` pages), or `null`
 * when every span lies inside it. Spans are canonical (ascending), so the
 * first such span is the one a refusal names.
 */
export function firstSpanBeyond(
  spans: readonly PageSpan[],
  pageCount: number,
): PageSpan | null {
  return spans.find(([, last]) => last > pageCount) ?? null;
}
