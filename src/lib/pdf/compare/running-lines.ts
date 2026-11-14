/**
 * Running lines: what a document repeats at the edge of its pages — a page
 * number, a running title, a company name on every page's top line. With
 * "Ignore page headers and numbers" on, Compare PDF leaves them out of both
 * sides before diffing, so a re-paginated document is not reported as a
 * change on every page.
 *
 * Only a page's EDGE lines are candidates (its first two and last two), so a
 * body sentence that quotes "Page 3 of 40" is never dropped. Two ways in:
 *
 * - its shape is a page number ({@link RUNNING_PATTERNS}), on any edge; or
 * - its shape recurs at an edge on at least `max(3, ceil(0.4 × pages))` of
 *   the pages that have text, where the shape turns every run of digits (and
 *   a roman numeral after "page") into `#`.
 *
 * `running-lines.test.ts` holds both directions with a corpus: every line
 * that must go is dropped, every line that must stay is kept, and every
 * pattern here catches a corpus line.
 */

/** How many lines at the top and at the bottom of a page are candidates. */
export const EDGE_LINES = 2;

/** The share of text pages a shape must recur on, and the floor. */
export const RECURRENCE_SHARE = 0.4;
export const RECURRENCE_FLOOR = 3;

/** Page-number shapes, matched against a line's SHAPE (digits → `#`). */
export const RUNNING_PATTERNS: readonly RegExp[] = [
  /^(?:page\s*)?#(?:\s*(?:of|\/)\s*#)?$/i,
  /^[-–]\s*#\s*[-–]$/,
];

/** A line's shape: digit runs, and a roman numeral after "page", as `#`. */
export function runningShape(text: string): string {
  return text
    .replace(/\d+/g, "#")
    .replace(/\b(page\s*)[ivxlcdm]+\b/gi, (_, page: string) => `${page}#`)
    .toLowerCase();
}

/**
 * The indices into `lines` of the running lines. `lines` are one document's
 * comparable lines in order, each with the page it sits on.
 */
export function detectRunningLines(
  lines: readonly { text: string; page: number }[],
): Set<number> {
  const byPage = new Map<number, number[]>();
  lines.forEach((line, i) => {
    const on = byPage.get(line.page);
    if (on) on.push(i);
    else byPage.set(line.page, [i]);
  });

  const edges: number[] = [];
  for (const indices of byPage.values()) {
    const picked = new Set([
      ...indices.slice(0, EDGE_LINES),
      ...indices.slice(-EDGE_LINES),
    ]);
    edges.push(...picked);
  }

  const pagesOfShape = new Map<string, Set<number>>();
  for (const i of edges) {
    const shape = runningShape(lines[i]!.text);
    const pages = pagesOfShape.get(shape) ?? new Set<number>();
    pages.add(lines[i]!.page);
    pagesOfShape.set(shape, pages);
  }
  const needed = Math.max(
    RECURRENCE_FLOOR,
    Math.ceil(RECURRENCE_SHARE * byPage.size),
  );

  const running = new Set<number>();
  for (const i of edges) {
    const shape = runningShape(lines[i]!.text);
    if (
      RUNNING_PATTERNS.some((pattern) => pattern.test(shape)) ||
      pagesOfShape.get(shape)!.size >= needed
    ) {
      running.add(i);
    }
  }
  return running;
}
