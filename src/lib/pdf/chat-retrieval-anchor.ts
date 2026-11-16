/**
 * The anchor share for Chat with PDF's page retrieval, and the one sentence
 * the panel says about it (audit #30, chat-with-pdf#2, slice 3).
 *
 * A LEAF, with no imports, because two sides need the same number: the
 * worker's selector (`./page-retrieval`, re-exported there) and the chat
 * panel's gated line, which ships to the browser. `page-retrieval.ts` must
 * not reach `.next/static` (the bundle check greps for its segmenter
 * sample), so the panel cannot import the constant from there.
 */

/**
 * The share of the document budget reserved for the opening pages before any
 * page is chosen by relevance. NOT a taste: `page-retrieval.eval.test.ts`
 * runs the selector over its corpus at every share in
 * {@link CHAT_RETRIEVAL_ANCHOR_SHARES}, and fails unless this equals the
 * share with the highest overall recall (ties to the LARGER share, which is
 * closer to main for early facts and keeps a longer stable prefix for the
 * provider's automatic prefix cache). Change the corpus or the selector and
 * that test says what this must become.
 *
 * History. First measured 2026-11-16 WITHOUT a coverage gate (overall
 * recall, 56 cases): 0 → 0.75, 1/8 → 0.75, 1/4 → 0.79, 1/3 → 0.80,
 * 1/2 → 0.82, so this was 1/2. The anchor was doing a second job then:
 * shielding early paraphrased facts (class C: 0.00 at 0, 0.71 at 1/2,
 * against main's 1.00) from pages that share one word of the question.
 * Review found C below main; the coverage gate
 * (`CHAT_RETRIEVAL_MIN_COVERAGE`) now does that job. Re-measured WITH it:
 * 0, 1/8, 1/4 and 1/3 → 0.88 (every class but the honest-miss D at 1.00),
 * 1/2 → 0.86 (B 0.88). The tie goes to the larger share, so 1/3. The
 * margin is one B case; the test, not this paragraph, is the bound.
 */
export const CHAT_RETRIEVAL_ANCHOR_SHARE = 1 / 3;

/** The shares the anchor sweep measures (brief D1). */
export const CHAT_RETRIEVAL_ANCHOR_SHARES: readonly number[] = [
  0,
  1 / 8,
  1 / 4,
  1 / 3,
  1 / 2,
];

/**
 * The panel's line about how a longer file's pages are chosen, shown ONLY
 * when the observed worker proves `chatRetrieval` (brief step 6). Chosen from
 * the measured share rather than typed for one outcome of the sweep: "the
 * opening pages and" is true only while some budget is reserved for them.
 *
 * "less common" is the algorithm, not a flourish: a word on more than half
 * the pages weighs 0 (Robertson IDF clamped at 0, brief D4), so "the most
 * words" would be false for "what", "is" and "the".
 */
export function chatRetrievalPanelLine(anchorShare: number): string {
  return anchorShare > 0
    ? "For a longer file, each question is sent the opening pages and the pages that share the most of its less common words."
    : "For a longer file, each question is sent the pages that share the most of its less common words, or the opening pages when none do.";
}
