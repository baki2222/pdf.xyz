import type { PdfCompareResult } from "../compare-pdf";
import type { ComparableLine } from "./lines";

/**
 * Scroll both files together: a reading position in the first file maps to
 * the position in the second that shows the same unchanged text.
 *
 * A position is `u = page index + fraction` (0-based page, fraction 0 at its
 * top edge, 1 at its bottom), as `readingAnchor` reports it. Each unchanged
 * line is an anchor at `(page - 1) + (rank + 0.5) / count` on each side,
 * where rank and count are among the lines its page KEPT (anything set aside
 * contributes nothing). That is a line's rank turned into a page fraction,
 * not its geometry, so the map is an approximation; between anchors it is
 * linear.
 */

/** The most anchors kept per page of the first file. */
export const SYNC_ANCHORS_PER_PAGE = 4;

export interface SyncMap {
  /** Strictly increasing positions in the first file, from 0 to its page count. */
  l: Float64Array;
  /** The matching positions in the second, strictly increasing too. */
  r: Float64Array;
}

/** Each kept line's position on its page, by index into `lines`. */
function positions(lines: readonly ComparableLine[]): Float64Array {
  const out = new Float64Array(lines.length);
  let i = 0;
  while (i < lines.length) {
    const page = lines[i]!.page;
    let j = i;
    while (j < lines.length && lines[j]!.page === page) j += 1;
    const count = j - i;
    for (let k = i; k < j; k++) out[k] = page - 1 + (k - i + 0.5) / count;
    i = j;
  }
  return out;
}

/** The anchor of every unchanged line, in diff order. */
export function syncPoints(
  result: Pick<PdfCompareResult, "diff" | "lines">,
): [number, number][] {
  const pl = positions(result.lines.left);
  const pr = positions(result.lines.right);
  const out: [number, number][] = [];
  for (const d of result.diff) {
    if (d.kind !== "same" || d.left === undefined || d.right === undefined)
      continue;
    out.push([pl[d.left]!, pr[d.right]!]);
  }
  return out;
}

/**
 * The map through `points`, from (0, 0) to (`numL`, `numR`). Only points
 * strictly increasing in BOTH coordinates are kept (so the map is
 * invertible whatever it is handed: page counts that disagree with the
 * lines, or anchors out of order), then thinned to
 * {@link SYNC_ANCHORS_PER_PAGE} per page of the first file.
 */
export function buildSyncMap(
  points: readonly (readonly [number, number])[],
  numL: number,
  numR: number,
): SyncMap {
  const L = Math.max(0, numL);
  const R = Math.max(0, numR);
  const kept: [number, number][] = [[0, 0]];
  for (const [u, v] of points) {
    const last = kept.at(-1)!;
    if (u > last[0] && v > last[1] && u < L && v < R) kept.push([u, v]);
  }
  // Thin: per page of the first file, at most the stated number, spread.
  const thinned: [number, number][] = [kept[0]!];
  let i = 1;
  while (i < kept.length) {
    const page = Math.floor(kept[i]![0]);
    let j = i;
    while (j < kept.length && Math.floor(kept[j]![0]) === page) j += 1;
    const n = j - i;
    if (n <= SYNC_ANCHORS_PER_PAGE) {
      for (let k = i; k < j; k++) thinned.push(kept[k]!);
    } else {
      for (let k = 0; k < SYNC_ANCHORS_PER_PAGE; k++)
        thinned.push(
          kept[i + Math.round((k * (n - 1)) / (SYNC_ANCHORS_PER_PAGE - 1))]!,
        );
    }
    i = j;
  }
  if (L > 0 && R > 0) thinned.push([L, R]);
  return {
    l: Float64Array.from(thinned, (p) => p[0]),
    r: Float64Array.from(thinned, (p) => p[1]),
  };
}

/** {@link buildSyncMap} over a result's unchanged lines. */
export function syncMapOf(
  result: Pick<PdfCompareResult, "diff" | "lines">,
  numL: number,
  numR: number,
): SyncMap {
  return buildSyncMap(syncPoints(result), numL, numR);
}

function through(from: Float64Array, to: Float64Array, x: number): number {
  const n = from.length;
  if (n === 0) return 0;
  if (n === 1 || x <= from[0]!) return to[0]!;
  if (x >= from[n - 1]!) return to[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (from[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - from[lo]!) / (from[hi]! - from[lo]!);
  return to[lo]! + t * (to[hi]! - to[lo]!);
}

/** A position in the first file, as a position in the second. */
export function mapLR(map: SyncMap, u: number): number {
  return through(map.l, map.r, u);
}

/** A position in the second file, as a position in the first. */
export function mapRL(map: SyncMap, v: number): number {
  return through(map.r, map.l, v);
}
