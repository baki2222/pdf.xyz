/**
 * The checkbox GRID's cost (`gridLabels`: a condition x Yes / No grid): a
 * same-run size ratio, never a wall-clock bound, in a file of its own as
 * S4's, S5's and S6's are.
 *
 * WHAT IS TIMED. N small Yes / No grids, each with its own two columns
 * and two rows (`grids` below), so the page's rows AND columns grow with
 * N. Every row asks for its row text, and every column for its head and
 * its group head: the three searches that read the whole page once per
 * row or column.
 *
 * The first version timed one tall grid. It had two columns however long
 * it was, so it timed the row search alone while its pending entry claimed
 * the column searches too (#401 review, upheld 2 of 2).
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

/** SMALL against SMALL x K grids: linear reads about K. */
const SMALL = 100;
const K = 128;

/** The proposals a page returns at most (the rest are counted as capped). */
const PAGE_CAP = 60;

/** Squares per grid: two rows of a Yes and a No. */
const PER_GRID = 4;

/**
 * n small Yes / No grids, each a step right of and above the last. Every
 * grid has its OWN two columns and two rows, so the page's columns grow
 * with n as fast as its rows do. A tall grid has two columns however long
 * it is, so it cannot time the column searches: that page timed only the
 * row search (#401 review). Each grid's rows:
 * - its condition, 120 pt left of the row, beyond a square's own reach
 *   (DETECT.LABEL_LEFT_GAP 24), so every square takes its grid label;
 * - its heads, 4 pt over its top squares.
 * The next grid is 100 pt right and 60 pt up, clear of every band.
 */
function grids(n: number): CardPage {
  const rects: CardRect[] = [];
  const text: CardText[] = [];
  for (let i = 0; i < n; i++) {
    const x = 260 + 100 * i;
    const y = 100 + 60 * i;
    for (const [row, dy] of [
      ["a", 0],
      ["b", 20],
    ] as const) {
      rects.push(rect(x, y + dy, 12));
      rects.push(rect(x + 40, y + dy, 12));
      const cond = `Cond ${i}${row}`;
      text.push(txt(cond, x - 120 - 5 * cond.length, y + dy + 2));
    }
    text.push(txt("Yes", x, y + 20 + 16));
    text.push(txt("No", x + 40, y + 20 + 16));
  }
  return {
    page: 1,
    width: 400 + 100 * n,
    height: 200 + 60 * n,
    segs: [],
    rects,
    text,
    widgets: [],
    imageCover: 0,
  };
}

describe("cost of checkbox grids stays linear in their rows and columns", () => {
  it("health: two grids label every square '<condition> <head>'", () => {
    const result = classifyPage(grids(2));
    expect(result.proposals.map((p) => p.label).sort()).toEqual([
      "Cond 0a No",
      "Cond 0a Yes",
      "Cond 0b No",
      "Cond 0b Yes",
      "Cond 1a No",
      "Cond 1a Yes",
      "Cond 1b No",
      "Cond 1b Yes",
    ]);
  });

  it("128x the grids cost under GRID_BOUND x the time (same run, interleaved, time-boxed)", () => {
    const small = grids(SMALL);
    const large = grids(SMALL * K);
    const [a, b] = interleavedBest([
      () => classifyPage(small),
      () => classifyPage(large),
    ]);
    for (const [result, n] of [
      [a!.got, SMALL],
      [b!.got, SMALL * K],
    ] as const) {
      expect(result.proposals).toHaveLength(PAGE_CAP);
      expect(result.counts.capped).toBe(PER_GRID * n - PAGE_CAP);
      for (const p of result.proposals)
        expect(p.label).toMatch(/^Cond \d+[ab] (Yes|No)$/);
      expect(result.excluded).toEqual([]);
    }
    expectRatioBelow("checkbox grids", b!.ms, a!.ms, GRID_BOUND, {
      mode: "measure",
      detail: `${b!.calls} / ${a!.calls} calls`,
    });
  }, 180_000);
});

/**
 * The bound, measured 2026-11-28 (Windows 11, Node 24) on 100 against
 * 12,800 grids (128x): 2x over the worst reading of the fixed code, and at
 * least 1.5x under the lowest reading of each mutant it sees. Fixed and
 * mutant runs alternated. Each mutant puts ONE whole-page read back:
 *
 *  - Fixed (every search reads a baseline band): 218, 215, 229. The worst
 *    is 229, so the bound is at least 458.
 *  - Mutant R, the row text reading `p.text`: 1026, 995 and 1070, red 3 of
 *    3. Lowest / 1.5 = 663. The window is 458 to 663, so GRID_BOUND is 500.
 *  - Mutant H, the head and group-head loops reading `p.text`: one call of
 *    the large page runs past 400 s, so the test never finishes. At 64x it
 *    read 3673x, and one call of the large page took 66 s. main 8f379e1a's
 *    file, with all four reads, behaves the same (3339x at 64x). A
 *    regression there fails CI by its job timeout, not by this bound:
 *    vitest cannot interrupt a synchronous call.
 *  - At 64x, R did not separate from the fixed code (242-277 against
 *    90-96), which is why K is 128.
 *
 * NOT SEEN, said so: mutant C, the checklist pass reading `p.text`, read
 * 223, the same as the fixed code. That pass labels a column of unlabelled
 * squares, and every square here takes its grid label. Its band read rests
 * on review, and on the corpus reading the same with and without it.
 *
 * MEASURE MODE: #390 holds a new bound to a CI calibration that does not
 * exist yet, so this one records and does not fail. It is listed in
 * src/tests/wall-clock-pending.ts and names NO witness: the health checks
 * above say what the page returns, and the labels are identical with the
 * whole-page reads or without them.
 */
const GRID_BOUND = 500;
