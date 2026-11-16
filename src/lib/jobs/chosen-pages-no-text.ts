/**
 * What Summarize and Translate say when the pages a person CHOSE hold no
 * selectable text, though the document as a whole does (Summarize's page
 * range, audit summarize-pdf#5; Translate's, audit #29 slice 6). One owner
 * for both tools and both sides of the upload, like
 * `NO_SELECTABLE_TEXT_MESSAGE` in `./ai-no-text`.
 *
 * WHY A LEAF OF ITS OWN, and who may import it. Its readers are the two
 * lazy measures (`summarize-measure`, `translate-measure`) and the two
 * engines, and NEITHER PANEL. Each move it has made was measured on a
 * merged build:
 *  - in `./ai-no-text` (on every worker panel's first load through
 *    `pdf-security-client`), the lazy judgement's use kept it in that shared
 *    module: +42..47 B gz on 20 tool pages that never show it (2026-11-16,
 *    Summarize S5);
 *  - in `./summarize-pages` (which the Summarize panel imports statically for
 *    its rollback warning), Translate's key rode Summarize's first load, and
 *    Translate's lazy measure became a second importer of that module, so
 *    webpack shipped `summarize-pages` in two chunks, Summarize's panel chunk
 *    and Translate's measure chunk (2026-11-16, Translate S6; the budget
 *    entry in `src/deploy/bundle-budget.test.ts` records the bytes).
 * Here, it is on no page's first load and in each tool's measure chunk once.
 * `chosen-pages-no-text.test.ts` holds the importer set to that rule.
 *
 * The worker refuses with it after the route reserved the allowance (not
 * refunded, the allowance FAQ's cross-tool ruling), so it says nothing about
 * charging; the panel's pre-upload refusal appends its own "Nothing was
 * uploaded."
 */
export const NO_TEXT_IN_CHOSEN_PAGES_MESSAGE = {
  "summarize-pdf":
    "The pages you chose have no selectable text. Choose other pages, or run OCR PDF first.",
  // Translate's page range (audit #29 slice 6): the same fact, the same
  // sentence, keyed by its tool so each side reads its own entry.
  "translate-pdf":
    "The pages you chose have no selectable text. Choose other pages, or run OCR PDF first.",
} as const;
