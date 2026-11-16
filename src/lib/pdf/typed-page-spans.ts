/**
 * The ONE author of "what pages did the person type": text such as
 * "1-3, 8" read against the page count of the extraction the browser holds,
 * turned into the canonical wire spans (`pageSpansFromIndices`), bounded by
 * the wire's span limit, and collapsed to "the whole document" when it names
 * every page.
 *
 * Two panels ask it: Summarize PDF (`summarize-measure.ts`, slice 5 of
 * competitor audit summarize-pdf#5) and Translate PDF (competitor audit #29,
 * slice 6). Until slice 6 Summarize held the steps inline; a second panel
 * would have been a second copy of the grammar's last mile, so both read it
 * here.
 *
 * {@link coversEveryPage} is the rule "a selection naming every page is the
 * whole document" — sent with no `pages` key, needing no admission, charged
 * exactly as a whole-document run. It is exported because Summarize also
 * applies it to a bookmarked section, which does not pass through the typed
 * text: one author for the rule, not a helper plus an inline copy.
 *
 * LAZY-ONLY: it imports the typed grammar (`./ranges`) and the wire half
 * (`@/lib/jobs/page-spans-option` → responses), which no page needs before
 * Run. Imported only by the measures, which the panels load with `import()`.
 * Not an export of `page-spans-option.ts`: that module is on Summarize's
 * first load (through `summarize-pdf.ts`), and `./ranges` must not ride it.
 */

import {
  MAX_PAGE_SPANS,
  pageSpansFromIndices,
} from "@/lib/jobs/page-spans-option";
import type { PageSpan } from "./page-spans";
import { PageRangeError, parsePageList } from "./ranges";

/** The refusal for more spans than one request may name. */
export const TOO_MANY_PAGE_SPANS_MESSAGE = `Choose at most ${MAX_PAGE_SPANS} separate page ranges.`;

/**
 * Whether canonical `spans` name every page of a `pageCount`-page document:
 * exactly one span, from page 1 to the last page.
 */
export function coversEveryPage(
  spans: readonly PageSpan[],
  pageCount: number,
): boolean {
  return spans.length === 1 && spans[0]![0] === 1 && spans[0]![1] === pageCount;
}

/** The verdict on typed page text. */
export type TypedPageSpans =
  | {
      ok: true;
      /** The canonical spans, or `null` when they cover every page. */
      spans: PageSpan[] | null;
    }
  | {
      ok: false;
      /** The grammar's own sentence. Callers add what their refusal adds. */
      message: string;
    };

/**
 * Read `text` against a `pageCount`-page document. A refusal carries
 * `parsePageList`'s own sentence (e.g. "This PDF has 5 pages — "6" is out of
 * range.") or {@link TOO_MANY_PAGE_SPANS_MESSAGE}; anything else
 * `parsePageList` throws is a bug and is rethrown.
 */
export function typedPageSpans(
  text: string,
  pageCount: number,
): TypedPageSpans {
  let spans: PageSpan[];
  try {
    spans = pageSpansFromIndices(parsePageList(text, pageCount));
  } catch (error) {
    if (error instanceof PageRangeError)
      return { ok: false, message: error.message };
    throw error;
  }
  if (spans.length > MAX_PAGE_SPANS)
    return { ok: false, message: TOO_MANY_PAGE_SPANS_MESSAGE };
  return { ok: true, spans: coversEveryPage(spans, pageCount) ? null : spans };
}
