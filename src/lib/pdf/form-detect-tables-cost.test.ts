/**
 * Slice S5's cost (tables: empty ruled cells): a same-run size ratio,
 * never a wall-clock bound, in a file of its own as S4's is (run beside the
 * real reader, one side of a ratio reads the heap pdf.js left behind).
 *
 * WHAT IS TIMED. A page of N small headed tables stacked down one column
 * (the worst case for any lookup by x: every table's rules and plumb
 * lines share their x), each a header row, a filled row and an empty row,
 * so every S5 question is asked of every table: is it a grid (its stack
 * split where the outer plumb lines break, its column lines, a stray rule
 * inside), is it a label table, is the top row a header, is each body row
 * empty, labelled or filled, and every grid rule reaches the table-grid
 * step. Before S5 two of those steps scanned the whole page per table or
 * per rule (the grid finder's plumb lines and stray rules per stack part,
 * and `gridTouches`' plumb lines per rule: S4's cost note reported the
 * latter and left it); S5 looks both up by band ({@link plumbBands} in
 * form-detect.ts), or this page could not be linear.
 *
 * Column 0's words start past the first 40% of each rule, so no rule takes
 * a caption from under it (that search, `titleSize`, reads every text item
 * on the page: quadratic before S4, reported there, not this slice's).
 */
import { describe, expect, it } from "vitest";
import { expectRatioBelow } from "@/tests/time-bound";
import {
  classifyPage,
  type CardPage,
  type CardSeg,
  type CardText,
} from "./form-detect";

const txt = (str: string, x: number, y: number): CardText => ({
  str,
  x,
  y,
  width: 5 * str.length,
  size: 10,
  upright: true,
});

const seg = (x0: number, y0: number, x1: number, y1: number): CardSeg => ({
  x0,
  y0,
  x1,
  y1,
  width: 0.75,
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

/** 150 against 2,400 tables (16x): linear reads about 16. */
const SMALL = 150;
const K = 16;
const XS = [72, 260, 360, 460];

/** Tables 80 pt apart: header, a filled row, an empty row, 20 pt each. */
function tables(n: number): CardPage {
  const segs: CardSeg[] = [];
  const text: CardText[] = [];
  for (let i = 0; i < n; i++) {
    const y = 100 + 80 * i;
    for (const dy of [0, 20, 40, 60]) segs.push(seg(72, y + dy, 460, y + dy));
    for (const x of XS) segs.push(seg(x, y, x, y + 60));
    // Column 0's words at 230: inside its cell, past the rules' first 40%.
    const xs = [230, 263, 363];
    ["Item", "Qty", "Price"].forEach((h, k) =>
      text.push(txt(h, xs[k]!, y + 45)),
    );
    ["Bolt", "4", "1.00"].forEach((s, k) => text.push(txt(s, xs[k]!, y + 25)));
  }
  return {
    page: 1,
    width: 612,
    height: 200 + 80 * n,
    segs,
    rects: [],
    text,
    widgets: [],
    imageCover: 0,
  };
}

describe("cost of reading tables stays linear in the page's size", () => {
  it("tables: 16x the tables cost under TABLES_BOUND x the time (same run, interleaved, time-boxed)", () => {
    const small = tables(SMALL);
    const large = tables(SMALL * K);
    const [a, b] = interleavedBest([
      () => classifyPage(small),
      () => classifyPage(large),
    ]);
    for (const [result, n] of [
      [a!.got, SMALL],
      [b!.got, SMALL * K],
    ] as const) {
      // Health: every table was read as a headed table, its empty row's
      // three cells proposed (the per-page cap counted) and nothing else;
      // its four rules each passed over as table-grid (or the page band,
      // the same share of either page), and no filled-cells (the filled
      // row has no blank).
      expect(result.proposals.length + result.counts.capped).toBe(3 * n);
      for (const p of result.proposals) expect(p.rule).toBe("header-cell");
      const grid = result.excluded.filter((e) => e.rule === "table-grid");
      const band = result.excluded.filter((e) => e.rule === "page-band");
      expect(grid.length + band.length).toBe(result.excluded.length);
      expect(grid.length).toBeGreaterThan(3 * n);
      expect(band.length).toBeLessThan(0.2 * 4 * n);
    }
    expectRatioBelow("S5 tables", b!.ms, a!.ms, TABLES_BOUND, {
      mode: "measure",
      detail: `${b!.calls} / ${a!.calls} calls`,
    });
  }, 120_000);
});

/**
 * The bound, measured 2026-11-22 (Windows 11, Node 24), 2x over the worst
 * reading of the fixed code and at least 1.5x under the lowest reading of
 * the mutant it sees:
 *
 *  - before S5 looked plumb lines and stray rules up by band (both scans
 *    of the whole page per table, and `gridTouches` per rule): 55.58 and
 *    54.96. Fixed: 18.21, 18.09, 15.16 (worst 18.21, so the bound is at
 *    least 36.4).
 *  - mutant CW (each cell's words read from every text item on the page,
 *    not its baseline's band): 80.98, 77.40, 88.06; red at the bound 3 of
 *    3, lowest / 1.5 = 51.6. Window 36.4 to 51.6: TABLES_BOUND 45.
 *
 * NOT SEEN, said so: each of the three scans this slice replaced, put back
 * alone, reads under the bound at 16x, as its scan is a cheap test per
 * item against classify's dear work per table: CG (`gridTouches` over
 * every plumb line) 38.78, 38.16, 38.89; CS (stray rules from every rule)
 * 28.74, 28.77, 29.54; CI (a part's plumb lines from every one) 23.50,
 * 23.96, 25.79. All three together are the 55 above. Those lookups are
 * pinned by review and by the before-and-after readings only.
 *
 * MEASURE MODE: #390 holds a new bound to a CI calibration that does
 * not exist yet, so this one records and does not fail. It is listed in
 * src/tests/wall-clock-pending.ts and names NO witness: the health checks
 * above say what the page finds, not what it costs, and a quadratic step
 * passes them every time (the mistake S4's review caught; see that file's
 * docblock). Owed: back to assert once the calibration holds "S5 tables".
 */
const TABLES_BOUND = 45;
