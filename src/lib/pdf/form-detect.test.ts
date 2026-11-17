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
    expect(DETECTION_RULES).toHaveLength(3);
    expect(EXCLUSION_RULES).toHaveLength(17);
  });

  // The independent second bound on every threshold (CLAUDE.md, guards
  // rule 3): a literal table typed from the brief, so a constant changed by
  // a factor turns this red even where a test computes its boundary from
  // DETECT (the CAPS.perRun and BAND_EDGE tests once did, and survived
  // perRun 300 -> 150 and BAND_EDGE 0.08 -> 0.16). Values marked "review"
  // were added by the review round, not by the brief.
  it("every DETECT value is the brief's (a literal table, not a read-back)", () => {
    const { SIGNATURE_RE, SIGNOFF_RE, ...numbers } = DETECT;
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
      LABEL_LEFT_GAP: 24,
      LABEL_BELOW_RULE: 2,
      LABEL_ABOVE_RULE_EMS: 0.6,
      RUN_BASELINE_EMS: 0.3,
      CAPTION_MIN: 1,
      CAPTION_MAX: 14,
      CAPTION_SPAN: 0.4,
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
      COMB_MIN: 4,
      COMB_EPS: 1,
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

  // A square drawn as four separate stroked lines (generated forms do this)
  // was neither proposed nor excluded: each edge was a line too short to be
  // a candidate (review finding; corpus P18). It is now joined into the
  // Rect a `re` would have given.
  describe("a square drawn as four separate lines", () => {
    // In drawing order, each edge its own `m l S`, as the finding drew it.
    const edges = (dTop = 0, dRight = 0): CardSeg[] => [
      hseg(72, 84, 500),
      vseg(84 + dRight, 500, 512),
      hseg(84, 72, 512 + dTop),
      vseg(72, 512, 500),
    ];
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

    it("JOIN_EPS: corners 0.5 pt apart still meet, 0.6 pt apart do not", () => {
      expect(props(four(edges(0.5)))).toHaveLength(1);
      expect(props(four(edges(0.6)))).toEqual([]);
      expect(props(four(edges(0, 0.5)))).toHaveLength(1);
      expect(props(four(edges(0, 0.6)))).toEqual([]);
    });

    it("three of the four edges are not a square", () => {
      expect(props(four(edges().slice(0, 3)))).toEqual([]);
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
      o: { ys?: number[]; x1s?: number[]; text?: CardText[] } = {},
    ) => {
      const ys = o.ys ?? [600, 580, 560];
      return pg({
        segs: ys.map((y, i) => hseg(130, o.x1s?.[i] ?? 450, y)),
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
    });

    it("GRID_PITCH_EPS: pitches 2 pt apart are even, 2.1 pt apart are not", () => {
      expect(ruled(rows({ ys: [600, 580, 558] }))).toBe(3);
      expect(ruled(rows({ ys: [600, 580, 557.9] }))).toBe(0);
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

    it("stacked lines with one caption each are a form, not a table", () => {
      const p = rows({
        ys: [600, 570, 540],
        text: [
          txt("Full name", 132, 588, { width: 45, size: 10 }),
          txt("Street", 132, 558, { width: 30, size: 10 }),
          txt("City", 132, 528, { width: 20, size: 10 }),
        ],
      });
      expect(ruled(p)).toBe(0);
      expect(props(p).map((f) => f.label)).toEqual([
        "Full name",
        "Street",
        "City",
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

  it("COMB_MIN / COMB_EPS: four adjoining equal squares are a comb, three are not", () => {
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
    expect(run(row(3)).excluded.some((e) => e.rule === "comb")).toBe(false);
    expect(run(row(4, 1)).excluded.map((e) => e.rule)).toEqual(
      Array(4).fill("comb"),
    );
    expect(run(row(4, 1.1)).excluded.some((e) => e.rule === "comb")).toBe(
      false,
    );
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
