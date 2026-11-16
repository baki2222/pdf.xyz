/**
 * Page spans: a sorted set of page numbers written as ranges ("1–3, 17,
 * 58–61"). A dependency-free leaf, because three places print the same list
 * and the list must have one author:
 *
 *  - the chat worker's model notice and manifest (`pagesSent`);
 *  - `buildAiResultMeta`, which re-bounds the spans a worker wrote;
 *  - `userTruncationNotice`, which ships to the browser inside
 *    `truncation-notice.tsx` (a `"use client"` component).
 *
 * The last one is why this is not part of `page-retrieval.ts`: whatever this
 * module imports ships in every AI panel's chunk, and the retrieval code
 * must not. `page-retrieval.ts` imports this file, never the reverse.
 *
 * A span joins page NUMBERS that are consecutive, not chunks that are
 * adjacent: pages 3 and 5 with a blank page 4 between them are two spans,
 * "3, 5", because page 4 was never sent and a range would say it was.
 */

/**
 * One inclusive `[first, last]` range of 1-based PHYSICAL page numbers (1 is
 * the first page object in document order, never a printed /PageLabels
 * label). Type-only, so naming it here costs this leaf nothing at runtime.
 */
export type PageSpan = readonly [number, number];

/** Consecutive page numbers merged into inclusive `[first, last]` ranges. */
export function pageSpans(pages: readonly number[]): [number, number][] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (const page of sorted) {
    const last = spans[spans.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else spans.push([page, page]);
  }
  return spans;
}

/** Spans written for a reader: "1–3, 17, 58–61" (an en dash, a comma and a space). */
export function formatSpans(
  spans: readonly (readonly [number, number])[],
): string {
  return spans
    .map(([first, last]) => (first === last ? `${first}` : `${first}–${last}`))
    .join(", ");
}

/** How many pages `spans` cover. */
export const pagesIn = (spans: readonly PageSpan[]): number =>
  spans.reduce((sum, [first, last]) => sum + last - first + 1, 0);

/**
 * "page 4", "pages 3–5 and 9", "pages 1, 3 and 5–6": each span in
 * `formatSpans`'s own words (one author for "3–5"), joined with a final
 * "and" for a reader, singular for exactly one page. The one phrase for a
 * span in a sentence: the truncation notices, Summarize's section labels and
 * its out-of-range refusal (`src/lib/pdf/page-spans.guard.test.ts` holds
 * every module that imports this leaf to it).
 */
export function pagesPhrase(spans: readonly PageSpan[]): string {
  const parts = spans.map((span) => formatSpans([span]));
  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
  return `${pagesIn(spans) === 1 ? "page" : "pages"} ${list}`;
}

/**
 * The pages a PERSON chose, as an AI window names them: `pagesSent` on a
 * window WITHOUT `selection` (a relevance window is chat's and has its own
 * path), or null. Structural, so this leaf imports no type: the truncation
 * notices and Summarize's selection sentence
 * (`@/lib/workers/ai/selection-notice`) both read it.
 */
export function chosenSpans(window: {
  readonly selection?: unknown;
  readonly pagesSent?: readonly PageSpan[];
}): readonly PageSpan[] | null {
  if (window.selection !== undefined) return null;
  const spans = window.pagesSent;
  return spans && spans.length > 0 ? spans : null;
}

/** The spans of `pages` and the text that names them. */
export function formatPageSpans(pages: readonly number[]): {
  spans: [number, number][];
  text: string;
} {
  const spans = pageSpans(pages);
  return { spans, text: formatSpans(spans) };
}
