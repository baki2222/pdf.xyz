import { describe, expect, it } from "vitest";
import { validateFormFields } from "./create-forms";
import {
  DETECT,
  DETECTION_RULES,
  EXCLUSION_RULES,
  charSpans,
  classifyPage,
  cleanLabel,
  filterValid,
  nameFor,
  overlapsExisting,
  proposalToDraftFields,
  type CardPage,
  type CardRect,
  type CardSeg,
  type CardText,
  type ClassifyOptions,
  type ExclusionRuleId,
  type FieldProposal,
} from "./form-detect";

/**
 * The classifier on hand-built pages (already in the page frame). Every
 * threshold in DETECT is tested exactly AT its boundary and just OUTSIDE it,
 * so changing a constant turns a test red ("change a constant to shake out
 * guards"). The same rules on real PDFs read by pdf.js are run by
 * form-detect.pdfjs.test.ts and form-detect.corpus.test.ts.
 */

const W = 612;
const H = 792;

function pg(parts: Partial<CardPage> = {}): CardPage {
  return {
    page: 1,
    width: W,
    height: H,
    segs: [],
    rects: [],
    text: [],
    widgets: [],
    imageCover: 0,
    ...parts,
  };
}

function hseg(
  x0: number,
  x1: number,
  y: number,
  o: Partial<CardSeg> = {},
): CardSeg {
  return {
    x0,
    y0: y,
    x1,
    y1: y,
    width: 1,
    stroked: true,
    filled: false,
    lum: 0,
    ...o,
  };
}

function vseg(x: number, y0: number, y1: number): CardSeg {
  return {
    x0: x,
    y0,
    x1: x,
    y1,
    width: 1,
    stroked: true,
    filled: false,
    lum: 0,
  };
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  o: Partial<CardRect> = {},
): CardRect {
  return {
    x0: x,
    y0: y,
    x1: x + w,
    y1: y + h,
    width: 1,
    stroked: true,
    filled: false,
    lum: 0,
    ...o,
  };
}

function txt(
  str: string,
  x: number,
  y: number,
  o: Partial<CardText> = {},
): CardText {
  const size = o.size ?? 12;
  return {
    str,
    x,
    y,
    width: str.length * 0.5 * size,
    size,
    upright: true,
    ...o,
  };
}

const run = (p: CardPage, o?: ClassifyOptions) => classifyPage(p, o);
const props = (p: CardPage, o?: ClassifyOptions) => run(p, o).proposals;
const firstRule = (p: CardPage, o?: ClassifyOptions) =>
  run(p, o).excluded[0]?.rule;

/**
 * Cost SHAPE, never wall-clock. The cost tests below once held their page
 * to an absolute bound in ms (`< 250`, `< 800`, `< 1100`, ...) set on one
 * Windows machine, and CI's 4-vCPU Linux runners, three test files at a
 * time, read the machine instead of the shape: 451 and 527 ms against 400
 * (PR #382's runs, the headed grid below, converted first in PR #384) and
 * 809.6 against 800 (run 44402871424, the label column, on a runner that
 * took 30.7 s for this file against 19.6 on another). Additive margins in
 * ms (`< 2 * (a + b) + 50`) fail the other way: on a slow runner the
 * constant is lost in the noise. So each test now compares its own page
 * with itself, in one run on one machine: the same work at two sizes (or
 * a control the defect does not touch), the ratio held under a bound set
 * between the cost the test claims and the defect's growth, each side the
 * best of 3 samples.
 *
 * Each bound is at least 2x over the worst ratio the fixed code read and
 * at least 1.5x under the lowest the defect read, both in runs of this
 * WHOLE file, the way CI runs it (Windows 11, Node 24, 2026-11-19). The
 * fixed code: 12 runs one at a time, 8 four at a time, 8 more four at a
 * time with 2 busy loops, all pinned to 4 logical CPUs (2 cores with SMT,
 * about a 4-vCPU runner: the file took 41 to 54 s), and 6 three at a time
 * with 1 busy loop on those CPUs and 4 loops thrashing the shared L3 from
 * 8 others (55 to 59 s). The defect: 3 runs one at a time and 4 at once.
 * A defect timed with only its own test running (`-t`) reads up to 2x
 * off in either direction (review of the ratio conversion, finding 3: one
 * read 3.10 alone and 1.60 in the file), as the page's linear cost moves
 * with the heap the file has built and the defect's added cost does not.
 * Each test's comment names its mutants and their numbers. CI's own
 * reading is the one that counts: Linux, Node 22 and another scheduler
 * (finding 12). Its `[time-bound]` lines, from 3 runs before a merge, are
 * the check; a ratio over half its bound there is grounds to recalibrate.
 *
 * `fns` run once each in turn, `reps` times, INTERLEAVED, so a transient
 * slowdown (GC, another worker) lands on every side; the first one, the
 * cheapest by convention, runs once untimed first to warm the code paths.
 * Each side keeps its best time per call, since a pause only ever adds,
 * and its last result for the caller's health checks.
 *
 * Every sample runs its function again and again until SAMPLE_MS have
 * passed, and the side's time is that sample's time per call. A sample of
 * one call is unfair to the longer side under load (review of the ratio
 * conversion, findings 9, 10 and 13): a small side of 2 to 30 ms, about
 * one scheduler quantum (15.6 ms on Windows, a slice of about 3 ms on
 * Linux), can land a whole sample unpreempted, while a side of 300 ms or
 * more always pays its share of an oversubscribed CPU, so best-of-3
 * inflated the ratio by up to the oversubscription. Measured with 4 runs
 * of this file and 2 busy loops on 4 logical CPUs, samples of one call:
 * the headed grid read 40.1 against a quiet 22 to 25, and "each item's
 * pieces" 14.2 and 17.6 against a quiet 10. With samples of SAMPLE_MS, on
 * the same load: 17.1 to 29.9 and 7.3 to 9.4. It also retires the floor
 * that held a denominator over 1 ms: an absolute bound in ms that a
 * machine fast enough would fail with no change in cost, where a faster
 * machine now runs more calls per sample.
 */
const SAMPLE_MS = 100;

interface Timed<T> {
  /** The best sample's time per call. */
  ms: number;
  /** The calls in that sample. */
  calls: number;
  /** The last call's result. */
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

/**
 * `num / den` under `bound`; each side is one timed function or the sum of
 * several. On GitHub Actions the ratio is printed, pass or fail, as
 * `[time-bound] <name>: ratio X (bound B)` (the convention of
 * src/tests/hostile/decode-budget.test.ts), so a CI log shows each test's
 * headroom, not only its failures. Each side's time per call follows, with
 * its calls per sample in brackets.
 */
function expectRatioUnder(
  name: string,
  num: Timed<unknown> | readonly Timed<unknown>[],
  den: Timed<unknown> | readonly Timed<unknown>[],
  bound: number,
): void {
  const list = (s: Timed<unknown> | readonly Timed<unknown>[]) =>
    "ms" in s ? [s] : s;
  const ms = (s: Timed<unknown> | readonly Timed<unknown>[]) =>
    list(s).reduce((a, x) => a + x.ms, 0);
  const calls = (s: Timed<unknown> | readonly Timed<unknown>[]) =>
    list(s)
      .map((x) => x.calls)
      .join("+");
  const ratio = ms(num) / ms(den);
  const said = `${name}: ratio ${ratio.toFixed(2)} (bound ${bound})`;
  const side = (s: Timed<unknown> | readonly Timed<unknown>[]) =>
    `${ms(s).toPrecision(3)} ms (${calls(s)})`;
  if (process.env.GITHUB_ACTIONS === "true")
    console.log(`[time-bound] ${said} ${side(num)} / ${side(den)}`);
  expect(ratio, said).toBeLessThan(bound);
}

/** "Address:" (right edge 120) and a rule from 130 to 330 at y 600. */
function labelledRule(
  parts: { text?: CardText[]; segs?: CardSeg[] } = {},
): CardPage {
  return pg({
    text: [txt("Address:", 72, 600, { width: 48 }), ...(parts.text ?? [])],
    segs: parts.segs ?? [hseg(130, 330, 600)],
  });
}

describe("rule tables", () => {
  it("every id is unique and the tables are the documented size", () => {
    const ids = [...DETECTION_RULES, ...EXCLUSION_RULES].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 3 until review round 4 added table-cell (the owner's decision on the
    // Word-style two-column table, round 3's finding 9); 4 and 17 until
    // slice S3 added dot-leader, box-glyph, toc-leader and ticked-box; 6
    // and 19 until slice S4 added entry-box and filled-box; 7 and 20 until
    // slice S5 added header-cell, filled-cells and large-table.
    expect(DETECTION_RULES).toHaveLength(8);
    expect(EXCLUSION_RULES).toHaveLength(22);
  });

  // The independent second bound on every threshold (CLAUDE.md, guards
  // rule 3): a literal table typed from the brief, so a constant changed by
  // a factor turns this red even where a test computes its boundary from
  // DETECT (the CAPS.perRun and BAND_EDGE tests once did, and survived
  // perRun 300 -> 150 and BAND_EDGE 0.08 -> 0.16). Values marked "review"
  // were added by the review round, not by the brief.
  it("every DETECT value is the brief's (a literal table, not a read-back)", () => {
    const {
      SIGNATURE_RE,
      SIGNOFF_RE,
      FOOTNOTE_RE,
      QUOTE_END_RE,
      NOTICE_END_RE,
      ...numbers
    } = DETECT;
    expect(numbers).toStrictEqual({
      UNDERSCORE_MIN: 4,
      UNDERSCORE_EMS: {
        underscore: { "sans-serif": 0.556, serif: 0.5, monospace: 0.6 },
        unknownUnderscore: 0.5,
        space: 0.278,
        other: 0.5,
      },
      FIELD_INSET: 1,
      MIN_FIELD_W: 24,
      RULE_MIN_LEN: 36,
      RULE_MAX_DY: 0.5,
      RULE_MAX_WIDTH: 2,
      RULE_MERGE_GAP: 1,
      LABEL_LEFT_GAP_RULE: 36,
      LABEL_COLUMN_MIN: 2, // owner, round 3 (3); round 5 fixes, finding 5
      LABEL_COLUMN_GAP_MAX: 144, // owner, round 3
      LABEL_LEFT_GAP: 24,
      LABEL_BELOW_RULE: 2,
      LABEL_ABOVE_RULE_EMS: 0.6,
      RUN_BASELINE_EMS: 0.3,
      CAPTION_MIN: 1,
      CAPTION_MAX: 14,
      CAPTION_SPAN: 0.4,
      CONTINUATION_BELOW: 28, // review round 3
      CONTINUATION_WEIGHT_EPS: 0.1, // review round 4 fixes
      HEADING_LEAD_EMS: 1.6, // review round 3
      HEADING_SMALLER_BY: 0.5, // review round 3
      FOOTNOTE_SPAN: 1 / 3, // review round 4
      TITLE_LARGER: 1.5, // review round 4
      TITLE_ABOVE_EMS: 1.5, // review round 4
      QUOTE_MIN_WORDS: 3, // review round 4
      NOTICE_MIN_WORDS: 4, // review round 4 fixes
      CAPTION_TOP_RATIO: 2, // regression verify after review round 6
      TEXT_H_RUN: { ems: 1.2, min: 12, max: 22 },
      TEXT_H_RULE: { ems: 1.4, min: 14, max: 22 },
      RUN_BOTTOM_EMS: 0.15,
      RULE_BOTTOM_GAP: 1,
      DEFAULT_SIZE: 10,
      CLEARANCE_GAP: 1,
      MIN_FIELD_H: 10,
      TEXT_DESCENT_EMS: 0.2,
      TEXT_ASCENT_EMS: 0.7,
      SQUARE_MIN: 6,
      SQUARE_MAX: 20,
      SQUARE_SKEW: 0.2,
      SQUARE_INSET: 1,
      JOIN_EPS: 0.5, // review
      JOIN_CROWD: 16, // review (a work bound)
      UNDERLINE_MAX_GAP: 3,
      UNDERLINE_SPAN: 0.5,
      DIVIDER_SPAN: 0.85,
      BAND_EDGE: 0.08,
      BAND_SPAN: 0.7,
      BAND_REPEAT_EPS: 2,
      BAND_REPEAT_PAGES: 2,
      GRID_TOUCH_EPS: 1,
      GRID_END_TOUCHES: 2,
      GRID_TOUCHES: 3,
      GRID_ROWS_MIN: 3, // review
      GRID_ROW_EPS: 2, // review
      GRID_PITCH_EPS: 2, // review
      GRID_COLUMN_GAP: 24, // review
      COMB_MIN: 2, // review round 3 (the brief's was 4)
      COMB_EPS: 1,
      GRID_HEAD_ABOVE: 20, // review round 3
      CELL_ROWS_MIN: 2, // owner, round 4
      CELL_LABEL_MAX: 40, // owner, round 4
      SIGNOFF_ABOVE: 80, // review
      IOU_EXISTING: 0.3,
      DUP_DY: 4,
      DUP_OVERLAP: 0.5,
      BOUND_EPS: 0.5,
      CAPS: { perPage: 60, perRun: 300, pages: 50 },
    });
    expect([SIGNATURE_RE.source, SIGNATURE_RE.flags]).toEqual([
      // The anchored alternative: review round 4 fixes, finding 25.
      String.raw`\b(sign(atures?|ed)?|initials)\b|^\W*initial(\s+here)?\W*$`,
      "i",
    ]);
    expect([SIGNOFF_RE.source, SIGNOFF_RE.flags]).toEqual([
      String.raw`^\W*(?:(?:yours|very|kind|kindest|best|warm|warmest|with|signed|for|and)\s+)*(sincerely|regards|faithfully|truly|cordially|respectfully|on\s+behalf\s+of)\b`,
      "i",
    ]);
    // Built from code points, as the module builds them (ASCII source).
    const cp = (...points: number[]) => String.fromCodePoint(...points);
    expect([FOOTNOTE_RE.source, FOOTNOTE_RE.flags]).toEqual([
      String.raw`^\s*(?:\d{1,3}(?!\d)|[*` +
        cp(0x2020, 0x2021, 0xb9, 0xb2, 0xb3, 0x2070, 0x2074, 0x2d, 0x2079) +
        "])",
      "u",
    ]);
    expect([QUOTE_END_RE.source, QUOTE_END_RE.flags]).toEqual([
      `[.!?]["'${cp(0x2019, 0x201d)})]?$`,
      "u",
    ]);
    expect([NOTICE_END_RE.source, NOTICE_END_RE.flags]).toEqual(["[.!?]$", ""]);
  });
});

describe("labelled-rule", () => {
  it("proposes a field on a labelled line, inset 1 pt, 1 pt above it", () => {
    expect(props(labelledRule())).toEqual([
      expect.objectContaining({
        rule: "labelled-rule",
        type: "text",
        label: "Address",
        x: 131,
        y: 601,
        width: 198,
        height: 17, // clamp(1.4 x 12) = 16.8, top 617.8 rounds to 618
      }),
    ]);
  });

  it("RULE_MIN_LEN: a 36 pt line is a candidate, 35.9 pt is not", () => {
    expect(props(labelledRule({ segs: [hseg(130, 166, 600)] }))).toHaveLength(
      1,
    );
    const short = run(labelledRule({ segs: [hseg(130, 165.9, 600)] }));
    expect(short.proposals).toEqual([]);
    expect(short.excluded).toEqual([]);
  });

  it("RULE_MAX_DY: a rise of 0.5 pt is level, 0.6 pt is not", () => {
    expect(
      props(labelledRule({ segs: [{ ...hseg(130, 330, 600), y1: 600.5 }] })),
    ).toHaveLength(1);
    expect(
      props(labelledRule({ segs: [{ ...hseg(130, 330, 600), y1: 600.6 }] })),
    ).toHaveLength(0);
  });

  it("RULE_MAX_WIDTH: a 2 pt stroke is a rule, 2.1 pt is not", () => {
    expect(
      props(labelledRule({ segs: [hseg(130, 330, 600, { width: 2 })] })),
    ).toHaveLength(1);
    expect(
      props(labelledRule({ segs: [hseg(130, 330, 600, { width: 2.1 })] })),
    ).toHaveLength(0);
  });

  it("RULE_MAX_WIDTH: a filled bar 2 pt tall is a rule, 2.1 pt is not", () => {
    const bar = (h: number) =>
      pg({
        text: [txt("Address:", 72, 600, { width: 48 })],
        rects: [
          rect(130, 600 - h / 2, 200, h, { filled: true, stroked: false }),
        ],
      });
    expect(props(bar(2))).toHaveLength(1);
    expect(props(bar(2.1))).toHaveLength(0);
  });

  it("RULE_MERGE_GAP: pieces 1 pt apart are one line, 1.1 pt apart are not", () => {
    const two = (gap: number) =>
      labelledRule({
        segs: [hseg(130, 150, 600), hseg(150 + gap, 170 + gap, 600)],
      });
    expect(props(two(1))).toEqual([
      expect.objectContaining({ x: 131, width: 39 }),
    ]);
    expect(props(two(1.1))).toEqual([]);
  });

  it("LABEL_LEFT_GAP_RULE: a label ending 36 pt left of the line counts, 36.1 does not", () => {
    const at = (right: number) =>
      pg({
        text: [txt("Address:", right - 48, 600, { width: 48 })],
        segs: [hseg(130, 330, 600)],
      });
    expect(props(at(94))[0]?.label).toBe("Address");
    expect(firstRule(at(93.9))).toBe("unlabelled");
  });

  it("a label must end left of the line (within 1 pt)", () => {
    const at = (right: number) =>
      pg({
        text: [txt("Address:", right - 48, 600, { width: 48 })],
        segs: [hseg(130, 330, 600)],
      });
    expect(props(at(131))).toHaveLength(1);
    expect(firstRule(at(131.1))).toBe("unlabelled");
  });

  it("LABEL_BELOW_RULE: a label baseline 2 pt under the line counts, 2.1 does not", () => {
    const at = (y: number) =>
      pg({
        text: [txt("Address:", 72, y, { width: 48 })],
        segs: [hseg(130, 330, 600)],
      });
    expect(props(at(598))).toHaveLength(1);
    expect(firstRule(at(597.9))).toBe("unlabelled");
  });

  it("LABEL_ABOVE_RULE_EMS: a label baseline 0.6 em over the line counts, more does not", () => {
    const at = (y: number) =>
      pg({
        text: [txt("Address:", 72, y, { width: 48 })],
        segs: [hseg(130, 330, 600)],
      });
    expect(props(at(607.2))).toHaveLength(1);
    expect(firstRule(at(607.3))).toBe("unlabelled");
  });

  it("CAPTION_MIN / CAPTION_MAX: a caption top 1 to 14 pt under the line counts", () => {
    // Caption size 10: top = baseline + 7.
    const at = (top: number) =>
      pg({
        text: [txt("Date", 150, top - 7, { size: 10, width: 20 })],
        segs: [hseg(150, 300, 550)],
      });
    expect(props(at(549))[0]?.label).toBe("Date");
    expect(firstRule(at(549.1))).toBe("unlabelled");
    expect(props(at(536))[0]?.label).toBe("Date");
    expect(firstRule(at(535.9))).toBe("unlabelled");
  });

  // Review round 6 test honesty, cost finding 6: the caption is read from a
  // baseline window set by the page's smallest and largest text sizes, so a
  // page of one size could not tell them apart and the window's far end
  // could move with everything green. With a 5 pt footer on the page the
  // 10 pt caption at CAPTION_MAX still counts.
  it("CAPTION_MAX on a page of mixed sizes: a 10 pt caption top 14 pt under the line counts", () => {
    const at = (top: number) =>
      pg({
        text: [
          txt("Date", 150, top - 7, { size: 10, width: 20 }),
          txt("Page 1", 72, 40, { size: 5, width: 15 }),
        ],
        segs: [hseg(150, 300, 550)],
      });
    expect(props(at(536))[0]?.label).toBe("Date");
    expect(firstRule(at(535.9))).toBe("unlabelled");
    expect(props(at(549))[0]?.label).toBe("Date");
  });

  it("CAPTION_SPAN: a caption must overlap the first 40% of the line", () => {
    const at = (x: number) =>
      pg({
        text: [txt("Date", x, 540, { size: 10, width: 20 })],
        segs: [hseg(150, 300, 550)],
      });
    expect(props(at(209.9))[0]?.label).toBe("Date");
    expect(firstRule(at(210))).toBe("unlabelled");
  });

  // Review round 3, finding 4: a caption printed INSIDE an outlined box's
  // top-left was read as the caption under the box's TOP edge, so the field
  // went above the box, outside it. A larger outlined box's top edge takes
  // no caption from under it: what is under it is inside the box.
  describe("an outlined box's top edge takes no caption from inside the box", () => {
    const boxed = (more: CardSeg[] = []) =>
      pg({
        rects: [rect(72, 672, 468, 28)],
        segs: more,
        text: [txt("1 Name", 74, 693, { size: 7, width: 22 })],
      });

    // INVERTED in review round 4 fixes (finding 22). This read "the
    // caption inside the box's top-left labels no edge: nothing above the
    // box" and pinned both edges unlabelled (673 and 701): a delivery
    // note's "Received by" / "Date" boxes got no field at all. The caption
    // now labels the box's BOTTOM edge, so the field sits inside the box;
    // the top edge still takes nothing.
    it("the caption inside the box's top-left labels its bottom edge: a field inside the box, nothing above it", () => {
      expect(props(boxed()).map((x) => [x.label, x.y])).toEqual([
        ["1 Name", 673],
      ]);
      expect(run(boxed()).excluded.map((e) => [e.rule, e.box.y])).toEqual([
        ["unlabelled", 701],
      ]);
    });

    it("the same caption under a plain line still labels it (the control)", () => {
      const p = pg({
        segs: [hseg(72, 540, 700)],
        text: [txt("1 Name", 74, 693, { size: 7, width: 22 })],
      });
      expect(props(p)).toEqual([
        expect.objectContaining({ label: "1 Name", y: 701 }),
      ]);
    });

    it("a plain line joined to the box's top edge is the box's top too", () => {
      // Merged from the left: the line comes first in the merge, so the
      // box's mark must carry into it. (Until review round 4 fixes this
      // expected no proposal at all; the bottom edge's field inside the
      // box is finding 22's, so it asserts nothing ABOVE the box.)
      expect(
        props(boxed([hseg(40, 72.5, 700)])).filter((x) => x.y > 700),
      ).toEqual([]);
      expect(props(boxed([hseg(40, 72.5, 700)])).map((x) => x.y)).toEqual([
        673,
      ]);
    });

    // Review round 4 fixes, finding 22: an outlined box's bottom edge
    // takes a caption: its one interior text, set under the top-left, or,
    // when the box is empty, the nearest text just above its top.
    describe("an outlined box's bottom edge takes the box's caption", () => {
      /** A 468 x 60 box from y 300, `text` around it. */
      const box = (text: CardText[], more: Partial<CardPage> = {}) =>
        pg({ rects: [rect(72, 300, 468, 60)], text, ...more });
      const labels = (p: CardPage) => props(p).map((x) => [x.label, x.y]);

      it("an empty box with 'Comments:' above it: a field at the box's bottom", () => {
        // Descent bottom 2 pt over the top (baseline 364, 10 pt).
        expect(
          labels(box([txt("Comments:", 72, 364, { size: 10, width: 50 })])),
        ).toEqual([["Comments", 301]]);
      });

      it("CAPTION_MAX above: the text's descent up to 14 pt over the top counts, 14.1 does not; none reaching into the box", () => {
        const above = (gap: number) =>
          box([txt("Comments:", 72, 362 + gap, { size: 10, width: 50 })]);
        expect(labels(above(14))).toEqual([["Comments", 301]]);
        expect(labels(above(14.1))).toEqual([]);
        expect(labels(above(0))).toEqual([["Comments", 301]]);
        expect(labels(above(-0.1))).toEqual([]);
      });

      it("CAPTION_MAX inside: the one interior text's top up to 14 pt under the box's top counts, 14.1 does not; 1 pt over it still counts", () => {
        // A 10 pt caption: its top is 7 pt over its baseline.
        const inside = (gap: number) =>
          box([txt("Received by", 74, 360 - gap - 7, { size: 10, width: 55 })]);
        expect(labels(inside(14))).toEqual([["Received by", 301]]);
        expect(labels(inside(14.1))).toEqual([]);
        expect(labels(inside(-1))).toEqual([["Received by", 301]]);
        expect(labels(inside(-1.1))).toEqual([]);
      });

      // Review round 6 test honesty, cost finding 6: both searches read a
      // baseline window, and four of its edges could move with everything
      // green. Above the box the window is set by the page's smallest and
      // largest text sizes, so the page holds a 30 pt title and a 5 pt
      // footer (one size cannot tell the smallest from the largest): a
      // 10 pt caption at either end of CAPTION_MAX still counts.
      it("the window over an empty box reaches both ends of CAPTION_MAX on a page of mixed sizes", () => {
        const mixed = (gap: number) =>
          box([
            txt("Comments:", 72, 362 + gap, { size: 10, width: 50 }),
            txt("APPLICATION", 72, 720, { size: 30, width: 200 }),
            txt("Page 1", 72, 40, { size: 5, width: 15 }),
          ]);
        expect(labels(mixed(0))).toEqual([["Comments", 301]]);
        expect(labels(mixed(14))).toEqual([["Comments", 301]]);
        expect(labels(mixed(-0.1))).toEqual([]);
        expect(labels(mixed(14.1))).toEqual([]);
      });

      // Inside the box the window runs from its bottom to its top: a text
      // just over the bottom edge, or just under the top, is interior
      // text, and two interior texts are no caption.
      it("a second interior text just over the bottom edge or just under the top leaves no caption", () => {
        const two = (y: number) =>
          box([
            txt("Received by", 74, 346, { size: 10, width: 55 }),
            txt("x", 300, y, { size: 1, width: 1 }),
          ]);
        // Both edges unlabelled: neither a caption nor a field crossing
        // the "x" (a window from 1 pt over the bottom proposed the caption
        // at 300.3 and excluded it as crossing the "x" at 300.5).
        for (const y of [330, 300.3, 300.5, 359.5]) {
          expect(labels(two(y)), String(y)).toEqual([]);
          expect(
            run(two(y)).excluded.map((e) => e.rule),
            String(y),
          ).toEqual(["unlabelled", "unlabelled"]);
        }
        // Positive control: on the edges or outside the box it is not
        // interior, and the caption stands.
        expect(labels(two(300))).toEqual([["Received by", 301]]);
        expect(labels(two(360))).toEqual([["Received by", 301]]);
      });

      it("CAPTION_SPAN: the caption must reach into the box's left 40%", () => {
        const at = (x: number) =>
          box([txt("Received by", x, 350, { size: 7, width: 40 })]);
        // The left 40% of 72..540 ends at 259.2.
        expect(labels(at(219))).toEqual([["Received by", 301]]);
        expect(labels(at(259.3))).toEqual([]);
      });

      it("over an empty box the NEAREST text is its caption, and only upright text", () => {
        const p = box([
          txt("Comments:", 72, 364, { size: 10, width: 50 }),
          txt("Section B", 72, 374, { size: 10, width: 50 }),
        ]);
        expect(labels(p)).toEqual([["Comments", 301]]);
        const turned = box([
          txt("Comments:", 72, 364, { size: 10, width: 50, upright: false }),
        ]);
        expect(labels(turned)).toEqual([]);
      });

      it("RESIDUAL: a hint sentence between a caption and its box leaves the box unlabelled", () => {
        // "Dietary requirements" 16 pt over the box, an 8 pt sentence 8.
        const p = box([
          txt("Dietary requirements", 72, 380, { size: 10, width: 100 }),
          txt("Please tell us about any allergies or needs.", 72, 368, {
            size: 8,
            width: 160,
          }),
        ]);
        expect(labels(p)).toEqual([]);
      });

      // Review round 5 fixes, finding 10: pdf.js emits whitespace items
      // often, and the box's ONE interior text must not count them
      // (mutant BC7: a blank item made two and the caption was lost).
      it("a blank item inside the box does not count as its second text", () => {
        const p = pg({
          rects: [rect(72, 600, 300, 40)],
          text: [
            txt("Received by", 74, 630, { size: 7, width: 40 }),
            txt(" ", 74, 615, { size: 10, width: 3 }),
          ],
        });
        expect(props(p).map((x) => x.label)).toEqual(["Received by"]);
      });

      // Review round 5 fixes, finding 11: over an EMPTY box only upright
      // text competes for nearest (mutant BC3: a turned "DRAFT" nearer
      // the top won, and the caption was lost).
      it("over an empty box a nearer turned text does not beat the upright caption", () => {
        const p = pg({
          rects: [rect(72, 600, 300, 40)],
          text: [
            txt("Received by", 72, 652, { size: 10, width: 55 }),
            txt("DRAFT", 72, 643, { size: 10, width: 30, upright: false }),
          ],
        });
        expect(props(p).map((x) => x.label)).toEqual(["Received by"]);
      });

      it("a turned interior text is no caption", () => {
        const p = box([
          txt("Received by", 74, 350, { size: 7, width: 40, upright: false }),
        ]);
        expect(labels(p)).toEqual([]);
      });

      it("only the box's ONE interior text: a box holding two is left alone", () => {
        expect(
          labels(
            box([
              txt("Received by", 74, 350, { size: 7, width: 40 }),
              txt("J. Smith", 74, 320, { size: 10, width: 40 }),
            ]),
          ),
        ).toEqual([]);
      });

      it("NOTICE_MIN_WORDS: one sentence of 4 words ending . ! ? is a notice, not a caption; 3 words is a caption", () => {
        const one = (s: string) =>
          box([txt(s, 78, 345, { size: 10, width: 200 })]);
        expect(labels(one("Bring photo ID please."))).toEqual([]);
        expect(labels(one("Bring photo ID please!"))).toEqual([]);
        expect(labels(one("Bring photo ID please?"))).toEqual([]);
        expect(labels(one("Bring photo ID."))).toEqual([
          ["Bring photo ID", 301],
        ]);
        // Ending otherwise (")" here), any length is a caption.
        expect(labels(one("Address (number, street, and apt. no.)"))).toEqual([
          ["Address (number, street, and apt. no.)", 301],
        ]);
      });

      // Review round 5 fixes, finding 2: a one-line instruction framed in a
      // 30 pt box, written without a full stop, passed as a caption and
      // became a field squeezed under it. A captioned box has room to
      // write under its caption.
      //
      // INVERTED in review round 6 fixes (finding 2). This read "a
      // captioned box has room under its caption: 14 pt counts, 13.9 does
      // not (a framed instruction)" and pinned framed(33.9) as no field:
      // the room asked was a field's height for the caption's size
      // (TEXT_H_RULE, 14 pt), more than the classifier asks of any field
      // (MIN_FIELD_H, 10), and compact captioned boxes on tax forms (20
      // to 22 pt tall, a 6 to 8 pt caption in the top-left) lost the field
      // round 4 gave them. A caption sits in the top of its box and a
      // framed notice about its middle: the room under the caption (from
      // its descent to the box's bottom) is at least MIN_FIELD_H and more
      // than the room over it (from its ascent to the box's top).
      //
      // INVERTED AGAIN in the regression verify after review round 6. That
      // read "a captioned box has more room under its caption than over
      // it, and at least MIN_FIELD_H (a framed instruction has neither)",
      // and pinned framed(31.1) and framed(33.9) as fields named after the
      // instruction: "more than the room over it" let a stop-less
      // instruction framed 1 to 3 pt taller than A5's box through, which
      // round 5 (78964d41) had proposed nothing for. A field's height for
      // the caption's size counts on its own again (round 5's rule), and
      // short of it the room under the caption is MIN_FIELD_H and twice
      // the room over it (CAPTION_TOP_RATIO): a compact box's caption sits
      // a point or two under its top, a framed instruction about its
      // middle.
      it("a captioned box has a field's height under its caption, or MIN_FIELD_H and CAPTION_TOP_RATIO x the room over it (a framed instruction has neither)", () => {
        const framed = (h: number) =>
          pg({
            rects: [rect(72, 690, 468, h)],
            // Baseline 12 pt over the bottom: descent bottom 10 pt over it.
            text: [
              txt(
                "Please use block capitals and black ink throughout",
                80,
                702 + (h - 30),
                { size: 10, width: 240 },
              ),
            ],
          });
        // A5's 30 pt box: 10 pt of room under the text, 11 over it.
        expect(labels(framed(30))).toEqual([]);
        expect(run(framed(30)).excluded.map((e) => e.rule)).toEqual([
          "unlabelled",
          "unlabelled",
        ]);
        // Over it stays 11 as the box grows, so twice it is 22: short of a
        // field's height for 10 pt (14) under it, nothing counts.
        expect(labels(framed(31))).toEqual([]);
        expect(labels(framed(31.1))).toEqual([]);
        expect(labels(framed(33.9))).toEqual([]);
        // 14 pt under it counts on its own (round 5's boundary).
        expect(labels(framed(34))).toEqual([
          ["Please use block capitals and black ink throughout", 691],
        ]);
        // A compact box, its 10 pt caption 1 pt under the top: 10 pt of
        // room under it counts, 9.9 does not. (The field inside is then
        // squeezed under the caption, so `no-clearance` is off to see the
        // caption rule's own boundary; corpus P51 is the real shape.)
        const compact = (base: number) =>
          props(
            pg({
              rects: [rect(72, 600, 150, 20)],
              text: [txt("Wages", 74, base, { size: 10, width: 30 })],
            }),
            { disable: new Set(["no-clearance"] as const) },
          ).map((x) => [x.label, x.y]);
        expect(compact(612)).toEqual([["Wages", 601]]);
        expect(compact(611.9)).toEqual([]);
        // CAPTION_TOP_RATIO: 12 pt under "Wages" (short of 14) counts with
        // 6 pt over it, not with 6.1.
        const deep = (h: number) =>
          props(
            pg({
              rects: [rect(72, 600, 150, h)],
              text: [txt("Wages", 74, 614, { size: 10, width: 30 })],
            }),
            { disable: new Set(["no-clearance"] as const) },
          ).map((x) => [x.label, x.y]);
        expect(deep(27)).toEqual([["Wages", 601]]);
        expect(deep(27.1)).toEqual([]);
      });

      it("a bottom edge merged with another line is no box's bottom: it takes no box caption", () => {
        const p = box([txt("Comments:", 72, 364, { size: 10, width: 50 })], {
          segs: [hseg(20, 72.5, 300)],
        });
        expect(labels(p)).toEqual([]);
        // Joined from the right: the box's edge comes first in the merge.
        const q = box([txt("Comments:", 72, 364, { size: 10, width: 50 })], {
          segs: [hseg(539.5, 560, 300)],
        });
        expect(labels(q)).toEqual([]);
      });

      it("a box labelled from its left keeps its left label", () => {
        const p = pg({
          rects: [rect(140, 600, 200, 18)],
          text: [
            txt("Received by:", 72, 605.5, { size: 10, width: 60 }),
            txt("Notes", 142, 613, { size: 7, width: 20 }),
          ],
        });
        expect(props(p).map((x) => x.label)).toEqual(["Received by"]);
      });

      // Regression verify after review round 6 (mutant WI2): the box's
      // interior is read from the baselines up to its top. A window ending
      // 0.5 pt short of the top left a text 0.3 pt under it out, and the
      // box took the caption over it instead.
      it("a text whose baseline is just under the box's top is inside it; on the top it is not", () => {
        const p = (dy: number) =>
          pg({
            rects: [rect(72, 600, 300, 40)],
            text: [
              txt("DRAFT", 200, 640 - dy, { size: 10, width: 30 }),
              txt("Received by", 72, 652, { size: 10, width: 55 }),
            ],
          });
        expect(labels(p(0))).toEqual([["Received by", 601]]);
        expect(labels(p(0.3))).toEqual([]);
      });
    });

    // Review round 4 fixes, finding 24: a label set vertically centred
    // beside a box ("Total hours [____]") sat above the bottom edge's label
    // band (0.6 em over it), so a box taller than about 18 pt lost its
    // label. A box's bottom edge takes a left label anywhere up its side:
    // the band reaches to the box's top less the label's ascent.
    describe("a box's bottom edge takes a left label anywhere up its side", () => {
      /** A 130 pt wide box `h` tall from y 650, "Total hours" at `base`. */
      const side = (h: number, base: number) =>
        pg({
          rects: [rect(140, 650, 130, h)],
          text: [txt("Total hours", 72, base, { size: 10, width: 55 })],
        });
      const label = (p: CardPage) => props(p).map((x) => [x.label, x.y]);

      it("'Total hours' centred on a 22 pt box, and 'Reference:' on a 30 pt one", () => {
        expect(label(side(22, 657.5))).toEqual([["Total hours", 651]]);
        expect(
          label(
            pg({
              rects: [rect(140, 540, 200, 30)],
              text: [txt("Reference:", 72, 551, { size: 10, width: 50 })],
            }),
          ),
        ).toEqual([["Reference", 541]]);
      });

      it("the band's top: a baseline at the box's top less 0.7 em counts, 0.1 pt higher does not", () => {
        // A 30 pt box: its top at 680, so 673 is the highest baseline.
        expect(label(side(30, 673))).toEqual([["Total hours", 651]]);
        expect(label(side(30, 673.1))).toEqual([]);
      });

      it("a plain line keeps its band (0.6 em over it), and so does a box edge merged with a line", () => {
        const line = pg({
          segs: [hseg(140, 270, 650)],
          text: [txt("Total hours", 72, 657.5, { size: 10, width: 55 })],
        });
        expect(label(line)).toEqual([]);
        const merged = side(22, 657.5);
        merged.segs = [hseg(269.5, 300, 650)];
        expect(label(merged)).toEqual([]);
      });

      // Review round 6 fixes, finding 1 (a regression from finding 24's
      // band): in a row of separate captioned boxes 10 pt apart (a W-2's),
      // a box's left neighbour's caption ends within the 36 pt left gap
      // and sits up the box's side, so it labelled the box over the box's
      // own caption. Text inside another outlined box that ends left of
      // the box is that box's caption, and the box's own caption wins.
      describe("a row of separate captioned boxes: each box takes its own caption", () => {
        const CAPS = [
          "1 Wages, tips, other compensation",
          "2 Federal income tax withheld",
          "3 Social security wages",
        ];
        /** Three 150 pt boxes `h` tall, 8 pt captions 2 pt under the tops. */
        const row = (h: number, more: Partial<CardPage> = {}) =>
          pg({
            rects: CAPS.map((_, i) => rect(72 + 160 * i, 650, 150, h)),
            // Caption 1 ends at 206, 26 pt left of box 2 (at 232).
            text: CAPS.map((s, i) =>
              txt(s, 74 + 160 * i, 650 + h - 7.6, { size: 8 }),
            ),
            ...more,
          });

        it("24 and 28 pt boxes: box 2 takes '2 Federal income tax withheld', not box 1's caption", () => {
          for (const h of [24, 28])
            expect(label(row(h))).toEqual(CAPS.map((s) => [s, 651]));
        });

        it("a label in a cell of its own beside an EMPTY box still labels it", () => {
          const p = pg({
            rects: [rect(72, 650, 60, 24), rect(140, 650, 130, 24)],
            text: [txt("Total hours", 74, 657.5, { size: 10, width: 55 })],
          });
          expect(label(p)).toEqual([["Total hours", 651]]);
        });

        // Review round 6 test honesty: only a BOX's edge sets a held label
        // aside. With that guard dropped, a plain line asked for the
        // caption of a box it is not (an undefined top), found the heading
        // over it, and lost its label: the mutant stayed green.
        it("a writing line, no box, beside a label in a cell of its own takes it, a heading over the line or not", () => {
          const line = (more: CardText[]) =>
            props(
              pg({
                rects: [rect(72, 600, 60, 20)],
                segs: [hseg(140, 400, 601)],
                text: [txt("Name", 104, 605, { size: 10, width: 25 }), ...more],
              }),
            ).map((x) => [x.label, x.x]);
          expect(line([])).toEqual([["Name", 141]]);
          expect(
            line([txt("Applicant", 150, 700, { size: 12, width: 50 })]),
          ).toEqual([["Name", 141]]);
        });

        it("a left label not wholly inside a box ending left of the box keeps labelling it", () => {
          // "Received by:" over the top of a box under it, under the bottom
          // of a box over it, overhanging the left side of a narrower one
          // and the right side of another, and inside a frame round the
          // whole row: none holds it as its own text.
          const beside = (frame: CardRect) =>
            props(
              pg({
                rects: [rect(140, 600, 200, 24), frame],
                text: [
                  txt("Received by:", 72, 605.5, { size: 10, width: 60 }),
                  txt("Notes", 142, 619, { size: 7, width: 20 }),
                ],
              }),
            )
              .filter((x) => x.x === 141)
              .map((x) => [x.label, x.y]);
          for (const frame of [
            rect(72, 560, 60, 40),
            rect(72, 610, 60, 30),
            rect(80, 600, 52, 20),
            rect(60, 600, 50, 20),
            rect(60, 590, 400, 40),
          ])
            expect(beside(frame)).toEqual([["Received by", 601]]);
          // The control: wholly inside a cell of its own, it is that
          // cell's text, and the box's own caption wins.
          expect(beside(rect(70, 600, 64, 20))).toEqual([["Notes", 601]]);
        });

        // Regression verify after review round 6: the frames above sit 8
        // to 12 pt off every edge of the cell test, so each of its five
        // edges could move (1 pt of slack dropped, strict made loose) with
        // every test green (mutants BH2, BH4, BH5, BH6, BH7). Each edge is
        // pinned here at the boundary and just past it.
        it("the cell holding a left label: 1 pt of slack at its sides and right, none at its top and bottom", () => {
          const beside = (frame: CardRect, lab: Partial<CardText> = {}) =>
            props(
              pg({
                rects: [rect(140, 600, 200, 24), frame],
                text: [
                  txt("Received by:", 72, 605.5, {
                    size: 10,
                    width: 60,
                    ...lab,
                  }),
                  txt("Notes", 142, 619, { size: 7, width: 20 }),
                ],
              }),
            )
              .filter((x) => x.x === 141)
              .map((x) => x.label);
          const HELD = ["Notes"];
          const FREE = ["Received by"];
          // Its left edge up to 1 pt right of the label's start (72).
          expect(beside(rect(72.5, 600, 61.5, 20))).toEqual(HELD);
          expect(beside(rect(73, 600, 61, 20))).toEqual(HELD);
          expect(beside(rect(73.1, 600, 61, 20))).toEqual(FREE);
          // Its right edge up to 1 pt left of the label's end (132).
          expect(beside(rect(70, 600, 61.5, 20))).toEqual(HELD);
          expect(beside(rect(70, 600, 61, 20))).toEqual(HELD);
          expect(beside(rect(70, 600, 60.9, 20))).toEqual(FREE);
          // Its right edge up to 1 pt into the box (from 140), the cell
          // short enough not to meet the box's top or bottom.
          expect(beside(rect(70, 603, 70.5, 10))).toEqual(HELD);
          expect(beside(rect(70, 603, 71, 10))).toEqual(HELD);
          expect(beside(rect(70, 603, 71.1, 10))).toEqual(FREE);
          // The baseline (605.5) strictly inside: on the bottom or the top
          // edge is outside the cell.
          expect(beside(rect(70, 605.4, 64, 20))).toEqual(HELD);
          expect(beside(rect(70, 605.5, 64, 20))).toEqual(FREE);
          expect(beside(rect(70, 590, 64, 15.6))).toEqual(HELD);
          expect(beside(rect(70, 590, 64, 15.5))).toEqual(FREE);
          // A negative width reaches no farther left than the label's
          // start: starting 5 pt right of the cell, it is outside it.
          expect(beside(rect(70, 600, 50, 20), { x: 125, width: -10 })).toEqual(
            FREE,
          );
        });

        // Regression verify after review round 6 (mutant OW5): the field's
        // height is read from the label it takes. With the held caption
        // nearer, sizing from every left hit took the held 10 pt "No."
        // for the free 14 pt "Received by:".
        it("a free left label beside a held one sizes the field from its own text", () => {
          const p = (held: number, free: number) =>
            props(
              pg({
                rects: [rect(140, 600, 200, 24), rect(100, 600, 38, 20)],
                text: [
                  txt("Received by:", 44, 605.5, { size: free, width: 60 }),
                  txt("No.", 102, 605.5, { size: held, width: 30 }),
                  txt("Notes", 142, 619, { size: 7, width: 20 }),
                ],
              }),
            )
              .filter((x) => x.x === 141)
              .map((x) => [x.label, x.height]);
          expect(p(10, 14)).toEqual([["Received by", 17]]);
          expect(p(14, 10)).toEqual([["Received by", 14]]);
        });

        // Mutant BH1 (the tall test written `b1 - b0 > TALL`): a rect
        // whose bands are both infinite has no finite span, and walking
        // its buckets one by one never ends.
        //
        // This test also held the call to `< 250` ms, and that bound could
        // never fail on BH1: the walk does not return, so the clock is not
        // read. BH1 is red here as a RangeError ("Invalid array length",
        // the bucket's list overflowing after 2.2 to 2.4 s on Windows, 3 of
        // 3 runs) thrown from the walk itself, and so is `TALL = Infinity`
        // (the frame walked from -Infinity; 2.5 s, 1 run). An infinite cost
        // has no ratio, so the bound is gone, not converted: the cost of a
        // rect's height is pinned as a ratio by the test after this one.
        it("a cell with an infinite top and bottom holds its label; a rect at an infinite height is read once, not bucket by bucket", () => {
          const frame: CardRect = {
            ...rect(70, 0, 64, 0),
            y0: -Infinity,
            y1: Infinity,
          };
          const lost: CardRect = {
            ...rect(400, 0, 50, 0),
            y0: Infinity,
            y1: Infinity,
          };
          const p = pg({
            rects: [rect(140, 600, 200, 24), frame, lost],
            text: [
              txt("Received by:", 72, 605.5, { size: 10, width: 60 }),
              txt("Notes", 142, 619, { size: 7, width: 20 }),
            ],
          });
          const got = props(p)
            .filter((x) => x.x === 141)
            .map((x) => x.label);
          expect(got).toEqual(["Notes"]);
        });

        // A rect taller than TALL buckets is met by every question instead
        // of being filed in a bucket per 50 pt of its height. First pinned
        // as one 2e8 pt rect classified in `< 250` ms, a wall-clock bound
        // (see interleavedBest). Now the cost of the HEIGHT: a 16x taller
        // holder must cost what the shorter one costs, and filed bucket by
        // bucket it costs 16x. First timed as 200 classifications per
        // sample (fixed 0.88 to 1.35; `TALL = Infinity` 18.2 to 22.0 with
        // the test alone); samples are time-boxed now.
        // Measured in this whole file (see interleavedBest): fixed 0.89 to
        // 1.13 one or 4 at a time, 0.66 to 1.36 under the pinned loads;
        // with `TALL = Infinity` (every rect filed bucket by bucket) 18.49
        // to 19.16, and 16.20 to 21.78 4 at a time; with only a span that
        // is not finite met by every question, 17.95 to 19.80 and 17.68 to
        // 21.72. The bound, 4, is 2.9x over the worst fixed and 4.1x under
        // the lowest defect.
        it("a rect far taller than the page holds its text too, without a bucket per point", () => {
          const page = (h: number) =>
            pg({
              rects: [rect(70, -h / 2, 64, h), rect(140, 600, 200, 24)],
              text: [
                txt("Received by:", 72, 605.5, { size: 10, width: 60 }),
                txt("Notes", 142, 619, { size: 7, width: 20 }),
              ],
            });
          const labels = (p: CardPage) => () =>
            props(p)
              .filter((x) => x.x === 141)
              .map((x) => x.label);
          const [short, tall] = interleavedBest([
            labels(page(2.5e5)),
            labels(page(4e6)),
          ]);
          // Health: at both heights the holder holds "Received by:", so the
          // box takes its own caption.
          expect(short!.got).toEqual(["Notes"]);
          expect(tall!.got).toEqual(["Notes"]);
          expectRatioUnder("rect far taller than the page", tall!, short!, 4);
        }, 60_000);

        // Review round 6 test honesty: each held-label question reads only
        // the rects round its text's baseline. A mutant that met every
        // rect in every question stayed green; it cost 8,000 left hits x
        // 20,000 far rects here (16,000 hits since the test became a ratio).
        it("each left hit asks only the rects round it: 20,000 far rects cost nothing per hit", () => {
          // A 3,000 pt box with its own caption, 16,000 hits in a cell on
          // its left, and 20,000 rects far above the page.
          const far: CardRect[] = [];
          for (let j = 0; j < 20_000; j++)
            far.push(
              rect(10 + (j % 50) * 11, -5000 - 20 * Math.floor(j / 50), 4, 9),
            );
          const holder = rect(70, 500, 64, 3000);
          const box = rect(140, 500, 200, 3000);
          const caption = txt("Notes", 142, 3490, { size: 7, width: 20 });
          const hits: CardText[] = [];
          for (let i = 0; i < 16_000; i++)
            hits.push(
              txt("ab", 100, 510 + (2900 * i) / 16_000, { size: 6, width: 6 }),
            );
          const page = (rects: CardRect[], text: CardText[]) =>
            pg({ height: 4000, rects, text });
          const hitsOnly = page([box, holder], [caption, ...hits]);
          const farOnly = page([box, ...far], [caption]);
          const both = page([box, ...far, holder], [caption, ...hits]);
          const labels = (p: CardPage) => () => props(p).map((x) => x.label);
          const [held, alone, together] = interleavedBest([
            labels(hitsOnly),
            labels(farOnly),
            labels(both),
          ]);
          // Health checks: the hits are held (the box takes its own
          // caption) with the far rects or without them, and without the
          // holder they label the box.
          expect(held!.got).toEqual(["Notes"]);
          expect(alone!.got).toEqual(["Notes"]);
          expect(together!.got).toEqual(["Notes"]);
          expect(labels(page([box, ...far], [caption, ...hits]))()).toEqual([
            "ab",
          ]);
          // The hits and the far rects together cost what each costs alone.
          //
          // History. This was `last < 3 * first + 20` ms, the holder last
          // among the rects against the holder first: the additive 20 ms is
          // a larger share of a fast machine's run than a slow one's, so
          // the margin moved with the runner. Then (the ratio conversion's
          // first commit) the ratio last / first, bound 3: the question
          // written `p.rects.some(holds)` stops at the holder when it is
          // first and reads all 20,000 when it is last, and read 8.22, 8.13
          // and 7.44. But a question that reads every rect and does NOT
          // stop early costs the same with the holder first or last, so
          // neither form could see it: `p.rects.filter(holds).length > 0`
          // stayed green at 1.02, 1.03 and 1.06 (review of the ratio
          // conversion, finding 6; R2), the negation of this test's name.
          // Both against the sum sees any question that meets the far
          // rects, early exit or not: every hit pays for 20,000 rects, a
          // product of the two sides.
          // Measured in this whole file (see interleavedBest): fixed 0.96
          // to 1.28 one or 4 at a time, 1.46 at worst under the pinned
          // loads; `p.rects.filter(holds).length > 0` 10.98 to 11.83, and
          // 9.66 to 11.65 4 at a time; `p.rects.some(holds)` 10.20 to
          // 11.10, and 10.53 to 12.08. The bound, 4, is 2.7x over the
          // first and 2.4x under the lowest defect.
          expectRatioUnder(
            "each left hit, both vs each alone",
            together!,
            [held!, alone!],
            4,
          );
        }, 60_000);
      });
    });
  });

  // Review round 3, finding 5: a W-9's strips are captioned at their TOP,
  // just under the rule above, and each caption labelled that rule above:
  // every field went one strip too high, the first above the form. In an
  // even-pitch stack whose rules are all captioned but the lowest, each
  // caption now labels the rule below it (the strip it sits in).
  describe("strips captioned at their top: each caption labels the rule below it", () => {
    const Y = [710, 684, 658, 632, 606];
    /** Rules at `ys` (72..540 unless `x1` says), 7 pt captions under `captioned`. */
    const strips = (
      ys: number[],
      captioned: number[],
      o: { x1?: (i: number) => number; left?: [number, string][] } = {},
    ) =>
      pg({
        segs: ys.map((y, i) => hseg(72, o.x1?.(i) ?? 540, y)),
        text: [
          ...captioned.map((i) =>
            txt(`Caption ${i + 1}`, 74, ys[i]! - 7, { size: 7, width: 30 }),
          ),
          ...(o.left ?? []).map(([i, s]) =>
            txt(s, 40, ys[i]!, { size: 10, width: 30 }),
          ),
        ],
      });
    const labelled = (p: CardPage) =>
      props(p).map((x) => [x.label, x.y] as const);

    it("all captioned but the lowest: each caption labels the strip's lower rule, the top rule is unlabelled", () => {
      const p = strips(Y, [0, 1, 2, 3]);
      expect(labelled(p)).toEqual([
        ["Caption 1", 685],
        ["Caption 2", 659],
        ["Caption 3", 633],
        ["Caption 4", 607],
      ]);
      expect(props(p).every((x) => x.height === 14)).toBe(true);
      expect(run(p).excluded).toEqual([
        expect.objectContaining({ rule: "unlabelled" }),
      ]);
      expect(run(p).excluded[0]!.box.y).toBe(711);
    });

    it("the lowest captioned too (captions under their lines): nothing moves", () => {
      expect(labelled(strips(Y, [0, 1, 2, 3, 4]))).toEqual([
        ["Caption 1", 711],
        ["Caption 2", 685],
        ["Caption 3", 659],
        ["Caption 4", 633],
        ["Caption 5", 607],
      ]);
    });

    it("GRID_ROWS_MIN: three rules move, two do not", () => {
      expect(labelled(strips([710, 684, 658], [0, 1]))).toEqual([
        ["Caption 1", 685],
        ["Caption 2", 659],
      ]);
      expect(labelled(strips([710, 684], [0]))).toEqual([["Caption 1", 711]]);
    });

    it("a stack whose pitch changes (two runs sharing a rule) moves as one", () => {
      // 40 pt strips under 26 pt ones, as a W-9's strips vary.
      expect(labelled(strips([710, 684, 658, 618, 578], [0, 1, 2, 3]))).toEqual(
        [
          ["Caption 1", 685],
          ["Caption 2", 659],
          ["Caption 3", 619],
          ["Caption 4", 579],
        ],
      );
    });

    it("GRID_PITCH_EPS: a pitch 2 pt off the first still moves, 3 pt does not", () => {
      expect(labelled(strips([710, 684, 656], [0, 1]))).toEqual([
        ["Caption 1", 685],
        ["Caption 2", 657],
      ]);
      expect(labelled(strips([710, 684, 655], [0, 1]))).toEqual([
        ["Caption 1", 711],
        ["Caption 2", 685],
      ]);
    });

    it("GRID_ROW_EPS: a rule ending 2 pt off still stacks, 3 pt does not", () => {
      const off = (d: number) => (i: number) => (i === 2 ? 540 + d : 540);
      expect(labelled(strips([710, 684, 658], [0, 1], { x1: off(2) }))).toEqual(
        [
          ["Caption 1", 685],
          ["Caption 2", 659],
        ],
      );
      expect(labelled(strips([710, 684, 658], [0, 1], { x1: off(3) }))).toEqual(
        [
          ["Caption 1", 711],
          ["Caption 2", 685],
        ],
      );
    });

    it("a rows-only table is no strips: its captions stay (seen with table-grid off)", () => {
      const rows: [string, string, number][] = [
        ["Description", "Amount", 686],
        ["Widget", "10.00", 666],
        ["Gadget", "12.00", 646],
      ];
      const p = pg({
        segs: [700, 680, 660, 640].map((y) => hseg(72, 540, y)),
        text: rows.flatMap(([a, b, y]) => [
          txt(a, 76, y, { size: 10, width: 50 }),
          txt(b, 300, y, { size: 10, width: 30 }),
        ]),
      });
      expect(firstRule(p)).toBe("table-grid");
      expect(props(p, { disable: new Set(["table-grid"]) })).toContainEqual(
        expect.objectContaining({ label: "Description", y: 701 }),
      );
    });

    it("a rule labelled from its left is no strip: nothing moves", () => {
      // An upper rule with its own left label ...
      expect(
        labelled(strips([710, 684, 658], [0, 1], { left: [[1, "Name:"]] })),
      ).toEqual([
        ["Caption 1", 711],
        ["Name", 685],
      ]);
      // ... and the lowest with one.
      expect(
        labelled(strips([710, 684, 658], [0, 1], { left: [[2, "Date:"]] })),
      ).toEqual([
        ["Caption 1", 711],
        ["Caption 2", 685],
        ["Date", 659],
      ]);
    });

    // KNOWN MISS (review round 4 fixes, finding 5): captions under their
    // lines in a stack that ends with a bare line (address line 2) read as
    // strips, so every caption moves one line down and the top line loses
    // its own. Its geometry is the strips' exactly (a caption just under
    // each rule but the lowest; 9 pt captions 3.7 pt under here, 7 pt 2.1
    // pt under in P29), so no rule tells them apart, and the narrowest
    // change tried (strips need 4 rules or more) gave up every 3-rule
    // strip and still shifted the 4-rule C2. Pinned as it is, for the
    // owner: invert it when a signal is found.
    it("KNOWN MISS: captions under three lines with a bare third line move down one line (the C1 shape)", () => {
      const p = pg({
        segs: [640, 610, 580].map((y) => hseg(72, 400, y)),
        text: [
          txt("Name", 72, 630, { size: 9, width: 24 }),
          txt("Address", 72, 600, { size: 9, width: 34 }),
        ],
      });
      // Wanted: ["Name", 641], ["Address", 611].
      expect(labelled(p)).toEqual([
        ["Name", 611],
        ["Address", 581],
      ]);
      expect(run(p).excluded).toEqual([
        expect.objectContaining({ rule: "unlabelled" }),
      ]);
    });
  });

  // Review round 3, finding 8: a multi-line "Address:" or "Notes:" field
  // draws its first line beside the label and the rest under it, from the
  // margin; those were all unlabelled. A bare line directly under a line
  // labelled from its left, ending where it ends, now continues it.
  describe("continuation lines under a labelled line", () => {
    /** "Address:" (72..116) and its line 120..400 at 576, then `more` lines. */
    const block = (more: CardSeg[], text: CardText[] = []) =>
      pg({
        segs: [hseg(120, 400, 576), ...more],
        text: [txt("Address:", 72, 576, { size: 10, width: 44 }), ...text],
      });
    const labelled = (p: CardPage) =>
      props(p).map((x) => [x.label, x.y] as const);

    it("two lines from the margin under 'Address:' are Address too", () => {
      const p = block([hseg(72, 400, 552), hseg(72, 400, 528)]);
      expect(labelled(p)).toEqual([
        ["Address", 577],
        ["Address", 553],
        ["Address", 529],
      ]);
    });

    it("CONTINUATION_BELOW: 28 pt under the labelled line counts, 28.1 does not", () => {
      expect(labelled(block([hseg(72, 400, 548)]))).toHaveLength(2);
      expect(labelled(block([hseg(72, 400, 547.9)]))).toEqual([
        ["Address", 577],
      ]);
    });

    it("GRID_ROW_EPS: right ends 2 pt apart count, 2.1 do not; it may start 2 pt right of the labelled line, not 2.1", () => {
      expect(labelled(block([hseg(72, 402, 552)]))).toHaveLength(2);
      expect(labelled(block([hseg(72, 402.1, 552)]))).toHaveLength(1);
      // The short side (review round 4 fixes, finding 14: only an
      // overshoot was tested, so any shorter line, a postcode box under
      // "Address:", could inherit the label unnoticed).
      expect(labelled(block([hseg(72, 398, 552)]))).toHaveLength(2);
      expect(labelled(block([hseg(72, 397.9, 552)]))).toHaveLength(1);
      expect(labelled(block([hseg(72, 300, 552)]))).toHaveLength(1);
      expect(labelled(block([hseg(122, 400, 552)]))).toHaveLength(2);
      expect(labelled(block([hseg(122.1, 400, 552)]))).toHaveLength(1);
    });

    it("text between the two lines, or a line between them, ends it", () => {
      expect(
        labelled(
          block(
            [hseg(72, 400, 552)],
            [txt("Postal address", 74, 562, { size: 8, width: 60 })],
          ),
        ),
      ).toHaveLength(1);
      // The nearest line above that overlaps it is not the labelled one.
      expect(
        labelled(block([hseg(300, 500, 566), hseg(72, 400, 552)])),
      ).toEqual([["Address", 577]]);
    });

    it("the label above, set up to 2 pt under its own line, is not text between", () => {
      const p = pg({
        segs: [hseg(120, 400, 576), hseg(72, 400, 552)],
        text: [txt("Address:", 72, 574, { size: 10, width: 44 })],
      });
      expect(labelled(p)).toEqual([
        ["Address", 577],
        ["Address", 553],
      ]);
    });

    it("text on its own row to its left ends it: a label 36.5 pt off is not inherited", () => {
      const p = block(
        [hseg(120, 400, 552)],
        [txt("Date:", 120 - 36.5 - 26, 552, { size: 10, width: 26 })],
      );
      expect(labelled(p)).toEqual([["Address", 577]]);
      expect(run(p).excluded.map((e) => e.rule)).toEqual(["unlabelled"]);
    });

    it("only a LEFT label continues: a captioned line passes nothing on", () => {
      const p = pg({
        segs: [hseg(72, 400, 576), hseg(72, 400, 552)],
        text: [txt("Street", 74, 568, { size: 6, width: 20 })],
      });
      expect(labelled(p)).toEqual([["Street", 577]]);
      // A caption under a line always sits between it and a line below, so
      // the left-label condition is seen on a strip's moved caption, which
      // sits ABOVE its line: the line 22 pt under the lowest strip is bare.
      const strips = pg({
        segs: [710, 684, 658, 632, 610].map((y) => hseg(72, 540, y)),
        text: [710, 684, 658].map((y, i) =>
          txt(`Caption ${i + 1}`, 74, y - 7, { size: 7, width: 30 }),
        ),
      });
      expect(labelled(strips)).toEqual([
        ["Caption 1", 685],
        ["Caption 2", 659],
        ["Caption 3", 633],
      ]);
    });

    it("a margin-to-margin continuation is a field, not a divider", () => {
      const p = pg({
        segs: [hseg(80, 576, 600), hseg(36, 576, 576)],
        text: [txt("Notes:", 36, 600, { size: 10, width: 30 })],
      });
      expect(labelled(p)).toEqual([
        ["Notes", 601],
        ["Notes", 577],
      ]);
    });

    // Review round 4 fixes, finding 6: a section separator under a form's
    // last field (ending where the field lines end) took that field's
    // label as a continuation. A continuation is drawn at its line's
    // weight: a stroke more than 0.1 pt heavier or lighter ends it.
    it("a separator drawn at another weight is no continuation: 0.1 pt off counts, more does not", () => {
      const at = (w: number) =>
        pg({
          segs: [
            hseg(120, 400, 576, { width: 0.5 }),
            hseg(72, 400, 552, { width: w }),
          ],
          text: [txt("Address:", 72, 576, { size: 10, width: 44 })],
        });
      expect(labelled(at(0.6))).toHaveLength(2);
      expect(labelled(at(0.4))).toHaveLength(2);
      expect(labelled(at(0.61))).toEqual([["Address", 577]]);
      expect(labelled(at(0.39))).toEqual([["Address", 577]]);
      // Exactly 0.1 apart (review round 5 fixes, finding 14): 0.6 - 0.5 is
      // 0.09999999999999998 in floating point, so `>=` for `>` stayed
      // green above. 0.2 - 0.1 is 0.1 exactly.
      const exact = (above: number, below: number) =>
        pg({
          segs: [
            hseg(120, 400, 576, { width: above }),
            hseg(72, 400, 552, { width: below }),
          ],
          text: [txt("Address:", 72, 576, { size: 10, width: 44 })],
        });
      expect(0.2 - 0.1).toBe(DETECT.CONTINUATION_WEIGHT_EPS);
      expect(labelled(exact(0.2, 0.1))).toHaveLength(2);
    });

    // Review round 5 fixes, finding 13: the own-row guard counts upright
    // text only (mutant CO10: any text on the line's row blocked it).
    it("a turned mark on the continuation's own row does not block it", () => {
      const p = block(
        [hseg(72, 400, 552)],
        [txt("x", 10, 552, { size: 10, width: 5, upright: false })],
      );
      expect(labelled(p)).toEqual([
        ["Address", 577],
        ["Address", 553],
      ]);
    });

    it("a filled bar's weight is its height", () => {
      const bar = (h: number) =>
        pg({
          segs: [hseg(120, 400, 576)],
          rects: [
            rect(72, 552 - h / 2, 328, h, { filled: true, stroked: false }),
          ],
          text: [txt("Address:", 72, 576, { size: 10, width: 44 })],
        });
      // The line above is stroked 1 pt wide.
      expect(labelled(bar(1))).toHaveLength(2);
      expect(labelled(bar(1.2))).toHaveLength(1);
    });

    it("RESIDUAL: a separator at the field lines' own weight still continues the line above", () => {
      expect(labelled(block([hseg(72, 400, 554)]))).toHaveLength(2);
    });
  });

  // Review round 3, finding 6: any rule with text under it took that text as
  // its caption, so plain prose got fields: a heading under a border-top
  // rule, a one-page footer rule. A heading (text with SMALLER text starting
  // at its x directly under it) is no caption, and a line labelled only by a
  // caption in the outer band of the page is the page's furniture.
  describe("prose is not a form: headings and footers", () => {
    /**
     * A rule over a `size` heading at 592, `body` text `lead` pt under it,
     * and a second body line 1.3 x `body` under the first. Review round 4
     * fixes, finding 3: a heading needs a BODY of two lines (one smaller
     * line under a caption is the caption's hint), so this draws two; it
     * drew one until then.
     */
    const headed = (size: number, body: number, lead: number, dx = 0) =>
      pg({
        segs: [hseg(72, 538, 606)],
        text: [
          txt("2. Results", 72, 592, { size, width: 60 }),
          txt("The results start here.", 72 + dx, 592 - lead, {
            size: body,
            width: 120,
          }),
          txt("And they go on here.", 72 + dx, 592 - lead - 1.3 * body, {
            size: body,
            width: 110,
          }),
        ],
      });

    it("a heading under a rule, body text under the heading: no caption", () => {
      expect(props(headed(12, 10, 14))).toEqual([]);
      expect(firstRule(headed(12, 10, 14))).toBe("unlabelled");
    });

    // PRODUCT CHOICE (regression verify after review round 6): a heading
    // over ONE line of body text is a caption, as it has been since review
    // round 4 fixes (finding 3). Round 3 (7316a543) proposed nothing for
    // the heading side. The two shapes below differ only in their words: a
    // larger line over a rule, one smaller line under it. Taking one line
    // as a body again for a heading set larger than the page's body (the
    // verify's narrow candidate) turned corpus P37 red, where the 7 pt
    // hints ARE the page's body size. A wrong proposal costs one reject in
    // Slice 2's review; a lost caption costs a manual add on a real form.
    it("PRODUCT CHOICE: a heading over one line of body text is a field named after the heading, as a caption over one hint keeps its line", () => {
      const oneLine = (
        head: string,
        line: string,
        size: number,
        body: number,
      ) =>
        props(
          pg({
            segs: [hseg(72, 538, 606)],
            text: [
              txt(head, 72, 592, { size, width: 60 }),
              txt(line, 72, 578, { size: body, width: 190 }),
            ],
          }),
        ).map((x) => x.label);
      expect(
        oneLine("2. Results", "The results start here and run across.", 12, 10),
      ).toEqual(["2. Results"]);
      expect(
        oneLine("Full name", "(as shown on your passport)", 10, 7),
      ).toEqual(["Full name"]);
      // The control: a second body line makes it a heading.
      expect(props(headed(12, 10, 14))).toEqual([]);
    });

    it("HEADING_LEAD_EMS: the body's baseline up to 1.6 x the heading's size under it, not 0.1 pt more", () => {
      expect(props(headed(10, 9, 16))).toEqual([]);
      expect(props(headed(10, 9, 16.1))[0]?.label).toBe("2. Results");
    });

    it("HEADING_SMALLER_BY: the body at least 0.5 pt smaller, not 0.4 (a printed name over its role stays a caption)", () => {
      expect(props(headed(12, 11.5, 14))).toEqual([]);
      expect(props(headed(12, 11.6, 14))[0]?.label).toBe("2. Results");
      expect(props(headed(12, 12, 14))[0]?.label).toBe("2. Results");
    });

    it("GRID_ROW_EPS: the body starting 2 pt off the heading's x still counts, 2.1 does not", () => {
      expect(props(headed(12, 10, 14, 2))).toEqual([]);
      expect(props(headed(12, 10, 14, 2.1))[0]?.label).toBe("2. Results");
    });

    // Review round 4 fixes, finding 13: the x alignment was tested to the
    // right only, and dropping Math.abs stayed green, so smaller text to
    // the LEFT of a caption (a two-column form's other column) could make
    // it a heading. The heading here sits at x 301, so text 2.1 pt to its
    // left falls in a cell the page index reads.
    it("GRID_ROW_EPS to the left: a body starting 2 pt left of the heading counts, 2.1 does not", () => {
      const at = (dx: number) =>
        pg({
          segs: [hseg(301, 538, 606)],
          text: [
            txt("2. Results", 301, 592, { size: 12, width: 60 }),
            txt("The results start here.", 301 + dx, 578, {
              size: 10,
              width: 120,
            }),
            txt("And they go on here.", 301 + dx, 565, {
              size: 10,
              width: 110,
            }),
          ],
        });
      expect(props(at(-2))).toEqual([]);
      expect(props(at(-2.1))[0]?.label).toBe("2. Results");
    });

    it("a two-column form: smaller text far left of a caption leaves it a caption", () => {
      const p = pg({
        segs: [hseg(300, 538, 606)],
        text: [
          txt("Full name", 300, 596, { size: 10, width: 45 }),
          txt("Other column text", 72, 584, { size: 8, width: 70 }),
          txt("More of that column", 72, 574, { size: 8, width: 70 }),
        ],
      });
      expect(props(p).map((x) => x.label)).toEqual(["Full name"]);
    });

    it("only upright, non-blank text UNDER the caption makes it a heading", () => {
      const captioned = (extra: CardText) =>
        pg({
          segs: [hseg(72, 538, 606)],
          text: [txt("Full name", 72, 596, { size: 10, width: 45 }), extra],
        });
      const label = (extra: CardText) => props(captioned(extra))[0]?.label;
      // Smaller text ABOVE it (a hint over the line, clear of the field) ...
      expect(label(txt("(required)", 72, 640, { size: 7, width: 30 }))).toBe(
        "Full name",
      );
      // ... smaller text under it that is turned, or blank ...
      expect(
        label(txt("note", 72, 584, { size: 7, width: 15, upright: false })),
      ).toBe("Full name");
      expect(label(txt("   ", 72, 584, { size: 7, width: 8 }))).toBe(
        "Full name",
      );
      // INVERTED in review round 4 fixes (finding 3). This read "the
      // positive control: upright smaller words under it" and pinned the
      // label undefined for ONE 7 pt line under "Full name": a caption with
      // its hint under it ("(as shown on your passport)") lost its line.
      // One smaller line is a hint; the caption stays.
      expect(label(txt("note", 72, 584, { size: 7, width: 15 }))).toBe(
        "Full name",
      );
      // INVERTED in review round 5 fixes (finding 4). This read "the
      // positive control now: TWO smaller lines under it, a body" and
      // pinned the label undefined for two 7 pt lines under "Full name" on
      // a 10 pt page: a caption with two hint lines under it lost its line
      // (a signature line its signature count). Lines smaller than the
      // page's body are hints, not a body; the caption stays.
      const two = captioned(txt("note", 72, 584, { size: 7, width: 15 }));
      two.text.push(txt("more", 72, 575, { size: 7, width: 15 }));
      expect(props(two)[0]?.label).toBe("Full name");
      // The positive control now: a larger caption over two lines set in
      // the page's body size is a heading.
      const body = pg({
        segs: [hseg(72, 538, 606)],
        text: [
          txt("Section A", 72, 594, { size: 12, width: 54 }),
          txt("Tell us about yourself in your own words.", 72, 580, {
            size: 10,
            width: 190,
          }),
          txt("Use the space below for anything else.", 72, 567, {
            size: 10,
            width: 180,
          }),
        ],
      });
      expect(props(body)[0]?.label).toBe(undefined);
    });

    // Review round 5 fixes, finding 4: on a declaration page in 10 pt,
    // "Signature of applicant" with two 7 pt hints under it was read as a
    // heading over a body, so the line lost its caption and the signature
    // went uncounted (one hint line, the control, kept it).
    it("a signature caption over two hint lines smaller than the page's body is still a signature", () => {
      const page = (hints: number) =>
        pg({
          segs: [hseg(72, 300, 612)],
          text: [
            txt(
              "I declare that the information I have given on this form is true and complete.",
              72,
              700,
              { size: 10, width: 400 },
            ),
            txt("Signature of applicant", 72, 600, { size: 10, width: 105 }),
            txt("(must match your photo ID)", 72, 590, { size: 7, width: 85 }),
            ...(hints === 2
              ? [
                  txt("(sign in black ink only)", 72, 581, {
                    size: 7,
                    width: 75,
                  }),
                ]
              : []),
          ],
        });
      expect(run(page(1)).counts.signatureLines).toBe(1);
      expect(run(page(2)).counts.signatureLines).toBe(1);
      expect(firstRule(page(2))).toBe("signature");
    });

    // Review round 6 fixes, finding 3 (a regression from the fix above):
    // a prose article's boxed-out sidebar, a rule over a heading over
    // 8 pt text, got a field: the sidebar text is smaller than the page's
    // 10 pt body, so it stopped counting as the heading's body and the
    // heading became the rule's caption. A heading set larger than the
    // page's body (by HEADING_SMALLER_BY) keeps a smaller body; the
    // signature caption above is set AT body size and stays a caption.
    it("a sidebar heading set larger than the page's body keeps its smaller text as its body", () => {
      const article = (size: number) =>
        pg({
          segs: [hseg(340, 540, 704)],
          text: [
            ...Array.from({ length: 20 }, (_, i) =>
              txt(
                "Body text of the article runs on line after line.",
                72,
                700 - 13 * i,
                {
                  size: 10,
                  width: 250,
                },
              ),
            ),
            txt("Did you know", 340, 688, { size, width: 66 }),
            ...[676, 666, 656].map((y) =>
              txt("Sidebar text set smaller than the body.", 340, y, {
                size: 8,
                width: 150,
              }),
            ),
          ],
        });
      expect(props(article(10.5))).toEqual([]);
      expect(firstRule(article(10.5))).toBe("unlabelled");
      // 0.1 pt short of the body plus 0.5, it is the rule's caption again
      // (the boundary).
      expect(props(article(10.4)).map((x) => x.label)).toEqual([
        "Did you know",
      ]);
    });

    // Review round 6 fixes, finding 4 (since before round 4): on a
    // completed statement the printed total under a sum rule was the
    // rule's caption, a field labelled "65,698.58" on a page with nothing
    // to fill in. A caption without a letter names nothing.
    it("a figure under a sum rule is no caption; a caption with a letter in it still is", () => {
      const sum = (s: string) =>
        pg({
          segs: [hseg(470, 540, 640)],
          text: [
            txt("1,036.40", 497, 652, { size: 10, width: 43 }),
            txt(s, 488, 626, { size: 10, width: 52 }),
          ],
        });
      expect(props(sum("65,698.58"))).toEqual([]);
      expect(firstRule(sum("65,698.58"))).toBe("unlabelled");
      expect(props(sum("(1)"))).toEqual([]);
      expect(props(sum("Total 1"))).toEqual([
        expect.objectContaining({ label: "Total 1", y: 641 }),
      ]);
    });

    describe("a heading's body is two lines: one smaller line under a caption is its hint", () => {
      /**
       * "Full name" (10 pt) under a rule, a 5 pt hint 10 pt under it, and a
       * second line `gap` under the hint, `size` pt, `dx` off the hint's x.
       */
      const hinted = (second?: { gap: number; size?: number; dx?: number }) =>
        pg({
          segs: [hseg(72, 300, 660)],
          text: [
            txt("Full name", 72, 650, { size: 10, width: 45 }),
            txt("(as shown on your passport)", 72, 640, { size: 5, width: 90 }),
            ...(second
              ? [
                  txt(
                    "and on your other papers",
                    72 + (second.dx ?? 0),
                    640 - second.gap,
                    {
                      size: second.size ?? 5,
                      width: 90,
                    },
                  ),
                ]
              : []),
          ],
        });
      const label = (p: CardPage) => props(p)[0]?.label;

      it("a caption with one smaller hint under it keeps its line (the A1 shape)", () => {
        expect(label(hinted())).toBe("Full name");
      });

      it("HEADING_LEAD_EMS: a second line up to 1.6 x the first's size under it makes a body, not 0.1 pt more", () => {
        expect(label(hinted({ gap: 8 }))).toBe(undefined);
        expect(label(hinted({ gap: 8.1 }))).toBe("Full name");
      });

      it("the second line no larger than the first: equal counts, 0.1 pt larger does not (the next field's caption)", () => {
        expect(label(hinted({ gap: 6, size: 5 }))).toBe(undefined);
        expect(label(hinted({ gap: 6, size: 5.1 }))).toBe("Full name");
      });

      it("GRID_ROW_EPS: the second line starting 2 pt off the first's x counts, 2.1 does not", () => {
        expect(label(hinted({ gap: 6, dx: 2 }))).toBe(undefined);
        expect(label(hinted({ gap: 6, dx: -2 }))).toBe(undefined);
        expect(label(hinted({ gap: 6, dx: 2.1 }))).toBe("Full name");
        expect(label(hinted({ gap: 6, dx: -2.1 }))).toBe("Full name");
      });
    });

    /** A 400 pt rule at `y` with centred 8 pt footer text 10 pt under it. */
    const footer = (y: number, left = false) =>
      pg({
        segs: [hseg(106, 506, y)],
        text: [
          txt("Example Ltd - Annual report - Page 1 of 1", 230, y - 10, {
            size: 8,
            width: 150,
          }),
          ...(left ? [txt("Date:", 76, y, { size: 10, width: 26 })] : []),
        ],
      });

    it("a one-page footer rule labelled only by the text under it, in the bottom band: page-band", () => {
      // BAND_EDGE: the outer 8% of 792 pt is under 63.36.
      expect(firstRule(footer(63))).toBe("page-band");
      expect(props(footer(64))[0]?.label).toBe(
        "Example Ltd - Annual report - Page 1 of 1",
      );
    });

    // Review round 4 fixes, finding 12: the caption-only band rule was
    // pinned in the bottom band only; applied below half the page alone,
    // it stayed green. A header rule over its caption at the top of a
    // prose page is page furniture too.
    it("the same in the TOP band: a header rule over its caption is page-band", () => {
      // BAND_EDGE: the outer 8% of 792 pt is over 728.64.
      const header = (y: number) =>
        pg({
          segs: [hseg(106, 506, y)],
          text: [
            txt("Example Ltd - Annual report", 230, y - 10, {
              size: 8,
              width: 150,
            }),
          ],
        });
      expect(props(header(740))).toEqual([]);
      expect(run(header(740)).excluded.map((e) => e.rule)).toEqual([
        "page-band",
      ]);
      expect(props(header(728))[0]?.label).toBe("Example Ltd - Annual report");
    });

    it("the same line labelled from its LEFT in the band is still a field", () => {
      expect(props(footer(56, true))[0]?.label).toBe("Date");
    });

    // Review round 4 fixes, finding 4: the caption-only band rule dropped a
    // dense form's last row (or a first row under 0.5 in margins). A band
    // line with a ROW-MATE, another labelled line on its row (within
    // GRID_ROW_EPS) beside it, is a form's row, not furniture.
    describe("a row of captioned lines in the band is a form's row", () => {
      /** "Print name" and "Date" lines at y 58, 9 pt captions 10 under. */
      const signRow = (
        o: {
          dy?: number;
          date?: boolean;
          x0?: number;
          leftOnly?: boolean;
        } = {},
      ) =>
        pg({
          segs: [
            hseg(72, 260, 58),
            ...(o.date === false
              ? []
              : [hseg(o.x0 ?? 320, 460, 58 + (o.dy ?? 0))]),
          ],
          text: [
            txt("Print name", 72, 48, { size: 9, width: 44 }),
            ...(o.date === false || o.leftOnly
              ? []
              : [
                  txt("Date", o.x0 ?? 320, 48 + (o.dy ?? 0), {
                    size: 9,
                    width: 18,
                  }),
                ]),
          ],
        });
      const labels = (p: CardPage) => props(p).map((x) => x.label);

      it("two captioned lines side by side at y 58 are both fields", () => {
        expect(labels(signRow())).toEqual(["Print name", "Date"]);
      });

      it("GRID_ROW_EPS: a mate 2 pt off the row counts, 2.1 pt does not", () => {
        expect(labels(signRow({ dy: 2 }))).toEqual(["Date", "Print name"]);
        expect(firstRule(signRow({ dy: 2.1 }))).toBe("page-band");
        expect(labels(signRow({ dy: 2.1 }))).toEqual([]);
      });

      it("the mate must be labelled itself: an unlabelled line beside it is no mate", () => {
        expect(labels(signRow({ leftOnly: true }))).toEqual([]);
      });

      it("the mate must lie beside it, not along it: two captioned pieces of one row that overlap are no mates", () => {
        // A footer rule over a second short captioned rule inside its span.
        const p = pg({
          segs: [hseg(106, 506, 56), hseg(300, 400, 57)],
          text: [
            txt("Example Ltd", 108, 46, { size: 8, width: 44 }),
            txt("Page 1", 302, 47, { size: 8, width: 24 }),
          ],
        });
        expect(labels(p)).toEqual([]);
      });

      it("RESIDUAL: a lone captioned line in the band is still page-band (B3: one 'Date' line at y 58)", () => {
        expect(firstRule(signRow({ date: false }))).toBe("page-band");
      });
    });

    // Review round 4 fixes, finding 10: the heading test scanned every
    // text item for every caption, and the title-rule test did the same,
    // so a page of small text under rules went from linear to quadratic
    // (4.6 s at 20,000 items on the reviewer's head, 11 s once the title
    // test landed). Both now read a per-page index.
    //
    // First pinned as 20,000 items in `< 800` ms ("measured before: 11 s;
    // after: about 0.15 s"), a wall-clock bound (see interleavedBest): CI
    // took up to 488 ms for the whole test in 3 passing runs, and 636 ms
    // on main's run 44428026069. Now the SHAPE: 16 times the
    // items under the same 200 rules must cost far less than 256 times
    // (each caption reading every item). 16, not 8: the linear page reads
    // 10 to 11 at 8 times (a sort is n log n), too near a defect that is
    // diluted to 50 there by what does not grow. First measured with the
    // defect timed alone: fixed 19.4 to 22.4; `title ??=` as `title =`,
    // 142 to 164.
    // Measured in this whole file (see interleavedBest): fixed 20.31 to
    // 22.53 one or 4 at a time, 16.21 to 24.01 under the pinned loads;
    // with `title ??=` as `title =` (the title size read again for every
    // caption) 157.6 to 167.7, and 164.2 to 173.9 4 at a time; with the
    // heading test's look under a caption scanning every item (as before
    // review round 4), 149.7 to 158.2 and 146.5 to 163.3. The bound, 56,
    // is 2.3x over the worst fixed and 2.6x under the lowest defect.
    it("20,000 tiny items as captions under 200 rules are classified in linear time", () => {
      // One string for every tiny item and for the positive control's
      // caption, so a fixture that stops reaching the caption path loses
      // the control too.
      const word = "ab";
      const page = (n: number) => {
        const segs: CardSeg[] = [];
        const text: CardText[] = [];
        for (let k = 0; k < 200; k++) segs.push(hseg(72, 540, 30 + 3.7 * k));
        for (let k = 0; k < n; k++) {
          const layer = Math.floor(k / 200) % 3;
          text.push(
            txt(
              word,
              72 + (k % 150) * 3,
              28.5 + 3.7 * (k % 200) - 0.3 * layer,
              { size: 2 - 0.6 * layer, width: 2 },
            ),
          );
        }
        // Positive control: one rule off the table, with a tiny item of the
        // same string, size and drop under it as its caption, a copy of the
        // third layer's (the one inside a rule's caption window: the two
        // over it have their tops within CAPTION_MIN of the rule).
        segs.push(hseg(552, 600, 401.85));
        text.push(txt(word, 554, 401.85 - 2.1, { size: 0.8, width: 2 }));
        return pg({ segs, text });
      };
      const few = page(1_250);
      const many = page(20_000);
      const [small, large] = interleavedBest([() => run(few), () => run(many)]);
      // Health: every rule is a candidate, and the page is read the same
      // at both sizes: the rules in the page bands are page-band, the rest
      // a table ruled in rows (each rule's captions read on the way).
      // The control is the one field, captioned by its tiny item: a caption
      // like the table's reaches the heading test and the title test (the
      // two quadratic terms this test is for) and is taken. Without it,
      // every count here held with no item ever reaching either test:
      // "ab" written "12" (no letter, so no caption) kept them all, and
      // the heading test put back to a scan of every item stayed green
      // with it (review of the ratio conversion, finding 8: controls T2
      // and T2 + R3). Both are red now, 3 runs of 3, on this control.
      for (const r of [small!.got, large!.got]) {
        expect(r.counts.candidates).toBe(201);
        const rules = r.excluded.map((e) => e.rule);
        expect(rules.filter((x) => x === "page-band")).toHaveLength(21);
        expect(rules.filter((x) => x === "table-grid")).toHaveLength(179);
        expect(r.proposals.map((x) => [x.x, x.label])).toEqual([[553, word]]);
      }
      expectRatioUnder("20,000 captions under 200 rules", large!, small!, 56);
    }, 60_000);

    // Review round 6 test honesty, cost finding 6: an outlined box's
    // caption (inside it, or over its top), an unlabelled line's caption
    // under it and a candidate's sign-off over it were each read by
    // scanning every text item on the page, so 5,000 boxes and 20,000
    // text items far from them cost 3 s where the boxes alone and the
    // text alone cost 0.2 s.
    //
    // History. Pinned as `both < 2 * (boxes + words) + 50` ms: CI took up
    // to 6 s for the test, so the additive 50 ms was noise there and a
    // margin only on a fast machine. Then (the ratio conversion's first
    // commit) as both against the sum, bound 2.5, with 5,000 boxes and
    // 80,000 items (one window put back to a scan read 2.67 with 20,000).
    // But a window turned into a scan with a cheap test per item passed:
    // the box's inside read as `ix.sorted.filter((t) => t.y >= r.y && t.y
    // <= top)` (5,000 x 80,000 tests) was red at 3.07 to 3.24 alone and
    // green at 1.60 to 1.74 in this whole file (review of the ratio
    // conversion, findings 3 and 4; R4). The scan's share is N x W x (a test) over N x (a box) + W x
    // (an item), and two things held it down. The boxes are the costly
    // side and are not linear on their own: 1,250, 2,500, 5,000 and
    // 10,000 of them alone took 47, 189, 692 and 2,773 ms in this file
    // (2026-11-19), 4 times for each doubling. And an item with a letter
    // costs about 1,000 such tests (95 ms for 80,000), so more words alone
    // never got the scan's share past N / 1,000. So the page has half the
    // boxes, the same 80,000 words, and 400,000 blank items: an item of a
    // space costs half a word (173 ms for 320,000) and every scan reads it
    // all the same.
    it("2,500 outlined boxes and 480,000 text items far from them cost what each costs alone", () => {
      const N = 2500;
      const W = 80_000;
      const B = 400_000;
      const page = (boxes: boolean, words: boolean) => {
        const rects: CardRect[] = [];
        const text: CardText[] = [];
        if (boxes)
          for (let i = 0; i < N; i++)
            rects.push(
              rect(20 + (i % 10) * 58, 100 + 40 * Math.floor(i / 10), 50, 30),
            );
        if (words)
          for (let k = 0; k < W + B; k++)
            text.push(
              txt(
                k < W ? "x" : " ",
                20 + (k % 200) * 2.9,
                20_500 + 4 * Math.floor(k / 200),
                { size: 2, width: 1 },
              ),
            );
        return pg({ height: 20_500 + 4 * ((W + B) / 200) + 500, rects, text });
      };
      const pages = [page(false, true), page(true, false), page(true, true)];
      const [words, boxes, both] = interleavedBest(
        pages.map((p) => () => run(p).counts.candidates),
      );
      // Health: each box is a candidate (an empty entry box's field stands
      // for its top edge since slice S4's review round 1; before, both
      // edges were, 2 x N), with the text or not; the text alone has none.
      expect(both!.got).toBe(N);
      expect(boxes!.got).toBe(N);
      expect(words!.got).toBe(0);
      // Both together against the sum of each alone: a per-box scan of
      // every text item multiplies the two costs.
      // Measured in this whole file (see interleavedBest): fixed 0.89 to
      // 1.13 one or 4 at a time, 0.87 to 1.17 under the pinned loads. Each
      // window put back to a scan of every item, 3 runs one at a time and
      // 4 at once: the box's inside (R4 above) 11.3 to 13.7 and 13.6 to
      // 16.3; over the box (`ix.sorted` for its window) 14.9 to 16.2 and
      // 15.1 to 15.8; a line's caption under it (`p.text`) 16.7 to 17.7
      // and 23.5 to 28.2; the sign-off over a line (`ix.sorted.some`)
      // 41.1 to 43.9 (one at a time only: 2 to 3 minutes a run). The
      // bound, 3.5, is 3.0x over the worst fixed and 3.2x under the lowest
      // defect.
      expectRatioUnder(
        "2,500 boxes with 480,000 items vs each alone",
        both!,
        [boxes!, words!],
        3.5,
      );
    }, 60_000);

    // KNOWN MISS (review round 4 fixes, finding 8): a section heading
    // under a separator rule whose next line is a form's label more than
    // HEADING_LEAD_EMS under it has no body in reach, so the heading is
    // read as the separator's caption and the separator is proposed as a
    // field named after the heading (as before round 3). Widening the
    // reach would make more hinted captions headings (finding 3's shape),
    // and the form below is no body. Pinned for the owner.
    it("KNOWN MISS: a separator over 'Section 2: Employment' with the next label 24 pt down is a field named after the heading (the E1 shape)", () => {
      const p = pg({
        segs: [
          hseg(120, 540, 636),
          hseg(72, 540, 616, { width: 0.75 }),
          hseg(130, 540, 572),
        ],
        text: [
          txt("Phone:", 72, 636, { size: 10, width: 32 }),
          txt("Section 2: Employment", 72, 596, { size: 12, width: 130 }),
          txt("Employer:", 72, 572, { size: 10, width: 46 }),
        ],
      });
      // Wanted: ["Phone", 637], ["Employer", 573] and nothing at 617.
      expect(props(p).map((x) => [x.label, x.y])).toEqual([
        ["Phone", 637],
        ["Section 2: Employment", 617],
        ["Employer", 573],
      ]);
    });

    it("an unlabelled line in the band stays unlabelled (the band takes labelled lines)", () => {
      expect(firstRule(pg({ segs: [hseg(106, 506, 56)] }))).toBe("unlabelled");
    });

    // KNOWN MISSES (review round 3, finding 6): no signal told these from a
    // captioned line, so each was still proposed and pinned as it was.
    // Review round 4 found a signal for the footnote and the title rule;
    // those two are INVERTED below, their history kept.

    /** Two 11 pt body lines across 72..540, the text column. */
    const body = [
      txt("Body text runs the whole width of the text column here.", 72, 600, {
        size: 11,
        width: 468,
      }),
      txt("And a second line of it, just as wide as the first one.", 72, 586, {
        size: 11,
        width: 468,
      }),
    ];
    /** A rule from x0 to x1 at 140 with an 8 pt note 10 pt under it. */
    const footnote = (
      o: { x0?: number; x1?: number; s?: string; size?: number } = {},
    ) =>
      pg({
        segs: [hseg(o.x0 ?? 72, o.x1 ?? 216, 140)],
        text: [
          ...body,
          txt(o.s ?? "1 Figures are unaudited and may change.", 72, 130, {
            size: o.size ?? 8,
            width: 140,
          }),
        ],
      });
    const noteLabel = (p: CardPage) => props(p)[0]?.label;

    // INVERTED in review round 4. This test read "KNOWN MISS: a footnote
    // separator over the footnote is still proposed" and pinned the label
    // "1 Figures are unaudited and may change" on a page holding only the
    // rule and the note. A short rule at the left margin whose text under
    // it is smaller than the body and opens with a footnote marker is a
    // footnote separator: the note is no caption.
    // Review round 5 fixes, finding 15 (mutant FN6): a tie in character
    // counts gives the body size to the size met first. Here that is 10,
    // so the 8 pt note under the short rule is a footnote; read as 8, it
    // would be body text and a caption.
    it("a body-size tie goes to the size met first", () => {
      const p = pg({
        segs: [hseg(72, 200, 100)],
        text: [
          txt("Body texts", 72, 700, { size: 10, width: 468 }),
          txt("1 Note abc", 72, 90, { size: 8, width: 40 }),
        ],
      });
      expect(props(p)).toEqual([]);
      // Control: with the note first, 8 is the body and the note a caption.
      const q = { ...p, text: [...p.text].reverse() };
      expect(props(q).map((x) => x.label)).toEqual(["1 Note abc"]);
    });

    it("a footnote separator over the footnote is no field", () => {
      expect(props(footnote())).toEqual([]);
      expect(firstRule(footnote())).toBe("unlabelled");
      // Residual, kept as it was: with no body text on the page there is no
      // body size for the note to be smaller than.
      const bare = pg({
        segs: [hseg(72, 216, 140)],
        text: [
          txt("1 Figures are unaudited and may change.", 72, 130, {
            size: 8,
            width: 140,
          }),
        ],
      });
      expect(noteLabel(bare)).toBe("1 Figures are unaudited and may change");
    });

    it("footnote markers: a digit, *, a dagger, a double dagger, a superscript digit", () => {
      for (const cp of [0x2a, 0x2020, 0x2021, 0xb9, 0xb2, 0xb3, 0x2074]) {
        const s = `${String.fromCodePoint(cp)} Figures are unaudited.`;
        expect(noteLabel(footnote({ s })), `U+${cp.toString(16)}`).toBe(
          undefined,
        );
      }
      expect(noteLabel(footnote({ s: "12 Figures are unaudited." }))).toBe(
        undefined,
      );
    });

    it("positive control: a short margin line captioned in small text with NO marker is a field", () => {
      expect(noteLabel(footnote({ s: "Date of signing" }))).toBe(
        "Date of signing",
      );
      // A number that is not a marker: four digits run on (a year).
      expect(noteLabel(footnote({ s: "2024 accounts" }))).toBe("2024 accounts");
    });

    it("FOOTNOTE_SPAN: a rule up to a third of the text column (468 / 3 = 156), not 0.1 pt more", () => {
      expect(noteLabel(footnote({ x1: 72 + 156 }))).toBe(undefined);
      expect(noteLabel(footnote({ x1: 72 + 156.1 }))).toBe(
        "1 Figures are unaudited and may change",
      );
    });

    it("the rule starts at the left text margin (within GRID_ROW_EPS 2), not indented", () => {
      expect(noteLabel(footnote({ x0: 74, x1: 218 }))).toBe(undefined);
      expect(noteLabel(footnote({ x0: 74.1, x1: 218 }))).toBe(
        "1 Figures are unaudited and may change",
      );
    });

    it("the note is smaller than the body by HEADING_SMALLER_BY (0.5): 10.5 under 11 pt body text, not 10.6", () => {
      expect(noteLabel(footnote({ size: 10.5 }))).toBe(undefined);
      expect(noteLabel(footnote({ size: 10.6 }))).toBe(
        "1 Figures are unaudited and may change",
      );
    });

    /** A 72 pt rule at 690 under a `size` title centred on 306 + dx. */
    const titled = (
      o: { size?: number; dx?: number; len?: number; lead?: number } = {},
    ) => {
      const len = o.len ?? 72;
      const mid = 306 + (o.dx ?? 0);
      return pg({
        segs: [hseg(mid - len / 2, mid + len / 2, 690)],
        text: [
          txt("A Report on Things", 230, 690 + (o.lead ?? 22), {
            size: o.size ?? 18,
            width: 152,
          }),
          txt("by A. Writer", 280, 678, { size: 10, width: 52 }),
        ],
      });
    };
    const bylineLabel = (p: CardPage) => props(p)[0]?.label;

    // INVERTED in review round 4. This test read "KNOWN MISS: a short rule
    // between a title and its byline is still proposed" and pinned the
    // label "by A. Writer". A rule no longer than the larger text line
    // directly over it, centred on that line, is decoration: the byline
    // under it is no caption.
    it("a short rule between a title and its byline is no field", () => {
      expect(props(titled())).toEqual([]);
      expect(firstRule(titled())).toBe("unlabelled");
    });

    it("TITLE_LARGER: a title 1.5 x the caption's size (15 over 10), not 14.9", () => {
      expect(bylineLabel(titled({ size: 15 }))).toBe(undefined);
      expect(bylineLabel(titled({ size: 14.9 }))).toBe("by A. Writer");
    });

    it("TITLE_ABOVE_EMS: the title's baseline up to 1.5 x its size over the rule (27 pt at 18), not 27.1", () => {
      expect(bylineLabel(titled({ lead: 27 }))).toBe(undefined);
      expect(bylineLabel(titled({ lead: 27.1 }))).toBe("by A. Writer");
    });

    // Review round 6 test honesty: mutant T7 (`u.y > r.y - 3`, a title
    // whose baseline is under the rule counted as over it) stayed green;
    // both read no field, but for different reasons.
    it("a title whose baseline is UNDER the rule is no title over it: the rule crosses it (overlaps-text)", () => {
      for (const lead of [-0.5, -2.9]) {
        expect(props(titled({ lead })), `lead ${lead}`).toEqual([]);
        expect(firstRule(titled({ lead })), `lead ${lead}`).toBe(
          "overlaps-text",
        );
      }
    });

    it("centred on the title within GRID_ROW_EPS (2), not 2.1", () => {
      expect(bylineLabel(titled({ dx: 2 }))).toBe(undefined);
      expect(bylineLabel(titled({ dx: 2.1 }))).toBe("by A. Writer");
    });

    it("positive control: a field line wider than the title over it is still a field", () => {
      // No longer than the title (152) within 2 pt; a form's name line runs on.
      expect(bylineLabel(titled({ len: 154 }))).toBe(undefined);
      expect(bylineLabel(titled({ len: 154.2 }))).toBe("by A. Writer");
    });

    it("a title UNDER the rule, or a turned one, is no title", () => {
      const p = titled();
      p.text[0] = { ...p.text[0]!, y: 660 };
      expect(bylineLabel(p)).toBe("by A. Writer");
      const q = titled();
      q.text[0] = { ...q.text[0]!, upright: false };
      expect(bylineLabel(q)).toBe("by A. Writer");
      const blank = titled();
      blank.text[0] = { ...blank.text[0]!, str: "   " };
      expect(bylineLabel(blank)).toBe("by A. Writer");
    });

    /** Two equal rules at 540 and 500 round `quote`, body text under them. */
    const pulled = (
      o: {
        quote?: string;
        size?: number;
        x?: number;
        width?: number;
        third?: boolean;
      } = {},
    ) =>
      pg({
        segs: [
          hseg(150, 462, 540),
          hseg(150, 462, 500),
          ...(o.third ? [hseg(150, 462, 580)] : []),
        ],
        text: [
          txt(o.quote ?? "Quality is never an accident.", 150, 525, {
            size: o.size ?? 11,
            width: 150,
          }),
          txt("The article goes on under the quote.", o.x ?? 72, 485, {
            size: 10,
            width: o.width ?? 200,
          }),
        ],
      });
    const labels = (p: CardPage) => props(p).map((x) => x.label);

    // INVERTED in review round 4. This test read "KNOWN MISS: a pull
    // quote's two rules are still proposed" and pinned both labels, "Quality
    // is never an accident" and "The article goes on under the quote". Two
    // equal rules round one sentence at body size or larger, with body text
    // running on past them, are a pull quote: neither takes a caption.
    it("a pull quote's two rules are no fields", () => {
      expect(props(pulled())).toEqual([]);
      expect(run(pulled()).excluded.map((e) => e.rule)).toEqual([
        "unlabelled",
        "unlabelled",
      ]);
    });

    it("QUOTE_MIN_WORDS / QUOTE_END_RE: a sentence of 3 words or more, ended by . ! or ?", () => {
      expect(props(pulled({ quote: "Quality never fails." }))).toEqual([]);
      expect(props(pulled({ quote: "Never again!" }))).toHaveLength(2);
      expect(props(pulled({ quote: "Is it worth it?" }))).toEqual([]);
      const curly = `${String.fromCodePoint(0x201c)}Quality is never an accident.${String.fromCodePoint(0x201d)}`;
      expect(props(pulled({ quote: curly }))).toEqual([]);
    });

    it("positive control: a caption with no closing stop between two lines is a field", () => {
      expect(labels(pulled({ quote: "Name of your employer" }))).toEqual([
        "Name of your employer",
        "The article goes on under the quote",
      ]);
    });

    it("the quote at body size or larger: 9.5 pt under 10 pt body text is a caption", () => {
      expect(props(pulled({ size: 9.6 }))).toEqual([]);
      expect(props(pulled({ size: 9.5 }))).toHaveLength(2);
    });

    it("the body text runs past the rules by GRID_COLUMN_GAP (24), or it is a caption", () => {
      expect(props(pulled({ x: 126 }))).toEqual([]);
      expect(labels(pulled({ x: 126.1 }))).toEqual([
        "Quality is never an accident",
        "The article goes on under the quote",
      ]);
    });

    it("body text running on just OVER the upper rule counts too; the lower rule keeps a caption inside its span", () => {
      const over = (y: number) => {
        const p = pulled({ x: 150 });
        p.text.push(
          txt("The article runs on above the quote as well.", 72, y, {
            size: 10,
            width: 220,
          }),
        );
        return p;
      };
      // 14 pt over (CAPTION_MAX): the quote's rule takes no caption.
      expect(labels(over(554))).toEqual([
        "The article goes on under the quote",
      ]);
      // ... and the near end: a baseline ON the upper rule is not over it
      // (review round 5 fixes, finding 16; mutant PQ6, `>=` for `>`).
      const on = pulled({ x: 150 });
      on.text.push(
        txt("The article runs on.", 470, 540, { size: 10, width: 80 }),
      );
      expect(labels(on)[0]).toBe("Quality is never an accident");
      expect(labels(over(554.1))).toEqual([
        "Quality is never an accident",
        "The article goes on under the quote",
      ]);
    });

    it("a third equal rule (over the pair) makes it a stack of lines, not a quote", () => {
      expect(labels(pulled({ third: true }))).toEqual([
        "Quality is never an accident",
        "The article goes on under the quote",
      ]);
    });

    it("running on past the RIGHT end counts too: by 24 pt, not 23.9", () => {
      // 150 + 336 = 486 = 462 + 24.
      expect(props(pulled({ x: 150, width: 336 }))).toEqual([]);
      expect(labels(pulled({ x: 150, width: 335.9 }))).toEqual([
        "Quality is never an accident",
        "The article goes on under the quote",
      ]);
    });

    it("running text under the lower rule counts only in its caption window (top up to CAPTION_MAX 14 under it)", () => {
      const deep = (y: number) => {
        const p = pulled({ x: 150 });
        p.text.push(
          txt("The article runs on below as well.", 72, y, {
            size: 10,
            width: 220,
          }),
        );
        return p;
      };
      // Top 479 + 7 = 486, 14 under 500: the quote's rule takes no caption.
      expect(labels(deep(479))).toEqual([
        "The article goes on under the quote",
      ]);
      expect(labels(deep(478.9))).toEqual([
        "Quality is never an accident",
        "The article goes on under the quote",
      ]);
      // ... and the near end: a top CAPTION_MIN (1) under the rule counts,
      // 0.9 does not (review round 6 test honesty: mutant Q6, `>` for
      // `>=`, stayed green).
      expect(labels(deep(492))).toEqual([
        "The article goes on under the quote",
      ]);
      expect(labels(deep(492.1))).toEqual([
        "Quality is never an accident",
        "The article goes on under the quote",
      ]);
    });

    // Review round 6 test honesty: mutant Q13 (`t.y >= lo.y - 1` for
    // `t.y > lo.y`, text ON the lower rule counted as between the rules)
    // stayed green.
    it("a small note with its baseline ON the lower rule is not between the rules; 0.1 over it is", () => {
      const noted = (y: number) => {
        const p = pulled({ x: 150 });
        p.text.push(
          txt("Body text runs on beside it.", 40, 480, {
            size: 10,
            width: 400,
          }),
          txt("note", 160, y, { size: 7, width: 15 }),
        );
        return p;
      };
      expect(labels(noted(500))).not.toContain("Quality is never an accident");
      expect(labels(noted(500.1))).toContain("Quality is never an accident");
    });
  });

  it("TEXT_H_RULE: clamp(1.4 x label size, 14, 22)", () => {
    const h = (size: number) =>
      props(
        pg({
          text: [txt("Address:", 72, 600, { width: 48, size })],
          segs: [hseg(130, 330, 600)],
        }),
      )[0]!.height;
    expect(h(10)).toBe(14);
    expect(h(15)).toBe(21);
    expect(h(20)).toBe(22);
  });

  it("DEFAULT_SIZE: a line with no label text is measured at 10 pt", () => {
    const p = props(pg({ segs: [hseg(130, 330, 600)] }), {
      disable: new Set(["unlabelled"]),
    });
    expect(p[0]).toMatchObject({ label: null, height: 14 });
  });
});

// Review round 2, finding 6 (the owner's decision, round 3): a form that sets
// its labels flush left and starts every line at one tab stop leaves a short
// label ("City:") far from its line while a long one ("Date of birth:") sits
// close, and the 36 pt gap read the short ones as unlabelled. A line in a
// LABEL COLUMN now takes the text to its left up to LABEL_COLUMN_GAP_MAX;
// a lone line keeps the 36 pt gap. Every condition of the column has a test
// here that turns red when the condition is removed or loosened.
describe("labelled-rule: a label column (labels flush left, lines at one tab stop)", () => {
  interface Row {
    label: string;
    /** The label's right end. */
    right: number;
    /** The label's left edge (72). */
    x?: number;
    /** The line's left end (the tab stop). */
    x0?: number;
    o?: Partial<CardText>;
  }
  /** Row i: label baseline and line at y 600 - 30 i, the line to `end` (450). */
  const rowY = (i: number) => 600 - 30 * i;
  function column(
    rows: Row[],
    tab: number,
    more: { text?: CardText[]; segs?: CardSeg[]; end?: number } = {},
  ): CardPage {
    return pg({
      text: [
        ...rows.map((r, i) => {
          const x = r.x ?? 72;
          return txt(r.label, x, rowY(i), { width: r.right - x, ...r.o });
        }),
        ...(more.text ?? []),
      ],
      segs: [
        ...rows.map((r, i) => hseg(r.x0 ?? tab, more.end ?? 450, rowY(i))),
        ...(more.segs ?? []),
      ],
    });
  }
  /** The label proposed on row i's line (undefined: nothing proposed there). */
  const labelAt = (p: CardPage, i: number) =>
    props(p).find((q) => q.y === rowY(i) + 1)?.label;
  /** The rule that decided row i's line. */
  const decidedAt = (p: CardPage, i: number) =>
    run(p).excluded.find((e) => Math.round(e.box.y) === rowY(i) + 1)?.rule;

  // Lines at 160. Gaps: Name 53, Email 55, Date of birth 19, City 64,
  // Telephone 28. Only Date of birth and Telephone are within 36 pt.
  const TAB = 160;
  const A1: Row[] = [
    { label: "Name:", right: 107 },
    { label: "Email:", right: 105 },
    { label: "Date of birth:", right: 141 },
    { label: "City:", right: 96 },
    { label: "Telephone:", right: 132 },
  ];
  const NAMES = ["Name", "Email", "Date of birth", "City", "Telephone"];

  it("every line of a 5-row column takes its label, however short (the a1 shape)", () => {
    const p = column(A1, TAB);
    expect(NAMES.map((_, i) => labelAt(p, i))).toEqual(NAMES);
    expect(run(p).excluded).toEqual([]);
  });

  it("stays unlabelled: a lone line with text 40 pt to its left (36 pt holds outside a column)", () => {
    const p = pg({
      text: [txt("Address:", 72, 600, { width: 48 })],
      segs: [hseg(160, 400, 600)],
    });
    expect(props(p)).toEqual([]);
    expect(firstRule(p)).toBe("unlabelled");
  });

  // Lines at 250: Name, Date of birth and Email are in reach, City is the
  // one moved to the boundary.
  const FAR = (cityRight: number): Row[] => [
    { label: "Name:", right: 240 },
    { label: "Date of birth:", right: 230 },
    { label: "Email:", right: 200 },
    { label: "City:", right: cityRight },
  ];

  it("LABEL_COLUMN_GAP_MAX: a column label ending 144 pt left of its line counts, 144.1 does not", () => {
    expect(labelAt(column(FAR(106), 250), 3)).toBe("City");
    const out = column(FAR(105.9), 250);
    expect(labelAt(out, 3)).toBeUndefined();
    expect(decidedAt(out, 3)).toBe("unlabelled");
    // The rest of the column is still a column.
    expect([0, 1, 2].map((i) => labelAt(out, i))).toEqual([
      "Name",
      "Date of birth",
      "Email",
    ]);
  });

  it("stays unlabelled: a 150 pt gap in a column", () => {
    const p = column(FAR(100), 250);
    expect(labelAt(p, 3)).toBeUndefined();
    expect(decidedAt(p, 3)).toBe("unlabelled");
  });

  it("GRID_ROW_EPS: column labels whose left edges are 2 pt apart line up, 2.1 pt apart do not", () => {
    const moved = (x: number) =>
      column(
        A1.map((r, i) => (i === 3 ? { ...r, x, right: r.right + x - 72 } : r)),
        TAB,
      );
    expect(labelAt(moved(74), 3)).toBe("City");
    expect(labelAt(moved(70), 3)).toBe("City");
    expect(labelAt(moved(74.1), 3)).toBeUndefined();
    expect(decidedAt(moved(74.1), 3)).toBe("unlabelled");
    expect(labelAt(moved(69.9), 3)).toBeUndefined();
  });

  it("stays unlabelled: a column whose labels are ragged (left edges 4 pt apart)", () => {
    const p = column(
      A1.map((r, i) => ({ ...r, x: 72 + 4 * i, right: r.right + 4 * i })),
      TAB + 16,
    );
    // Gaps: 69, 67, 27, 68, 28. The lone-line rule still labels two.
    expect(NAMES.map((_, i) => labelAt(p, i))).toEqual([
      undefined,
      undefined,
      "Date of birth",
      undefined,
      "Telephone",
    ]);
    expect(decidedAt(p, 0)).toBe("unlabelled");
  });

  it("GRID_ROW_EPS: lines whose left ends are 2 pt apart line up, 2.1 pt apart do not", () => {
    const moved = (x0: number) =>
      column(
        A1.map((r, i) => (i === 3 ? { ...r, x0 } : r)),
        TAB,
      );
    expect(labelAt(moved(162), 3)).toBe("City");
    expect(labelAt(moved(158), 3)).toBe("City");
    expect(labelAt(moved(162.1), 3)).toBeUndefined();
    expect(decidedAt(moved(162.1), 3)).toBe("unlabelled");
    expect(labelAt(moved(157.9), 3)).toBeUndefined();
  });

  // INVERTED in review round 5 fixes (finding 5; owner-level call made
  // under the brief's delegation). This read "LABEL_COLUMN_MIN: 3 lines
  // make a column, 2 do not" and pinned Email (55 pt from its line, under
  // Date of birth at one tab stop) unlabelled: a vehicle inspection's
  // two-row header ("Vehicle reg:" / "Driver:") lost its second field.
  // Two aligned rows, one anchored within 36 pt, are a tab-stop column.
  it("LABEL_COLUMN_MIN: 2 lines make a column, 1 does not (a line at another tab stop does not count)", () => {
    const three = column([A1[2]!, A1[1]!, A1[3]!], TAB);
    expect([0, 1, 2].map((i) => labelAt(three, i))).toEqual([
      "Date of birth",
      "Email",
      "City",
    ]);
    // Rows 0 and 1 are a column of two; row 2 is labelled within 36 pt but
    // its line starts at 340 and its label at 300, so it is in neither.
    const two = column(
      [A1[2]!, A1[1]!, { label: "Phone:", x: 300, right: 330, x0: 340 }],
      TAB,
    );
    expect(labelAt(two, 0)).toBe("Date of birth");
    expect(labelAt(two, 2)).toBe("Phone");
    expect(labelAt(two, 1)).toBe("Email");
    // One: Email alone at that tab stop, the anchor's line moved 2.1 pt.
    const one = column([{ ...A1[2]!, x0: TAB + 2.1 }, A1[1]!], TAB);
    expect(labelAt(one, 1)).toBeUndefined();
    expect(decidedAt(one, 1)).toBe("unlabelled");
  });

  it("the column needs a label the lone-line rule accepts, in the same column", () => {
    // Left: the A1 column (anchored by Date of birth and Telephone). Right:
    // labels at 320 and lines at 400, every gap over 36 pt.
    const right = ["Ref:", "Code:", "Group:", "Unit:"].map((s, i) =>
      txt(s, 320, rowY(i), { width: 30 }),
    );
    const p = column(A1, TAB, {
      text: right,
      segs: right.map((_, i) => hseg(400, 560, rowY(i))),
      end: 300,
    });
    expect(NAMES.map((_, i) => labelAt(p, i))).toEqual(NAMES);
    const far = props(p).filter((q) => q.x === 401);
    expect(far).toEqual([]);
    expect(
      run(p).excluded.filter((e) => Math.round(e.box.x) === 401),
    ).toHaveLength(4);
    // And alone, with no anchor anywhere on the page.
    const alone = column(
      A1.map((r) => ({ ...r, right: Math.min(r.right, 110) })),
      TAB,
    );
    expect(props(alone)).toEqual([]);
  });

  it("stays unlabelled: another text piece between a label and its line", () => {
    // A word ("(work)") 40 pt short of the line: the nearest text is not the
    // column's.
    const word = column(A1, TAB, {
      text: [txt("(work)", 108, rowY(1), { width: 12 })],
    });
    expect(labelAt(word, 1)).toBeUndefined();
    expect(decidedAt(word, 1)).toBe("unlabelled");
    // A dot leader, which is no label itself, between "Email:" and the line.
    const leader = column(A1, TAB, {
      text: [txt("........", 108, rowY(1), { width: 40 })],
    });
    expect(labelAt(leader, 1)).toBeUndefined();
    expect(decidedAt(leader, 1)).toBe("unlabelled");
    // The other rows stay a column.
    expect(labelAt(leader, 3)).toBe("City");
  });

  // Text between a label and its line is read up to the band of the page's
  // largest size, then held to its OWN band (0.6 em over the line): with
  // that test deleted, a small note over its own band but under the
  // largest one cut the row out of the column (review round 6 test
  // honesty, closing mutant sweep: round 3's mutant M22, green since the
  // scan became a slice).
  it("a 5 pt note over its own band (0.6 em) in a label's gap is not between: the row keeps its column label", () => {
    const note = (dy: number) =>
      column(A1, TAB, {
        text: [txt("note", 120, rowY(1) + dy, { size: 5, width: 10 })],
      });
    // On its band (3 pt over the line at 5 pt) it is the line's own label.
    expect(labelAt(note(3), 1)).toBe("note");
    // Over it, up to the 12 pt labels' band (7.2 pt), it is nothing.
    expect(labelAt(note(3.1), 1)).toBe("Email");
    expect(labelAt(note(5), 1)).toBe("Email");
    expect(labelAt(note(7.2), 1)).toBe("Email");
    // And under the band's bottom (2 pt under the line) it is nothing too;
    // on the bottom it is the line's label again.
    expect(labelAt(note(-2), 1)).toBe("note");
    expect(labelAt(note(-2.1), 1)).toBe("Email");
  });

  it("stays unlabelled: a rule, or a plumb line, between a label and its line", () => {
    const level = column(A1, TAB, { segs: [hseg(110, 140, rowY(1))] });
    expect(labelAt(level, 1)).toBeUndefined();
    expect(decidedAt(level, 1)).toBe("unlabelled");
    expect(labelAt(level, 3)).toBe("City");
    const plumb = column(A1, TAB, {
      segs: [vseg(130, rowY(1) - 5, rowY(1) + 10)],
    });
    expect(labelAt(plumb, 1)).toBeUndefined();
    expect(decidedAt(plumb, 1)).toBe("unlabelled");
    expect(labelAt(plumb, 3)).toBe("City");
  });

  it("stays unlabelled: a column label that is not upright", () => {
    const p = column(
      A1.map((r, i) => (i === 1 ? { ...r, o: { upright: false } } : r)),
      TAB,
    );
    expect(labelAt(p, 1)).toBeUndefined();
    expect(decidedAt(p, 1)).toBe("unlabelled");
    expect(labelAt(p, 3)).toBe("City");
  });

  it("a column label sits on its line's label band: 2 pt under the line counts, 2.1 does not; 0.6 em over it counts, more does not", () => {
    const low = (dy: number) =>
      column(
        A1.map((r, i) => (i === 1 ? { ...r, o: { y: rowY(1) - dy } } : r)),
        TAB,
      );
    expect(labelAt(low(2), 1)).toBe("Email");
    expect(labelAt(low(2.1), 1)).toBeUndefined();
    expect(decidedAt(low(2.1), 1)).toBe("unlabelled");
    // And above it: 0.6 em (7.2 pt at 12 pt) counts, 7.3 does not.
    expect(labelAt(low(-7.2), 1)).toBe("Email");
    expect(labelAt(low(-7.3), 1)).toBeUndefined();
    expect(decidedAt(low(-7.3), 1)).toBe("unlabelled");
  });

  it("a line in a column takes its left label before a caption under it", () => {
    const p = column(A1, TAB, {
      text: [txt("(as on your passport)", TAB + 2, rowY(4) - 10, { size: 10 })],
    });
    expect(labelAt(p, 4)).toBe("Telephone");
    const q = column(A1, TAB, {
      text: [txt("(as on your passport)", TAB + 2, rowY(3) - 12, { size: 10 })],
    });
    // City is 64 pt from its line, so only the column reaches it.
    expect(labelAt(q, 3)).toBe("City");
  });

  // Review round 4 fixes, finding 18: the column rule filtered every row
  // for every row and scanned all text and all rules for every line, new
  // quadratic terms on a stacked label column (within the 20,000-primitive
  // cap). Rows with one line start and label edge are asked once, and the
  // blockers are read from y-sorted lists.
  // 20,000 lines: the walker's primitive cap (PATH_LIMITS.maxPrimitives).
  //
  // First pinned as 20,000 lines in `< 800` ms ("measured before: 2 s at
  // 5,000 lines; after: about 0.35 s at 20,000"), a wall-clock bound (see
  // interleavedBest): CI read 809.6 ms on the fixed code (PR #382's run
  // 44402871424, a slow runner), and 856.9 on main once #385 merged (run
  // 44428026069, red). Now the SHAPE: 16 times the lines must
  // cost far less than 256 times (each line reading every other's text).
  // 16, not 8: at 8 times the linear page read up to 9.9 and the defect
  // 40, too close to set a bound 2x from one and 1.5x from the other.
  // First measured with samples of one call and the defect timed alone:
  // fixed 13.1 to 25.7 (the small column takes 5 to 13 ms, the noisiest
  // denominator here; the bound was 48 until a run read 25.7), the
  // left-label search reading `p.text` 110 to 145.
  // Measured in this whole file (see interleavedBest): fixed 18.01 to
  // 22.24 one or 4 at a time, 13.45 to 21.24 under the pinned loads; with
  // the left-label search reading `p.text` instead of `bandText(ix, r)`
  // (every line meeting every text item) 154.8 to 171.0, and 141.9 to
  // 191.9 4 at a time. The bound, 56, is 2.5x over the worst fixed and
  // 2.5x under the defect. The rules between label and line have a test
  // of their own (after the next one): put back here, the historical
  // `lines.rules.some(...)` read 92.9 to 107.7 and the stop written
  // `continue` 71.5 to 88.9, red but not 1.5x over the bound.
  it("a 20,000-line label column is classified in linear time", () => {
    const column = (n: number) => {
      const segs: CardSeg[] = [];
      const text: CardText[] = [];
      for (let k = 0; k < n; k++) {
        const y = 40 + 30 * k;
        segs.push(hseg(160, 450, y));
        text.push(
          txt(k % 2 ? "City:" : "Date of birth:", 72, y, {
            size: 10,
            width: k % 2 ? 24 : 70,
          }),
        );
      }
      return pg({ height: 40 + 30 * n + 100, segs, text });
    };
    const N = 20_000;
    const few = column(N / 16);
    const many = column(N);
    const [small, large] = interleavedBest([() => run(few), () => run(many)]);
    // Health: every line is a field (City only by the column), capped at
    // 60, at both sizes.
    for (const [res, n] of [
      [small!.got, N / 16],
      [large!.got, N],
    ] as const) {
      expect(res.counts.candidates).toBe(n);
      expect(res.excluded).toEqual([]);
      expect(res.counts.capped).toBe(n - 60);
      expect(res.proposals.map((x) => x.label).slice(0, 2)).toEqual([
        "City",
        "Date of birth",
      ]);
    }
    expectRatioUnder("20,000-line label column", large!, small!, 56);
  }, 60_000);

  // The text between a label and its line is read from the label band's
  // bottom up, stopping at the first baseline over the band of the page's
  // largest size. With `continue` for that `break` every row read every
  // text item over it, and the column above stayed under its 800 ms
  // bound (review round 6 test honesty, closing mutant sweep: round 4's
  // f18-text-between-scan). Measured best of 2: the column with the text
  // 65 ms, each alone 20 and 43; with `continue`, 382 ms.
  it("5,000 column rows and 50,000 text items over them cost what each costs alone", () => {
    const N = 5000;
    const K = 50_000;
    const top = 40 + 30 * N + 100;
    const page = (rows: boolean, words: boolean) => {
      const segs: CardSeg[] = [];
      const text: CardText[] = [];
      if (rows)
        for (let k = 0; k < N; k++) {
          const y = 40 + 30 * k;
          segs.push(hseg(160, 450, y));
          text.push(
            txt(k % 2 ? "City:" : "Date of birth:", 72, y, {
              size: 10,
              width: k % 2 ? 24 : 70,
            }),
          );
        }
      if (words)
        for (let k = 0; k < K; k++)
          text.push(
            txt("x", 20 + (k % 100) * 5.8, top + 4 * Math.floor(k / 100), {
              size: 2,
              width: 1,
            }),
          );
      return pg({ height: top + 4 * (K / 100) + 100, segs, text });
    };
    const pages = [page(false, true), page(true, false), page(true, true)];
    const [words, rows, both] = interleavedBest(
      pages.map((p) => () => run(p).counts.candidates),
    );
    // Health: every line is a candidate, with the text or not; the text
    // alone has none.
    expect(both!.got).toBe(N);
    expect(rows!.got).toBe(N);
    expect(words!.got).toBe(0);
    // Both together against the sum of each alone. This was `both < 2 *
    // (rows + words) + 50` ms, an additive margin that is most of a fast
    // machine's run and noise on a slow one (CI took up to 980 ms for the
    // test). Rows that each read every text item over them multiply.
    // First measured with the defect timed alone: fixed 0.95 to 1.18,
    // `continue` for the `break` 5.14 to 6.63 (bound 2.5).
    // Measured in this whole file (see interleavedBest): fixed 0.99 to
    // 1.24 one or 4 at a time, 0.90 to 1.18 under the pinned loads; with
    // the `break` turned back into `continue` 6.24 to 7.30, and 6.78 to
    // 7.02 4 at a time; with no stop at all (`textTop` Infinity) 8.69 to
    // 9.25 and 8.68 to 9.68. The bound, 2.8, is 2.3x over the worst fixed
    // and 2.2x under the lowest defect.
    expectRatioUnder(
      "5,000 column rows with 50,000 words vs each alone",
      both!,
      [rows!, words!],
      2.8,
    );
  }, 60_000);

  // The rules between a label and its line are read the same way: from the
  // label band's bottom up, stopping at the first rule over the band's top.
  // Before review round 4 (finding 18) every line asked every rule on the
  // page (`lines.rules.some(...)`), and the 20,000-line column above was
  // the only test of that term. Measured there, the term rode on noise:
  // the historical `some` read 46.8 to 61.8 against that test's bound of
  // 56, and the stop written `continue` 43.7 to 79.2, red in 2 and 3 runs
  // of 5 (review of the ratio conversion, finding 2; R5h and R5). So the
  // rule term has a test of its own, the shape of the one above for text:
  // short rules over the column, too short to be lines themselves, cost
  // the column nothing per line.
  it("5,000 column rows and 50,000 short rules over them cost what each costs alone", () => {
    const N = 5000;
    const K = 50_000;
    const top = 40 + 30 * N + 100;
    const page = (rows: boolean, rules: boolean) => {
      const segs: CardSeg[] = [];
      const text: CardText[] = [];
      if (rows)
        for (let k = 0; k < N; k++) {
          const y = 40 + 30 * k;
          segs.push(hseg(160, 450, y));
          text.push(
            txt(k % 2 ? "City:" : "Date of birth:", 72, y, {
              size: 10,
              width: k % 2 ? 24 : 70,
            }),
          );
        }
      if (rules)
        for (let k = 0; k < K; k++) {
          const x = 20 + (k % 100) * 5.8;
          segs.push(hseg(x, x + 3, top + 4 * Math.floor(k / 100)));
        }
      return pg({ height: top + 4 * (K / 100) + 100, segs, text });
    };
    const pages = [page(false, true), page(true, false), page(true, true)];
    const [rules, rows, both] = interleavedBest(pages.map((p) => () => run(p)));
    // Health: every line is a candidate and the column labels them, City
    // (24 pt wide, 64 pt from its line) by the column alone, with the
    // short rules or without them; the short rules alone are no lines.
    for (const r of [rows!.got, both!.got]) {
      expect(r.counts.candidates).toBe(N);
      expect(r.excluded).toEqual([]);
      expect(r.proposals.map((x) => x.label).slice(0, 2)).toEqual([
        "City",
        "Date of birth",
      ]);
    }
    expect(rules!.got.counts.candidates).toBe(0);
    // Measured in this whole file (see interleavedBest): fixed 0.91 to
    // 1.18 one or 4 at a time, 0.86 to 1.28 under the pinned loads; with
    // every line asking every rule (`lines.rules.some(...)`, the indexed
    // walk skipped) 5.25 to 6.19, and 5.52 to 5.87 4 at a time; with the
    // walk's stop written `continue` 8.76 to 11.31 and 8.36 to 17.43. The
    // bound, 2.6, is 2.0x over the worst fixed and 2.0x under the lowest
    // defect.
    expectRatioUnder(
      "5,000 column rows with 50,000 short rules vs each alone",
      both!,
      [rows!, rules!],
      2.6,
    );
  }, 60_000);

  // Review round 4 fixes, finding 19: derived boundaries of the column
  // rule that no test sat exactly on; each mutant named stayed green.
  it("the column's anchor may end exactly LABEL_LEFT_GAP_RULE (36 pt) from its line (mutant C1)", () => {
    // Row 0 ends exactly 36 pt short of the line; rows 1 and 2 are 60 off.
    const p = column(
      [
        { label: "Surname:", right: 124 },
        { label: "City:", right: 100 },
        { label: "Town:", right: 100 },
      ],
      160,
    );
    expect([0, 1, 2].map((i) => labelAt(p, i))).toEqual([
      "Surname",
      "City",
      "Town",
    ]);
  });

  it("a tick at the line's own left end does not cut it from its column label (mutant C7)", () => {
    const p = column(A1, TAB, {
      segs: A1.map((_, i) => vseg(TAB, rowY(i), rowY(i) + 8)),
    });
    expect(NAMES.map((_, i) => labelAt(p, i))).toEqual(NAMES);
  });

  it("a line exactly RULE_MIN_LEN (36 pt) long is a column row (mutant C8)", () => {
    const p = pg({
      text: A1.map((r, i) =>
        txt(r.label, 72, rowY(i), { width: r.right - 72 }),
      ),
      segs: A1.map((_, i) => hseg(TAB, i === 3 ? TAB + 36 : 450, rowY(i))),
    });
    expect(labelAt(p, 3)).toBe("City");
  });

  // Review round 4 fixes, finding 20: the blockers between a label and its
  // line were tested only well inside the label band, so every edge
  // comparison could be loosened to strict. Row 1 (Email, 55 pt off) is
  // labelled by the column only.
  it("blockers on the very edges of the label band still block (mutants C2-C5, C9, C10)", () => {
    const y = rowY(1);
    const at = (more: { text?: CardText[]; segs?: CardSeg[] }) =>
      labelAt(column(A1, TAB, more), 1);
    expect(at({})).toBe("Email");
    // A leader at the band's foot (y - 2) and at its head (y + 0.6 x 10).
    const leader = (ly: number) =>
      txt("........", 110, ly, { size: 10, width: 40 });
    expect(at({ text: [leader(y - 2)] })).toBeUndefined();
    expect(at({ text: [leader(y + 6)] })).toBeUndefined();
    // A rule at the band's foot, and at the label's top (y + 0.6 x 12).
    expect(at({ segs: [hseg(110, 150, y - 2)] })).toBeUndefined();
    expect(at({ segs: [hseg(110, 150, y + 0.6 * 12)] })).toBeUndefined();
    // A plumb line ending at the band's foot, one starting at its top.
    expect(at({ segs: [vseg(130, y - 20, y - 2)] })).toBeUndefined();
    expect(at({ segs: [vseg(130, y + 0.6 * 12, y + 30)] })).toBeUndefined();
  });
});

// Review round 4: the owner's decision on round 3's finding 9. A ruled grid
// of exactly two columns and two or more rows, every LEFT cell holding one
// short upright label line inside it and every RIGHT cell empty, is a form
// (a Word-exported "label | answer" table): one text field fills each right
// cell inside its borders, labelled from its left cell. Corpus N38 (once the
// KNOWN MISS negative) and N4 (a 3 x 3 grid labelled from OUTSIDE, which
// stays table-grid).
describe("table-cell: a two-column table of labels and empty cells", () => {
  const LABELS = ["Name", "Address", "Telephone", "Email"];
  /** Rules from 72 to 400 every 24 pt down from 600; plumb lines at `xs`. */
  const table = (
    o: {
      rows?: number;
      xs?: number[];
      left?: (CardText | null)[];
      text?: CardText[];
      segs?: CardSeg[];
      rects?: CardRect[];
      plumbs?: CardSeg[];
    } = {},
  ) => {
    const rows = o.rows ?? 4;
    const ys = Array.from({ length: rows + 1 }, (_, i) => 600 - 24 * i);
    const xs = o.xs ?? [72, 180, 400];
    const left =
      o.left ??
      LABELS.slice(0, rows).map((s, i) =>
        txt(s, 76, ys[i]! - 16, { size: 10, width: 5 * s.length }),
      );
    return pg({
      segs: [
        ...ys.map((y) => hseg(72, 400, y)),
        ...(o.plumbs ?? xs.map((x) => vseg(x, ys[rows]!, 600))),
        ...(o.segs ?? []),
      ],
      rects: o.rects ?? [],
      text: [
        ...left.filter((t): t is CardText => t !== null),
        ...(o.text ?? []),
      ],
    });
  };
  const cells = (p: CardPage) =>
    props(p)
      .filter((x) => x.rule === "table-cell")
      .map((x) => x.label);
  const grid = (p: CardPage) =>
    run(p).excluded.filter((e) => e.rule === "table-grid").length;

  it("one field per right cell, filling it inside its borders (inset 1), labelled from its left cell", () => {
    const p = table();
    expect(props(p)).toEqual(
      LABELS.map((label, i) =>
        expect.objectContaining({
          rule: "table-cell",
          type: "text",
          label,
          x: 181,
          y: 577 - 24 * i,
          width: 218,
          height: 22,
        }),
      ),
    );
    // The grid's own rules are still table-grid, never fields themselves.
    expect(grid(p)).toBe(5);
  });

  it("CELL_ROWS_MIN: two rows are a form, one row is not", () => {
    expect(cells(table({ rows: 2 }))).toEqual(["Name", "Address"]);
    expect(cells(table({ rows: 1 }))).toEqual([]);
    expect(grid(table({ rows: 1 }))).toBe(2);
  });

  it("CELL_LABEL_MAX: a label of 40 characters counts, 41 does not", () => {
    const of = (n: number) =>
      table({
        rows: 2,
        left: [
          txt("A".repeat(n), 76, 584, { size: 10, width: 100 }),
          txt("Email", 76, 560, { size: 10, width: 25 }),
        ],
      });
    expect(cells(of(40))).toEqual(["A".repeat(40), "Email"]);
    expect(cells(of(41))).toEqual([]);
  });

  // INVERTED by slice S5 (2026-11-22). This read "a header row (text in
  // both cells) keeps the whole grid a table" and asserted no proposal: a
  // header row now reads its table's cells (`header-cell`, corpus N39).
  // It is no LABEL table still (no table-cell), and its rules stay
  // table-grid.
  it("a header row (text in both cells) is no label table: its empty cells are header cells", () => {
    const p = table({
      text: [txt("Your answer", 184, 584, { size: 10, width: 55 })],
    });
    expect(props(p).map((x) => [x.rule, x.label])).toEqual([
      ["header-cell", "Address"],
      ["header-cell", "Telephone"],
      ["header-cell", "Email"],
    ]);
    expect(grid(p)).toBe(5);
  });

  // S5 changed the first row's case: text in the TOP right cell makes that
  // row a header row ("Name | x" cannot be told from "Question | Answer"),
  // so the rows under it, labelled and empty, are header cells. Until S5
  // all four positions asserted no proposal. Text in any lower right cell
  // still leaves the grid with no label table and no header row.
  it("any text in a lower right cell keeps it a table; in the top one it makes a header row (S5)", () => {
    for (const y of [560, 536, 512]) {
      const p = table({ text: [txt("x", 300, y, { size: 10, width: 5 })] });
      expect(props(p), `text at ${y}`).toEqual([]);
    }
    const top = table({ text: [txt("x", 300, 584, { size: 10, width: 5 })] });
    expect(props(top).map((x) => [x.rule, x.label])).toEqual([
      ["header-cell", "Address"],
      ["header-cell", "Telephone"],
      ["header-cell", "Email"],
    ]);
  });

  it("three or more columns stay a table", () => {
    expect(props(table({ xs: [72, 180, 290, 400] }))).toEqual([]);
  });

  // Review round 6 test honesty, cost finding 1: the split loop asked
  // whether the outer plumb lines join two rules by filtering and sorting
  // every vertical on the page for every pair, so a Word-style table (each
  // cell's border its own piece) cost rows x verticals. The control is the
  // same page with no two rules' ends alike, so no stack asks anything:
  // the page's other per-line costs, some of them quadratic in verticals
  // (gridTouches), are in both. First written against the table drawn in
  // whole lines, which a later speed-up of the rest of the page made too
  // cheap a control to hold under parallel load.
  //
  // The pieces come in a fixed pseudo-random order, as a content stream may
  // give them. In drawing order the defect's sort per pair meets presorted
  // runs and is linear, which leaves only its filter: a constant factor on
  // a page whose own gridTouches is rows x verticals already. Measured that
  // way, the defect read 1.46 against a fixed 0.39 alone and 0.71 to 0.78
  // among this file's other tests, no room for a bound 2x from one and
  // 1.5x from the other. Shuffled, each pair's sort is n log n.
  //
  // KNOWN GAP: this test pins only the per-pair SORT, not the filter that
  // came with it. The defect had two halves, a filter of every vertical
  // for every pair (rows x verticals) and a sort of what it found, and on
  // this page the filter alone is a constant factor: the page's own
  // gridTouches is rows x verticals already, the control's too. Put back
  // without the sort (`lines.verticals.filter(...)` at each outer x, per
  // pair, in front of the joined test), it read 0.76 to 0.88 in this whole
  // file, green, and no bound 2x over the fixed code (1.54) can see it
  // (review of the ratio conversion, finding 5; R7a). The additive form
  // that came before did catch it on this machine, in 2 of 3 runs of its
  // own unshuffled page (522.7 ms against 494.4 + 50, 575.3 against 516.8
  // + 50), but only because 50 ms was a margin on a fast machine: CI took
  // 4 to 5 s a side, where 50 ms is 1%, inside the noise. A real Word
  // table draws its borders in order, which makes the sort linear too, so
  // the full historical shape (filter, sort and walk per pair; R7b) is red
  // here only for the shuffled pieces. This holds until gridTouches stops
  // being rows x verticals; once the page's own cost is linear in its
  // verticals, the filter half is a quadratic term against it, and this
  // test should be re-measured against R7a.
  it("a 4,000-row label table drawn in Word-style pieces costs no more than the same rules unstacked", () => {
    const N = 4000;
    const pieces: CardSeg[] = [];
    for (const x of [50, 200, 450])
      for (let i = 0; i < N; i++)
        pieces.push(vseg(x, 40 + 20 * i, 40 + 20 * (i + 1)));
    let seed = 1;
    for (let i = pieces.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      [pieces[i], pieces[j]] = [pieces[j]!, pieces[i]!];
    }
    const page = (stacked: boolean) => {
      const segs: CardSeg[] = [];
      const text: CardText[] = [];
      for (let i = 0; i <= N; i++)
        segs.push(
          stacked
            ? hseg(50, 450, 40 + 20 * i)
            : hseg(
                50 + 2.1 * (i % 70),
                452 + 2.1 * (Math.floor(i / 70) % 70),
                40 + 20 * i,
              ),
        );
      segs.push(...pieces);
      for (let i = 0; i < N; i++)
        text.push(txt(`Label ${i}`, 54, 46 + 20 * i, { size: 10, width: 40 }));
      return pg({ height: 40 + 20 * N + 100, segs, text });
    };
    const stackedPage = page(true);
    const unstackedPage = page(false);
    const [stacked, unstacked] = interleavedBest<FieldProposal[]>([
      () => props(stackedPage),
      () => props(unstackedPage),
    ]);
    // Health: the stacked page is read as the label table (the page CAP
    // keeps 60), the unstacked one has no table cell.
    expect(stacked!.got).toHaveLength(60);
    expect(stacked!.got.slice(0, 2).map((x) => [x.rule, x.label])).toEqual([
      ["table-cell", "Label 3999"],
      ["table-cell", "Label 3998"],
    ]);
    expect(unstacked!.got.filter((x) => x.rule === "table-cell")).toEqual([]);
    // Measured: before, 1,087 ms against 615; after, 259 against 489. This
    // was `stacked < unstacked + 50` ms, and CI took 4 to 5 s for each
    // side, so the 50 ms was about 1% there, far inside the noise. First
    // measured with the defect timed alone: fixed 0.54 to 0.72 (0.35 with
    // this test alone), `outer =` 7.85 to 9.00.
    // Measured in this whole file (see interleavedBest): fixed 0.60 to
    // 0.74 one or 4 at a time, 0.64 to 0.77 under the pinned loads; with
    // `outer ??=` written `outer =` (each pair gathering and sorting the
    // plumb lines again) 4.85 to 5.23, and 4.78 to 5.58 4 at a time; with
    // the historical filter, sort and walk per pair (R7b) 4.86 to 5.34 and
    // 4.65 to 5.32. The bound, 2, is 2.6x over the worst fixed and 2.3x
    // under the lowest defect. (The filter alone: see KNOWN GAP above.)
    expectRatioUnder(
      "Word-style pieces stacked vs unstacked",
      stacked!,
      unstacked!,
      2,
    );
  }, 60_000);

  // Review round 6 test honesty: the column lines are counted inside the
  // stack's height only. Mutant TC15 (every vertical in the x span
  // counted) stayed green; a signature box under the table then cost the
  // table every field.
  it("an unrelated box BELOW the table, its sides inside the table's x span, leaves the table alone", () => {
    expect(cells(table({ rects: [rect(250, 300, 120, 40)] }))).toEqual(LABELS);
  });

  // Review round 6 test honesty: mutant TC12 (`> 0` for `> 0.5` in
  // textIn) stayed green.
  it("a left label reaching 0.5 pt into the right cell is not in it; 0.6 pt is", () => {
    // "Name" starts at 76; the column line is at 180.
    const reach = (width: number) =>
      table({
        left: LABELS.map((s, i) =>
          txt(s, 76, 584 - 24 * i, {
            size: 10,
            width: i === 0 ? width : 5 * s.length,
          }),
        ),
      });
    expect(cells(reach(104.5))).toEqual(LABELS);
    expect(cells(reach(104.6))).toEqual([]);
  });

  it("a left cell holding two lines, or nothing, keeps it a table", () => {
    const two = table({
      // "Address" sits at 560; a second line under it in the same cell.
      text: [txt("(in full)", 76, 546, { size: 6, width: 20 })],
    });
    expect(props(two)).toEqual([]);
    const none = table({
      left: [
        txt("Name", 76, 584, { size: 10, width: 25 }),
        null,
        txt("Telephone", 76, 536, { size: 10, width: 45 }),
        txt("Email", 76, 512, { size: 10, width: 25 }),
      ],
    });
    expect(props(none)).toEqual([]);
  });

  it("left-cell text that is not upright, or that crosses the column line, keeps it a table", () => {
    const turned = table({
      rows: 2,
      left: [
        txt("Name", 76, 584, { size: 10, width: 25, upright: false }),
        txt("Email", 76, 560, { size: 10, width: 25 }),
      ],
    });
    expect(props(turned)).toEqual([]);
    const spills = table({
      rows: 2,
      left: [
        txt("Name of the applicant", 76, 584, { size: 10, width: 110 }),
        txt("Email", 76, 560, { size: 10, width: 25 }),
      ],
    });
    expect(props(spills)).toEqual([]);
    // Text starting left of the grid's own border is not inside its cell.
    const outside = table({
      rows: 2,
      left: [
        txt("Name", 64, 584, { size: 10, width: 25 }),
        txt("Email", 76, 560, { size: 10, width: 25 }),
      ],
    });
    expect(props(outside)).toEqual([]);
  });

  it("a grid open at one end (no plumb line there) is no label table", () => {
    const open = table({
      plumbs: [vseg(72, 504, 600), vseg(180, 504, 600), vseg(300, 504, 600)],
    });
    expect(props(open)).toEqual([]);
  });

  it("N4's shape: a 3 x 3 grid of empty cells labelled from OUTSIDE stays a table", () => {
    const p = pg({
      segs: [
        ...[500, 520, 540, 560].map((y) => hseg(200, 440, y)),
        ...[200, 280, 360, 440].map((x) => vseg(x, 500, 560)),
      ],
      text: [1, 2, 3, 4].map((n, i) =>
        txt(`Row ${n}`, 165, 502 + 20 * i, { size: 10, width: 25 }),
      ),
    });
    expect(props(p)).toEqual([]);
    // 3, not 4, since slice S4's review round 1: the top row's cells are
    // entry-sized boxes, whose candidates (each `table-grid` here) stand
    // for their top edge.
    expect(grid(p)).toBe(3);
  });

  // INVERTED by slice S5 (2026-11-22, tables: empty ruled cells). Until
  // then this read "KNOWN MISS: an empty ruled table under a header row
  // proposes nothing" (review round 4 fixes, finding 26): every row was
  // table-grid, and it asserted props(p) toEqual([]) with the wanted
  // fields in a comment. The grid's rules are still table-grid (4); its
  // empty cells are now fields named "<row head> <column head>". Corpus
  // N45 (the timesheet) is inverted with it; P45 (tiled customs boxes, no
  // regular grid) and N46 (a filled data table) stay as they were.
  it("an empty ruled table under a header row: one field per empty body cell, named by row and column", () => {
    const xs = [72, 170, 250, 330];
    const ys = [600, 580, 558, 536];
    const p = pg({
      segs: [
        ...ys.map((y) => hseg(72, 330, y)),
        ...xs.map((x) => vseg(x, 536, 600)),
      ],
      text: [
        ...["Day", "Start", "Finish"].map((h, i) =>
          txt(h, xs[i]! + 3, 585, { size: 9, width: 30 }),
        ),
        ...["Monday", "Tuesday"].map((d, r) =>
          txt(d, 75, ys[r + 2]! + 5, { size: 9, width: 40 }),
        ),
      ],
    });
    expect(props(p).map((x) => [x.rule, x.label])).toEqual([
      ["header-cell", "Monday Start"],
      ["header-cell", "Monday Finish"],
      ["header-cell", "Tuesday Start"],
      ["header-cell", "Tuesday Finish"],
    ]);
    expect(grid(p)).toBe(4);
  });

  it("a square, or a rule, inside a right cell keeps it a table", () => {
    expect(props(table({ rects: [rect(300, 580, 10, 10)] }))).toEqual([]);
    expect(props(table({ segs: [hseg(200, 380, 564)] }))).toEqual([]);
  });

  it("the middle plumb line must run the whole height of the grid", () => {
    const short = table({
      plumbs: [vseg(72, 504, 600), vseg(180, 528, 600), vseg(400, 504, 600)],
    });
    expect(props(short)).toEqual([]);
  });

  it("plumb lines drawn cell by cell (one piece a row) are one line", () => {
    const ys = [600, 576, 552, 528, 504];
    const pieces = ys
      .slice(1)
      .flatMap((y, i) => [72, 180, 400].map((x) => vseg(x, y, ys[i]!)));
    expect(cells(table({ plumbs: pieces }))).toEqual(LABELS);
  });

  // Review round 6 test honesty, cost finding 1: the plumb-line question
  // was rewritten to answer many pairs at one x (gathered and sorted once,
  // a prefix maximum, a binary search). Every edge of the old walk is
  // pinned here, each one through a table: mutants of the eps at each end,
  // the running maximum, and the prefix were green on the suite before.
  describe("plumb lines join two rules within GRID_TOUCH_EPS (1) at every edge", () => {
    /** The label table, its left border drawn as `left`. */
    const bordered = (left: CardSeg[], segs: CardSeg[] = []) =>
      cells(
        table({
          plumbs: [...left, vseg(180, 504, 600), vseg(400, 504, 600)],
          segs,
        }),
      );

    it("a border 1 pt off the rules' end joins them; 1.1 pt off does not", () => {
      expect(bordered([vseg(73, 504, 600)])).toEqual(LABELS);
      expect(bordered([vseg(73.1, 504, 600)])).toEqual([]);
    });

    // The pieces that start by the lower rule (within the eps) are found
    // by a binary search. With the lower rule's own y in the walk, a search
    // that counted too few gave the same answers, and its boundary moved
    // (`<` for `<=`, no eps, or twice the eps) with every test green. A
    // border starting over the BOTTOM rule has no piece under it to join
    // through, so only the search can join it.
    it("a border starting 1 pt over the bottom rule reaches it; 1.1 pt over does not", () => {
      expect(bordered([vseg(72, 505, 600)])).toEqual(LABELS);
      expect(bordered([vseg(72, 504.5, 600)])).toEqual(LABELS);
      expect(bordered([vseg(72, 505.1, 600)])).toEqual([
        "Name",
        "Address",
        "Telephone",
      ]);
      expect(bordered([vseg(72, 505.9, 600)])).toEqual([
        "Name",
        "Address",
        "Telephone",
      ]);
      // And the Email row is no table at all: a search counting twice the
      // eps joined it, and its cell went out as a duplicate.
      for (const y of [505.1, 505.9]) {
        const p = table({
          plumbs: [vseg(72, y, 600), vseg(180, 504, 600), vseg(400, 504, 600)],
        });
        expect(
          run(p).excluded.map((e) => e.rule),
          String(y),
        ).toEqual([
          "table-grid",
          "table-grid",
          "table-grid",
          "table-grid",
          "no-clearance",
        ]);
      }
    });

    // Regression verify after review round 6 (mutant PC10): the reach of
    // no pieces at all is minus infinity, not 0. Seeded with 0, a border
    // that misses the bottom rule joined it whenever the rules lay under
    // y 0 (a table drawn below the crop box, every field off the page).
    it("below y 0, a border starting 1.1 pt over the bottom rule still misses it", () => {
      const below = (y: number) => {
        const p = table({
          plumbs: [vseg(72, y, 600), vseg(180, 504, 600), vseg(400, 504, 600)],
        });
        const dy = -1000;
        return run({
          ...p,
          segs: p.segs.map((s) => ({ ...s, y0: s.y0 + dy, y1: s.y1 + dy })),
          text: p.text.map((t) => ({ ...t, y: t.y + dy })),
        }).excluded.filter((e) => e.rule === "off-page").length;
      };
      expect(below(504)).toBe(4);
      expect(below(505.1)).toBe(3);
    });

    it("a border broken by 1 pt mid-row is one line; by 1.1 pt the table splits there", () => {
      // The break is in the Telephone row (528 to 552): split, only the
      // two rows over it are a table.
      expect(bordered([vseg(72, 504, 539.5), vseg(72, 540.5, 600)])).toEqual(
        LABELS,
      );
      expect(bordered([vseg(72, 504, 539.5), vseg(72, 540.6, 600)])).toEqual([
        "Name",
        "Address",
      ]);
    });

    it("a border stopping 1 pt short of the top rule reaches it; 1.1 pt short does not", () => {
      expect(bordered([vseg(72, 504, 599)])).toEqual(LABELS);
      expect(bordered([vseg(72, 504, 598.9)])).toEqual([
        "Address",
        "Telephone",
        "Email",
      ]);
    });

    it("a border drawn in overlapping pieces, one inside another, is one line", () => {
      expect(
        bordered([
          vseg(72, 504, 530),
          vseg(72, 529.8, 560),
          vseg(72, 535, 540),
          vseg(72, 560, 600),
        ]),
      ).toEqual(LABELS);
    });

    it("a whole border with a short tick at its foot is still a whole border", () => {
      expect(bordered([vseg(72, 504, 600), vseg(72, 505, 506)])).toEqual(
        LABELS,
      );
    });

    // Two rules within 1 pt of each other are joined whatever is drawn
    // between them: a top rule doubled 0.8 pt over itself makes a fifth,
    // thin row with no label, and the table is lost. Pinned as it stands
    // (the rewrite keeps the old walk's answer: a reach starting at the
    // lower rule already meets the upper), with a border ending under the
    // pair so that only the starting reach can join them.
    it("KNOWN MISS: a top rule doubled 0.8 pt over itself loses the table (a thin row with no label)", () => {
      expect(bordered([vseg(72, 504, 599.5)], [hseg(72, 400, 600.8)])).toEqual(
        [],
      );
      // Control: not doubled, the same border is a table.
      expect(bordered([vseg(72, 504, 599.5)])).toEqual(LABELS);
    });
  });

  it("two such tables at one margin, apart, are each a form", () => {
    const lower = pg({
      segs: [
        ...[400, 376, 352].map((y) => hseg(72, 400, y)),
        ...[72, 180, 400].map((x) => vseg(x, 352, 400)),
      ],
      text: [
        txt("Referee", 76, 384, { size: 10, width: 35 }),
        txt("Phone", 76, 360, { size: 10, width: 25 }),
      ],
    });
    const both = pg({
      segs: [...table().segs, ...lower.segs],
      text: [...table().text, ...lower.text],
    });
    expect(cells(both)).toEqual([...LABELS, "Referee", "Phone"]);
  });
});

describe("underscore-run", () => {
  const runItem = (str: string, width: number, o: Partial<CardText> = {}) =>
    pg({ text: [txt(str, 100, 600, { width, ...o })] });

  it("UNDERSCORE_MIN: four underscores are a run, three are not", () => {
    expect(props(runItem("____", 40))).toHaveLength(1);
    const three = run(runItem("___", 40));
    expect(three.proposals).toEqual([]);
    expect(three.counts.candidates).toBe(0);
  });

  it("reads full-width underscores (U+FF3F) too", () => {
    const fw = String.fromCodePoint(0xff3f).repeat(4);
    expect(props(runItem(fw, 40))).toHaveLength(1);
  });

  it("MIN_FIELD_W: 24 pt after the inset is a field, 23.9 pt is short-run", () => {
    expect(props(runItem("____", 26))).toEqual([
      expect.objectContaining({ width: 24 }),
    ]);
    expect(firstRule(runItem("____", 25.9))).toBe("short-run");
  });

  it("FIELD_INSET / RUN_BOTTOM_EMS / TEXT_H_RUN: the box over a run", () => {
    // Baseline 601.8 at size 12: bottom = 601.8 - 1.8 = 600; height 14.4.
    const p = props(pg({ text: [txt("____", 100, 601.8, { width: 40 })] }))[0]!;
    expect(p).toMatchObject({ x: 101, y: 600, width: 38, height: 14 });
  });

  it("TEXT_H_RUN: clamp(1.2 x size, 12, 22)", () => {
    const h = (size: number) =>
      props(
        pg({
          text: [txt("____", 100, 600 + 0.15 * size, { width: 60, size })],
        }),
      )[0]!.height;
    expect(h(5)).toBe(12);
    expect(h(15)).toBe(18);
    expect(h(20)).toBe(22);
  });

  it("takes the words before it in the same item as its label", () => {
    const p = props(
      pg({
        text: [txt("Date ________ Place ________", 72, 650, { width: 200 })],
      }),
    );
    expect(p.map((x) => x.label)).toEqual(["Date", "Place"]);
  });

  it("RUN_BASELINE_EMS: a label item within 0.3 em of the run's baseline counts", () => {
    const at = (dy: number) =>
      pg({
        text: [
          txt("Name:", 60, 600 + dy, { width: 30 }),
          txt("________", 100, 600, { width: 60 }),
        ],
      });
    expect(props(at(3.6))[0]?.label).toBe("Name");
    expect(props(at(3.7))[0]?.label).toBeNull();
  });

  it("LABEL_LEFT_GAP: a run's label item ending 24 pt left counts, 24.1 does not", () => {
    const at = (right: number) =>
      pg({
        text: [
          txt("Name:", right - 30, 600, { width: 30 }),
          txt("________", 100, 600, { width: 60 }),
        ],
      });
    expect(props(at(76))[0]?.label).toBe("Name");
    expect(props(at(75.9))[0]?.label).toBeNull();
  });

  it("a run with no label is still proposed (underscores are a field on their own)", () => {
    expect(props(runItem("________", 60))[0]).toMatchObject({ label: null });
  });

  // Each text item filtered every piece on the page to find its own:
  // quadratic in text items, which nothing caps (2.2 s for a page of 20,000
  // items through the reader; review finding).
  //
  // First pinned as 20,001 items in `< 300` ms ("measured before: about
  // 1.5 s; after: well under 100 ms"), a wall-clock bound (see
  // interleavedBest). Now the SHAPE: 8 times the items must cost far less
  // than 64 times (each item filtering every piece). First 2,500 items
  // against 20,000, with samples of one call and the defect timed alone:
  // fixed 8.59 to 11.9, `all.filter(...)` 49.7 to 54.4 (bound 28). But the
  // small page took 2 to 5 ms, about one scheduler slice, and read 14.2
  // and 17.6 under load (review of the ratio conversion, finding 10), and
  // a defect at half the cost, each item scanning `all` from its start
  // and stopping past itself, read 23.1 to 53.6, green in 2 runs of 5
  // (finding 7; R8). Now 5,000 against 40,000, so the quadratic term is
  // more of the large page, with time-boxed samples.
  // Measured in this whole file (see interleavedBest): fixed 7.53 to 9.42
  // one or 4 at a time, 7.34 to 12.60 under the pinned loads; with
  // `byItem.get(item)` written `all.filter((pc) => pc.item === item)`
  // 50.63 to 51.85; with the half-cost scan 50.54 to 52.87 (both one at a
  // time only: 8 to 14 minutes a run, as every page of many items pays
  // it). The bound, 28, is 2.2x over the worst fixed and 1.8x under the
  // lowest defect.
  it("finds each item's pieces in one pass, not one scan per item", () => {
    const page = (n: number) => {
      const text: CardText[] = [];
      for (let k = 0; k < n; k++)
        text.push(
          txt("ab", 10 + (k % 75) * 8, 10 + Math.floor(k / 75) * 2.9, {
            size: 2,
            width: 2,
          }),
        );
      text.push(txt("Name: ________", 10, 1580, { size: 2, width: 40 }));
      return pg({ height: 1592, text });
    };
    const few = page(5_000);
    const many = page(40_000);
    const [small, large] = interleavedBest([
      () => run(few).counts.candidates,
      () => run(many).counts.candidates,
    ]);
    // Health: the one run among them is still found, at both sizes.
    expect(small!.got).toBe(1);
    expect(large!.got).toBe(1);
    expectRatioUnder("each item's pieces in one pass", large!, small!, 28);
  }, 60_000);
});

describe("UNDERSCORE_EMS: placing a run inside its item", () => {
  it("known family: underscores at the family's width, the rest share what is left", () => {
    // Helvetica-like: "Name: " is 38.676 at 12 pt, each "_" 6.672.
    const t = txt("Name: ____", 72, 700, {
      width: 38.676 + 4 * 6.672,
      family: "sans-serif",
    });
    const spans = charSpans(t);
    expect(spans[6]![0]).toBeCloseTo(72 + 38.676, 6);
    expect(spans[9]![1]).toBeCloseTo(t.x + t.width, 6);
  });

  it("monospace: every character the same width", () => {
    const t = txt("ab: ____", 0, 0, { width: 80, family: "monospace" });
    expect(charSpans(t).map(([a, b]) => b - a)).toEqual(Array(8).fill(10));
  });

  it("unknown family: weights 0.5 / 0.278 / 0.5, scaled to the item's width", () => {
    const t = txt("a ____", 0, 0, { width: 2.778 });
    const spans = charSpans(t);
    expect(spans[0]![1]).toBeCloseTo(0.5, 6);
    expect(spans[1]![1] - spans[1]![0]).toBeCloseTo(0.278, 6);
  });

  it("falls back to scaling when the underscores alone would overflow the item", () => {
    const t = txt("a ____", 0, 0, { width: 10, family: "serif" }); // 4 x 6 > 10
    const spans = charSpans(t);
    expect(spans.at(-1)![1]).toBeCloseTo(10, 6);
  });
});

describe("square-checkbox", () => {
  const box = (s: number, o: Partial<CardRect> = {}, hh = s) =>
    pg({
      rects: [rect(72, 500, s, hh, o)],
      text: [txt("Yes", 72 + s + 6, 502, { size: 10, width: 15 })],
    });

  it("proposes the square inset by 1 pt, labelled from its right", () => {
    expect(props(box(12))).toEqual([
      expect.objectContaining({
        type: "checkbox",
        label: "Yes",
        x: 73,
        y: 501,
        width: 10,
        height: 10,
      }),
    ]);
  });

  it("SQUARE_MIN / SQUARE_MAX: 6 to 20 pt a side", () => {
    expect(props(box(6))).toHaveLength(1);
    expect(props(box(5.9))).toHaveLength(0);
    expect(props(box(20))).toHaveLength(1);
    expect(props(box(20.1))).toHaveLength(0);
  });

  it("SQUARE_SKEW: sides within 20% of the larger", () => {
    expect(props(box(10, {}, 8))).toHaveLength(1);
    expect(props(box(10, {}, 7.9))).toHaveLength(0);
  });

  it("LABEL_LEFT_GAP: a label starting 24 pt right of the square counts, 24.1 does not", () => {
    const at = (gap: number) =>
      pg({
        rects: [rect(72, 500, 12, 12)],
        text: [txt("Yes", 84 + gap, 502, { size: 10, width: 15 })],
      });
    expect(props(at(24))[0]?.label).toBe("Yes");
    expect(firstRule(at(24.1))).toBe("unlabelled");
  });

  // Review round 3, finding 1: the right side was searched first and the
  // left only when it found nothing, so in "Yes [] No []" the next answer
  // word (18 pt to the right) beat the box's own label (4.8 pt to its left)
  // and every Yes box was labelled "No". The nearer side wins now.
  it("a square takes the label on its NEARER side: 'Yes [] No []' and '[] Yes [] No' both read Yes, No", () => {
    const inline = pg({
      rects: [rect(402, 598, 10, 10), rect(447, 598, 10, 10)],
      text: [
        txt("Yes", 380, 600, { size: 10, width: 17.2 }),
        txt("No", 430, 600, { size: 10, width: 12.8 }),
      ],
    });
    expect(props(inline).map((p) => p.label)).toEqual(["Yes", "No"]);
    const labelRight = pg({
      rects: [rect(380, 598, 10, 10), rect(430, 598, 10, 10)],
      text: [
        txt("Yes", 394, 600, { size: 10, width: 17.2 }),
        txt("No", 444, 600, { size: 10, width: 12.8 }),
      ],
    });
    expect(props(labelRight).map((p) => p.label)).toEqual(["Yes", "No"]);
  });

  it("the nearer side: a tie keeps the right, the left 0.1 pt nearer takes the left", () => {
    const at = (left: number) =>
      pg({
        rects: [rect(100, 500, 10, 10)],
        text: [
          txt("L", 100 - left - 10, 502, { size: 10, width: 10 }),
          txt("R", 114, 502, { size: 10, width: 10 }),
        ],
      });
    expect(props(at(4))[0]?.label).toBe("R");
    expect(props(at(3.9))[0]?.label).toBe("L");
  });

  // Review round 4 (A-regressions, finding 1): the nearer side was decided
  // per square, so wherever the gap between two options was smaller than a
  // box's gap to its own label, a box took its neighbour's label. A ROW of
  // squares now reads one side for all of them when only that side gives
  // every square a label of its own (both: the side nearer in sum).
  describe("a row of squares reads its labels from one side", () => {
    const labels = (p: CardPage) => props(p).map((x) => x.label);
    it("'Do you smoke? [] Yes [] No' with 4 pt between Yes and the next box reads Yes, No", () => {
      const p = pg({
        rects: [rect(150, 598, 10, 10), rect(186.2, 598, 10, 10)],
        text: [
          txt("Do you smoke?", 72, 600, { size: 10, width: 66 }),
          txt("Yes", 165, 600, { size: 10, width: 17.2 }),
          txt("No", 201.2, 600, { size: 10, width: 12.8 }),
        ],
      });
      expect(labels(p)).toEqual(["Yes", "No"]);
    });
    it("a two-column label-right list whose long left label ends 4 pt before column 2's box", () => {
      const p = pg({
        rects: [rect(72, 598, 10, 10), rect(182, 598, 10, 10)],
        text: [
          txt("High blood pressure", 88, 600, { size: 10, width: 90 }),
          txt("Heart disease", 198, 600, { size: 10, width: 60 }),
        ],
      });
      expect(labels(p)).toEqual(["High blood pressure", "Heart disease"]);
    });
    it("'Male [] Female []' with equal gaps reads Male, Female (the left side is the only complete one)", () => {
      const p = pg({
        rects: [rect(98, 558, 10, 10), rect(150, 558, 10, 10)],
        text: [
          txt("Male", 72, 560, { size: 10, width: 22 }),
          txt("Female", 112, 560, { size: 10, width: 34 }),
        ],
      });
      expect(labels(p)).toEqual(["Male", "Female"]);
    });
    it("both sides complete: the side nearer in sum wins, a tie keeps the right", () => {
      // "A [] B [] C": every box has a label on both sides. B sits 2 pt
      // from each box, so the sums are a + 2 (left) and 2 + 4 (right).
      const p = (a: number) =>
        pg({
          rects: [rect(100, 500, 10, 10), rect(124, 500, 10, 10)],
          text: [
            txt("A", 100 - a - 10, 502, { size: 10, width: 10 }),
            txt("B", 112, 502, { size: 10, width: 10 }),
            txt("C", 138, 502, { size: 10, width: 10 }),
          ],
        });
      expect(labels(p(3.9))).toEqual(["A", "B"]);
      expect(labels(p(4))).toEqual(["B", "C"]);
    });
    it("one text nearest to two boxes is no complete side: each box falls back to its nearer label", () => {
      // "Colour:" ends 4 pt before box 1 and 20 pt before box 2; "Red"
      // starts 10 pt after box 2 (26 pt after box 1, out of its reach).
      const p = pg({
        rects: [rect(100, 500, 10, 10), rect(116, 500, 10, 10)],
        text: [
          txt("Colour:", 61, 502, { size: 10, width: 35 }),
          txt("Red", 136, 502, { size: 10, width: 17 }),
        ],
      });
      expect(labels(p)).toEqual(["Colour", "Red"]);
    });
    // Review round 4 fixes, finding 17: the reader gives a label no width
    // when pdf.js gives none, so "Yes" was measured as ending where it
    // starts, tied with the "No" across the box, and the Yes box read
    // "No". The row rule reads this row from its left side in full.
    it("'Yes [] No []' with the labels' widths unknown (0) still reads Yes, No", () => {
      const p = (wYes: number, wNo: number) =>
        pg({
          rects: [rect(100, 200, 10, 10), rect(150, 200, 10, 10)],
          text: [
            txt("Yes", 80, 202, { size: 10, width: wYes }),
            txt("No", 130, 202, { size: 10, width: wNo }),
          ],
        });
      expect(labels(p(16, 14))).toEqual(["Yes", "No"]);
      expect(labels(p(0, 14))).toEqual(["Yes", "No"]);
      expect(labels(p(0, 0))).toEqual(["Yes", "No"]);
    });
  });

  // Review round 3, finding 7: a condition x Yes / No grid, or a rating
  // grid, proposed nothing (each row's text is far left, each head above),
  // and with dot leaders only the first column, named after the row alone.
  // A square in a grid whose every column has its own head is labelled
  // "<row text> <head>".
  describe("a checkbox grid with a head over each column", () => {
    const ROWS = ["Asthma", "Diabetes", "Epilepsy"];
    /** 10 pt squares at `xs` in rows from y 598 down, heads over the top. */
    const grid = (
      o: {
        rows?: string[];
        xs?: number[];
        heads?: (string | null)[];
        above?: number;
        leaders?: boolean;
        extra?: CardText[];
      } = {},
    ) => {
      const rows = o.rows ?? ROWS;
      const xs = o.xs ?? [400, 452];
      const heads = o.heads ?? ["Yes", "No"];
      return pg({
        rects: rows.flatMap((_, i) =>
          xs.map((x) => rect(x, 598 - 20 * i, 10, 10)),
        ),
        text: [
          ...rows.map((s, i) =>
            txt(o.leaders ? `${s} ....` : s, 72, 600 - 20 * i, {
              size: 10,
              width: o.leaders ? xs[0]! - 4 - 72 : 50,
            }),
          ),
          ...heads.flatMap((h, k) =>
            h === null
              ? []
              : [
                  txt(h, xs[k]! - 2, 608 + (o.above ?? 10), {
                    size: 9,
                    width: 14,
                  }),
                ],
          ),
          ...(o.extra ?? []),
        ],
      });
    };
    const labels = (p: CardPage) => props(p).map((x) => x.label);

    it("each square is labelled by its row and its column's head", () => {
      expect(labels(grid())).toEqual([
        "Asthma Yes",
        "Asthma No",
        "Diabetes Yes",
        "Diabetes No",
        "Epilepsy Yes",
        "Epilepsy No",
      ]);
    });

    it("the head is the nearest text ABOVE the column: not a note under the grid, not a group header over the heads", () => {
      const extra = [
        txt("* see notes", 398, 520, { size: 8, width: 50 }),
        txt("Answer", 396, 626, { size: 9, width: 70 }),
      ];
      expect(labels(grid({ extra }))).toEqual(labels(grid()));
    });

    it("a row whose text is turned is labelled by the head alone", () => {
      const p = grid();
      p.text = p.text.map((t) =>
        ROWS.includes(t.str) ? { ...t, upright: false } : t,
      );
      expect(labels(p)).toEqual(["Yes", "No", "Yes", "No", "Yes", "No"]);
    });

    it("with dot leaders the first column is not named after the row alone", () => {
      expect(labels(grid({ leaders: true })).slice(0, 2)).toEqual([
        "Asthma Yes",
        "Asthma No",
      ]);
    });

    // Review round 4 fixes, finding 19 (mutant G5: the row's first square
    // read as its last stayed green). It also caught this round's finding
    // 2 rule taking a word between two grid boxes as the first box's own
    // label: only a row that reads a side in full is a row of options.
    it("the row text is left of the row's FIRST square, and a word between two grid boxes is no option label", () => {
      const p = grid({ extra: [txt("or", 425, 600, { size: 10, width: 10 })] });
      expect(labels(p).slice(0, 2)).toEqual(["Asthma Yes", "Asthma No"]);
    });

    it("GRID_HEAD_ABOVE: a head 20 pt above the column's top square counts, 20.1 does not", () => {
      expect(labels(grid({ above: 20 }))).toHaveLength(6);
      expect(labels(grid({ above: 20.1 }))).toEqual([]);
      // The near edge (review round 4 fixes, finding 19, mutant G1): a
      // "head" whose baseline is level with the top square's top is no head.
      expect(labels(grid({ above: 0 }))).not.toContain("Asthma Yes");
      expect(labels(grid({ above: 0.1 }))).toContain("Asthma Yes");
      // KNOWN MISS (review round 4 fixes, finding 9): a head row set with
      // space under it (D3: heads 22 pt over the top boxes, a 20 pt row
      // pitch) proposes nothing, failing towards missing, as before round
      // 3. Reaching by the grid's own pitch would be a new rule with no
      // second bound yet; pinned for the owner.
      expect(labels(grid({ above: 22 }))).toEqual([]);
    });

    // Review round 4 fixes, finding 16: a head drawn as two text items (a
    // kerned or TJ-split "Not sure") named its column after ONE word, the
    // one first in the content stream. Every item on the head's baseline
    // over the column is joined, left to right.
    it("a head of two text items is read whole, whatever their stream order", () => {
      const not = txt("Not", 446, 618, { size: 9, width: 12 });
      const sure = txt("sure", 455, 618, { size: 9, width: 16 });
      const yes = txt("Yes", 398, 618, { size: 9, width: 14 });
      const p = (heads: CardText[]) =>
        pg({
          rects: [0, 1].flatMap((i) =>
            [400, 452].map((x) => rect(x, 598 - 20 * i, 10, 10)),
          ),
          text: [
            txt("Asthma", 72, 600, { size: 10, width: 50 }),
            txt("Diabetes", 72, 580, { size: 10, width: 50 }),
            ...heads,
          ],
        });
      const want = [
        "Asthma Yes",
        "Asthma Not sure",
        "Diabetes Yes",
        "Diabetes Not sure",
      ];
      expect(labels(p([yes, not, sure]))).toEqual(want);
      expect(labels(p([yes, sure, not]))).toEqual(want);
      // GRID_ROW_EPS: a second item 2 pt off the head's baseline joins it,
      // 2.1 pt off does not (the nearer one is the head alone).
      const off = (dy: number) => ({ ...sure, y: 618 + dy });
      expect(labels(p([yes, not, off(2)]))[1]).toBe("Asthma Not sure");
      expect(labels(p([yes, not, off(2.1)]))[1]).toBe("Asthma Not");
    });

    it("every column needs a head of its own: one missing, or one text over both, is no grid", () => {
      expect(labels(grid({ heads: ["Yes", null] }))).toEqual([]);
      expect(
        labels(
          grid({
            heads: [],
            extra: [txt("Tick one box", 396, 618, { size: 9, width: 70 })],
          }),
        ),
      ).toEqual([]);
    });

    // Review round 5 fixes, finding 15 (mutant GH3), decided under the
    // brief's delegation: the docblock said one text across two columns
    // is no grid, but only each head's LEFTMOST item was compared, so
    // "Not" (over column 1) + "sure" (over both) gave "Pain Not sure" and
    // "Pain sure". Every item of a head is now its own: a text shared by
    // two columns' heads makes the row no grid.
    it("a head item shared by two columns makes no grid ('Not' + 'sure' across both)", () => {
      const p = (sureW: number) =>
        pg({
          rects: [0, 1].flatMap((i) =>
            [300, 340].map((x) => rect(x, 600 - 20 * i, 12, 12)),
          ),
          text: [
            txt("Pain", 72, 602, { size: 10, width: 20 }),
            txt("Nausea", 72, 582, { size: 10, width: 30 }),
            txt("Not", 290, 616, { size: 9, width: 14 }),
            txt("sure", 305, 616, { size: 9, width: sureW }),
          ],
        });
      expect(labels(p(40)).filter((s) => /Not|sure/.test(s ?? ""))).toEqual([]);
      // Control: "sure" short of the second column, and a head of its own
      // over it, is a grid.
      const q = p(16);
      q.text.push(txt("No", 342, 616, { size: 9, width: 10 }));
      expect(labels(q)[0]).toBe("Pain Not sure");
    });

    // KNOWN MISS (regression verify after review round 6): a head row the
    // grid cannot resolve drops the grid's squares as unlabelled, where
    // round 3 (7316a543) proposed every one (with the split head's words
    // as names: "Pain Not", "Pain sure"). One head item over two columns
    // (above), and group heads set 2 pt over the Yes / No row (within
    // GRID_ROW_EPS, so read as part of it, each over two columns). Falling
    // back to the row text alone would name two boxes alike in every grid
    // whose heads collide, which round 5 (finding 15) decided against;
    // that is a product decision, not a narrow fix.
    it("KNOWN MISS: a head row whose items each lie over two columns leaves every square unlabelled", () => {
      const gh3 = pg({
        rects: [300, 340].flatMap((x) =>
          [500, 480].map((y) => rect(x, y, 10, 10)),
        ),
        text: [
          txt("Not", 290, 515, { size: 9, width: 14 }),
          txt("sure", 305, 515, { size: 9, width: 40 }),
          txt("Pain", 200, 501, { size: 10, width: 20 }),
          txt("Fever", 200, 481, { size: 10, width: 25 }),
        ],
      });
      expect(props(gh3)).toEqual([]);
      expect(run(gh3).excluded.map((e) => e.rule)).toEqual(
        Array(4).fill("unlabelled"),
      );
      const xs = [300, 330, 380, 410];
      const eyes = (groupY: number) =>
        pg({
          rects: [0, 1].flatMap((i) =>
            xs.map((x) => rect(x, 600 - 20 * i, 12, 12)),
          ),
          text: [
            txt("Left eye", 305, groupY, { size: 9, width: 34 }),
            txt("Right eye", 383, groupY, { size: 9, width: 38 }),
            ...xs.map((x, k) =>
              txt(k % 2 ? "No" : "Yes", x + 1, 616, { size: 9, width: 12 }),
            ),
            txt("Redness", 72, 602, { size: 10, width: 40 }),
            txt("Itching", 72, 582, { size: 10, width: 36 }),
          ],
        });
      expect(props(eyes(618))).toEqual([]);
      expect(run(eyes(618)).excluded.map((e) => e.rule)).toEqual(
        Array(8).fill("unlabelled"),
      );
      // The control: group heads well over the row name every box.
      expect(labels(eyes(640))[0]).toBe("Redness Left eye Yes");
    });

    it("an option list in two columns under an instruction keeps its own labels", () => {
      const p = pg({
        rects: [0, 1].flatMap((i) =>
          [72, 200].map((x) => rect(x, 598 - 20 * i, 10, 10)),
        ),
        text: [
          txt("Interests:", 72, 618, { size: 10, width: 48 }),
          ...[
            ["Music", 86, 600],
            ["Sports", 214, 600],
            ["Reading", 86, 580],
            ["Travel", 214, 580],
          ].map(([s, x, y]) =>
            txt(s as string, x as number, y as number, { size: 10, width: 30 }),
          ),
        ],
      });
      expect(labels(p)).toEqual(["Music", "Sports", "Reading", "Travel"]);
    });

    // Review round 4 fixes, finding 2: two option lists set side by side,
    // each under its own heading (or under an instruction drawn as two text
    // items), passed for a headed grid, and every box was labelled with the
    // heading instead of its own option. A square with its own upright
    // label on its right is no grid cell.
    it("two headed option lists side by side keep their own labels", () => {
      const p = (heads: [string, number][]) =>
        pg({
          rects: [0, 1, 2].flatMap((i) =>
            [72, 300].map((x) => rect(x, 594 - 18 * i, 10, 10)),
          ),
          text: [
            ...heads.map(([s, x]) => txt(s, x, 612, { size: 10, width: 60 })),
            ...[
              ["Fever", "Insulin"],
              ["Cough", "Inhaler"],
              ["Headache", "Aspirin"],
            ].flatMap(([a, b], i) => [
              txt(a!, 88, 596 - 18 * i, { size: 10, width: 40 }),
              txt(b!, 316, 596 - 18 * i, { size: 10, width: 40 }),
            ]),
          ],
        });
      const own = [
        "Fever",
        "Insulin",
        "Cough",
        "Inhaler",
        "Headache",
        "Aspirin",
      ];
      expect(
        labels(
          p([
            ["Symptoms", 72],
            ["Medication", 300],
          ]),
        ),
      ).toEqual(own);
      expect(
        labels(
          p([
            ["Which of these have you had?", 72],
            ["(tick all that apply)", 300],
          ]),
        ),
      ).toEqual(own);
      // The mirror: each option LEFT of its box, under its heading.
      const mirror = pg({
        rects: [0, 1].flatMap((i) =>
          [140, 368].map((x) => rect(x, 594 - 18 * i, 10, 10)),
        ),
        text: [
          txt("Symptoms", 96, 612, { size: 10, width: 60 }),
          txt("Medication", 324, 612, { size: 10, width: 60 }),
          ...[
            ["Fever", "Insulin"],
            ["Cough", "Inhaler"],
          ].flatMap(([a, b], i) => [
            txt(a!, 96, 596 - 18 * i, { size: 10, width: 40 }),
            txt(b!, 324, 596 - 18 * i, { size: 10, width: 40 }),
          ]),
        ],
      });
      expect(labels(mirror)).toEqual(["Fever", "Insulin", "Cough", "Inhaler"]);
    });

    it("a grid needs two squares in each row and in each column", () => {
      // One column of squares under a head is no grid ...
      // INVERTED in review round 4 fixes (finding 23). This expected []
      // for one "Tick" column with the row names far left: a ruled fee
      // table's "Select" column proposed none of its checkboxes. Such a
      // column (2+ equal squares, each alone on its row, none labelled)
      // now takes each row's first text, so it is a checklist, not a grid.
      expect(labels(grid({ xs: [400], heads: ["Tick"] }))).toEqual([
        "Asthma",
        "Diabetes",
        "Epilepsy",
      ]);
      // ... nor is one row of squares under heads.
      expect(labels(grid({ rows: ["Asthma"] }))).toEqual([]);
    });

    describe("a column of unlabelled boxes, one a row, takes each row's first text", () => {
      it("the row's FIRST text, not a price nearer the box", () => {
        const p = pg({
          rects: [0, 1].map((i) => rect(494, 520 - 20 * i, 12, 12)),
          text: [
            ...["Full delegate", "Student"].map((s, i) =>
              txt(s, 75, 525 - 20 * i, { size: 9, width: 60 }),
            ),
            ...["$450", "$200"].map((s, i) =>
              txt(s, 283, 525 - 20 * i, { size: 9, width: 20 }),
            ),
          ],
        });
        expect(labels(p)).toEqual(["Full delegate", "Student"]);
      });

      // Review round 5 fixes, finding 3: in a numbered list the row's
      // first text is its number, and the boxes were named "1" to "3". A
      // label names something; a row number names a position.
      it("the row's first text WITH A LETTER: a numbered checklist's boxes take their items, not their numbers", () => {
        const items = ["Passport", "Tickets", "Charger"];
        const p = pg({
          rects: items.map((_, i) => rect(405, 619 - 20 * i, 9, 9)),
          text: items.flatMap((s, i) => [
            txt(`${i + 1}`, 72, 620 - 20 * i, { size: 10, width: 6 }),
            txt(s, 110, 620 - 20 * i, { size: 10, width: 40 }),
          ]),
        });
        expect(labels(p)).toEqual(items);
      });

      // The letter filter above made the prices in the test before it
      // unreadable as labels, so taking the NEAREST lettered text instead
      // of the first stayed green (mutant f23-nearest, rerun in round 5).
      it("the row's FIRST lettered text, not a lettered note nearer the box", () => {
        const p = pg({
          rects: [0, 1].map((i) => rect(494, 520 - 20 * i, 12, 12)),
          text: [
            ...["Full delegate", "Student"].map((s, i) =>
              txt(s, 75, 525 - 20 * i, { size: 9, width: 60 }),
            ),
            ...["incl. lunch", "no lunch"].map((s, i) =>
              txt(s, 283, 525 - 20 * i, { size: 9, width: 45 }),
            ),
          ],
        });
        expect(labels(p)).toEqual(["Full delegate", "Student"]);
      });

      // Review round 6 fixes, finding 5: with an item-code column (Code |
      // Item | Returned) the boxes were named "A1", "B7": a code holds a
      // letter. A code names a position too: one word of letters and
      // digits, with a digit in it, is skipped. A one-character word is
      // still a label ("Y", or a CJK item), and so is a phrase with a
      // number in it.
      it("the row's first lettered text that is no item code: a code column's boxes take their items", () => {
        const page = (rows: [string, string][]) =>
          pg({
            rects: rows.map((_, i) => rect(415, 667 - 18 * i, 9, 9)),
            text: rows.flatMap(([code, item], i) => [
              txt(code, 72, 668 - 18 * i, { size: 10, width: 12 }),
              txt(item, 120, 668 - 18 * i, { size: 10, width: 40 }),
            ]),
          });
        expect(
          labels(
            page([
              ["A1", "Laptop"],
              ["B7", "Badge"],
              ["12a", "Headset"],
            ]),
          ),
        ).toEqual(["Laptop", "Badge", "Headset"]);
        // Not codes: a one-letter word, a phrase with a number in it, and
        // a one-character CJK word (U+7537, "male").
        const cjk = String.fromCodePoint(0x7537);
        expect(
          labels(
            page([
              ["Y", "Laptop"],
              ["Form 7", "Badge"],
              [cjk, "Headset"],
            ]),
          ),
        ).toEqual(["Y", "Form 7", cjk]);
        // A row whose only lettered text is a code keeps the code ("7" is
        // no label: it holds no letter).
        expect(
          labels(
            page([
              ["7", "B7"],
              ["A1", "Laptop"],
            ]),
          ),
        ).toEqual(["B7", "Laptop"]);
      });

      /** Squares at (400, 600) and (400, 570), "Item one" / "Item two" at 72. */
      const items = (extra: Partial<CardPage> = {}) =>
        pg({
          rects: [rect(400, 600, 12, 12), rect(400, 570, 12, 12)],
          text: [
            txt("Item one", 72, 602, { size: 10, width: 40 }),
            txt("Item two", 72, 572, { size: 10, width: 40 }),
          ],
          ...extra,
        });

      // Review round 5 fixes, finding 12: upright text only (mutant CL2: a
      // turned margin note left of the row named its box).
      it("the row's first UPRIGHT text: a turned margin note further left is passed over", () => {
        const p = items();
        p.text.push(
          txt("SIDE", 40, 572, { size: 10, width: 20, upright: false }),
        );
        expect(labels(p)).toEqual(["Item one", "Item two"]);
      });

      // Review round 5 fixes, finding 15 (mutant CL3): squares within
      // COMB_EPS of a row's first bottom share it, so a box 1 pt off row
      // two makes its square no longer alone; 1.1 pt off is a row of its
      // own.
      it("COMB_EPS: a box 1 pt off a checklist row shares it (no labels), 1.1 pt off does not", () => {
        const third = (dy: number) => {
          const p = items();
          p.rects.push(rect(450, 570 + dy, 12, 12));
          return p;
        };
        expect(labels(third(1))).not.toContain("Item two");
        expect(labels(third(1.1))).toContain("Item two");
      });

      it("each box must be alone on its row: a headless two-column grid stays unlabelled", () => {
        expect(labels(grid({ heads: [] }))).toEqual([]);
      });

      it("a column needs two boxes: one far from its row's text stays unlabelled", () => {
        expect(
          labels(grid({ xs: [400], heads: [], rows: ["Asthma"] })),
        ).toEqual([]);
      });

      it("a column where any box found a label of its own is left as it is", () => {
        const p = grid({
          xs: [400],
          heads: [],
          extra: [txt("Yes", 414, 600, { size: 9, width: 14 })],
        });
        // The first box reads "Yes"; the others stay unlabelled.
        expect(labels(p)).toEqual(["Yes"]);
      });
    });

    // Review round 4 fixes, finding 7: with COMB_MIN 2, a headed Yes / No
    // grid whose two boxes in a row are drawn 1 pt apart was read as a
    // row of digit boxes and excluded as comb. A square that takes its
    // grid label is no comb.
    it("a headed grid whose boxes adjoin is a grid, not a comb", () => {
      const p = (heads: boolean) =>
        pg({
          rects: [0, 1].flatMap((i) =>
            [400, 413].map((x) => rect(x, 598 - 18 * i, 12, 12)),
          ),
          text: [
            txt("Married", 72, 600, { size: 10, width: 36 }),
            txt("Employed", 72, 582, { size: 10, width: 44 }),
            ...(heads
              ? [
                  txt("Y", 403, 616, { size: 9, width: 6 }),
                  txt("N", 416, 616, { size: 9, width: 6 }),
                ]
              : []),
          ],
        });
      expect(labels(p(true))).toEqual([
        "Married Y",
        "Married N",
        "Employed Y",
        "Employed N",
      ]);
      // Without heads they are combs still.
      expect(labels(p(false))).toEqual([]);
      expect(run(p(false)).excluded.map((e) => e.rule)).toEqual([
        "comb",
        "comb",
        "comb",
        "comb",
      ]);
    });

    // Review round 5 fixes, finding 6a: a two-level grid ("Left eye |
    // Right eye" over "Yes No | Yes No") named each box twice ("Redness
    // Yes", "Redness No", "Redness Yes", "Redness No"). Repeated heads take
    // the group head over their column, when that makes them distinct.
    it("a two-level grid: repeated heads take their group head (Redness Left eye Yes)", () => {
      const xs = [300, 330, 380, 410];
      const p = (groups: boolean, groupY = 640) =>
        pg({
          rects: [0, 1].flatMap((i) =>
            xs.map((x) => rect(x, 600 - 20 * i, 12, 12)),
          ),
          text: [
            ...(groups
              ? [
                  txt("Left eye", 305, groupY, { size: 9, width: 34 }),
                  txt("Right eye", 383, groupY, { size: 9, width: 38 }),
                ]
              : []),
            ...xs.map((x, k) =>
              txt(k % 2 ? "No" : "Yes", x + 1, 616, { size: 9, width: 12 }),
            ),
            txt("Redness", 72, 602, { size: 10, width: 40 }),
            txt("Itching", 72, 582, { size: 10, width: 36 }),
          ],
        });
      expect(labels(p(true))).toEqual([
        "Redness Left eye Yes",
        "Redness Left eye No",
        "Redness Right eye Yes",
        "Redness Right eye No",
        "Itching Left eye Yes",
        "Itching Left eye No",
        "Itching Right eye Yes",
        "Itching Right eye No",
      ]);
      // 2 x GRID_HEAD_ABOVE over the top square (612): 652 counts, 652.1
      // does not, and without group heads the names stay as they were.
      expect(labels(p(true, 652))[0]).toBe("Redness Left eye Yes");
      expect(labels(p(true, 652.1))[0]).toBe("Redness Yes");
      expect(labels(p(false))[0]).toBe("Redness Yes");
    });

    // Review round 6 test honesty: three conditions of the group-head
    // search had no test, and each mutant stayed green: the NEAREST text
    // over the head row (G5, the farthest taken instead), every column
    // having a group (G6, the guard dropped), and an upright group head
    // (G10, turned text taken).
    describe("a two-level grid's group heads: the nearest, upright, over every column", () => {
      const xs = [300, 330, 380, 410];
      const eyes = [
        txt("Left eye", 305, 630, { size: 9, width: 34 }),
        txt("Right eye", 383, 630, { size: 9, width: 38 }),
      ];
      const p = (groups: CardText[], more: CardText[] = []) =>
        pg({
          rects: [0, 1].flatMap((i) =>
            xs.map((x) => rect(x, 600 - 20 * i, 12, 12)),
          ),
          text: [
            ...groups,
            ...more,
            ...xs.map((x, k) =>
              txt(k % 2 ? "No" : "Yes", x + 1, 616, { size: 9, width: 12 }),
            ),
            txt("Redness", 72, 602, { size: 10, width: 40 }),
            txt("Itching", 72, 582, { size: 10, width: 36 }),
          ],
        });

      it("a section title over both group heads (within 2 x GRID_HEAD_ABOVE) does not displace the nearer group head", () => {
        const title = txt("Eye examination", 300, 646, {
          size: 11,
          width: 130,
        });
        expect(labels(p(eyes, [title])).slice(0, 4)).toEqual([
          "Redness Left eye Yes",
          "Redness Left eye No",
          "Redness Right eye Yes",
          "Redness Right eye No",
        ]);
      });

      it("a group head over only some columns names no box: the heads stay as they were", () => {
        const got = labels(p([eyes[1]!]));
        expect(got[0]).toBe("Redness Yes");
        expect(got.filter((l) => /undefined/.test(l ?? ""))).toEqual([]);
      });

      // Mutant G7 (the distinct check dropped) stayed green too: group
      // heads that leave two names alike are not read at all.
      it("group heads that leave two names alike are not read: Left eye over three columns", () => {
        const wide = [
          txt("Left eye", 300, 630, { size: 9, width: 95 }),
          txt("Right eye", 410, 630, { size: 9, width: 12 }),
        ];
        expect(labels(p(wide)).slice(0, 4)).toEqual([
          "Redness Yes",
          "Redness No",
          "Redness Yes",
          "Redness No",
        ]);
      });

      // Mutant G4 (`<` for `<=` GRID_ROW_EPS) stayed green: a raised mark
      // 2 pt over a head is in the head row, never a group head; 2.1 pt
      // over it is the nearest text over the head row.
      it("a mark raised GRID_ROW_EPS (2) over a head is in the head row; 2.1 pt over it is a group head", () => {
        const marked = (dy: number) =>
          labels(p(eyes, [txt("1", 309, 616 + dy, { size: 5, width: 3 })]))
            .slice(0, 4)
            .join(" | ");
        expect(marked(2)).toBe(
          "Redness Left eye Yes 1 | Redness Left eye No | Redness Right eye Yes | Redness Right eye No",
        );
        expect(marked(2.1)).toBe(
          "Redness 1 Yes | Redness Left eye No | Redness Right eye Yes | Redness Right eye No",
        );
      });

      it("turned group heads are no group heads", () => {
        expect(labels(p(eyes.map((t) => ({ ...t, upright: false }))))[0]).toBe(
          "Redness Yes",
        );
      });
    });

    // Review round 5 fixes, finding 1: the exemption above made two date
    // combs under one "D D M M Y Y Y Y" head row 16 checkboxes ("Date of
    // birth D", ...). A grid's heads name distinct choices; a comb's heads
    // name character positions, which repeat. A row whose heads repeat
    // keeps the comb rule.
    it("adjoining boxes under REPEATED heads are combs: D D M M Y Y Y Y over two date combs", () => {
      const p = (heads: string) =>
        pg({
          rects: [0, 1].flatMap((i) =>
            [...heads].map((_, k) => rect(200 + 14 * k, 600 - 30 * i, 14, 14)),
          ),
          text: [
            ...[...heads].map((h, k) =>
              txt(h, 204 + 14 * k, 618, { size: 8, width: 5 }),
            ),
            txt("Date of birth", 72, 603, { size: 10, width: 60 }),
            txt("Date of arrival", 72, 573, { size: 10, width: 70 }),
          ],
        });
      expect(labels(p("DDMMYYYY"))).toEqual([]);
      const rules = run(p("DDMMYYYY")).excluded.map((e) => e.rule);
      expect(rules).toHaveLength(16);
      expect(new Set(rules)).toEqual(new Set(["comb"]));
      // One repeat is enough: a two-box comb under "D D" (COMB_MIN is 2).
      // Review round 6 test honesty: mutant R1 (a row needing two repeats)
      // stayed green.
      expect(labels(p("DD"))).toEqual([]);
      expect(run(p("DD")).excluded.map((e) => e.rule)).toEqual([
        "comb",
        "comb",
        "comb",
        "comb",
      ]);
      // Control: distinct heads over adjoining boxes are still a grid.
      expect(labels(p("YN"))).toEqual([
        "Date of birth Y",
        "Date of birth N",
        "Date of arrival Y",
        "Date of arrival N",
      ]);
    });
  });

  // Review round 3, finding 3: text inside a checkbox's square lowered its
  // top as it does a text field's, leaving a 14 x 2 "checkbox" that the
  // builder's own validation accepts. A checkbox is never resized.
  it("text inside the square is overlaps-text, never a squashed checkbox", () => {
    const p = (hint: boolean) =>
      pg({
        rects: [rect(182, 616, 16, 16)],
        text: [
          txt("Dependants", 100, 620, { size: 10, width: 76 }),
          ...(hint ? [txt("0", 187, 620, { size: 10, width: 5.6 })] : []),
        ],
      });
    expect(props(p(false))).toEqual([
      expect.objectContaining({ label: "Dependants", width: 14, height: 14 }),
    ]);
    expect(props(p(true))).toEqual([]);
    expect(firstRule(p(true))).toBe("overlaps-text");
  });

  // KNOWN MISS (review round 5 fixes, finding 6b): on a prescription pad,
  // "Substitution permitted" ends 27.3 pt left of its 9 pt box, beyond
  // LABEL_LEFT_GAP (24), and the box is unlabelled. Widening the gap
  // would let a row of options take its neighbour's word; left as is.
  it("KNOWN MISS: a box whose label ends 27.3 pt to its left stays unlabelled", () => {
    const p = (gap: number) =>
      pg({
        rects: [rect(400, 600, 9, 9)],
        text: [
          txt("Substitution permitted", 72, 602, {
            size: 10,
            width: 400 - gap - 72,
          }),
        ],
      });
    expect(props(p(27.3))).toEqual([]);
    expect(firstRule(p(27.3))).toBe("unlabelled");
    expect(props(p(24))[0]?.label).toBe("Substitution permitted");
  });

  it("the nearer side counts upright text only: a nearer turned word does not beat an upright label", () => {
    const p = pg({
      rects: [rect(100, 500, 10, 10)],
      text: [
        txt("L", 88, 502, { size: 10, width: 10, upright: false }),
        txt("R", 120, 502, { size: 10, width: 10 }),
      ],
    });
    expect(props(p)[0]?.label).toBe("R");
  });

  // A square drawn as four separate stroked lines (generated forms do this)
  // was neither proposed nor excluded: each edge was a line too short to be
  // a candidate (review finding; corpus P18). It is now joined into the
  // Rect a `re` would have given.
  describe("a square drawn as four separate lines", () => {
    // In drawing order, each edge its own `m l S`, as the finding drew it.
    // `off` moves one corner coordinate of one edge: left x and bottom end,
    // right x and both ends, top's two ends and its y (the bottom edge is
    // what the others are compared with).
    type Corner = "lx" | "ly0" | "rx" | "ry0" | "ry1" | "tx0" | "tx1" | "ty";
    const edges = (off: Partial<Record<Corner, number>> = {}): CardSeg[] => {
      const d = (k: Corner) => off[k] ?? 0;
      return [
        hseg(72, 84, 500),
        vseg(84 + d("rx"), 500 + d("ry0"), 512 + d("ry1")),
        hseg(84 + d("tx1"), 72 + d("tx0"), 512 + d("ty")),
        vseg(72 + d("lx"), 512, 500 + d("ly0")),
      ];
    };
    const four = (e: CardSeg[], label = true) =>
      pg({
        segs: e,
        text: label ? [txt("Yes", 90, 502, { size: 10, width: 15 })] : [],
      });

    it("is proposed exactly as the same square drawn with `re`", () => {
      expect(props(four(edges()))).toEqual(props(box(12)));
      expect(props(four(edges()))).toHaveLength(1);
    });

    it("unlabelled, it is explained (`unlabelled`), not silently dropped", () => {
      expect(run(four(edges(), false)).excluded.map((e) => e.rule)).toEqual([
        "unlabelled",
      ]);
    });

    // Only the top's y and the right's x were moved here once, so each of
    // the other six corner comparisons could be deleted with everything
    // green, and a square was then joined from edges 1 pt apart at a corner
    // (review finding). Every one of the eight is moved now, both ways.
    it("JOIN_EPS: each corner coordinate may be 0.5 pt off, not 0.6", () => {
      const corners: Corner[] = [
        "lx",
        "ly0",
        "rx",
        "ry0",
        "ry1",
        "tx0",
        "tx1",
        "ty",
      ];
      for (const k of corners)
        for (const s of [1, -1]) {
          expect(
            props(four(edges({ [k]: 0.5 * s }))),
            `${k} ${0.5 * s}`,
          ).toHaveLength(1);
          expect(
            props(four(edges({ [k]: 0.6 * s }))),
            `${k} ${0.6 * s}`,
          ).toEqual([]);
        }
    });

    it("three of the four edges are not a square", () => {
      expect(props(four(edges().slice(0, 3)))).toEqual([]);
    });

    // The edges tried were 12 pt only, so either end of the join's length
    // window could be narrowed with everything green, and 6 pt and 20 pt
    // checkboxes drawn as four lines were then silently lost (review
    // finding). `short` draws the bottom edge that much shorter, centred.
    it("the join window: 6 to 20 pt sides join, with JOIN_EPS of slack below", () => {
      const sized = (s: number, short = 0) =>
        pg({
          segs: [
            hseg(72 + short / 2, 72 + s - short / 2, 500),
            vseg(72 + s, 500, 500 + s),
            hseg(72 + s, 72, 500 + s),
            vseg(72, 500 + s, 500),
          ],
          text: [txt("Yes", 72 + s + 6, 502, { size: 10, width: 15 })],
        });
      expect(props(sized(6))).toHaveLength(1);
      expect(props(sized(20))).toHaveLength(1);
      // A 6 pt square's bottom edge drawn 5.5 pt long still joins (the box
      // is 6 pt from its other edges); 5.4 pt long does not.
      expect(props(sized(6, 0.5))).toHaveLength(1);
      expect(props(sized(6, 0.6))).toEqual([]);
    });

    // Two joinSquares guards were untested: skipping joined edges in
    // readLines, and joining stroked segments only (review finding).
    it("a joined square's edges are not lines too: squares on a rule leave it a field", () => {
      // Without the skip, the squares' sides were plumb lines touching the
      // rule, which turned it table-grid.
      const sq = (x: number): CardSeg[] => [
        hseg(x, x + 12, 600),
        vseg(x + 12, 600, 612),
        hseg(x + 12, x, 612),
        vseg(x, 612, 600),
      ];
      const p = labelledRule({
        segs: [hseg(130, 330, 600), ...sq(150), ...sq(200), ...sq(250)],
      });
      expect(props(p)).toEqual([expect.objectContaining({ label: "Address" })]);
      expect(run(p).excluded.map((e) => e.rule)).toEqual(
        Array(3).fill("unlabelled"),
      );
    });

    it("only stroked edges are joined: four filled `m l f` edges are no box", () => {
      // pdf.js paints nothing for a zero-area fill; joined, it was a phantom
      // checkbox (joinSquares makes every box it joins stroked).
      const fills = four(
        edges().map((s) => ({ ...s, stroked: false, filled: true })),
      );
      expect(run(fills).excluded).toEqual([]);
      expect(props(fills)).toEqual([]);
    });

    // Edges sharing a corner were paired every left with every right, each
    // pairing re-scanning the corner: cubic, so 2,400 stroked segments took
    // 12.7 s, and the cap allows 20,000 (review finding). A corner crowded
    // past JOIN_CROWD edges is no checkbox's and is left unjoined.
    it("JOIN_CROWD: 16 edges at a corner still join, 17 do not", () => {
      const crowded = (k: number) =>
        four([
          ...edges(),
          ...Array.from({ length: k - 1 }, () => vseg(72, 512, 500)),
        ]);
      expect(props(crowded(16))).toHaveLength(1);
      expect(props(crowded(17))).toEqual([]);
    });

    // First pinned as 400 triples at one corner in `< 250` ms ("measured
    // before the bound: about 900 ms; after it: a few ms"), a wall-clock
    // bound (see interleavedBest). Now the SHAPE: 4 times the edges at each
    // of 200 corners must cost far less than 64 times (every left paired
    // with every right, each pairing re-scanning the corner). 200 corners,
    // as one corner's linear cost is too short to time. First measured
    // with the defect timed alone: fixed 3.40 to 5.30, `lists.flat()` 31.3
    // to 34.1 (bound 16).
    // Measured in this whole file (see interleavedBest): fixed 3.48 to
    // 4.72 one or 4 at a time, 3.16 to 4.89 under the pinned loads;
    // without the JOIN_CROWD bound (`near` returning `lists.flat()`
    // however crowded) 30.61 to 34.44, and 33.69 to 34.43 4 at a time;
    // with `JOIN_CROWD: Infinity` 32.98 to 34.04 and 33.13 to 34.11. The
    // bound, 12, is 2.5x over the worst fixed and 2.6x under the lowest
    // defect.
    it("edges crowded at one corner cost linear time, not cubic", () => {
      const page = (n: number) => {
        const segs: CardSeg[] = [];
        for (let c = 0; c < 200; c++) {
          const x = 20 + 30 * (c % 20);
          const y = 20 + 30 * Math.floor(c / 20);
          for (let k = 0; k < n; k++)
            segs.push(
              hseg(x, x + 10, y),
              vseg(x, y, y + 10),
              vseg(x + 10, y, y + 15),
            );
        }
        return pg({ segs });
      };
      const few = page(20);
      const many = page(80);
      const [small, large] = interleavedBest([() => run(few), () => run(many)]);
      // Health: no corner makes a box (none has a top edge), at both sizes.
      for (const r of [small!.got, large!.got]) {
        expect(r.proposals).toEqual([]);
        expect(r.excluded).toEqual([]);
      }
      expectRatioUnder("edges crowded at a corner", large!, small!, 12);
    }, 60_000);
  });

  it("an unlabelled square is kept beside two labelled squares of its size", () => {
    const col = (n: number) =>
      pg({
        rects: [500, 480, 460].slice(0, n).map((y) => rect(72, y, 12, 12)),
        text: [
          txt("A", 90, 502, { size: 10 }),
          txt("B", 90, 482, { size: 10 }),
        ],
      });
    // Two labelled squares, one bare: kept.
    expect(props(col(3))).toHaveLength(3);
    // One labelled square and one bare one: the bare one is unlabelled.
    const two = pg({
      rects: [rect(72, 500, 12, 12), rect(72, 480, 12, 12)],
      text: [txt("A", 90, 502, { size: 10 })],
    });
    expect(run(two).excluded.map((e) => e.rule)).toEqual(["unlabelled"]);
  });
});

describe("exclusions, each at its boundary", () => {
  it("SIGNATURE_RE: sign / signed / signature / initials, as whole words", () => {
    for (const label of [
      "Sign",
      "Signed",
      "Signature",
      "Initials",
      "Sign here",
      // Review round 4 fixes, finding 25: the singular, alone or "here",
      // was a text field (and on a square initials box, a checkbox).
      "Initial",
      "Initial here",
      "INITIAL HERE",
    ])
      expect(
        firstRule(
          pg({ text: [txt(`${label}: ________`, 72, 600, { width: 150 })] }),
        ),
        label,
      ).toBe("signature");
    for (const label of [
      "Design",
      "Signal",
      "Assignment",
      "Initial deposit",
      "Initial amount",
      "Initially",
    ])
      expect(
        props(
          pg({ text: [txt(`${label}: ________`, 72, 600, { width: 150 })] }),
        ),
      ).toHaveLength(1);
  });

  // KNOWN MISS (review round 5 fixes, finding 6c): "Tenant initial:" is a
  // text field while "Landlord initials:" is a signature. A name word
  // before the singular cannot be allowed: "Middle initial" is the same
  // shape and is a field for one letter of a name. Invert this when the
  // detector can tell a party ("Tenant") from a name part ("Middle").
  it("KNOWN MISS: 'Tenant initial' is a field (as 'Middle initial' must stay); 'Landlord initials' a signature", () => {
    const line = (label: string) =>
      pg({ text: [txt(`${label}: ________`, 72, 600, { width: 150 })] });
    expect(props(line("Tenant initial"))).toEqual([
      expect.objectContaining({ label: "Tenant initial", type: "text" }),
    ]);
    expect(props(line("Middle initial"))).toEqual([
      expect.objectContaining({ label: "Middle initial", type: "text" }),
    ]);
    expect(firstRule(line("Landlord initials"))).toBe("signature");
  });

  // A letter's sign-off ("Yours sincerely," above a line, the printed name
  // under it) was proposed as a text field named after the signer: the
  // signature rule tested only the label, and the label was the caption
  // "John Smith" (review finding; corpus N25).
  describe("signature: a letter's sign-off", () => {
    /** A 180 pt line at y 470 captioned "John Smith", `close` at y 470 + dy. */
    const letter = (close: string | null, dy = 50, x = 72) =>
      pg({
        segs: [hseg(72, 252, 470)],
        text: [
          ...(close ? [txt(close, x, 470 + dy, { width: 80, size: 11 })] : []),
          txt("John Smith", 72, 456, { width: 55, size: 11 }),
          txt("Director", 72, 442, { width: 40, size: 11 }),
        ],
      });
    // Every alternative of SIGNOFF_RE caught by some close, and every close
    // caught by some alternative (CLAUDE.md, guards rule 1: both ways).
    const CLOSES = [
      "Yours sincerely,",
      "Sincerely,",
      "Kind regards,",
      "Yours faithfully,",
      "Yours truly,",
      "Cordially,",
      "Respectfully,",
      "On behalf of Acme Ltd,",
      "Very truly yours,",
      "Best regards,",
      "Warm regards,",
      "With kind regards,",
      "Kindest regards,",
      "Warmest regards,",
      "Signed for and on behalf of Acme Ltd",
    ];
    // The closes: the one capturing group. The lead words: the group
    // repeated before it.
    const group = (re: RegExp) =>
      (re.exec(DETECT.SIGNOFF_RE.source)?.[1] ?? "").split("|").filter(Boolean);
    const alternatives = group(/\((?!\?)([^()]*)\)/);
    const leads = group(/\(\?:([a-z|]+)\)\\s\+\)\*/);

    it("the close list and SIGNOFF_RE cover each other", () => {
      expect(alternatives.length, "SIGNOFF_RE read as empty").toBeGreaterThan(
        3,
      );
      expect(leads.length, "no lead words read").toBeGreaterThan(3);
      for (const alt of [...alternatives, ...leads])
        expect(
          CLOSES.filter((c) =>
            new RegExp(`\\b${alt.replace(/ /g, "\\s+")}\\b`, "i").test(c),
          ),
          `no close exercises "${alt}"`,
        ).not.toEqual([]);
      for (const c of CLOSES)
        expect(DETECT.SIGNOFF_RE.test(c), `"${c}" is not caught`).toBe(true);
    });

    // The close was matched ANYWHERE in its text item, so a form's
    // instruction ("... on behalf of the patient, please give your
    // details:", "You are cordially invited ...") made every caption line
    // under it a signature (review finding; corpus P21, P22). A close opens
    // its line.
    it("an instruction that only contains a close's words is not a close", () => {
      for (const s of [
        "If you are completing this form on behalf of the patient:",
        "You are cordially invited to the Annual Dinner.",
        "Please answer truly and in full.",
      ]) {
        expect(props(letter(s)), s).toEqual([
          expect.objectContaining({ label: "John Smith" }),
        ]);
      }
    });

    it("a captioned line under a close is a signature line", () => {
      for (const c of CLOSES) {
        const r = run(letter(c));
        expect(r.proposals, c).toEqual([]);
        expect(r.excluded.map((e) => e.rule)).toEqual(["signature"]);
        expect(r.counts.signatureLines).toBe(1);
      }
    });

    it("without a close it stays a captioned field", () => {
      expect(props(letter(null))).toEqual([
        expect.objectContaining({ label: "John Smith" }),
      ]);
      expect(props(letter("Thank you for your order."))).toHaveLength(1);
      expect(props(letter("Sincerity is our motto."))).toHaveLength(1);
    });

    it("SIGNOFF_ABOVE: a close 80 pt above the line counts, 80.1 pt does not", () => {
      expect(firstRule(letter("Yours sincerely,", 80))).toBe("signature");
      expect(props(letter("Yours sincerely,", 80.1))).toHaveLength(1);
    });

    // Review round 6 test honesty, cost finding 6: the close is read from
    // the baselines over the line (from the line's own y up), so a window
    // starting 1 pt higher stayed green. A close whose baseline is just
    // over the line still counts; one just under it does not.
    it("a close whose baseline is 0.5 pt over the line counts; 0.5 pt under it does not", () => {
      const on = (dy: number) =>
        pg({
          segs: [hseg(72, 252, 470)],
          text: [
            txt("Yours sincerely,", 72, 470 + dy, { width: 80, size: 2 }),
            txt("John Smith", 72, 456, { width: 55, size: 11 }),
          ],
        });
      expect(firstRule(on(0.5))).toBe("signature");
      // Regression verify after review round 6 (mutant SO1): a window
      // starting 0.5 pt over the line kept 0.5 and lost 0.3.
      expect(firstRule(on(0.3))).toBe("signature");
      expect(props(on(-0.5))).toEqual([
        expect.objectContaining({ label: "John Smith" }),
      ]);
    });

    it("a close below the line, or far to its side, does not count", () => {
      expect(props(letter("Yours sincerely,", -40))).toHaveLength(1);
      expect(props(letter("Yours sincerely,", 50, 400))).toHaveLength(1);
    });

    // A close also counts over where the line's label would be, up to
    // LABEL_LEFT_GAP_RULE left of it, but the only side test put the close
    // far to the right, so that reach could be deleted with everything
    // green, and a close set left of the line no longer counted (review
    // finding).
    it("LABEL_LEFT_GAP_RULE: a close reaching to within 36 pt left of the line counts", () => {
      // An 80 pt close whose right end is `gap` left of a line from x 130.
      const leftOf = (gap: number) =>
        pg({
          segs: [hseg(130, 330, 470)],
          text: [
            txt("Yours sincerely,", 50 - gap, 520, { width: 80, size: 11 }),
            txt("John Smith", 130, 456, { width: 55, size: 11 }),
          ],
        });
      expect(firstRule(leftOf(35.9))).toBe("signature");
      expect(props(leftOf(36))).toEqual([
        expect.objectContaining({ label: "John Smith" }),
      ]);
    });

    // The docblock said "the close is upright text" and only the docblock
    // did: removing the check stayed green (review finding).
    it("a close that is not upright text does not count", () => {
      const turned = pg({
        segs: [hseg(72, 252, 470)],
        text: [
          txt("Kind regards,", 72, 500, {
            width: 60,
            size: 11,
            upright: false,
          }),
          txt("John Smith", 72, 456, { width: 55, size: 11 }),
        ],
      });
      expect(props(turned)).toEqual([
        expect.objectContaining({ label: "John Smith" }),
      ]);
      // Control: the same close upright makes it a signature line.
      const upright = pg({
        ...turned,
        text: [{ ...turned.text[0]!, upright: true }, turned.text[1]!],
      });
      expect(firstRule(upright)).toBe("signature");
    });

    it("a line labelled to its left keeps its own label's verdict", () => {
      const p = pg({
        segs: [hseg(130, 330, 470)],
        text: [
          txt("Yours sincerely,", 72, 520, { width: 80, size: 11 }),
          txt("Date:", 72, 470, { width: 30, size: 11 }),
        ],
      });
      expect(props(p)).toEqual([expect.objectContaining({ label: "Date" })]);
    });

    // EVERY caption-only line within 80 pt under a close was a signature
    // line, so a sign-off block's Print name and Date lines were lost and
    // signatureLines over-counted (review finding; corpus P23). Only the
    // first line under the close is its signature line.
    it("only the first line under a close is its signature line", () => {
      const p = pg({
        segs: [hseg(72, 300, 570), hseg(72, 300, 545), hseg(72, 300, 520)],
        text: [
          txt("Yours faithfully,", 72, 600, { width: 80, size: 11 }),
          txt("Print name", 74, 537, { width: 40, size: 8 }),
          txt("Date", 74, 512, { width: 20, size: 8 }),
        ],
      });
      const r = run(p);
      expect(r.proposals.map((f) => f.label)).toEqual(["Print name", "Date"]);
      expect(r.excluded.map((e) => e.rule)).toEqual(["signature"]);
      expect(r.counts.signatureLines).toBe(1);
    });

    // A letter's signature line typed as underscores was still proposed as
    // a text field: the sign-off rule looked at drawn lines only (review
    // finding; corpus N26). An unlabelled run under a close is the close's
    // signature line too; a labelled one ("Date: ____") stays a field.
    it("an unlabelled underscore run under a close is a signature line", () => {
      const typed = (s: string) =>
        pg({
          text: [
            txt("Yours sincerely,", 72, 520, { width: 80, size: 11 }),
            txt(s, 72, 470, { width: 180, size: 11 }),
            txt("John Smith", 72, 456, { width: 55, size: 11 }),
          ],
        });
      const r = run(typed("______________________________"));
      expect(r.proposals).toEqual([]);
      expect(r.excluded.map((e) => e.rule)).toEqual(["signature"]);
      expect(r.counts.signatureLines).toBe(1);
      expect(props(typed("Date: ______________________"))).toEqual([
        expect.objectContaining({ label: "Date", rule: "underscore-run" }),
      ]);
      // A run is a line for "the first line under the close" too: a second
      // bare run under the signature's run is a field.
      const two = run(
        pg({
          text: [
            txt("Yours sincerely,", 72, 520, { width: 80, size: 11 }),
            txt("______________________________", 72, 470, { width: 180 }),
            txt("______________________________", 72, 445, { width: 180 }),
          ],
        }),
      );
      expect(two.excluded.map((e) => e.rule)).toEqual(["signature"]);
      expect(two.proposals).toEqual([
        expect.objectContaining({ rule: "underscore-run", y: 443 }),
      ]);
    });
  });

  it("counts signature lines", () => {
    expect(
      run(pg({ text: [txt("Signature: ________", 72, 600, { width: 150 })] }))
        .counts.signatureLines,
    ).toBe(1);
  });

  it("UNDERLINE_MAX_GAP: text 3 pt over the line underlines it, 3.1 pt does not", () => {
    const at = (gap: number) =>
      labelledRule({
        text: [txt("Heading words", 150, 600 + gap, { width: 120 })],
      });
    expect(firstRule(at(3))).toBe("underline");
    expect(firstRule(at(3.1))).not.toBe("underline");
  });

  it("UNDERLINE_SPAN: text along half the line underlines it, less does not", () => {
    const at = (w: number) =>
      labelledRule({ text: [txt("Heading", 130, 601, { width: w })] });
    expect(firstRule(at(100))).toBe("underline");
    expect(firstRule(at(99.9))).not.toBe("underline");
  });

  it("DIVIDER_SPAN: an unlabelled line 85% of the page wide is a divider", () => {
    const at = (len: number) => pg({ segs: [hseg(40, 40 + len, 400)] });
    expect(firstRule(at(0.85 * W))).toBe("full-width-divider");
    expect(firstRule(at(0.85 * W - 0.1))).toBe("unlabelled");
  });

  it("a labelled line that wide is not a divider", () => {
    const p = pg({
      text: [txt("Notes:", 0, 400, { width: 30 })],
      segs: [hseg(36, 576, 400)],
    });
    expect(props(p)).toHaveLength(1);
  });

  it("BAND_EDGE / BAND_SPAN: a line in the outer 8% wider than 70% of the page", () => {
    const at = (y: number, len: number) =>
      pg({
        text: [txt("Co:", 2, y, { width: 18 })],
        segs: [hseg(30, 30 + len, y)],
      });
    // Literals from the brief, not DETECT.BAND_EDGE x H: a boundary computed
    // from the constant moves with it and cannot fail (review finding;
    // mutants 0.08 -> 0.16 and -> 0.04 both stayed green that way).
    // 0.08 x 792 = 63.36, and the top band starts at 792 - 63.36 = 728.64.
    const wide = 0.7 * W + 0.1;
    expect(firstRule(at(63.2, wide))).toBe("page-band");
    expect(props(at(63.4, wide))).toHaveLength(1);
    expect(props(at(63.2, 0.7 * W))).toHaveLength(1);
    expect(firstRule(at(728.8, wide))).toBe("page-band");
    expect(props(at(728.5, wide))).toHaveLength(1);
  });

  it("BAND_REPEAT_EPS / BAND_REPEAT_PAGES: the same band line on another page", () => {
    const p = pg({
      text: [txt("Company Ltd", 130, 760, { width: 66 })],
      segs: [hseg(200, 500, 760)],
    });
    const other = (d: number) => [[hseg(200 + d, 500 + d, 760 + d)]];
    expect(firstRule(p, { repeatsAcrossPages: other(2) })).toBe("page-band");
    expect(props(p, { repeatsAcrossPages: other(2.1) })).toHaveLength(1);
    expect(props(p, { repeatsAcrossPages: [] })).toHaveLength(1);
  });

  it("a repeat outside the bands is not a band", () => {
    const p = pg({
      text: [txt("Name:", 90, 400, { width: 30 })],
      segs: [hseg(130, 330, 400)],
    });
    expect(
      props(p, { repeatsAcrossPages: [[hseg(130, 330, 400)]] }),
    ).toHaveLength(1);
  });

  // Every band line scanned every other page's whole list of band lines:
  // pages^2 x lines^2 for a run, 24 s for 50 pages of 2,000 (review
  // finding). Each page's lines are now indexed once and looked up.
  //
  // First pinned as 2,100 lines against 49 pages in `< 250` ms ("measured
  // before: about 590 ms; after: under 50 ms"), a wall-clock bound (see
  // interleavedBest). Now the SHAPE, on the axis the defect grows on: 8
  // times the band lines on every page must cost far less than 64 times
  // (each line scanning every other page's lines; more PAGES cost both
  // linearly, so pages cannot tell them apart). 105 rows of lines is all
  // the band holds at this pitch, so the factor is 105 / 13. First
  // measured with the defect timed alone: fixed 7.22 to 13.0, `segs.some`
  // 66.9 to 74.9.
  // Measured in this whole file (see interleavedBest): fixed 9.45 to
  // 10.88 one or 4 at a time, 7.48 to 14.77 under the pinned loads; with
  // each other page scanned whole (`segs.some` for the cell lookup) 61.79
  // to 67.01, and 66.48 to 81.00 4 at a time; with each page's index built
  // again for every line (the cache never read) 68.40 to 75.09 and 76.43
  // to 84.04. The bound, 32, is 2.2x over the worst fixed and 1.9x under
  // the lowest defect.
  it("the repeat check is a lookup: 2,100 band lines against 49 pages", () => {
    const bandSegs = (dx: number, rows: number) => {
      const out: CardSeg[] = [];
      for (let r = 0; r < rows; r++)
        for (const y of [1 + 0.6 * r, H - 1 - 0.6 * r])
          for (let c = 0; c < 10; c++)
            out.push(hseg(10 + 58 * c + dx, 60 + 58 * c + dx, y));
      return out;
    };
    const check = (rows: number) => {
      const p = pg({ segs: bandSegs(0, rows) });
      const others = Array.from({ length: 49 }, () => bandSegs(5, rows));
      return () => run(p, { repeatsAcrossPages: others });
    };
    const [small, large] = interleavedBest([check(13), check(105)]);
    // Health: every line was a band candidate that asked for repeats, and
    // none was found on another page, at both sizes.
    for (const [r, n] of [
      [small!.got, 260],
      [large!.got, 2100],
    ] as const) {
      expect(r.counts.candidates).toBe(n);
      expect(r.excluded.map((e) => e.rule)).not.toContain("page-band");
    }
    // A match on one other page still makes it a band.
    const others = Array.from({ length: 49 }, () => bandSegs(5, 105));
    const twice = run(pg({ segs: bandSegs(0, 105).slice(0, 1) }), {
      repeatsAcrossPages: [...others, bandSegs(0, 105)],
    });
    expect(twice.excluded.map((e) => e.rule)).toEqual(["page-band"]);
    expectRatioUnder("repeat check, 49 pages", large!, small!, 32);
  }, 60_000);

  it("GRID_TOUCHES: three plumb lines across the line make a grid, two do not", () => {
    const with_ = (xs: number[]) =>
      labelledRule({
        segs: [hseg(130, 330, 600), ...xs.map((x) => vseg(x, 580, 620))],
      });
    expect(firstRule(with_([130, 230, 330]))).toBe("table-grid");
    expect(props(with_([130, 330]))).toHaveLength(1);
  });

  it("GRID_END_TOUCHES: an end met by two plumb lines (above and below) is a grid", () => {
    const p = labelledRule({
      segs: [hseg(130, 330, 600), vseg(130, 600, 620), vseg(130, 580, 600)],
    });
    expect(firstRule(p)).toBe("table-grid");
  });

  // INVERTED in review round 4 (the owner's decision on round 3's finding
  // 9). This test read "KNOWN MISS: a run alone in a table cell is proposed
  // with no label (its label is in the cell to its left)" and pinned
  // [underscore-run, null] twice: the label sits across the cell border,
  // past LABEL_LEFT_GAP. A run typed alone in a ruled cell now takes the
  // label of the cell to its left in the same row, when that cell holds one
  // label line. The table's rules stay table-grid: its right cells hold text.
  it("a run alone in a table cell takes its label from the cell to its left", () => {
    const p = pg({
      segs: [
        ...[600, 576, 552].map((y) => hseg(72, 400, y)),
        ...[72, 180, 400].map((x) => vseg(x, 552, 600)),
      ],
      text: [
        txt("Name", 76, 584, { size: 10, width: 25 }),
        txt("Email", 76, 560, { size: 10, width: 25 }),
        txt("______________________________", 184, 584, {
          size: 10,
          width: 160,
        }),
        txt("______________________________", 184, 560, {
          size: 10,
          width: 160,
        }),
      ],
    });
    expect(props(p).map((x) => [x.rule, x.label])).toEqual([
      ["underscore-run", "Name"],
      ["underscore-run", "Email"],
    ]);
    expect(run(p).excluded.map((e) => e.rule)).toEqual(
      Array(3).fill("table-grid"),
    );
  });

  describe("a run in a table cell: only alone, and only from one label line", () => {
    /** Row 600..576, columns 72 | 180 | 400; `left` in the left cell. */
    const cell = (left: CardText[], extra: CardText[] = [], mid = 180) =>
      pg({
        segs: [
          ...[600, 576].map((y) => hseg(72, 400, y)),
          ...[72, mid, 400].map((x) => vseg(x, 576, 600)),
        ],
        text: [
          ...left,
          txt("______________________________", 184, 584, {
            size: 10,
            width: 160,
          }),
          ...extra,
        ],
      });
    const runLabel = (p: CardPage) =>
      props(p).find((x) => x.rule === "underscore-run")?.label;
    const name = txt("Name", 76, 584, { size: 10, width: 25 });

    it("positive control: one label line in the left cell", () => {
      expect(runLabel(cell([name]))).toBe("Name");
    });

    // Review round 5 fixes, finding 7: every run in a cell scanned every
    // piece (is it alone?) and every text item (the left cell's label),
    // and every run without a label scanned every item for one: quadratic
    // in text, which nothing caps. Measured on the reviewer's head about
    // 5 s for this page; after, about 0.65 s (best of two runs).
    //
    // First pinned at `< 1100` ms on the best of two runs, a wall-clock
    // bound (see interleavedBest): CI took up to 1,271 ms for the whole
    // test of two runs. Now the SHAPE: 8 times the rows (runs and items
    // alike) must cost far less than 64 times (each run scanning every
    // item). First measured with the defect timed alone: fixed 10.3 to
    // 13.5, the band search below 78.2 to 80.7.
    // Measured in this whole file (see interleavedBest): fixed 10.34 to
    // 13.91 one or 4 at a time, 9.58 to 14.77 under the pinned loads; with
    // the unlabelled run's search reading `p.text.filter(...)` instead of
    // its baseline band, 73.17 to 76.26 (one at a time only: over 2
    // minutes a run). The bound, 32, is 2.2x over the worst fixed and 2.3x
    // under the defect. This test pins that search; the other two scans
    // are the next test's.
    /**
     * `rows` rows of 40 cell pairs, a label in the left cell and a run in
     * the right, and `extra` items far under the grid (200 per row unless
     * said). Without its plumb lines the grid has no cells.
     */
    const ruledGrid = (rows: number, celled = true, extra = 200 * rows) => {
      const pairs = 40;
      const segs: CardSeg[] = [];
      const text: CardText[] = [];
      const right = 50 + 150 * pairs;
      for (let i = 0; i <= rows; i++) segs.push(hseg(50, right, 50 + 20 * i));
      if (celled)
        for (let c = 0; c <= pairs; c++) {
          segs.push(vseg(50 + 150 * c, 50, 50 + 20 * rows));
          if (c < pairs) segs.push(vseg(90 + 150 * c, 50, 50 + 20 * rows));
        }
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < pairs; c++) {
          text.push(
            txt(`R${r}C${c}`, 54 + 150 * c, 56 + 20 * r, {
              size: 8,
              width: 10,
            }),
          );
          text.push(
            txt("____________", 96 + 150 * c, 56 + 20 * r, {
              size: 8,
              width: 100,
            }),
          );
        }
      for (let k = 0; k < extra; k++)
        text.push(
          txt("x", 60 + (k % 1000) * 3, 4200 + Math.floor(k / 1000) * 4, {
            size: 2,
            width: 1,
          }),
        );
      const height = Math.max(4400, 4240 + 4 * Math.ceil(extra / 1000));
      return pg({ width: right + 50, height, segs, text });
    };

    it("a ruled grid of 8,000 runs in cells, with 40,000 more items, is classified in linear time", () => {
      const few = ruledGrid(25);
      const many = ruledGrid(200);
      const [small, large] = interleavedBest([
        () => run(few).proposals[0]?.label,
        () => run(many).proposals[0]?.label,
      ]);
      // Health check: the runs took their cells' labels (the page CAP keeps
      // 60 proposals), so the cell path ran, at both sizes.
      expect(small!.got).toMatch(/^R\d+C0$/);
      expect(large!.got).toMatch(/^R\d+C0$/);
      expectRatioUnder("ruled grid of 8,000 runs", large!, small!, 32);
    }, 60_000);

    // The other two scans named above, `alone` over every piece and the
    // left cell's label over every item, are each a cheap test per pair, so
    // at 8 times the rows their quadratic term never dominated the page's
    // linear cost: in the test above, `alone` put back to `pix.sorted.every`
    // stayed green in 5 runs of 5 (15.6 alone, 30.3 in the whole file,
    // against 32), and the label read from `ix.sorted.filter` was red by
    // 1.3 to 1.5x (review of the ratio conversion, finding 1; R11 and
    // R11b; with time-boxed samples they read 28.3 to 32.8 and 44.2 to
    // 50.2 there now). Only the cell path runs either, so its cost is
    // held against the same grid with no plumb lines: no cells form, and
    // every run is read the same way up to the cell lookup.
    it("a ruled grid's cell path costs no more than the same grid without its plumb lines", () => {
      // 100,000 items under the grid, not 40,000: every item is one more
      // test per run for either scan, and only one more item for the page.
      const celled = ruledGrid(200, true, 100_000);
      const open = ruledGrid(200, false, 100_000);
      const [without, within] = interleavedBest([
        () => run(open),
        () => run(celled),
      ]);
      // Health: in cells each run takes its left cell's label; with no
      // cells, none does. Both pages hold the same 8,000 runs.
      const runs = (r: ReturnType<typeof classifyPage>) =>
        r.proposals.filter((x) => x.rule === "underscore-run");
      expect(runs(within!.got)[0]?.label).toMatch(/^R\d+C0$/);
      expect(runs(without!.got).length).toBeGreaterThan(0);
      expect(runs(without!.got).every((x) => x.label === null)).toBe(true);
      expect(within!.got.counts.candidates).toBe(
        without!.got.counts.candidates,
      );
      // Measured in this whole file (see interleavedBest): fixed 0.76 to
      // 0.90 one or 4 at a time, 0.70 to 0.96 under the pinned loads; with
      // `alone` over every piece (`pix.sorted.every`) 4.89 to 5.37, and
      // 4.70 to 5.76 4 at a time; with the left cell's label read from
      // every item (`ix.sorted.filter`) 11.55 to 13.96 and 10.38 to 12.45.
      // The bound, 2.2, is 2.3x over the worst fixed and 2.1x under the
      // lowest defect. The unlabelled run's band search runs on both
      // pages, so it is the test above's (read here: 0.93 to 1.01).
      expectRatioUnder(
        "ruled grid, cells vs no plumb lines",
        within!,
        without!,
        2.2,
      );
    }, 60_000);

    it("two lines in the left cell, or none: no label", () => {
      expect(
        runLabel(
          cell([name, txt("(in full)", 76, 579, { size: 4, width: 15 })]),
        ),
      ).toBe(null);
      expect(runLabel(cell([]))).toBe(null);
    });

    it("another word in the run's own cell: no label from across the border", () => {
      expect(
        runLabel(
          cell([name], [txt("(optional)", 350, 584, { size: 8, width: 40 })]),
        ),
      ).toBe(null);
    });

    it("no plumb line between them: no cell, no label", () => {
      const p = pg({
        segs: [600, 576].map((y) => hseg(72, 400, y)),
        text: [
          name,
          txt("______________________________", 184, 584, {
            size: 10,
            width: 160,
          }),
        ],
      });
      expect(runLabel(p)).toBe(null);
    });

    it("the left cell must be closed: a bottom rule stopping short of its left border leaves no cell", () => {
      const open = (x0: number) =>
        pg({
          segs: [
            hseg(72, 400, 600),
            hseg(x0, 400, 576),
            ...[72, 180, 400].map((x) => vseg(x, 576, 600)),
          ],
          text: [
            name,
            txt("______________________________", 184, 584, {
              size: 10,
              width: 160,
            }),
          ],
        });
      expect(runLabel(open(72))).toBe("Name");
      expect(runLabel(open(150))).toBe(null);
    });

    it("a left cell that spans only part of the run's row gives no label", () => {
      // The run's cell runs 552..600; the left column is split at 576.
      const p = pg({
        segs: [
          hseg(72, 400, 600),
          hseg(72, 180, 576),
          hseg(72, 400, 552),
          ...[72, 180, 400].map((x) => vseg(x, 552, 600)),
        ],
        text: [
          name,
          txt("______________________________", 184, 584, {
            size: 10,
            width: 160,
          }),
        ],
      });
      expect(runLabel(p)).toBe(null);
      // Control: the same rows with the split drawn across both columns.
      p.segs[1] = hseg(72, 400, 576);
      expect(runLabel(p)).toBe("Name");
    });

    it("left-cell text that is not upright is no label", () => {
      expect(
        runLabel(
          cell([txt("Name", 76, 584, { size: 10, width: 25, upright: false })]),
        ),
      ).toBe(null);
    });
  });

  // A table ruled with level lines only (invoices, statements) had its top
  // rule proposed as a 481 pt text field labelled with the first column
  // header, taken as a caption (review finding; corpus N24). The vertical
  // lines the grid rule needs are not there, so rows are recognised too.
  describe("table-grid: a table ruled with rows only", () => {
    const header = (gap = 40) => [
      txt("Item", 135, 586, { width: 30, size: 10 }),
      txt("Price", 165 + gap, 586, { width: 30, size: 10 }),
    ];
    const rows = (
      o: {
        ys?: number[];
        x0s?: number[];
        x1s?: number[];
        text?: CardText[];
      } = {},
    ) => {
      const ys = o.ys ?? [600, 580, 560];
      return pg({
        segs: ys.map((y, i) => hseg(o.x0s?.[i] ?? 130, o.x1s?.[i] ?? 450, y)),
        text: o.text ?? header(),
      });
    };
    const ruled = (p: CardPage) =>
      run(p).excluded.filter((e) => e.rule === "table-grid").length;

    it("every rule of the table is table-grid, and nothing is proposed", () => {
      expect(ruled(rows())).toBe(3);
      expect(props(rows())).toEqual([]);
      expect(props(rows(), { disable: new Set(["table-grid"]) })).not.toEqual(
        [],
      );
    });

    it("GRID_ROWS_MIN: three rules are a table, two are not", () => {
      expect(ruled(rows({ ys: [600, 580] }))).toBe(0);
    });

    // A row is the space strictly between two rules. The words are read
    // from a baseline slice that includes both rules, and the strict tests
    // after it could be deleted with everything green (review round 6
    // test honesty, closing mutant sweep: round 3's two mutants of these
    // bounds). A header set exactly ON a rule is in neither row beside it.
    it("a header whose baseline is ON a rule is in no row: 0.1 pt over or under it, it is", () => {
      const at = (y: number) =>
        rows({
          text: [
            txt("Item", 135, y, { width: 30, size: 10 }),
            txt("Price", 205, y, { width: 30, size: 10 }),
          ],
        });
      expect(ruled(at(580))).toBe(0);
      expect(ruled(at(580.1))).toBe(3);
      expect(ruled(at(579.9))).toBe(3);
    });

    it("GRID_ROW_EPS: ends 2 pt apart line up, 2.1 pt apart do not", () => {
      expect(ruled(rows({ x1s: [450, 452, 450] }))).toBe(3);
      expect(ruled(rows({ x1s: [450, 452.1, 450] }))).toBe(0);
      // The left ends too: only the right ends were moved here once, so the
      // left-end check could be deleted with everything green, and rules
      // whose left ends differ by 4 pt became a table (review finding).
      expect(ruled(rows({ x0s: [130, 132, 130] }))).toBe(3);
      expect(ruled(rows({ x0s: [130, 132.1, 130] }))).toBe(0);
      expect(ruled(rows({ x0s: [130, 134, 130] }))).toBe(0);
    });

    it("GRID_PITCH_EPS: pitches 2 pt apart are even, 2.1 pt apart are not", () => {
      expect(ruled(rows({ ys: [600, 580, 558] }))).toBe(3);
      expect(ruled(rows({ ys: [600, 580, 557.9] }))).toBe(0);
    });

    // After a pitch break the next run starts at the rule BEFORE the break,
    // but every test had three evenly pitched rules, so starting it at the
    // break stayed green, and an item table above a wider totals gap had
    // its top rule proposed under a column header: the N24 defect again
    // (review finding; corpus N31).
    // "Even within 2 pt" is measured against the run's FIRST pitch, but
    // three rules make one comparison only, so comparing with the previous
    // pitch instead (a pitch drifting 1.5 pt a row) stayed green (review
    // finding). Pitches 20, 21.5, 23: the fourth rule is 3 pt off the first
    // pitch, so it is not one of the table's rows.
    it("GRID_PITCH_EPS is against the run's first pitch: a drift ends the run", () => {
      const p = rows({
        ys: [600, 620, 641.5, 664.5],
        text: [
          txt("Item", 135, 606, { width: 30, size: 10 }),
          txt("Price", 205, 606, { width: 30, size: 10 }),
          txt("Notes", 132, 652, { width: 30, size: 10 }),
        ],
      });
      expect(ruled(p)).toBe(3);
      expect(props(p).map((f) => f.label)).toEqual(["Notes"]);
    });

    it("after a pitch break the next run starts at the rule before it", () => {
      const p = rows({
        ys: [630, 610, 590, 560],
        text: [
          txt("Item", 135, 616, { width: 20, size: 10 }),
          txt("Price", 300, 616, { width: 25, size: 10 }),
          txt("Widget", 135, 596, { width: 30, size: 10 }),
          txt("10.00", 300, 596, { width: 25, size: 10 }),
        ],
      });
      expect(ruled(p)).toBe(3);
      expect(props(p)).toEqual([]);
    });

    it("GRID_COLUMN_GAP: text 24 pt apart is two columns, 23.9 pt is one", () => {
      expect(ruled(rows({ text: header(24) }))).toBe(3);
      expect(ruled(rows({ text: header(23.9) }))).toBe(0);
    });

    // A stack of labelled form lines was suppressed as a table whenever a
    // hint ("DD MM YYYY") under one of them gave a band two columns: the
    // rule ignored the label to the LEFT of each line (review finding;
    // corpus P19). A rows-only table's rules span its first column, so its
    // row text sits above and below each rule, never to its left.
    it("a rule with a label to its left is a field line, not a table row", () => {
      const ys = [600, 570, 540, 510];
      const labels = [
        "Surname:",
        "Forenames:",
        "Date of birth:",
        "Nationality:",
      ];
      const stack = (labelled: boolean) =>
        pg({
          segs: ys.map((y) => hseg(146, 420, y, { width: 0.5 })),
          text: [
            ...["DD", "MM", "YYYY"].map((s, i) =>
              txt(s, 150 + 60 * i, 531, { width: 10, size: 6 }),
            ),
            ...(labelled
              ? labels.map((s, i) =>
                  txt(s, 80, ys[i]!, { width: 60, size: 11 }),
                )
              : []),
          ],
        });
      expect(ruled(stack(true))).toBe(0);
      expect(props(stack(true)).map((f) => f.label)).toEqual([
        "Surname",
        "Forenames",
        "Date of birth",
        "Nationality",
      ]);
      // Control: the same lines with no labels still read as a table's rows.
      expect(ruled(stack(false))).toBe(4);
    });

    /** Three lines captioned Full name / Street / City, and `more` text. */
    const stacked = (more: CardText[] = []) =>
      rows({
        ys: [600, 570, 540],
        text: [
          txt("Full name", 132, 588, { width: 45, size: 10 }),
          txt("Street", 132, 558, { width: 30, size: 10 }),
          txt("City", 132, 528, { width: 20, size: 10 }),
          ...more,
        ],
      });

    it("stacked lines with one caption each are a form, not a table", () => {
      const p = stacked();
      expect(ruled(p)).toBe(0);
      expect(props(p).map((f) => f.label)).toEqual([
        "Full name",
        "Street",
        "City",
      ]);
    });

    // Only the text BETWEEN two rules counts, but nothing tested either
    // bound: deleting one stayed green, and then a two-column header or
    // footer anywhere above or below made a form of stacked captioned lines
    // a table (review finding; corpus P25).
    it("two-column text above or below the stack is not one of its rows", () => {
      const p = stacked([
        txt("Part 2", 135, 700, { width: 30, size: 10 }),
        txt("Ref 123", 300, 700, { width: 35, size: 10 }),
        txt("Page 1 of 2", 135, 480, { width: 50, size: 10 }),
        txt("Form A-12", 300, 480, { width: 45, size: 10 }),
      ]);
      expect(ruled(p)).toBe(0);
      expect(props(p).map((f) => f.label)).toEqual([
        "Full name",
        "Street",
        "City",
      ]);
    });

    // Only text over the rules' own width counts, but nothing tested that
    // either: row markers in the margin ("(a)", "(b)") then counted as a
    // second column and made a form a table (review finding).
    it("text in the margin beside the stack is not one of its columns", () => {
      for (const x of [88, 460]) {
        const p = stacked([
          txt("(a)", x, 590, { width: 15, size: 10 }),
          txt("(b)", x, 560, { width: 15, size: 10 }),
        ]);
        expect(ruled(p), `markers at x ${x}`).toBe(0);
        expect(props(p).map((f) => f.label)).toEqual([
          "Full name",
          "Street",
          "City",
        ]);
      }
    });

    // Only words count as a column, not underscore runs, but nothing tested
    // that: counting runs turned a form with a run beside each caption into
    // table-grid (review finding). A run is a field of its own.
    it("an underscore run beside each caption is not a second column", () => {
      const p = stacked([
        txt("________", 300, 588, { width: 44, size: 10 }),
        txt("________", 300, 558, { width: 44, size: 10 }),
      ]);
      expect(ruled(p)).toBe(0);
      expect(props(p).map((f) => [f.rule, f.label])).toEqual([
        ["labelled-rule", "Full name"],
        ["underscore-run", null],
        ["labelled-rule", "Street"],
        ["underscore-run", null],
        ["labelled-rule", "City"],
      ]);
    });

    // ONE band with two columns made the whole stack a table, so an address
    // block whose City / State / ZIP row has three captions lost every field
    // (review finding; corpus P20). A table repeats its columns in every row
    // that holds text; a caption stack is mostly one caption a row.
    it("every row that holds text must have two columns, not just one row", () => {
      const block = (state: boolean) =>
        rows({
          ys: [600, 568, 536],
          text: [
            txt("Street address", 132, 590, { width: 55, size: 8 }),
            txt("City", 132, 558, { width: 15, size: 8 }),
            ...(state
              ? [
                  txt("State", 250, 558, { width: 20, size: 8 }),
                  txt("ZIP code", 350, 558, { width: 32, size: 8 }),
                ]
              : []),
            txt("Country", 132, 526, { width: 30, size: 8 }),
          ],
        });
      expect(ruled(block(true))).toBe(0);
      expect(props(block(true)).map((f) => f.label)).toEqual([
        "Street address",
        "City",
        "Country",
      ]);
      expect(props(block(false))).toHaveLength(3);
      // A table whose every row holds two columns is still a table.
      const table = rows({
        ys: [600, 580, 560],
        text: [
          ...header(),
          txt("Widget", 135, 566, { width: 30, size: 10 }),
          txt("10.00", 205, 566, { width: 30, size: 10 }),
        ],
      });
      expect(ruled(table)).toBe(3);
    });
  });

  it("GRID_TOUCH_EPS: a plumb line 1 pt off touches, 1.1 pt off does not", () => {
    const at = (d: number) =>
      labelledRule({
        segs: [
          hseg(130, 330, 600),
          vseg(129 - (d - 1), 580, 620),
          vseg(230, 580, 620),
          vseg(330, 600 + d, 620),
        ],
      });
    expect(firstRule(at(1))).toBe("table-grid");
    expect(props(at(1.1))).toHaveLength(1);
  });

  // INVERTED in review round 3 (finding 2). This test read "four adjoining
  // equal squares are a comb, three are not" and pinned the brief's COMB_MIN
  // of 4, so a DD / MM / YYYY date's two-box groups, a two-box "Age" and a
  // three-box "House no." each became checkboxes (labelled "/", "Age",
  // "House no"). Squares that touch edge to edge are digit boxes from two.
  it("COMB_MIN / COMB_EPS: two adjoining equal squares are a comb (three too), one alone is not", () => {
    const row = (n: number, gap = 0) =>
      pg({
        rects: Array.from({ length: n }, (_, k) =>
          rect(100 + k * (14 + gap), 400, 14, 14),
        ),
        text: Array.from({ length: n }, (_, k) =>
          txt("x", 100 + k * (14 + gap) + 3, 416, { size: 4, width: 2 }),
        ),
      });
    expect(run(row(4)).excluded.map((e) => e.rule)).toEqual(
      Array(4).fill("comb"),
    );
    expect(run(row(3)).excluded.map((e) => e.rule)).toEqual(
      Array(3).fill("comb"),
    );
    expect(run(row(2)).excluded.map((e) => e.rule)).toEqual(
      Array(2).fill("comb"),
    );
    expect(run(row(1)).excluded.some((e) => e.rule === "comb")).toBe(false);
    expect(run(row(2, 1)).excluded.map((e) => e.rule)).toEqual(
      Array(2).fill("comb"),
    );
    expect(run(row(2, 1.1)).excluded.some((e) => e.rule === "comb")).toBe(
      false,
    );
  });

  // Each next square in a row was found by scanning the whole sorted list
  // from its start: a page of graph-paper cells under the primitive cap took
  // 3.4 s (review finding). The next square is now looked up by its corner.
  //
  // First pinned as 12,500 squares in `< 400` ms ("measured before: about
  // 1.2 s; after: under 100 ms"), a wall-clock bound (see
  // interleavedBest). Now the SHAPE: 125 rows of squares against 16 (7.8
  // times the squares) must cost far less than 61 times (each next square
  // found by a scan of the whole list). First measured with the defect
  // timed alone: fixed 6.75 to 12.5, the scan below 72.0 to 85.0.
  // Measured in this whole file (see interleavedBest): fixed 8.61 to
  // 11.12 one or 4 at a time, 6.99 to 14.15 under the pinned loads; with
  // the corner lookup replaced by one scan of `sorted` per next square
  // (the `for` over `byCorner.get(...)` written `dx === 0 && dy === 0 ?
  // sorted : []`) 68.26 to 73.88, and 63.47 to 73.24 4 at a time; with
  // `sorted.find(...)` from its start for each next square 65.15 to 72.24
  // and 65.73 to 72.95. The bound, 32, is 2.3x over the worst fixed and
  // 2.0x under the lowest defect.
  it("a grid of 12,500 small squares is read as combs in linear time", () => {
    const grid = (rows: number) => {
      const rects: CardRect[] = [];
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < 100; k++)
          rects.push(rect(5 + 6 * k, 5 + 6 * r, 6, 6));
      return pg({ rects });
    };
    const few = grid(16);
    const many = grid(125);
    const [small, large] = interleavedBest([() => run(few), () => run(many)]);
    // Health: every square is a comb's, at both sizes.
    for (const [res, n] of [
      [small!.got, 1_600],
      [large!.got, 12_500],
    ] as const) {
      expect(res.excluded).toHaveLength(n);
      expect(res.excluded.every((e) => e.rule === "comb")).toBe(true);
    }
    expectRatioUnder("12,500 squares as combs", large!, small!, 32);
  }, 60_000);

  // Review round 4 fixes, finding 11: the duplicate pass walked every
  // later survivor past DUP_DY with `continue` on a list sorted by y, so it
  // was quadratic in labelled squares, and a headed grid labels them all
  // (824 ms at 20,000 on the reviewer's machine). It stops at DUP_DY now.
  //
  // This test first bounded the 20,000-square run at 400 ms, and a CI runner
  // took 451 ms on the fixed code (PR #382's run 44373418087), under the
  // full suite's load. Its "after" was 86 ms here and its "before" 824 ms,
  // so the bound sat 2x from the defect and 5x from a loaded runner: it
  // measured the machine, not the shape. The property is the SHAPE of the
  // cost, so it is pinned as a ratio measured on one machine in one run:
  // 8 times the squares must cost far less than 64 times (quadratic).
  // Measured, best of 3, Windows: fixed 6.69; with the `break` turned back
  // into `continue` (the defect), 30.1 and 38.2. The bound, 16, is 2.4x
  // above the first and 1.9x below the second.
  //
  // That 6.69 did not hold. Timed interleaved (interleavedBest) the fixed
  // page read 7.1 to 11.3 over 13 runs of this file, 4 of them at once,
  // and the defect 30.0 to 35.5: a bound 2x over the one is 1.3x under the
  // other. Timed as first written, a scratch run read 6.23 on its first
  // trial and 9.1 to 10.1 on the next three: the 6.69 was a denominator
  // still warming (14.7 ms against 7.1 ms once warm). So the large grid is
  // now 400 rows, 16 times the small one: fixed 20.5 to 28.2 in 5 runs of
  // this file and 19.6 to 29.4 in 4 at a time (21.1 to 23.7 alone), the
  // defect 126.9, 122.5 and 119.8 (timed alone). The bound was 60.
  //
  // Then 60 was within 1.5x of the fixed code under load: with samples of
  // one call, 4 runs of this file and 2 busy loops on 4 logical CPUs read
  // 40.1 (review of the ratio conversion, finding 9; see SAMPLE_MS). With
  // time-boxed samples that load read 17.1 to 29.9, but 1 busy loop and 4
  // loops thrashing the shared L3 read up to 38.5: 40,000 squares are a
  // working set the cache holds less of than 2,500 (finding 11).
  // Measured in this whole file (see interleavedBest): fixed 19.66 to
  // 27.84 one or 4 at a time, 17.11 to 38.47 under the pinned loads; with
  // the `break` turned back into `continue` 135.2 to 154.1, and 166.6 to
  // 211.3 4 at a time; with every survivor walked from the start (`j =
  // 0`) 183.3 to 210.2 and 154.3 to 210.2. The bound, 80, is 2.1x over
  // the worst fixed and 1.7x under the lowest defect.
  it("a headed grid of labelled squares is classified in linear time", () => {
    const grid = (rows: number) => {
      const rects: CardRect[] = [];
      const text: CardText[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 100; c++)
          rects.push(rect(200 + 12 * c, 20 + 12 * r, 8, 8));
        text.push(txt(`Row ${r}`, 40, 22 + 12 * r, { size: 6, width: 30 }));
      }
      const top = 20 + 12 * (rows - 1) + 8;
      for (let c = 0; c < 100; c++)
        text.push(txt(`H${c}`, 200 + 12 * c, top + 6, { size: 5, width: 7 }));
      return pg({ width: 1500, height: top + 100, rects, text });
    };
    // Best of 3, interleaved, warmed (interleavedBest; it was written here
    // first, the sizes timed one after the other, and moved there when the
    // other cost tests were converted to ratios).
    const few = grid(25);
    const many = grid(400);
    const [small, large] = interleavedBest([() => run(few), () => run(many)]);
    // Health: every square is labelled by the grid (the page cap keeps 60),
    // at both sizes, so both runs took the path the defect lived on.
    const res = large!.got;
    expect(res.counts.candidates).toBe(40_000);
    expect(res.proposals).toHaveLength(60);
    expect(res.counts.capped).toBe(40_000 - 60);
    expect(res.proposals[0]!.label).toBe("Row 399 H0");
    expect(small!.got.counts.candidates).toBe(2_500);
    expect(small!.got.proposals[0]!.label).toBe("Row 24 H0");
    // Each sample runs for SAMPLE_MS at least, so the small grid is timed
    // over about ten calls (see interleavedBest).
    expectRatioUnder("headed grid of labelled squares", large!, small!, 80);
  }, 60_000);

  it("a filled square is a bullet", () => {
    const p = pg({
      rects: [rect(72, 600, 8, 8, { filled: true, stroked: false })],
      text: [txt("Point", 88, 601, { size: 10 })],
    });
    expect(firstRule(p)).toBe("bullet");
  });

  it("a candidate whose only label is turned text is rotated-label", () => {
    const p = pg({
      text: [txt("Name:", 128, 450, { upright: false, width: 12 })],
      segs: [hseg(150, 350, 450)],
    });
    const r = run(p);
    expect(r.excluded.map((e) => e.rule)).toEqual(["rotated-label"]);
    expect(r.counts.rotatedText).toBe(1);
  });

  it("an upright label wins over turned text", () => {
    const p = pg({
      text: [
        txt("Name:", 128, 450, { upright: false, width: 12 }),
        txt("Name:", 100, 450, { width: 30 }),
      ],
      segs: [hseg(150, 350, 450)],
    });
    expect(props(p)[0]?.label).toBe("Name");
  });

  it("TEXT_DESCENT_EMS: text resting with its descent on the field's bottom overlaps it", () => {
    // Field bottom 601. Size 10: descent 2.
    const at = (b: number) =>
      labelledRule({ text: [txt("note", 200, b, { size: 10, width: 20 })] });
    expect(firstRule(at(602.9))).toBe("overlaps-text");
    expect(firstRule(at(603))).toBe("no-clearance");
  });

  it("TEXT_ASCENT_EMS: text below whose ascent reaches the field's bottom overlaps it", () => {
    const at = (b: number) =>
      labelledRule({ text: [txt("note", 200, b, { size: 10, width: 20 })] });
    expect(firstRule(at(594.1))).toBe("overlaps-text");
    expect(props(at(594))).toHaveLength(1);
  });

  it("MIN_FIELD_H / CLEARANCE_GAP: a field squeezed to 10 pt stays, under 10 is no-clearance", () => {
    const at = (b: number) =>
      labelledRule({
        text: [txt("Please print", 200, b, { size: 10, width: 60 })],
      });
    expect(props(at(612))).toEqual([
      expect.objectContaining({ y: 601, height: 10 }),
    ]);
    expect(firstRule(at(611.9))).toBe("no-clearance");
  });

  it("IOU_EXISTING: IoU above 0.3 overlaps, at or below does not (no centre inside)", () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const b = (x: number) => ({ x0: x, y0: 0, x1: x + 10, y1: 10 });
    expect(overlapsExisting(a, b(5.38))).toBe(true); // IoU 0.3004
    expect(overlapsExisting(a, b(5.4))).toBe(false); // IoU 0.2987
    // A centre inside wins whatever the IoU.
    expect(
      overlapsExisting(
        { x0: 0, y0: 0, x1: 100, y1: 100 },
        { x0: 40, y0: 40, x1: 45, y1: 45 },
      ),
    ).toBe(true);
  });

  it("existing-field and existing-draft; a card on another page does not count", () => {
    const p = labelledRule();
    const box = { x: 131, y: 601, width: 198, height: 17 };
    const withField = { ...p, widgets: [box] };
    expect(firstRule(withField)).toBe("existing-field");
    expect(run(withField).counts.alreadyFields).toBe(1);
    expect(firstRule(p, { drafts: [{ page: 1, ...box }] })).toBe(
      "existing-draft",
    );
    expect(props(p, { drafts: [{ page: 2, ...box }] })).toHaveLength(1);
  });

  it("DUP_DY: squares whose bottoms are 4 pt apart are one field, 4.1 pt are two", () => {
    const two = (dy: number) =>
      pg({
        rects: [rect(72, 500, 12, 12), rect(72, 500 + dy, 12, 12)],
        text: [txt("Yes", 90, 506, { size: 10 })],
      });
    const r = run(two(4));
    expect(r.proposals).toHaveLength(1);
    expect(r.excluded.map((e) => e.rule)).toEqual(["duplicate"]);
    expect(props(two(4.1))).toHaveLength(2);
  });

  it("DUP_OVERLAP: overlapping by half the shorter is a duplicate, less is not", () => {
    const two = (dx: number) =>
      pg({
        rects: [rect(72, 500, 12, 12), rect(72 + dx, 500, 12, 12)],
        text: [txt("Yes", 72 + dx + 18, 502, { size: 10 })],
      });
    expect(run(two(5)).excluded.map((e) => e.rule)).toContain("duplicate");
    expect(run(two(5.1)).excluded.map((e) => e.rule)).not.toContain(
      "duplicate",
    );
  });

  it("a line and a run in the same place: the line's box, the run's label", () => {
    const p = pg({
      text: [
        txt("Name:", 72, 400, { width: 30 }),
        txt("____________", 110, 400, { width: 80 }),
      ],
      segs: [hseg(110, 190, 399)],
    });
    const r = run(p);
    expect(r.proposals).toEqual([
      expect.objectContaining({ rule: "labelled-rule", label: "Name", y: 400 }),
    ]);
    expect(r.excluded.map((e) => e.rule)).toEqual(["duplicate"]);
  });

  it("BOUND_EPS equals the engine's: the same box passes or fails both", () => {
    // A field whose right edge rounds to 613.
    const page = (w: number) =>
      pg({
        width: w,
        text: [txt("Name:", 520, 600, { width: 30 })],
        segs: [hseg(555, 614, 600)],
      });
    const spec = (w: number) =>
      validateFormFields(
        [
          {
            type: "text",
            name: "a",
            page: 1,
            x: 556,
            y: 601,
            width: 57,
            height: 17,
          },
        ],
        [{ width: w, height: H }],
      );
    expect(props(page(612.5))).toHaveLength(1);
    expect(spec(612.5)).toEqual([]);
    expect(firstRule(page(612.4))).toBe("off-page");
    expect(spec(612.4)).not.toEqual([]);
    expect(DETECT.BOUND_EPS).toBe(0.5);
  });

  it("off-page below zero: a field starting left of the page", () => {
    const p = pg({
      text: [txt("A", -40, 600, { width: 5, upright: false })],
      segs: [hseg(-2, 100, 600)],
    });
    expect(firstRule(p, { disable: new Set(["rotated-label"]) })).toBe(
      "off-page",
    );
  });

  it("CAPS.perPage: 60 proposals a page, the rest counted", () => {
    const rects: CardRect[] = [];
    const text: CardText[] = [];
    for (let k = 0; k < 61; k++) {
      const x = 20 + (k % 10) * 58;
      const y = 40 + Math.floor(k / 10) * 40;
      rects.push(rect(x, y, 12, 12));
      text.push(txt("Opt", x + 16, y + 2, { size: 8, width: 12 }));
    }
    const r = run(pg({ rects, text }));
    expect(r.proposals).toHaveLength(60);
    expect(r.counts.capped).toBe(1);
  });

  it("disable: every exclusion id is a seam that can be turned off", () => {
    const cases: [ExclusionRuleId, CardPage][] = [
      ["unlabelled", pg({ segs: [hseg(130, 330, 600)] })],
      ["short-run", pg({ text: [txt("____", 100, 600, { width: 20 })] })],
      [
        "signature",
        pg({ text: [txt("Signature: ________", 72, 600, { width: 150 })] }),
      ],
    ];
    for (const [id, p] of cases) {
      expect(firstRule(p)).toBe(id);
      const off = run(p, { disable: new Set([id]) });
      expect(off.excluded.map((e) => e.rule)).not.toContain(id);
      expect(off.proposals.length).toBeGreaterThan(0);
    }
  });
});

describe("cleanLabel", () => {
  it("drops underscores, trailing colons and dashes, and extra spaces", () => {
    expect(cleanLabel("  Full   name :  ")).toBe("Full name");
    expect(cleanLabel("Date ____")).toBe("Date");
    expect(cleanLabel("____")).toBeNull();
    expect(cleanLabel("Amount -")).toBe("Amount");
    const dash = String.fromCodePoint(0x2014);
    expect(cleanLabel(`Total ${dash}. :`)).toBe("Total");
    expect(cleanLabel(": . -")).toBeNull();
  });

  // The trailing trim was an anchored regex that backtracked over every run
  // of ':' and '.' that did not end the string, so one 40,005-character text
  // item beside 40 rules took 32 s for one page (review finding).
  //
  // First pinned as two 50,005-character labels in `< 100` ms ("measured
  // before: about 1.3 s; after: well under 1 ms"), a wall-clock bound (see
  // interleavedBest). Now the SHAPE, at equal work per sample: 16,000
  // labels of 255 characters against 2,000 of 2,005 (the same 4,000,000
  // characters of punctuation) cost no more when the trim is linear (less:
  // each call's fixed cost counts 8 times as often in the short ones), and
  // 8 times as much when each run is backtracked over. One label is too
  // quick to time, and a sample long enough to time on the linear trim is
  // long for the defect, so the labels are short. First measured with the
  // defect timed alone: fixed 0.37 to 0.69, the old regex 7.04 to 7.19.
  // Measured in this whole file (see interleavedBest): fixed 0.41 to 0.53
  // one or 4 at a time, 0.38 to 0.78 under the pinned loads; with the
  // trim loop replaced by the old anchored regex (`end =
  // mid.replace(/[\s:.\-...]+$/u, "").length`) 6.79 to 7.20, and 6.65 to
  // 6.93 4 at a time; with each position tested by an anchored regex on
  // the rest of the string 5.97 to 6.67 and 6.15 to 6.59. The bound, 2,
  // is 2.6x over the worst fixed and 3.0x under the lowest defect.
  it("trims in linear time, whatever runs of punctuation the label holds", () => {
    const label = (n: number) => "Name" + ".:".repeat(n) + "x";
    const trims = (s: string, times: number) => () => {
      let out: string | null = null;
      for (let i = 0; i < times; i++) out = cleanLabel(s);
      return out;
    };
    const shortLabel = label(125);
    const longLabel = label(1_000);
    const [short, long] = interleavedBest([
      trims(shortLabel, 16_000),
      trims(longLabel, 2_000),
    ]);
    // Health: an inner run is kept whole, at both lengths, and a run that
    // ends the label is trimmed.
    expect(short!.got).toBe(shortLabel);
    expect(long!.got).toBe(longLabel);
    expect(cleanLabel("Name" + ".:".repeat(25_000))).toBe("Name");
    expectRatioUnder("trim, 8x longer labels at equal work", long!, short!, 2);
  }, 60_000);

  // Review round 3, finding 2: the "/" between a date's box groups was the
  // boxes' label. A label holds a letter or a digit.
  it("a string with no letter or digit is no label", () => {
    for (const s of ["/", "( )", "&", "#", "*", "+ -", "/ /"])
      expect(cleanLabel(s), s).toBeNull();
    expect(cleanLabel("No.")).toBe("No");
    expect(cleanLabel("3")).toBe("3");
    expect(cleanLabel("(a)")).toBe("(a)");
    // Bengali "nam" (name): two letters and a vowel sign.
    const bengali = String.fromCodePoint(0x09a8, 0x09be, 0x09ae);
    expect(cleanLabel(bengali)).toBe(bengali);
    // Digits of any script (review round 4 fixes, finding 19, mutant L2:
    // \p{N} read as 0-9 stayed green): Bengali one and two.
    const digits = String.fromCodePoint(0x09e7, 0x09e8);
    expect(cleanLabel(digits)).toBe(digits);
  });

  it("so a lone square beside a '/' is unlabelled, and a label past the '/' is read", () => {
    const p = (extra: CardText[]) =>
      pg({
        rects: [rect(100, 500, 12, 12)],
        text: [txt("/", 115, 502, { size: 10, width: 3 }), ...extra],
      });
    expect(firstRule(p([]))).toBe("unlabelled");
    expect(
      props(p([txt("Yes", 120, 502, { size: 10, width: 15 })]))[0]?.label,
    ).toBe("Yes");
  });
});

describe("nameFor", () => {
  const none = new Set<string>();

  it("lower-cases, drops accents, joins words with _", () => {
    expect(nameFor(`Pr${String.fromCodePoint(0xe9)}nom`, "text", none, 1)).toBe(
      "prenom",
    );
    expect(nameFor("Full Name (as on passport)", "text", none, 1)).toBe(
      "full_name_as_on_passport",
    );
  });

  it("never contains a period, whatever the label", () => {
    for (const label of [
      "a.b",
      "Mr. Smith",
      "...",
      "name.first",
      "e.g. 3.5",
      ".x.",
    ])
      expect(nameFor(label, "text", none, 1)).not.toContain(".");
  });

  it("prefixes a leading digit", () => {
    expect(nameFor("1st line", "text", none, 1)).toBe("field_1st_line");
  });

  it("falls back to text_N / checkbox_N when nothing is left", () => {
    const bengali = String.fromCodePoint(0x09a8, 0x09be, 0x09ae);
    expect(nameFor(bengali, "text", none, 3)).toBe("text_3");
    expect(nameFor(null, "checkbox", none, 2)).toBe("checkbox_2");
    expect(nameFor("::", "text", none, 7)).toBe("text_7");
  });

  it("cuts to 40 characters", () => {
    const n = nameFor("x".repeat(60), "text", none, 1);
    expect(n).toHaveLength(40);
  });

  it("is unique: _2, _3, ...", () => {
    expect(nameFor("Name", "text", new Set(["name"]), 1)).toBe("name_2");
    expect(nameFor("Name", "text", new Set(["name", "name_2"]), 1)).toBe(
      "name_3",
    );
  });

  it("treats a taken dotted name as taking its group", () => {
    expect(nameFor("Name", "text", new Set(["name.first"]), 1)).toBe("name_2");
    expect(nameFor("Name", "text", new Set(["name", "name.first"]), 1)).toBe(
      "name_2",
    );
  });

  it("a name it gives passes the engine's validation against the dotted names", () => {
    const reserved = ["name", "name.first", "mr"];
    const name = nameFor("Mr. Name", "text", new Set(reserved), 1);
    expect(
      validateFormFields(
        [{ type: "text", name, page: 1, x: 10, y: 10, width: 50, height: 15 }],
        [{ width: W, height: H }],
        reserved,
      ),
    ).toEqual([]);
  });
});

describe("proposalToDraftFields and filterValid", () => {
  const prop = (o: Partial<FieldProposal>): FieldProposal => ({
    key: "k",
    page: 1,
    x: 10,
    y: 10,
    width: 100,
    height: 15,
    type: "text",
    label: "Name",
    rule: "underscore-run",
    ...o,
  });

  it("names each proposal against the taken names and each other", () => {
    const specs = proposalToDraftFields(
      [
        prop({}),
        prop({ y: 40 }),
        prop({ type: "checkbox", label: null, width: 10, height: 10 }),
      ],
      ["name"],
    );
    expect(specs.map((s) => s.name)).toEqual([
      "name_2",
      "name_3",
      "checkbox_1",
    ]);
    expect(specs[0]).toMatchObject({ type: "text", multiline: false });
    expect(specs[0]).not.toHaveProperty("defaultValue");
    expect(specs[2]).toMatchObject({ type: "checkbox", checked: false });
  });

  it("drops what the engine's validation refuses and counts it", () => {
    const sizes = [{ width: W, height: H }];
    const all = [prop({}), prop({ x: 600, y: 60 }), prop({ y: 90 })];
    const { kept, invalid } = filterValid(all, (xs) =>
      validateFormFields(proposalToDraftFields(xs), sizes),
    );
    expect(invalid).toBe(1);
    expect(kept.map((p) => p.y)).toEqual([10, 90]);
  });

  it("keeps everything when validation passes; ignores errors with no index", () => {
    expect(filterValid([1, 2], () => [{ index: -1 }])).toEqual({
      kept: [1, 2],
      invalid: 0,
    });
  });
});

// Review round 6 fixes, findings 6 to 9: shapes a fresh sweep found that
// predate round 4 and have no narrow, safe fix. Each is pinned as it
// stands, with its reason, so a change to it is seen and decided. The
// detector only proposes: a miss costs the user one manual add, a wrong
// proposal one reject. Invert a KNOWN MISS (keeping its history) when it
// is fixed.
describe("review round 6 sweep: known misses and a product choice", () => {
  const rows = (p: CardPage) =>
    props(p).map((x) => [x.rule, x.label, x.x, x.y]);

  // KNOWN MISS (finding 6): a resume whose section rules start at the
  // body's left edge (the section heads sit in the left margin) gets a
  // field per section, labelled with the first body line under the rule.
  // A line followed by more lines of its size reads as a caption; telling
  // a paragraph from a caption needs a guard for printed-name and role
  // blocks under signature lines, which have the same two-line shape.
  it("KNOWN MISS: a resume's section rules over their body text are fields named after the first body line", () => {
    const text: CardText[] = [txt("Alex Morgan", 72, 730, { size: 20 })];
    const segs: CardSeg[] = [];
    const sections: [string, string[]][] = [
      [
        "Experience",
        [
          "Senior designer, Northwind Studio, 2021 to present",
          "Led the redesign of the booking flow used by 2 million people.",
        ],
      ],
      [
        "Education",
        [
          "BA Graphic Design, Lakeside University, 2017",
          "Graduated with honours; thesis on wayfinding systems.",
        ],
      ],
    ];
    let y = 680;
    for (const [head, body] of sections) {
      text.push(txt(head, 72, y, { size: 11 }));
      segs.push(hseg(160, 540, y + 3, { width: 0.5 }));
      y -= 18;
      for (const s of body) {
        text.push(txt(s, 160, y, { size: 10 }));
        y -= 13;
      }
      y -= 14;
    }
    expect(rows(pg({ text, segs }))).toEqual([
      [
        "labelled-rule",
        "Senior designer, Northwind Studio, 2021 to present",
        161,
        684,
      ],
      [
        "labelled-rule",
        "BA Graphic Design, Lakeside University, 2017",
        161,
        626,
      ],
    ]);
  });

  // WAS A KNOWN MISS (finding 7): a heading over blank writing lines
  // ("Defects found / comments" over three full-width rules 20 pt apart)
  // proposed nothing, all three lines `unlabelled`. A label over a line
  // must sit within 0.6 em of it, and a continuation line needs a labelled
  // first line. INVERTED by slice S4 (stacked lines, review round 1,
  // geometry 4): a stack's caption may sit up to one pitch over its top
  // line, so the heading labels ONE multiline field over all three. The
  // guard for a heading over a page's ruled body is the stack's own: no
  // line of it labelled, and no column headings beside the caption.
  it("a heading 20 pt over three blank writing lines is ONE multiline field (was a known miss)", () => {
    const p = pg({
      text: [txt("Defects found / comments", 72, 400)],
      segs: [hseg(72, 540, 380), hseg(72, 540, 360), hseg(72, 540, 340)],
    });
    expect(
      props(p).map((x) => [x.rule, x.label, x.multiline === true]),
    ).toEqual([["labelled-rule", "Defects found / comments", true]]);
    expect(run(p).excluded).toEqual([]);
  });

  // PRODUCT CHOICE (finding 9): on a numbered tax worksheet each amount
  // line is labelled with the line number set just left of it ("1"), not
  // the description at the margin ("Wages, salaries, tips"). Kept: forms
  // like the IRS's name their lines by number, and the number is the
  // nearest text on the line's baseline. Before round 4 two of these
  // lines had no label at all.
  it("PRODUCT CHOICE: a worksheet's amount lines take the line number set left of them", () => {
    const text: CardText[] = [];
    const segs: CardSeg[] = [];
    ["Wages, salaries, tips", "Taxable interest", "Ordinary dividends"].forEach(
      (s, i) => {
        const y = 640 - 22 * i;
        const n = String(i + 1);
        text.push(txt(n, 72, y, { size: 10 }), txt(s, 90, y, { size: 10 }));
        text.push(txt(n, 432, y, { size: 9 }));
        segs.push(hseg(446, 540, y - 2));
      },
    );
    expect(rows(pg({ text, segs }))).toEqual([
      ["labelled-rule", "1", 447, 639],
      ["labelled-rule", "2", 447, 617],
      ["labelled-rule", "3", 447, 595],
    ]);
  });
});
