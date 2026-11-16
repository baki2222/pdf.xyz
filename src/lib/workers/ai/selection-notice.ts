/**
 * Summarize's selection sentence: "This summary covers pages 3–5 of 40, the
 * pages you chose." Its own module, beside `./truncation` rather than in it
 * (review of audit summarize-pdf#5, measured 2026-11-16 on the merged build):
 * the Summarize panel imports this sentence statically, and while it lived in
 * `./truncation` that second importer stopped webpack concatenating
 * `./truncation` into `truncation-notice.tsx`, so every AI panel (Chat,
 * Translate, AI Extract) paid a module wrapper plus this function for a
 * sentence only Summarize shows. The worker's engine and the panel both
 * call this one function, so summary.md and the panel cannot disagree.
 */
import type { TruncationWindow } from "./truncation";
import { chosenSpans, pagesIn, pagesPhrase } from "@/lib/pdf/page-spans";

/**
 * The sentence the panel and summary.md show beside a summary of chosen
 * pages, from the window alone: "This summary covers page 4 of 40, the page
 * you chose." Empty when the window names no chosen pages (a whole-document
 * or prefix run, or any other tool). Truncated, it names the pages READ
 * (`pagesSent` is already the clipped list) and `userTruncationNotice` says
 * why the rest was not.
 */
export function userSelectionNotice(window: TruncationWindow): string {
  const spans = chosenSpans(window);
  if (!spans) return "";
  const single = pagesIn(spans) === 1;
  return `This summary covers ${pagesPhrase(spans)} of ${window.totalPages}, ${single ? "the page" : "the pages"} you chose.`;
}
