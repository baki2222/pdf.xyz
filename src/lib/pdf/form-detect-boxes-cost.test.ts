/**
 * Slice S4's cost (entry boxes and stacked lines): a same-run size ratio,
 * never a wall-clock bound. A file of its own: run beside the real reader
 * (form-detect-boxes.test.ts runs pdf.js over its corpus first), the large
 * side of the box ratio read 5x slower for the heap that left behind
 * (2.36 s against 0.48 s for the same page), and a ratio is only as fair as
 * its two sides' conditions.
 *
 * WHAT IS TIMED, AND WHAT IS NOT. A page of N empty labelled boxes is not
 * linear BEFORE slice S4: `gridTouches` scans every plumb line on the page
 * for each line that reaches the table-grid step, and every box's top edge
 * (a line with no label) reaches it, so the page costs N x 2N there
 * (origin/main ac88cac3: 24x the time for 8x the boxes; with this slice
 * 25x; profiled 2026-11-21, `gridTouches` and its filter on top). That is
 * reported, not this slice's to fix, and these pages are built so that no
 * line reaches that step: each box is passed over as a signature line,
 * decided before it, and its top edge goes with it (an entry box's field
 * stands for its top edge since review round 1; before, a wide caption
 * 2.5 pt over it passed it over as an underline). Every S4 question about each box (is it an
 * entry box's size, does it hold text, does it hold anything drawn) is
 * still asked, and the health checks read that it was from the excluded
 * box's geometry (the box's inside, not a line's strip).
 */
import { describe, expect, it } from "vitest";
import { expectRatioBelow } from "@/tests/time-bound";
import {
  classifyPage,
  type CardPage,
  type CardRect,
  type CardSeg,
  type CardText,
} from "./form-detect";

const txt = (str: string, x: number, y: number, width: number): CardText => ({
  str,
  x,
  y,
  width,
  size: 10,
  upright: true,
});

const rect = (x: number, y: number, w: number, h: number): CardRect => ({
  x0: x,
  y0: y,
  x1: x + w,
  y1: y + h,
  width: 0.75,
  stroked: true,
  filled: false,
  lum: 0,
});

const hseg = (x0: number, x1: number, y: number): CardSeg => ({
  x0,
  y0: y,
  x1,
  y1: y,
  width: 0.75,
  stroked: true,
  filled: false,
  lum: 0,
});

const pg = (o: Partial<CardPage>): CardPage => ({
  page: 1,
  width: 612,
  height: 792,
  segs: [],
  rects: [],
  text: [],
  widgets: [],
  imageCover: 0,
  ...o,
});

/**
 * The time-boxed convention of form-detect.test.ts (copied, not imported,
 * so this file depends on no other file's helpers): each function runs
 * again and again for SAMPLE_MS per sample, the samples INTERLEAVED, 3 of
 * them, after one untimed warm-up of the first; each side keeps its best
 * time per call (a pause only ever adds). The ratio goes through
 * src/tests/time-bound.ts, which prints its `[time-bound]` line on every
 * run for the CI harvest.
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

/** 600 against 9,600 (16x): linear reads about 16. */
const SMALL = 600;
const K = 16;

/**
 * Boxes 80 pt apart, each 250 x 40, captioned "Signature of applicant N"
 * 2.5 pt over its top across 200 of its 250 pt (its top edge was passed
 * over as an underline until review round 1, since when an entry box's
 * field stands for its top edge); one box in four holds a short line and
 * one in four a writing line across it, so "does it hold anything drawn"
 * answers all three ways, and the writing lines are dropped as the lined
 * box's own. (At 60 pt apart each box's bottom
 * edge took the next caption, 9 pt under it, as a caption under a line,
 * and that search reads every text item on the page, `titleSize`: also
 * quadratic before S4, so the page keeps clear of it.)
 */
function boxes(n: number): CardPage {
  const rects: CardRect[] = [];
  const segs: CardSeg[] = [];
  const text: CardText[] = [];
  for (let i = 0; i < n; i++) {
    const y = 100 + 80 * i;
    rects.push(rect(72, y, 250, 40));
    if (i % 4 === 1) segs.push(hseg(80, 90, y + 20));
    if (i % 4 === 3) segs.push(hseg(76, 318, y + 20));
    text.push(txt(`Signature of applicant ${i}`, 72, y + 42.5, 200));
    // Margin notes level with the box, far right of it: text a "does it
    // hold text" question must pass over, so one that read every item on
    // the page (mutant MT) shows over this page's other costs.
    for (const dy of [5, 15, 25]) text.push(txt(`Ref ${i}`, 500, y + dy, 30));
  }
  return pg({ height: 200 + 80 * n, rects, segs, text });
}

/** Stacks 80 pt apart: three lines 20 pt apart under "Comments N". */
function stacks(n: number): CardPage {
  const segs: CardSeg[] = [];
  const text: CardText[] = [];
  for (let i = 0; i < n; i++) {
    const y = 100 + 80 * i;
    for (const dy of [0, 20, 40]) segs.push(hseg(72, 372, y + dy));
    text.push(txt(`Comments ${i}`, 72, y + 46, 60));
  }
  return pg({ height: 200 + 80 * n, segs, text });
}

describe("cost of entry boxes and stacked lines stays linear in the page's size", () => {
  // BOXES_BOUND and STACKS_BOUND: see the readings beside them.
  it("entry boxes: 16x the boxes cost under BOXES_BOUND x the time (same run, interleaved, time-boxed)", () => {
    const small = boxes(SMALL);
    const large = boxes(SMALL * K);
    const [a, b] = interleavedBest([
      () => classifyPage(small),
      () => classifyPage(large),
    ]);
    for (const [result, n] of [
      [a!.got, SMALL],
      [b!.got, SMALL * K],
    ] as const) {
      // Health: every box was read as an ENTRY box (its inside, 248 x 38),
      // so each S4 question ran on it, and passed over as a signature
      // line; its top edge and any writing line in it went with it (2 x n
      // with every top an underline, before review round 1); nothing
      // proposed.
      const sig = result.excluded.filter((e) => e.rule === "signature");
      expect(sig.length).toBe(n);
      for (const e of sig)
        expect([e.box.width, e.box.height]).toEqual([248, 38]);
      expect(result.excluded.length).toBe(n);
      expect(result.proposals).toEqual([]);
    }
    expectRatioBelow("S4 entry boxes", b!.ms, a!.ms, BOXES_BOUND, {
      mode: "measure",
      detail: `${b!.calls} / ${a!.calls} calls`,
    });
  }, 120_000);

  it("stacks: 16x the stacks cost under STACKS_BOUND x the time (same run, interleaved, time-boxed)", () => {
    const small = stacks(SMALL);
    const large = stacks(SMALL * K);
    const [a, b] = interleavedBest([
      () => classifyPage(small),
      () => classifyPage(large),
    ]);
    for (const [result, n] of [
      [a!.got, SMALL],
      [b!.got, SMALL * K],
    ] as const) {
      // Health: one multiline field a stack, proposed (the per-page cap
      // counted) or, in the page's outer 8% (the same share of either
      // page), passed over as a band; nothing else excluded.
      const band = result.excluded.filter((e) => e.rule === "page-band").length;
      expect(band).toBeGreaterThan(0);
      expect(band).toBeLessThan(0.2 * n);
      expect(result.proposals.length + result.counts.capped + band).toBe(n);
      expect(result.excluded.length).toBe(band);
      for (const p of result.proposals) {
        expect(p.rule).toBe("labelled-rule");
        expect(p.multiline).toBe(true);
      }
    }
    expectRatioBelow("S4 stacks", b!.ms, a!.ms, STACKS_BOUND, {
      mode: "measure",
      detail: `${b!.calls} / ${a!.calls} calls`,
    });
  }, 120_000);
});

/**
 * The bounds, measured 2026-11-21 (Windows 11, Node 24), each 2x over the
 * worst reading of the fixed code and at least 1.5x under the lowest
 * mutant reading (first cut, then review round 1 of slice S4):
 *
 *  - boxes, first cut: fixed 16.66 to 17.41 over 5 runs one at a time,
 *    18.41 to 21.61 four at a time. Mutant MB (each "does it hold anything
 *    drawn" question scanning every mark on the page from one list, not
 *    the cells its box covers): 97.03, 100.58, 100.80. Mutant MT (each
 *    "does it hold text" question reading every text item, not its
 *    baseline's band): 74.34, 76.64, 78.46. Window 43.2 to 49.6.
 *  - boxes, review round 1 (top edges dropped, writing lines, the margin
 *    notes): fixed 19.32 to 19.67 over 5 runs one at a time. MB 200.70,
 *    204.14, 232.33; MT 108.13, 111.94, 114.63; MO (the caption over a
 *    box's top read from every text item, not its band) 77.65, 83.04,
 *    84.75. Window 39.3 to 51.8.
 *  - stacks, first cut: fixed 17.09 to 20.51 one at a time, 17.66 to 20.44
 *    four at a time. MT: 75.46, 78.42, 81.68 (MB leaves stacks alone:
 *    15.09 to 18.00). Window 41.0 to 50.3.
 *  - stacks, review round 1 (the text-between check, which MT read, was
 *    removed as unreachable): fixed 17.56 to 20.14 over 5 runs. MS (the
 *    column-heading check reading every text item, not the caption's
 *    baseline): 74.50, 75.88, 93.55. Window 40.3 to 49.7. MO reads 47.51,
 *    50.85, 79.00 here: red at the bound 3 of 3, but inside the 1.5x
 *    margin, so not counted for this bound.
 *
 * NOT SEEN, said so: mutant ML (a lined box's writing lines found by
 * scanning every line under it, not from a binary search of its band)
 * reads 21.66 to 22.33 on the boxes page, under the bound: its scan is a
 * cheap test per line against classify's dear work per line, so no ratio
 * at 16x separates it (a page of four writing lines in three boxes in
 * four took it to 35.39 and MT down to 52.26). The binary search is
 * pinned by review only.
 *
 * At 8x (1,200 against 9,600) no bound fitted: MT read 28.96 on the boxes
 * against a fixed worst of 10.24, a window of 20.5 to 19.3. CI's own
 * [time-bound] lines are the check; a reading over half a bound there is
 * grounds to recalibrate.
 *
 * MEASURE MODE, AND WHY (2026-11-22). Until then these were assertions.
 * #390 (the time-bound instrument) holds every new wall-clock check to
 * src/tests/time-bound.ts, and an assert-mode bound to a CI calibration
 * (n >= 5 runs, one on a slow runner) that does not exist yet; its debt
 * list may not grow. So these two bounds RECORD and do not fail.
 *
 * They are listed in src/tests/wall-clock-pending.ts and name NO witness.
 * The health checks above (both pages read as expected, so the ratio
 * compares like with like) are not a witness: they check what the page
 * finds, not what it costs, and a quadratic step passes them every time.
 * Naming them as a witness would claim cost was still guarded when it was
 * not (CLAUDE.md rule 2). The pending list says so on every CI run.
 *
 * Owed: turn both back to assert once src/tests/time-bounds.calibration.json
 * holds these ids, and remove the two pending entries.
 */
const BOXES_BOUND = 45;
const STACKS_BOUND = 45;
