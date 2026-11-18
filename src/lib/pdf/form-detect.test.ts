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
    // Word-style two-column table, round 3's finding 9).
    expect(DETECTION_RULES).toHaveLength(4);
    expect(EXCLUSION_RULES).toHaveLength(17);
  });

  // The independent second bound on every threshold (CLAUDE.md, guards
  // rule 3): a literal table typed from the brief, so a constant changed by
  // a factor turns this red even where a test computes its boundary from
  // DETECT (the CAPS.perRun and BAND_EDGE tests once did, and survived
  // perRun 300 -> 150 and BAND_EDGE 0.08 -> 0.16). Values marked "review"
  // were added by the review round, not by the brief.
  it("every DETECT value is the brief's (a literal table, not a read-back)", () => {
    const { SIGNATURE_RE, SIGNOFF_RE, FOOTNOTE_RE, QUOTE_END_RE, ...numbers } =
      DETECT;
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
      LABEL_COLUMN_MIN: 3, // owner, round 3
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
      String.raw`\b(sign(ature|ed)?|initials)\b`,
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

    it("the caption inside the box's top-left labels no edge: nothing above the box", () => {
      expect(props(boxed())).toEqual([]);
      expect(run(boxed()).excluded.map((e) => [e.rule, e.box.y])).toEqual([
        ["unlabelled", 673],
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
      // box's mark must carry into it.
      expect(props(boxed([hseg(40, 72.5, 700)]))).toEqual([]);
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
      // The positive control now: TWO smaller lines under it, a body.
      const two = captioned(txt("note", 72, 584, { size: 7, width: 15 }));
      two.text.push(txt("more", 72, 575, { size: 7, width: 15 }));
      expect(props(two)[0]?.label).toBe(undefined);
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
    it("20,000 tiny items as captions under 200 rules are classified in linear time", () => {
      const segs: CardSeg[] = [];
      const text: CardText[] = [];
      for (let k = 0; k < 200; k++) segs.push(hseg(72, 540, 30 + 3.7 * k));
      for (let k = 0; k < 20_000; k++) {
        const layer = Math.floor(k / 200) % 3;
        text.push(
          txt("ab", 72 + (k % 150) * 3, 28.5 + 3.7 * (k % 200) - 0.3 * layer, {
            size: 2 - 0.6 * layer,
            width: 2,
          }),
        );
      }
      const t0 = performance.now();
      const r = run(pg({ segs, text }));
      const ms = performance.now() - t0;
      // Health: every rule is a candidate, and the captions were read.
      expect(r.counts.candidates).toBe(200);
      // Measured before: 11 s; after: about 0.15 s.
      expect(ms).toBeLessThan(800);
    });

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

  it("LABEL_COLUMN_MIN: 3 lines make a column, 2 do not (a line at another tab stop does not count)", () => {
    const three = column([A1[2]!, A1[1]!, A1[3]!], TAB);
    expect([0, 1, 2].map((i) => labelAt(three, i))).toEqual([
      "Date of birth",
      "Email",
      "City",
    ]);
    // Row 1 is a column of two; row 2 is labelled within 36 pt but its line
    // starts at 340 and its label at 300, so it is in neither column.
    const two = column(
      [A1[2]!, A1[1]!, { label: "Phone:", x: 300, right: 330, x0: 340 }],
      TAB,
    );
    expect(labelAt(two, 0)).toBe("Date of birth");
    expect(labelAt(two, 2)).toBe("Phone");
    expect(labelAt(two, 1)).toBeUndefined();
    expect(decidedAt(two, 1)).toBe("unlabelled");
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

  it("a header row (text in both cells) keeps the whole grid a table", () => {
    const p = table({
      text: [txt("Your answer", 184, 584, { size: 10, width: 55 })],
    });
    expect(props(p)).toEqual([]);
    expect(grid(p)).toBe(5);
  });

  it("any text in any right cell keeps it a table (a filled-in answer, a value column)", () => {
    for (const y of [584, 560, 536, 512]) {
      const p = table({ text: [txt("x", 300, y, { size: 10, width: 5 })] });
      expect(props(p), `text at ${y}`).toEqual([]);
    }
  });

  it("three or more columns stay a table", () => {
    expect(props(table({ xs: [72, 180, 290, 400] }))).toEqual([]);
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
  it("finds each item's pieces in one pass, not one scan per item", () => {
    const text: CardText[] = [];
    for (let k = 0; k < 20_000; k++)
      text.push(
        txt("ab", 10 + (k % 75) * 8, 10 + Math.floor(k / 75) * 2.9, {
          size: 2,
          width: 2,
        }),
      );
    text.push(txt("Name: ________", 10, 780, { size: 2, width: 40 }));
    const t0 = performance.now();
    const r = run(pg({ text }));
    const ms = performance.now() - t0;
    // Health: the one run among them is still found.
    expect(r.counts.candidates).toBe(1);
    // Measured before: about 1.5 s; after: well under 100 ms.
    expect(ms).toBeLessThan(300);
  });
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
      // One column of squares under a head ...
      expect(labels(grid({ xs: [400], heads: ["Tick"] }))).toEqual([]);
      // ... and one row of squares under heads.
      expect(labels(grid({ rows: ["Asthma"] }))).toEqual([]);
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

    it("edges crowded at one corner cost linear time, not cubic", () => {
      const segs: CardSeg[] = [];
      for (let k = 0; k < 400; k++)
        segs.push(
          hseg(100, 110, 100),
          vseg(100, 100, 110),
          vseg(110, 100, 115),
        );
      const t0 = performance.now();
      run(pg({ segs }));
      // Measured before the bound: about 900 ms; after it: a few ms.
      expect(performance.now() - t0).toBeLessThan(250);
    });
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
    ])
      expect(
        firstRule(
          pg({ text: [txt(`${label}: ________`, 72, 600, { width: 150 })] }),
        ),
      ).toBe("signature");
    for (const label of ["Design", "Signal", "Assignment"])
      expect(
        props(
          pg({ text: [txt(`${label}: ________`, 72, 600, { width: 150 })] }),
        ),
      ).toHaveLength(1);
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
  it("the repeat check is a lookup: 2,100 band lines against 49 pages", () => {
    const bandSegs = (dx: number) => {
      const out: CardSeg[] = [];
      for (let r = 0; r < 105; r++)
        for (const y of [1 + 0.6 * r, H - 1 - 0.6 * r])
          for (let c = 0; c < 10; c++)
            out.push(hseg(10 + 58 * c + dx, 60 + 58 * c + dx, y));
      return out;
    };
    const p = pg({ segs: bandSegs(0) });
    const others = Array.from({ length: 49 }, () => bandSegs(5));
    const t0 = performance.now();
    const r = run(p, { repeatsAcrossPages: others });
    const ms = performance.now() - t0;
    // Health: every line was a band candidate that asked for repeats.
    expect(r.counts.candidates).toBe(2100);
    expect(r.excluded.map((e) => e.rule)).not.toContain("page-band");
    // A match on one other page still makes it a band.
    const twice = run(pg({ segs: bandSegs(0).slice(0, 1) }), {
      repeatsAcrossPages: [...others, bandSegs(0)],
    });
    expect(twice.excluded.map((e) => e.rule)).toEqual(["page-band"]);
    // Measured before: about 590 ms; after: under 50 ms.
    expect(ms).toBeLessThan(250);
  });

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
  it("a grid of 12,500 small squares is read as combs in linear time", () => {
    const rects: CardRect[] = [];
    for (let r = 0; r < 125; r++)
      for (let k = 0; k < 100; k++)
        rects.push(rect(5 + 6 * k, 5 + 6 * r, 6, 6));
    const t0 = performance.now();
    const res = run(pg({ rects }));
    const ms = performance.now() - t0;
    expect(res.excluded).toHaveLength(12_500);
    expect(res.excluded.every((e) => e.rule === "comb")).toBe(true);
    // Measured before: about 1.2 s; after: under 100 ms.
    expect(ms).toBeLessThan(400);
  });

  // Review round 4 fixes, finding 11: the duplicate pass walked every
  // later survivor past DUP_DY with `continue` on a list sorted by y, so it
  // was quadratic in labelled squares, and a headed grid labels them all
  // (824 ms at 20,000 on the reviewer's machine). It stops at DUP_DY now.
  it("a headed grid of 20,000 labelled squares is classified in linear time", () => {
    const rects: CardRect[] = [];
    const text: CardText[] = [];
    for (let r = 0; r < 200; r++) {
      for (let c = 0; c < 100; c++)
        rects.push(rect(200 + 12 * c, 20 + 12 * r, 8, 8));
      text.push(txt(`Row ${r}`, 40, 22 + 12 * r, { size: 6, width: 30 }));
    }
    const top = 20 + 12 * 199 + 8;
    for (let c = 0; c < 100; c++)
      text.push(txt(`H${c}`, 200 + 12 * c, top + 6, { size: 5, width: 7 }));
    const t0 = performance.now();
    const res = run(pg({ width: 1500, height: top + 100, rects, text }));
    const ms = performance.now() - t0;
    // Health: every square is labelled by the grid (the page cap keeps 60).
    expect(res.counts.candidates).toBe(20_000);
    expect(res.proposals).toHaveLength(60);
    expect(res.counts.capped).toBe(20_000 - 60);
    expect(res.proposals[0]!.label).toBe("Row 199 H0");
    expect(ms).toBeLessThan(400);
  });

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
  it("trims in linear time, whatever runs of punctuation the label holds", () => {
    const inner = "Name" + ".:".repeat(25_000) + "x";
    const t0 = performance.now();
    expect(cleanLabel(inner)).toBe(inner);
    expect(cleanLabel("Name" + ".:".repeat(25_000))).toBe("Name");
    // Measured before: about 1.3 s; after: well under 1 ms.
    expect(performance.now() - t0).toBeLessThan(100);
  });

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
