/**
 * The edit script between two sequences of ids — lines of two documents, or
 * the words of two lines. Pure: no strings, no pages, no copy beyond the one
 * refusal below. Moved here from `compare-pdf.ts` on 2026-11-14 (audit
 * compare-pdf#4), generic over ids so the line diff and the word marks run
 * the same algorithm; the size tests moved with it (`diff.test.ts`).
 */

/**
 * The largest LCS table `diffIds` will build for one stretch of the
 * sequences, in cells. At two bytes a cell that is 50 MB and well under a
 * second in the worst case — a size a phone's tab survives.
 *
 * It bounds a STRETCH, not the documents: stretches too big for one table are
 * first cut at ids that occur exactly once on each side (patience anchors),
 * so two versions of a 1,000-page contract with edits scattered through it
 * never build a table larger than the gap between two unchanged lines.
 */
export const MAX_DIFF_CELLS = 25_000_000;

/**
 * From this many cells a stretch is first checked for an id the two sides
 * share; with none, the edit script is written without building the table,
 * which would be all zeros (second review of audit compare-pdf#4,
 * 2026-11-14: two 99-page files whose every line changed spent ~60 ms of
 * one task on a 24.5-million-cell table of zeros). The script is the one
 * the table gives — every removed step, then every added one — so no
 * comparison's result changes (diff.test.ts, "a stretch with nothing in
 * common").
 */
export const DISJOINT_CHECK_CELLS = 1_000_000;

/**
 * Thrown instead of building a table the tab cannot hold. Before this bound
 * existed the table was built anyway: 801 MB for 10k × 10k lines, and past that
 * the tab died with no message. `useAsyncRun` shows this one in the runner.
 */
export class CompareTooLargeError extends Error {
  constructor(
    readonly leftLines: number,
    readonly rightLines: number,
  ) {
    super(
      `These PDFs differ in too many places to compare line by line in your browser (${leftLines.toLocaleString("en-US")} vs ${rightLines.toLocaleString("en-US")} differing lines). Split them into smaller parts and compare those one at a time.`,
    );
    this.name = "CompareTooLargeError";
  }
}

/** One step of the script: an index into `a`, into `b`, or into both. */
export type Op =
  | { k: "same"; a: number; b: number }
  | { k: "removed"; a: number }
  | { k: "added"; b: number };

/**
 * Each value's id in `ids`, adding the ones not seen yet. Two sequences
 * interned through ONE map compare as integers in every loop of `diffIds`.
 */
export function intern(
  ids: Map<string, number>,
  values: readonly string[],
): Int32Array {
  return Int32Array.from(values, (value) => {
    let id = ids.get(value);
    if (id === undefined) ids.set(value, (id = ids.size));
    return id;
  });
}

/**
 * The diff. Small stretches get an LCS, which favors stable readable reports
 * over minimal edit scripts; on a tie the left side's step comes first, so a
 * changed line reads "removed, then added". Around it:
 *
 * - the shared prefix and suffix of every stretch are emitted as-is;
 * - a stretch too large for one `maxCells` table is split at ids that are
 *   unique on both sides and in order (a patience diff), and each gap is
 *   diffed on its own;
 * - a large stretch with no such id is refused with `CompareTooLargeError`.
 *
 * Memory is one table at a time, never more than `maxCells` cells. `onCells`
 * hears each table's size as it is built — the word marks charge it against
 * their budget, and the tests hold the bound with it.
 */
export function diffIds(
  a: Int32Array,
  b: Int32Array,
  maxCells: number = MAX_DIFF_CELLS,
  onCells?: (cells: number) => void,
): Op[] {
  const out: Op[] = [];
  const same = (i: number, j: number) => out.push({ k: "same", a: i, b: j });
  const removed = (i: number) => out.push({ k: "removed", a: i });
  const added = (j: number) => out.push({ k: "added", b: j });

  const walk = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      same(aLo, bLo);
      aLo += 1;
      bLo += 1;
    }
    let suffix = 0;
    while (
      aHi - suffix > aLo &&
      bHi - suffix > bLo &&
      a[aHi - 1 - suffix] === b[bHi - 1 - suffix]
    ) {
      suffix += 1;
    }
    aHi -= suffix;
    bHi -= suffix;

    const n = aHi - aLo;
    const m = bHi - bLo;
    if (n === 0 || m === 0) {
      for (let i = aLo; i < aHi; i += 1) removed(i);
      for (let j = bLo; j < bHi; j += 1) added(j);
    } else if ((n + 1) * (m + 1) <= maxCells) {
      if (
        (n + 1) * (m + 1) >= DISJOINT_CHECK_CELLS &&
        disjoint(aLo, aHi, bLo, bHi)
      ) {
        // No id in common: the table would be all zeros, and its walk is
        // every removed step, then every added one. That, without the table.
        for (let i = aLo; i < aHi; i += 1) removed(i);
        for (let j = bLo; j < bHi; j += 1) added(j);
      } else lcs(aLo, aHi, bLo, bHi);
    } else {
      const anchors = uniqueAnchors(a, aLo, aHi, b, bLo, bHi);
      if (anchors.length === 0) throw new CompareTooLargeError(n, m);
      let pa = aLo;
      let pb = bLo;
      for (const [ai, bj] of anchors) {
        walk(pa, ai, pb, bj);
        same(ai, bj);
        pa = ai + 1;
        pb = bj + 1;
      }
      walk(pa, aHi, pb, bHi);
    }
    for (let s = 0; s < suffix; s += 1) same(aHi + s, bHi + s);
  };

  const disjoint = (
    aLo: number,
    aHi: number,
    bLo: number,
    bHi: number,
  ): boolean => {
    const seen = new Set<number>();
    for (let i = aLo; i < aHi; i += 1) seen.add(a[i]!);
    for (let j = bLo; j < bHi; j += 1) if (seen.has(b[j]!)) return false;
    return true;
  };

  const lcs = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    const n = aHi - aLo;
    const m = bHi - bLo;
    const width = m + 1;
    const cells = (n + 1) * width;
    onCells?.(cells);
    // An LCS length never exceeds min(n, m); pick the narrowest cell that fits.
    const dp = new (Math.min(n, m) < 0xffff ? Uint16Array : Uint32Array)(cells);
    for (let i = n - 1; i >= 0; i -= 1) {
      const row = i * width;
      const below = row + width;
      const ai = a[aLo + i];
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[row + j] =
          ai === b[bLo + j]
            ? dp[below + j + 1]! + 1
            : Math.max(dp[below + j]!, dp[row + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[aLo + i] === b[bLo + j]) {
        same(aLo + i, bLo + j);
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
        removed(aLo + i);
        i += 1;
      } else {
        added(bLo + j);
        j += 1;
      }
    }
    for (; i < n; i += 1) removed(aLo + i);
    for (; j < m; j += 1) added(bLo + j);
  };

  walk(0, a.length, 0, b.length);
  return out;
}

/**
 * Ids that occur exactly once in `a[aLo..aHi)` and once in `b[bLo..bHi)`,
 * reduced to the longest run that is in the same order on both sides (a
 * patience sort). Returned as [leftIndex, rightIndex] pairs, ascending.
 */
function uniqueAnchors(
  a: Int32Array,
  aLo: number,
  aHi: number,
  b: Int32Array,
  bLo: number,
  bHi: number,
): [number, number][] {
  // id -> index on that side, or -1 once seen twice.
  const inA = new Map<number, number>();
  for (let i = aLo; i < aHi; i += 1) {
    const id = a[i]!;
    inA.set(id, inA.has(id) ? -1 : i);
  }
  const inB = new Map<number, number>();
  for (let j = bLo; j < bHi; j += 1) {
    const id = b[j]!;
    if (inA.has(id)) inB.set(id, inB.has(id) ? -1 : j);
  }

  const pairs: [number, number][] = [];
  for (let i = aLo; i < aHi; i += 1) {
    const id = a[i]!;
    if (inA.get(id) !== i) continue;
    const j = inB.get(id);
    if (j !== undefined && j >= 0) pairs.push([i, j]);
  }

  // Longest strictly increasing subsequence of the right-hand indices.
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k += 1) {
    const j = pairs[k]![1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1]!;
    tails[lo] = k;
  }
  const chain: [number, number][] = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]!) chain.push(pairs[k]!);
  return chain.reverse();
}
