/**
 * How chat's model notice says a relevance window's pages were chosen
 * (audit #30, chat-with-pdf#2, slice 3). A leaf, so the copy guard can read
 * the words the engine really sends (`src/lib/tools/chat-retrieval-claims.ts`
 * composes them through `modelTruncationNotice` into its shipped corpus)
 * without importing the engine's graph. Reword a notice here and the guard's
 * exemplar moves with it.
 */
import type { SelectionNoticeParts } from "../ai/truncation";

/**
 * Two arms because "the opening pages and" is true only when the selector
 * reserves an anchor (`CHAT_RETRIEVAL_ANCHOR_SHARE > 0`) and the window
 * actually starts with one.
 */
export function chatRelevanceNotice(anchored: boolean): SelectionNoticeParts {
  return {
    chosenBy: anchored
      ? "the opening pages and pages chosen by the words they share with the question"
      : "pages chosen by the words they share with the question",
    revocation:
      "If the answer is not in these pages, do NOT say the document does not contain it — " +
      "say which pages you can see and that the answer may be on a page you were not given.",
  };
}
