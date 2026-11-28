/**
 * The checkbox GRID's cost (`gridLabels`: a condition x Yes / No grid): a
 * same-run size ratio, never a wall-clock bound, in a file of its own as
 * S4's, S5's and S6's are.
 *
 * WHAT IS TIMED. A grid of N rows down one column: a "Yes" and a "No"
 * square per row, heads over the top squares, the condition far to the
 * left of each row and a note far to its right. That gives every row a
 * head for each of its columns, so every row asks for its row text, the
 * search that read the whole page once per row. With the squares' own
 * side labels out of reach, each one takes its grid label. Columns ask for
 * their heads and group heads.
 *
 * Why its own page: S6's comb page never reaches that search. Its comb
 * columns share one "PIN" head item, so each row is skipped before it.
 * S6's ratio read the same with the search fixed or not (17.8-22.4
 * against 19.4-20.3, alternated, 2026-11-28).
 */
import { describe, expect, it } from "vitest";
import { expectRatioBelow } from "@/tests/time-bound";
import {
  classifyPage,
  type CardPage,
  type CardRect,
  type CardText,
} from "./form-detect";

const txt = (str: string, x: number, y: number, size = 10): CardText => ({
  str,
  x,
  y,
  width: 5 * str.length,
  size,
  upright: true,
});

const rect = (x: number, y: number, s: number): CardRect => ({
  x0: x,
  y0: y,
  x1: x + s,
  y1: y + s,
  width: 1,
  stroked: true,
  filled: false,
  lum: 0,
});

/**
 * The time-boxed convention of form-detect-boxes-cost.test.ts (copied, not
 * imported): each function runs again and again for SAMPLE_MS per sample,
 * the samples INTERLEAVED, 3 of them, after one untimed warm-up of the
 * first; each side keeps its best time per call.
 */
const SAMPLE_MS = 100;

interface Timed<T> {
  ms: number;
  calls: number;
  got: T;
}

function interleavedBest<T>(fns: readonly (() => T)[], reps = 3): Timed<T>[] {
  fns[0]!();
  const out = fns.map(() => ({ ms: Infinity, calls: 0, got: undefined as T }));
  for (let k = 0; k < reps; k++)
    fns.forEach((fn, i) => {
      const side = out[i]!;
      let calls = 0;
      let ms = 0;
      const t0 = performance.now();
      do {
        side.got = fn();
        calls++;
        ms = performance.now() - t0;
      } while (ms < SAMPLE_MS);
      if (ms / calls < side.ms) {
        side.ms = ms / calls;
        side.calls = calls;
      }
    });
  return out;
}

/** 200 against 12,800 rows (64x): linear reads about 64. */
const SMALL = 200;
const K = 64;

/** The proposals a page returns at most (the rest are counted as capped). */
const PAGE_CAP = 60;

/** A Yes / No grid of n rows, 20 pt apart. */
function grid(n: number): CardPage {
  const rects: CardRect[] = [];
  const text: CardText[] = [];
  const top = 100 + 20 * (n - 1);
  text.push(txt("Yes", 300, top + 16));
  text.push(txt("No", 340, top + 16));
  for (let i = 0; i < n; i++) {
    const y = 100 + 20 * i;
    rects.push(rect(300, y, 12));
    rects.push(rect(340, y, 12));
    text.push(txt(`Condition ${i}`, 120, y + 2));
    text.push(txt(`note ${i}`, 420, y + 2));
  }
  return {
    page: 1,
    width: 612,
    height: top + 100,
    segs: [],
    rects,
    text,
    widgets: [],
    imageCover: 0,
  };
}

describe("cost of a checkbox grid stays linear in its rows", () => {
  it("health: a small grid labels every square '<condition> <head>'", () => {
    const result = classifyPage(grid(3));
    expect(result.proposals.map((p) => p.label).sort()).toEqual([
      "Condition 0 No",
      "Condition 0 Yes",
      "Condition 1 No",
      "Condition 1 Yes",
      "Condition 2 No",
      "Condition 2 Yes",
    ]);
  });

  it("64x the rows cost under GRID_BOUND x the time (same run, interleaved, time-boxed)", () => {
    const small = grid(SMALL);
    const large = grid(SMALL * K);
    const [a, b] = interleavedBest([
      () => classifyPage(small),
      () => classifyPage(large),
    ]);
    for (const [result, n] of [
      [a!.got, SMALL],
      [b!.got, SMALL * K],
    ] as const) {
      expect(result.proposals).toHaveLength(PAGE_CAP);
      expect(result.counts.capped).toBe(2 * n - PAGE_CAP);
      for (const p of result.proposals)
        expect(p.label).toMatch(/^Condition \d+ (Yes|No)$/);
      expect(result.excluded).toEqual([]);
    }
    expectRatioBelow("grid rows", b!.ms, a!.ms, GRID_BOUND, {
      mode: "measure",
      detail: `${b!.calls} / ${a!.calls} calls`,
    });
  }, 180_000);
});

/**
 * The bound, measured 2026-11-28 (Windows 11, Node 24): 2x over the worst
 * reading of the fixed code, and at least 1.5x under the lowest reading of
 * the mutant it sees. The runs alternated fixed, mutant, fixed, ...
 *
 *  - Fixed (each search reads a baseline band): 77.8, 87.3, 74.6. The
 *    worst is 87.3, so the bound is at least 174.6.
 *  - Mutant: main 8f379e1a's form-detect.ts, with the whole-page reads put
 *    back in `gridLabels`' row text, its heads and group heads, and the
 *    checklist pass. It read 281, 284 and 287: red 3 of 3. Lowest / 1.5 =
 *    187.3. The window is 174.6 to 187.3, so GRID_BOUND is 180.
 *
 * NOT SEEN, said so: the checklist pass (lettered labels for a column of
 * unlabelled squares) never runs on this page, since every square here
 * takes its grid label. Its band read rests on review, and on the corpus
 * reading the same with and without it.
 *
 * MEASURE MODE: #390 holds a new bound to a CI calibration that does not
 * exist yet, so this one records and does not fail. It is listed in
 * src/tests/wall-clock-pending.ts and names NO witness: the health checks
 * above say what the page returns, and the labels are identical with the
 * whole-page reads or without them.
 */
const GRID_BOUND = 180;
