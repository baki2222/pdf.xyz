/**
 * What Summarize PDF's page choice says when it cannot be honoured — said
 * once, for the route and the panel (competitor audit summarize-pdf#5).
 *
 * The panel imports this module statically, so it is on Summarize PDF's
 * first load and must stay small: its one import is the page-spans leaf,
 * which the truncation notice already ships to that page.
 */

import { pagesPhrase, type PageSpan } from "@/lib/pdf/page-spans";

/**
 * `POST /api/jobs`'s refusal of a summarize job carrying `pages` when the
 * running worker does not prove `summarizePages` (`runningWorkerSummarizesPages`).
 *
 * "Nothing was charged" is true ONLY because the route refuses BEFORE the
 * ceiling peek and the allowance reservation; `summarize-pages.route.test.ts`
 * pins that order (the reserve spy is called zero times on every refusing
 * beat). Moving the gate below the reservation makes this sentence false.
 * The panel never shows it in normal use: it hides the control while the
 * key is unobserved.
 */
export const SUMMARIZE_PAGES_NOT_RUNNING_MESSAGE =
  "Choosing pages is not available on our server right now, so nothing was charged. Summarize the whole document, or try again later.";

/**
 * The panel's rollback warning: the person chose pages, and the completed
 * job's result does not confirm that only those pages were read
 * (`selectionConfirmed` in `./selection-echo`). Shown INSTEAD of the
 * selection sentence, never beside it.
 */
export const SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE =
  "Our server did not confirm that it read only the pages you chose, so this summary may cover other pages. Check it against your PDF before relying on it.";

/**
 * The ONE sentence for a span outside the document, singular for one page
 * ("so page 7 cannot be summarized"). Both sides say it: the worker's
 * refusal below, and the panel's refusal before upload
 * (`judgeSummarizeRun` in `@/lib/workers/summarize-measure`), each adding
 * only what is true on its side of the upload.
 */
export function pagesOutOfRangeSentence(total: number, span: PageSpan): string {
  return `This PDF has ${total} ${total === 1 ? "page" : "pages"}, so ${pagesPhrase([span])} cannot be summarized.`;
}

/**
 * The worker's refusal of a span past the end of the document
 * (`pages_out_of_range`, before any provider call). The route reserved the
 * allowance before the worker refused, and that is not refunded (the
 * allowance FAQ's cross-tool ruling), so this must never say or imply that
 * nothing was charged — only that nothing was sent. The panel's copy test
 * renders this sentence and holds it to that.
 */
export function pagesOutOfRangeMessage(
  total: number,
  beyond: PageSpan,
): string {
  return `${pagesOutOfRangeSentence(total, beyond)} Nothing was sent to the AI model.`;
}

/**
 * What Summarize and Translate say when the pages a person CHOSE hold no
 * selectable text, though the document as a whole does (Summarize's page
 * range, audit summarize-pdf#5; Translate's, audit #29 slice 6). One owner for both sides of the upload, like
 * `NO_SELECTABLE_TEXT_MESSAGE` in `./ai-no-text` — but HERE, not there:
 * `./ai-no-text` is on every worker panel's first load (through
 * `pdf-security-client`), and the panel's lazy judgement using this export
 * kept it in that shared module, +42..47 B gz on 20 tool pages that never show
 * it (measured 2026-11-16 on the merged build). The worker refuses with it
 * after the route reserved the allowance (not refunded, the allowance FAQ's
 * cross-tool ruling), so it says nothing about charging; the panel's
 * pre-upload refusal appends its own "Nothing was uploaded."
 */
export const NO_TEXT_IN_CHOSEN_PAGES_MESSAGE = {
  "summarize-pdf":
    "The pages you chose have no selectable text. Choose other pages, or run OCR PDF first.",
  // Translate's page range (audit #29 slice 6): the same fact, the same
  // sentence, keyed by its tool so each side reads its own entry.
  "translate-pdf":
    "The pages you chose have no selectable text. Choose other pages, or run OCR PDF first.",
} as const;
