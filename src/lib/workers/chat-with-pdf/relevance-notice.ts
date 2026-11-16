/**
 * How chat's model notice says a relevance window's pages were chosen
 * (audit #30, chat-with-pdf#2, slice 3). A leaf, so the copy guard can read
 * the words the engine really sends (`src/lib/tools/chat-retrieval-claims.ts`
 * composes them through `modelTruncationNotice` into its shipped corpus)
 * without importing the engine's graph. Reword a notice here and the guard's
 * exemplar moves with it.
 */
import type { SelectionNoticeParts } from "../ai/truncation";
import type { RelevanceSource } from "@/lib/pdf/page-retrieval";

/** Every source a selection reports, for the corpus and the tests to walk. */
export const CHAT_RELEVANCE_SOURCES: readonly RelevanceSource[] = [
  "words",
  "cited",
  "mixed",
];

/**
 * Why the pages past the opening run were sent, as the selection reported
 * it. "chosen by the words they share with the question" is said ONLY when
 * every such page was: a follow-up whose sent page came from the previous
 * answer's citations alone shares no word with the question, and saying so
 * would be the model being told something false about its own input.
 */
const CHOSEN_BY: Readonly<Record<RelevanceSource, string>> = {
  words: "pages chosen by the words they share with the question",
  cited: "pages the previous answer cited",
  mixed: "pages chosen for this question",
};

/**
 * Two arms per source because "the opening pages and" is true only when the
 * selector reserves an anchor (`CHAT_RETRIEVAL_ANCHOR_SHARE > 0`) and the
 * window actually starts with one.
 */
export function chatRelevanceNotice(
  anchored: boolean,
  source: RelevanceSource,
): SelectionNoticeParts {
  return {
    chosenBy: anchored
      ? `the opening pages and ${CHOSEN_BY[source]}`
      : CHOSEN_BY[source],
    revocation:
      "If the answer is not in these pages, do NOT say the document does not contain it — " +
      "say which pages you can see and that the answer may be on a page you were not given.",
  };
}
