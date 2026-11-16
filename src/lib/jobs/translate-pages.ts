/**
 * Translate PDF's chosen pages (competitor audit #29, slice 6): the sentences
 * about a page selection that more than one side of the upload shows.
 *
 * Imports nothing at runtime, like `./summarize-pages`. Kept apart from that
 * module on purpose: `./summarize-pages` is on Summarize's first load, and a
 * second importer from Translate's page would split it out of Summarize's
 * concatenation (memory "second importer breaks concatenation").
 */

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
