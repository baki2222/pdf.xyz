/**
 * Translate PDF's chosen pages (competitor audit #29, slice 6): the sentences
 * about a page selection that more than one side of the upload shows.
 *
 * Its one import is the page-spans leaf, like `./summarize-pages`, and its
 * phrase author is that leaf's `pagesPhrase` (the page-spans guard holds both
 * modules to it). Kept apart from `./summarize-pages` on purpose:
 * that module is on Summarize's first load, and a second importer from
 * Translate's page would split it out of Summarize's concatenation (memory
 * "second importer breaks concatenation"), so the out-of-range sentence is
 * written here with Translate's verb rather than parametrised there.
 */

import { chosenSpans, pagesPhrase, type PageSpan } from "@/lib/pdf/page-spans";

/**
 * The route's refusal of a translate job carrying `pages` while the running
 * worker does not prove `translatePageRange`
 * (`runningWorkerTranslatesPageRanges`). "nothing was charged" is true ONLY
 * because the route refuses BEFORE the spend-ceiling peek and the allowance
 * reservation; `translate-page-range.route.test.ts` pins that order with
 * spies that must stay uncalled.
 */
export const TRANSLATE_PAGES_NOT_RUNNING_MESSAGE =
  "Choosing pages is not available on our server right now, so nothing was charged. Translate the whole document, or try again later.";

/**
 * The panel's rollback warning: the person chose pages, and the completed
 * job's result does not confirm that only those pages were sent
 * (`selectionConfirmed` in `./selection-echo`). Shown INSTEAD of
 * {@link translateSelectionSentence}, never beside it.
 */
export const TRANSLATE_PAGES_UNCONFIRMED_MESSAGE =
  "Our server did not confirm that it translated only the pages you chose, so this translation may include other pages. Check it against your PDF before relying on it.";

/**
 * The ONE sentence for a span outside the document, singular for one page
 * ("so page 7 cannot be translated"). The worker's refusal below adds what
 * is true on its side; the panel's refusal before upload adds its own.
 */
export function translatePagesOutOfRangeSentence(
  total: number,
  span: PageSpan,
): string {
  return `This PDF has ${total} ${total === 1 ? "page" : "pages"}, so ${pagesPhrase([span])} cannot be translated.`;
}

/**
 * The worker's refusal of a span past the end of the document
 * (`pages_out_of_range`, before any provider call). The route reserved the
 * allowance before the worker refused, and that is not refunded (the
 * allowance FAQ's cross-tool ruling), so this must never say or imply that
 * nothing was charged: only that nothing was sent.
 */
export function translatePagesOutOfRangeMessage(
  total: number,
  beyond: PageSpan,
): string {
  return `${translatePagesOutOfRangeSentence(total, beyond)} Nothing was sent to the AI model.`;
}

/**
 * What a reader is told about a job that chose pages: the chosen pages, and
 * that no other page was sent. One author for the panel, translation.md, the
 * README and the manifest; "" for a whole-document job (`chosenSpans` reads
 * no selection).
 *
 * It claims only what `pagesSent` supports: the pages in the job's read
 * window (`AiWindowMeta.pagesSent`). It never says "translated" or "covers":
 * the delivery cap may withhold a tail and a failed call may leave a run
 * untranslated, and both are reported elsewhere (`delivery`, the positioned
 * gaps), so this sentence stays true beside either.
 */
export function translateSelectionSentence(window: {
  readonly totalPages: number;
  readonly selection?: unknown;
  readonly pagesSent?: readonly PageSpan[];
}): string {
  const spans = chosenSpans(window);
  if (spans === null) return "";
  return `You chose ${pagesPhrase(spans)} of ${window.totalPages}. No other page was sent to the AI model.`;
}
