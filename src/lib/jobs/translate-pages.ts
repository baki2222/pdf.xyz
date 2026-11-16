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
import { selectionConfirmed } from "./selection-echo";

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
 * What a reader is told about a job that chose pages: the pages the person
 * CHOSE, and that no other page was sent. One author for the panel,
 * translation.md, the README and the manifest; "" for a whole-document job
 * (`chosenSpans` reads no selection).
 *
 * "You chose" reads `chosen`, the request's own spans (`options.pages` on the
 * worker, what the panel sent), never `window.pagesSent`: a truncated window
 * clips `pagesSent` at the last page whose text started before the cut, so
 * reading it here said the person chose fewer pages than they did (review
 * 2026-11-17). What the window READ is stated separately, from the window,
 * only when it stops short of the last chosen page ("; this translation
 * reached page 6") — the same number the truncation notice names.
 *
 * `chosen` that the window does not confirm (`selectionConfirmed`: a filter
 * that did nothing echoes other pages) gives "": no sentence is better than
 * "No other page was sent" over a job that sent other pages, and the panel
 * shows its rollback warning there instead. With no `chosen` (a panel that
 * resumed a job and never saw the request), an untruncated window's pages
 * are the choice; a truncated one is named only as what was read.
 *
 * It never says "translated" or "covers": the delivery cap may withhold a
 * tail and a failed call may leave a run untranslated, and both are reported
 * elsewhere (`delivery`, the positioned gaps), so this sentence stays true
 * beside either.
 */
export function translateSelectionSentence(
  window: {
    readonly totalPages: number;
    readonly truncated: boolean;
    readonly selection?: unknown;
    readonly pagesSent?: readonly PageSpan[];
  },
  chosen?: readonly PageSpan[] | null,
): string {
  const read = chosenSpans(window);
  if (read === null) return "";
  const total = window.totalPages;
  const lastRead = read[read.length - 1]![1];
  const tail = "No other page was sent to the AI model.";
  if (chosen && chosen.length > 0) {
    if (!selectionConfirmed(chosen, window)) return "";
    const reach =
      lastRead < chosen[chosen.length - 1]![1]
        ? `; this translation reached page ${lastRead}`
        : "";
    return `You chose ${pagesPhrase(chosen)} of ${total}${reach}. ${tail}`;
  }
  return window.truncated
    ? `This translation read ${pagesPhrase(read)} of ${total}. ${tail}`
    : `You chose ${pagesPhrase(read)} of ${total}. ${tail}`;
}
