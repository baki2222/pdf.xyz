"use client";

/**
 * The end of a run, after its title: the receipt (`OutputFacts`) and the
 * row that carries the output on (`ContinueWith`) — ONE on-demand chunk,
 * fetched as a run starts (`warmEnding` in the runner kit) and drawn when
 * it finishes, never with the page. Everything in the runner kit lands in
 * every tool page's first load; these two, the hand-off launch and the page
 * count they bring with them, would have cost each page several KB for a
 * result most visits never reach. `lazy-chunks.test.ts` holds that no page
 * loads it up front, by the marker the receipt renders.
 */
export { OutputFacts } from "./output-facts";
export { ContinueWith } from "./continue-with";
export { RESULT_ENDING_CHUNK } from "./result-ending-chunk";
