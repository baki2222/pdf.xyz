import type { Op } from "./diff";
import type { WordPair } from "./words";

/** Unchanged lines shown around each change. */
export const CONTEXT = 2;

/**
 * One group of nearby changes with its context. Changes closer than
 * `2 × CONTEXT` unchanged lines share a hunk, so no context line is printed
 * twice. Line ranges are half-open indices into each side's comparable
 * lines; page ranges are the pages (first, last) the hunk's CHANGED lines sit
 * on — or, for a side with no changed line (a pure insertion or deletion),
 * the page of the nearest unchanged line before it (else after it), so a
 * header always names a page on both sides.
 */
export interface Hunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  ops: Op[];
  leftPages: [number, number];
  rightPages: [number, number];
  pairs: WordPair[];
}

/** "Page 2 → page 3", "Pages 2-3 → page 3". */
export function hunkHeader(
  hunk: Pick<Hunk, "leftPages" | "rightPages">,
  arrow: string,
): string {
  const range = ([first, last]: [number, number], word: string) =>
    first === last ? `${word} ${first}` : `${word}s ${first}-${last}`;
  return `${range(hunk.leftPages, "Page")} ${arrow} ${range(hunk.rightPages, "page")}`;
}

/**
 * The hunks of an edit script. `leftPage(i)` / `rightPage(j)` give the page a
 * line sits on; `pairs` are the word-marked pairs, handed to the hunk that
 * holds their left line.
 */
export function buildHunks(
  ops: readonly Op[],
  leftPage: (i: number) => number,
  rightPage: (j: number) => number,
  pairs: readonly WordPair[] = [],
): Hunk[] {
  const changed: number[] = [];
  ops.forEach((op, i) => {
    if (op.k !== "same") changed.push(i);
  });
  if (changed.length === 0) return [];

  // Op index ranges [from, to], merged when the unchanged gap is small.
  const groups: [number, number][] = [];
  for (const i of changed) {
    const last = groups.at(-1);
    if (last && i - last[1] - 1 <= 2 * CONTEXT) last[1] = i;
    else groups.push([i, i]);
  }

  // Each op's position on each side: the line index it is at or before.
  const aAt: number[] = [];
  const bAt: number[] = [];
  let a = 0;
  let b = 0;
  for (const op of ops) {
    aAt.push(a);
    bAt.push(b);
    if (op.k !== "added") a += 1;
    if (op.k !== "removed") b += 1;
  }
  aAt.push(a);
  bAt.push(b);

  const anchor = (from: number, to: number) => {
    for (let i = from - 1; i >= 0; i -= 1) {
      const op = ops[i]!;
      if (op.k === "same") return op;
    }
    for (let i = to + 1; i < ops.length; i += 1) {
      const op = ops[i]!;
      if (op.k === "same") return op;
    }
    return undefined;
  };

  // Pairs come in script order, so each hunk takes the next run of them.
  let nextPair = 0;
  return groups.map(([first, last]) => {
    const from = Math.max(0, first - CONTEXT);
    const to = Math.min(ops.length - 1, last + CONTEXT);
    const slice = ops.slice(from, to + 1);
    const removed = slice.flatMap((op) => (op.k === "removed" ? [op.a] : []));
    const added = slice.flatMap((op) => (op.k === "added" ? [op.b] : []));
    const near = anchor(first, last);
    const pagesOf = (
      lines: number[],
      page: (i: number) => number,
      fallback: number | undefined,
    ): [number, number] => {
      if (lines.length > 0) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const i of lines) {
          const p = page(i);
          if (p < lo) lo = p;
          if (p > hi) hi = p;
        }
        return [lo, hi];
      }
      const p = fallback === undefined ? 1 : page(fallback);
      return [p, p];
    };
    const aStart = aAt[from]!;
    const aEnd = aAt[to + 1]!;
    return {
      aStart,
      aEnd,
      bStart: bAt[from]!,
      bEnd: bAt[to + 1]!,
      ops: slice,
      leftPages: pagesOf(
        removed,
        leftPage,
        near?.k === "same" ? near.a : undefined,
      ),
      rightPages: pagesOf(
        added,
        rightPage,
        near?.k === "same" ? near.b : undefined,
      ),
      pairs: takePairs(),
    };
    function takePairs(): WordPair[] {
      while (nextPair < pairs.length && pairs[nextPair]!.left < aStart)
        nextPair += 1;
      const start = nextPair;
      while (nextPair < pairs.length && pairs[nextPair]!.left < aEnd)
        nextPair += 1;
      return pairs.slice(start, nextPair);
    }
  });
}
