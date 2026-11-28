/**
 * Slice S6's cost (combs and radio stacks): a same-run size ratio, never a
 * wall-clock bound, in a file of its own as S4's and S5's are.
 *
 * WHAT IS TIMED. A page of N blocks stacked down one column (every block's
 * shapes share their x, the worst case for any lookup by x), each block
 * asking every question S6 and its review round 1 added:
 *
 *  - a labelled checkbox ("Big") over a three-square stack at the radio
 *    gap, labelled on the right, with a caption over it: the stack's
 *    labels (`rightLabel` per square), its caption search, the words that
 *    could veto it, the squares' own labels (read once a page, lazily),
 *    the drift check and the columns check;
 *  - a comb of six touching boxes with a caption over it and lettered
 *    text 100 pt to its left: the comb rows, the scale-heads search over
 *    its stack, the left label with its barrier (rules and squares looked
 *    up by band) and the caption that wins over the far text.
 *
 * Review round 1 (finding guards-bytes, low): a quadratic mutant in
 * `radioStacks` (each square's label read after scanning every square)
 * stayed green on every existing cost test, since the 12,500-square grid
 * has no labelled squares and the headed grid's squares are skipped
 * before that line. This page has a labelled stack in every block.
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

/** 150 against 2,400 blocks (16x): linear reads about 16. */
const SMALL = 150;
const K = 16;

/** Blocks 120 pt apart, each a checkbox, a stack and a comb. */
function blocks(n: number): CardPage {
  const rects: CardRect[] = [];
  const text: CardText[] = [];
  for (let i = 0; i < n; i++) {
    const y = 100 + 120 * i;
    // The stack: squares at y+60, y+42, y+24; "Big" over it at y+80.
    rects.push(rect(72, y + 80, 16));
    text.push(txt("Big", 92, y + 83));
    ["Email", "Phone", "Post"].forEach((s, k) => {
      rects.push(rect(72, y + 60 - 18 * k, 12));
      text.push(txt(s, 88, y + 62 - 18 * k));
    });
    // The comb: six boxes at x 300, a caption over it, text 100 pt left.
    for (let k = 0; k < 6; k++) rects.push(rect(300 + 14 * k, y + 40, 14));
    text.push(txt("PIN", 300, y + 58, 9));
    text.push(txt("Ref", 185, y + 43));
  }
  return {
    page: 1,
    width: 612,
    height: 200 + 120 * n,
    segs: [],
    rects,
    text,
    widgets: [],
    imageCover: 0,
  };
}

describe("cost of combs and radio stacks stays linear in the page's size", () => {
  it("S6: 16x the blocks cost under COMBS_BOUND x the time (same run, interleaved, time-boxed)", () => {
    const small = blocks(SMALL);
    const large = blocks(SMALL * K);
    const [a, b] = interleavedBest([
      () => classifyPage(small),
      () => classifyPage(large),
    ]);
    for (const [result, n] of [
      [a!.got, SMALL],
      [b!.got, SMALL * K],
    ] as const) {
      // Health: every block gave its checkbox, its radio group (unnamed:
      // the text over it is the checkbox's own label) and its comb (named
      // from its caption, not the far text), the page cap counted, and
      // nothing was passed over.
      expect(result.proposals.length + result.counts.capped).toBe(3 * n);
      const rules = new Set(result.proposals.map((p) => p.rule));
      expect(rules).toEqual(
        new Set(["square-checkbox", "radio-stack", "comb-boxes"]),
      );
      for (const p of result.proposals) {
        if (p.rule === "radio-stack") expect(p.label).toBeNull();
        if (p.rule === "comb-boxes") expect(p.label).toBe("PIN");
      }
      expect(result.excluded).toEqual([]);
    }
    expectRatioBelow("S6 combs and radio stacks", b!.ms, a!.ms, COMBS_BOUND, {
      mode: "measure",
      detail: `${b!.calls} / ${a!.calls} calls`,
    });
  }, 180_000);
});

/**
 * The bound, measured 2026-11-22 (Windows 11, Node 24), 2x over the worst
 * reading of the fixed code and at least 1.5x under the lowest reading of
 * each mutant it sees:
 *
 *  - FIRST reading, at the reviewed head plus round 1's fixes: 70.01. The
 *    page found a quadratic step older than S6: `squareCandidates` read
 *    every text item on the page for every square's side labels (S1's
 *    code; no cost page had text beside its squares). Now each square
 *    reads its baseline band. Fixed: 20.20, 18.02, 18.61 (worst 20.20, so
 *    the bound is at least 40.4).
 *  - mutant E2 (the review's: each stacked square's label read after
 *    scanning every square): 81.96, 83.89, 70.19; red 3 of 3, lowest / 1.5
 *    = 46.8. Mutant E3 (the squares' own labels re-read for every caption
 *    candidate): 252, 232, 240; red 3 of 3. Window 40.4 to 46.8:
 *    COMBS_BOUND 45.
 *
 * NOT SEEN, said so: mutant E4 (the old whole-page side-text scan put
 * back) reads 67.01, 43.42, 53.58, red 2 of 3 at 45. It rests on this
 * reading and on review.
 *
 * MEASURE MODE: #390 holds a new bound to a CI calibration that
 * does not exist yet, so this one records and does not fail. It is listed
 * in src/tests/wall-clock-pending.ts and names NO witness: the health
 * checks above say what the page returns, not what it costs, and a
 * quadratic step passes them every time (see the docblocks of
 * form-detect-boxes-cost.test.ts and form-detect-tables-cost.test.ts).
 */
const COMBS_BOUND = 45;
