// @native-canvas
/**
 * Slice S6's review round 1 (2026-11-22), held the house way. Each finding
 * is reproduced on a hand-built page or a corpus case that the reviewed
 * head (2c49f896) got wrong, and held both ways:
 *
 *  - MULTI-ANSWER stacks at the radio gap ("Tick all that apply", a
 *    consent list, two lists side by side) were made ONE radio group, so
 *    the saved form allowed one answer where the page asked for several.
 *    They stay checkboxes now, through two ban lists ({@link MULTI_ANSWER}
 *    and {@link OWN_CHOICE}) held to a corpus in both directions (house
 *    rule 1), and a columns check;
 *  - a RATING ROW of touching boxes under distinct heads became a text
 *    field limited to 5 ({@link DETECT_COMBS}.COMB_SCALE_ABOVE);
 *  - a comb's LEFT LABEL had no reach and no barrier, so another field's
 *    label named it; a caption over the row now wins over far text, and
 *    far text past COMB_LABEL_GAP, or behind a printed line, names nothing;
 *  - a stack's CAPTION could be a neighbouring checkbox's own label;
 *  - at a FRACTIONAL pitch the builder's whole-point stack drifted off the
 *    printed squares (3.8 pt at 8 options); such a stack stays checkboxes
 *    unless every button lands within RADIO_CENTRE_EPS of its square;
 *  - mutation survivors (the headed-grid exemption, the filled-square
 *    check, the comb row band, proposalToDraftFields' maxLength and radio
 *    arms) each get a page that kills them;
 *  - the copy: over-claims about combs and radio groups, as BANNED shapes
 *    with OVERCLAIMS that each catch, both ways, over the served corpus.
 *
 * The composed chain runs the round's corpus cases to the saved PDF and
 * reads them back with pdf.js, as form-detect-combs.test.ts does for S6's.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, PDFRadioGroup, PDFTextField } from "pdf-lib";
import {
  createFormFields,
  readFormContext,
  validateFormFields,
} from "./create-forms";
import { fieldBoxes } from "./field-boxes";
import {
  DETECT_COMBS,
  MULTI_ANSWER,
  OWN_CHOICE,
  classifyPage,
  proposalToDraftFields,
  type CardPage,
  type CardRect,
  type CardSeg,
  type CardText,
  type FieldProposal,
} from "./form-detect";
import { detectFormFields } from "./form-detect-read";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { toAdd } from "@/components/tools/runner/create-forms-detect";
import {
  COMB_CASES,
  PRINTED,
  S6,
  type Printed,
} from "@/tests/form-detect-combs-fixtures";
import {
  legacyPdfjs,
  runCase,
  type CaseRun,
} from "@/tests/form-detect-fixtures";
import { createFormsCorpus } from "@/tests/create-forms-copy-corpus";

/* ------------------------------------------------------------------ *
 *  Hand-built pages (card frame = page frame, unturned)
 * ------------------------------------------------------------------ */

const txt = (
  str: string,
  x: number,
  y: number,
  o: Partial<CardText> = {},
): CardText => ({
  str,
  x,
  y,
  width: o.width ?? str.length * 5,
  size: 10,
  upright: true,
  ...o,
});

const rect = (
  x: number,
  y: number,
  w: number,
  h = w,
  o: Partial<CardRect> = {},
): CardRect => ({
  x0: x,
  y0: y,
  x1: x + w,
  y1: y + h,
  width: 1,
  stroked: true,
  filled: false,
  lum: 0,
  ...o,
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

const pg = (o: Partial<CardPage> = {}): CardPage => ({
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

const run = (p: CardPage) => classifyPage(p);
const said = (p: CardPage) =>
  run(p).proposals.map((x) => [x.rule, x.label, x.maxLength ?? x.options]);

/**
 * A column of `n` squares of side `s` from `top` down, `gap` apart, at x,
 * labelled on the right, with optional text over it (baseline, string).
 */
function stack(
  options: readonly string[],
  o: {
    x?: number;
    top?: number;
    s?: number;
    gap?: number;
    over?: [number, string][];
    filled?: boolean;
  } = {},
): { rects: CardRect[]; text: CardText[] } {
  const { x = 100, top = 650, s = 12, gap = 6, over = [] } = o;
  const rects: CardRect[] = [];
  const text: CardText[] = [];
  options.forEach((label, k) => {
    const y = top - k * (s + gap);
    rects.push(rect(x, y, s, s, o.filled ? { filled: true } : {}));
    text.push(txt(label, x + s + 4, y + 2, { width: 5 * label.length }));
  });
  for (const [base, str] of over)
    text.push(txt(str, x, base, { width: 5 * str.length }));
  return { rects, text };
}

/* ------------------------------------------------------------------ *
 *  1. Multi-answer stacks stay checkboxes (false-positives HIGH)
 * ------------------------------------------------------------------ */

/**
 * The ban lists' corpus, both ways (house rule 1): every caption here is
 * caught by some MULTI_ANSWER shape and every shape catches one; the
 * single-answer captions are caught by none. The first two are the
 * reviewer's probes.
 */
const ASKS_FOR_MANY = [
  "Tick all that apply",
  "Which of these do you own? (select any)",
  "Please check all boxes which apply",
  "Select one or more",
  "You may choose more than one",
  "Tick as many as you like",
  "Mark each that you have had",
];
const ASKS_FOR_ONE = [
  "Preferred contact",
  "Select one",
  "Select any one",
  "Choose one option",
  "Which of these applies to you?",
  "How did you hear about us?",
  "Tick one box only",
  "Gender",
];
const OWN_STATEMENTS = [
  "I agree to the terms of service",
  "I consent to data processing",
  "I'm happy to be contacted",
  "We may share my details",
  "Send me the newsletter",
  "Email me updates",
  "Keep me informed",
];
const SET_OPTIONS = [
  "In person",
  "Email",
  "Phone",
  "Post",
  "Yes",
  "No",
  "Not sure",
  "Instagram",
  "Weekly",
  "Itemised bill",
  "Send by post",
];

describe("the multi-answer and own-statement ban lists, both ways", () => {
  for (const [name, list, yes, no] of [
    ["MULTI_ANSWER", MULTI_ANSWER, ASKS_FOR_MANY, ASKS_FOR_ONE],
    ["OWN_CHOICE", OWN_CHOICE, OWN_STATEMENTS, SET_OPTIONS],
  ] as const) {
    it(`${name}: every example is caught, every shape catches one, no counter-example is`, () => {
      expect(list.length).toBeGreaterThan(0);
      expect(yes.length).toBeGreaterThanOrEqual(list.length);
      for (const s of yes)
        expect(
          list.some((re) => re.test(s)),
          `${s} is caught`,
        ).toBe(true);
      for (const re of list)
        expect(
          yes.some((s) => re.test(s)),
          `${re} catches an example`,
        ).toBe(true);
      for (const s of no)
        expect(
          list.filter((re) => re.test(s)),
          `${s} is not caught`,
        ).toEqual([]);
    });
  }
});

describe("a stack at the radio gap that asks for several answers stays checkboxes", () => {
  const fever = ["Fever", "Cough", "Headache", "Fatigue"];

  it("positive control: the same stack under a plain caption IS one radio group", () => {
    expect(said(pg(stack(fever, { over: [[668, "Symptoms"]] })))).toEqual([
      ["radio-stack", "Symptoms", fever],
    ]);
  });

  it('"Tick all that apply" over it: four checkboxes, no radio group', () => {
    const res = run(pg(stack(fever, { over: [[668, "Tick all that apply"]] })));
    expect(res.proposals.map((p) => [p.rule, p.label])).toEqual(
      fever.map((f) => ["square-checkbox", f]),
    );
  });

  it('"(select any)" over 10 pt squares at gap 7: checkboxes', () => {
    const own = ["Car", "Bicycle", "Motorbike", "Scooter", "None"];
    const p = pg(
      stack(own, {
        s: 10,
        gap: 7,
        over: [[666, "Which of these do you own? (select any)"]],
      }),
    );
    expect(run(p).proposals.map((x) => x.rule)).toEqual(
      own.map(() => "square-checkbox"),
    );
  });

  it("RADIO_VETO_ABOVE: the words 28 pt over the top square veto; 30 pt do not", () => {
    // Descent = baseline - 2 (size 10); the top square's top is 662.
    const at = (rise: number) =>
      run(
        pg(stack(fever, { over: [[662 + rise + 2, "Tick all that apply"]] })),
      ).proposals.map((p) => p.type);
    expect(at(28)).toEqual(fever.map(() => "checkbox"));
    expect(at(30)).toEqual(["radio"]);
  });

  it("a consent stack (options in the first person): three checkboxes", () => {
    const consent = [
      "I agree to the terms of service",
      "Send me the newsletter",
      "I consent to data processing",
    ];
    expect(run(pg(stack(consent))).proposals.map((p) => p.type)).toEqual(
      consent.map(() => "checkbox"),
    );
  });

  it("two stacks side by side on the same rows, no captions: six checkboxes (a list in columns)", () => {
    const a = stack(["Apples", "Pears", "Plums"], { x: 100 });
    const b = stack(["Carrots", "Peas", "Beans"], { x: 260 });
    const res = run(
      pg({ rects: [...a.rects, ...b.rects], text: [...a.text, ...b.text] }),
    );
    expect(res.proposals.map((p) => p.type)).toEqual(Array(6).fill("checkbox"));
  });

  it("...each with a caption of its own: two radio groups (two questions)", () => {
    const a = stack(["Male", "Female", "Other"], {
      x: 100,
      over: [[668, "Gender"]],
    });
    const b = stack(["Under 30", "30 to 60", "Over 60"], {
      x: 260,
      over: [[668, "Age"]],
    });
    const res = run(
      pg({ rects: [...a.rects, ...b.rects], text: [...a.text, ...b.text] }),
    );
    expect(res.proposals.map((p) => [p.type, p.label])).toEqual([
      ["radio", "Gender"],
      ["radio", "Age"],
    ]);
  });

  it("...one caption over the left one only: checkboxes", () => {
    const a = stack(["Apples", "Pears", "Plums"], {
      x: 100,
      over: [[668, "Fruit"]],
    });
    const b = stack(["Carrots", "Peas", "Beans"], { x: 260 });
    const res = run(
      pg({ rects: [...a.rects, ...b.rects], text: [...a.text, ...b.text] }),
    );
    expect(res.proposals.map((p) => p.type)).toEqual(Array(6).fill("checkbox"));
  });

  it("control: a lone stack beside an unrelated stack on OTHER rows is still a group", () => {
    const a = stack(["Email", "Phone", "Post"], { x: 100 });
    const b = stack(["Red", "Green", "Blue"], { x: 260, top: 500 });
    const res = run(
      pg({ rects: [...a.rects, ...b.rects], text: [...a.text, ...b.text] }),
    );
    expect(res.proposals.map((p) => p.type)).toEqual(["radio", "radio"]);
  });
});

/* ------------------------------------------------------------------ *
 *  2. A rating row of touching boxes is no comb (false-positives MEDIUM)
 * ------------------------------------------------------------------ */

/** Rows of `n` touching 14 pt boxes from x 250, labelled on the left. */
function rows(
  labels: readonly string[],
  o: { pitch?: number; n?: number; heads?: string[]; headRise?: number } = {},
): CardPage {
  const { pitch = 20, n = 5, heads = [], headRise = 26 } = o;
  const rects: CardRect[] = [];
  const text: CardText[] = [];
  labels.forEach((label, r) => {
    const y = 400 - r * pitch;
    text.push(txt(label, 160, y + 3, { width: 70 }));
    for (let k = 0; k < n; k++) rects.push(rect(250 + 14 * k, y, 14));
  });
  heads.forEach((h, k) => {
    const w = Math.min(12, 4 * h.length);
    text.push(
      txt(h, 250 + 14 * k + 7 - w / 2, 414 + headRise, { width: w, size: 7 }),
    );
  });
  return pg({ rects, text });
}

const LIKERT = [
  "Strongly disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly agree",
];
const ROWS = ["Service quality", "Value for money", "Staff"];

describe("a scale's heads over touching boxes: no comb field", () => {
  it("positive control: the same three rows with no heads are three comb fields", () => {
    expect(said(rows(ROWS))).toEqual(ROWS.map((r) => ["comb-boxes", r, 5]));
  });

  it("word heads (Strongly disagree ... Strongly agree) over the top row: nothing for any row, every box `comb`", () => {
    const res = run(rows(ROWS, { heads: LIKERT }));
    expect(res.proposals).toEqual([]);
    expect(res.excluded.map((e) => e.rule)).toEqual(Array(15).fill("comb"));
  });

  it('one row under "1" to "5": no field', () => {
    expect(
      run(rows(["Rating"], { heads: ["1", "2", "3", "4", "5"] })).proposals,
    ).toEqual([]);
  });

  it("COMB_SCALE_ABOVE: heads whose baseline is 40 pt over the top row veto; 41 do not", () => {
    const at = (rise: number) =>
      run(
        rows(["Rating"], { heads: ["1", "2", "3", "4", "5"], headRise: rise }),
      ).proposals.length;
    expect(at(40)).toBe(0);
    expect(at(41)).toBe(1);
  });

  it("repeated heads (D D M M Y Y Y Y) and a date's heads (DD MM YYYY) are no scale", () => {
    const heads = ["D", "D", "M", "M", "Y", "Y", "Y", "Y"];
    expect(said(rows(["Date of birth"], { n: 8, heads }))).toEqual([
      ["comb-boxes", "Date of birth", 8],
    ]);
    const p = rows(["Date of birth"], { n: 8 });
    for (const [h, x] of [
      ["DD", 254],
      ["MM", 282],
      ["YYYY", 314],
    ] as const)
      p.text.push(txt(h, x, 440, { width: 4 * h.length, size: 7 }));
    expect(said(p)).toEqual([["comb-boxes", "Date of birth", 8]]);
  });

  // Mutant S2 (heads may repeat) stayed green: the D D M M case above is
  // also all date heads. Repeated heads that are no date's hold it.
  it("repeated heads that are no date's (A A B B C) are no scale either", () => {
    expect(said(rows(["Code"], { heads: ["A", "A", "B", "B", "C"] }))).toEqual([
      ["comb-boxes", "Code", 5],
    ]);
  });

  it("COMB_STACK_GAP_CELLS: a row 2 cells (28 pt) under a headed one shares its heads; 29 pt under does not", () => {
    const at = (gap: number) =>
      said(rows(["Speed", "Price"], { pitch: 14 + gap, heads: LIKERT }));
    expect(at(28)).toEqual([]);
    expect(at(29)).toEqual([["comb-boxes", "Price", 5]]);
  });

  it("a 1-5 rating grid, heads 26 pt over it (past a headed grid's 20): no comb field (review probe)", () => {
    const res = run(
      rows(["Speed", "Quality", "Price"], {
        pitch: 30,
        heads: ["1", "2", "3", "4", "5"],
      }),
    );
    expect(res.proposals.filter((p) => p.rule === "comb-boxes")).toEqual([]);
  });

  // Mutation survivor A14 (the headed-grid exemption in combFields): the
  // review's probe R2. Heads 6 pt over the top row make a headed grid
  // (S5's square rules), so every box is a checkbox named from its row
  // and head. NOTE: the scale check above now ALSO keeps these from being
  // combs, so A14 alone stays green HERE (one signal read twice); the
  // staggered-heads page below is where only the grid exemption holds.
  it("a 1-5 rating grid, heads 6 pt over it: 15 checkboxes named row and head (probe R2)", () => {
    const res = run(
      rows(["Speed", "Quality", "Price"], {
        pitch: 30,
        heads: ["1", "2", "3", "4", "5"],
        headRise: 6,
      }),
    );
    expect(res.proposals.map((p) => p.label)).toEqual(
      ["Speed", "Quality", "Price"].flatMap((r) =>
        ["1", "2", "3", "4", "5"].map((h) => `${r} ${h}`),
      ),
    );
  });
});

describe("the headed-grid exemption holds where the scale check does not (mutant A14)", () => {
  // The first head 4 pt lower than the rest (past GRID_ROW_EPS): the scale
  // check reads only the lowest baseline, one head, so no scale; the
  // headed grid reads each column's nearest head, four distinct. Only the
  // grid exemption keeps these from a comb field.
  it("staggered heads over two touching rows: a headed grid of checkboxes, no comb field", () => {
    const heads = ["Yes", "No", "N/A", "Other"];
    const rects: CardRect[] = [];
    const text: CardText[] = [];
    for (const [y, label] of [
      [400, "Speed"],
      [380, "Price"],
    ] as const) {
      text.push(txt(label, 160, y + 3, { width: 30 }));
      for (let k = 0; k < 4; k++) rects.push(rect(250 + 14 * k, y, 14));
    }
    heads.forEach((h, k) =>
      text.push(
        txt(h, 250 + 14 * k + 2, 414 + (k === 0 ? 6 : 10), {
          width: 10,
          size: 6,
        }),
      ),
    );
    const res = run(pg({ rects, text }));
    expect(res.proposals.filter((p) => p.rule === "comb-boxes")).toEqual([]);
    expect(res.proposals.map((p) => p.label)).toEqual(
      ["Speed", "Price"].flatMap((r) => heads.map((h) => `${r} ${h}`)),
    );
  });
});

/* ------------------------------------------------------------------ *
 *  3. A comb's label: reach, barrier, caption first (MEDIUM, R1)
 * ------------------------------------------------------------------ */

describe("a comb is named from its own label, never another field's", () => {
  const comb = (x = 350, y = 600, n = 5) =>
    Array.from({ length: n }, (_, k) => rect(x + 14 * k, y, 14));

  it("R1: a left column's 'Name' and its rule, a caption 'Postcode' over the comb: the comb is 'Postcode', 'Name' is the rule's", () => {
    const res = run(
      pg({
        rects: comb(),
        segs: [seg(110, 600, 280, 600)],
        text: [
          txt("Name", 72, 603, { width: 25 }),
          txt("Postcode", 350, 618, { width: 37, size: 9 }),
        ],
      }),
    );
    expect(res.proposals.map((p) => [p.rule, p.label])).toEqual([
      ["labelled-rule", "Name"],
      ["comb-boxes", "Postcode"],
    ]);
  });

  it("the same with no caption: the comb has no label, so no field (each box `comb`)", () => {
    const res = run(
      pg({
        rects: comb(),
        segs: [seg(110, 600, 280, 600)],
        text: [txt("Name", 72, 603, { width: 25 })],
      }),
    );
    expect(res.proposals.map((p) => p.rule)).toEqual(["labelled-rule"]);
    expect(res.excluded.filter((e) => e.rule === "comb")).toHaveLength(5);
  });

  it("a printed rule between a near-enough label and the row: no left label", () => {
    // "Ref" ends 100 pt from the row (inside COMB_LABEL_GAP), a rule between.
    const between = (segs: CardSeg[]) =>
      run(
        pg({
          rects: comb(),
          segs,
          text: [txt("Ref", 235, 603, { width: 15 })],
        }),
      ).proposals.filter((p) => p.rule === "comb-boxes");
    expect(between([])).toEqual([expect.objectContaining({ label: "Ref" })]);
    expect(between([seg(260, 600, 340, 600)])).toEqual([]);
  });

  it("a square between the label and the row: no left label", () => {
    const res = run(
      pg({
        rects: [...comb(), rect(300, 600, 14)],
        text: [txt("Ref", 235, 603, { width: 15 })],
      }),
    );
    expect(res.proposals.filter((p) => p.rule === "comb-boxes")).toEqual([]);
  });

  it("'Office use only' 430 pt to the left: no label (past COMB_LABEL_GAP)", () => {
    const res = run(
      pg({
        rects: comb(480, 600, 4),
        text: [txt("Office use only", 50, 603, { width: 0 })],
      }),
    );
    expect(res.proposals).toEqual([]);
  });

  it("a NEAR left label (within LABEL_LEFT_GAP) still wins over a caption", () => {
    const res = run(
      pg({
        rects: comb(),
        text: [
          txt("Postcode", 300, 603, { width: 40 }),
          txt("Your address", 350, 618, { width: 50, size: 9 }),
        ],
      }),
    );
    expect(res.proposals.map((p) => p.label)).toEqual(["Postcode"]);
  });

  it("a FAR left label loses to a caption over the row", () => {
    const res = run(
      pg({
        rects: comb(),
        text: [
          txt("Membership no", 200, 603, { width: 65 }),
          txt("PIN", 350, 618, { width: 15, size: 9 }),
        ],
      }),
    );
    expect(res.proposals.map((p) => p.label)).toEqual(["PIN"]);
  });
});

/* ------------------------------------------------------------------ *
 *  4. A stack's caption is never a neighbour's own label (LOW)
 * ------------------------------------------------------------------ */

describe("a radio group's caption is never another square's label", () => {
  it('a 16 pt square labelled "Big" just over the stack: "Big" stays its checkbox\'s, the group has no name', () => {
    const s = stack(["A", "B", "C"]);
    s.rects.push(rect(100, 664, 16));
    s.text.push(txt("Big", 120, 667, { width: 15 }));
    const res = run(pg(s));
    expect(res.proposals.map((p) => [p.type, p.label])).toEqual([
      ["checkbox", "Big"],
      ["radio", null],
    ]);
  });

  it("control: the same text with no square of its own names the group", () => {
    const s = stack(["A", "B", "C"]);
    s.text.push(txt("Big", 120, 667, { width: 15 }));
    expect(run(pg(s)).proposals.map((p) => [p.type, p.label])).toEqual([
      ["radio", "Big"],
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  5. A fractional pitch: the builder's stack must land (geometry MEDIUM)
 * ------------------------------------------------------------------ */

/** Every builder button's centre against its printed square's: worst offset. */
function worstOffset(p: FieldProposal, printed: CardRect[]): number {
  const boxes = fieldBoxes({ ...p, type: "radio", options: p.options });
  expect(boxes).toHaveLength(printed.length);
  return Math.max(
    ...boxes.map((b, k) => {
      const s = printed[k]!;
      return Math.max(
        Math.abs(b.x + b.width / 2 - (s.x0 + s.x1) / 2),
        Math.abs(b.y + b.height / 2 - (s.y0 + s.y1) / 2),
      );
    }),
  );
}

describe("a fractional pitch: a group only where every button lands on its square", () => {
  const opts = (n: number) =>
    ["A", "B", "C", "D", "E", "F", "G", "H"].slice(0, n);
  // The reviewer's layouts (side, gap, options), each a group at 2c49f896
  // with its last button 1.8 to 3.8 pt off. (Their fourth, side 12 at gap
  // 5.2 with 8 options, was 1.9 pt off with the stack hung from its top
  // square; centred on the mean it is within 1 pt, so it is a group below.)
  for (const [s, gap, n] of [
    [12.4, 6, 6],
    [11, 6.5, 6],
    [10.6, 6.9, 8],
  ] as const)
    it(`side ${s}, gap ${gap}, ${n} options: checkboxes (the stack would drift past RADIO_CENTRE_EPS)`, () => {
      expect(
        run(pg(stack(opts(n), { s, gap }))).proposals.map((p) => p.type),
      ).toEqual(Array(n).fill("checkbox"));
    });

  for (const [s, gap, n] of [
    [12.4, 6, 3],
    [11, 6.5, 3],
    [12, 5.2, 8],
    [12, 6, 8],
  ] as const)
    it(`side ${s}, gap ${gap}, ${n} options: one group, every button within RADIO_CENTRE_EPS of its square`, () => {
      const page = pg(stack(opts(n), { s, gap }));
      const [p, ...rest] = run(page).proposals;
      expect(rest).toEqual([]);
      expect(p!.type).toBe("radio");
      expect(worstOffset(p!, page.rects)).toBeLessThanOrEqual(
        DETECT_COMBS.RADIO_CENTRE_EPS,
      );
    });
});

/* ------------------------------------------------------------------ *
 *  6. Mutation survivors, each given a page that kills it
 * ------------------------------------------------------------------ */

describe("pages for the review's surviving mutants", () => {
  it("B14: a bulleted list of three FILLED squares at the radio gap is bullets, no group (probe R6)", () => {
    const res = run(pg(stack(["One", "Two", "Three"], { filled: true })));
    expect(res.proposals).toEqual([]);
    expect(res.excluded.map((e) => e.rule)).toEqual(Array(3).fill("bullet"));
  });

  it("A7: two DD MM YYYY rows 30 pt apart are two rows, a field per group (probe R4)", () => {
    const rects: CardRect[] = [];
    const text: CardText[] = [];
    for (const [y, label] of [
      [600, "Start"],
      [570, "End"],
    ] as const) {
      text.push(txt(label, 100, y + 3, { width: 30 }));
      for (const x of [150, 164, 186, 200, 222, 236, 250, 264])
        rects.push(rect(x, y, 14));
    }
    expect(said(pg({ rects, text }))).toEqual([
      ["comb-boxes", "Start", 2],
      ["comb-boxes", "Start", 2],
      ["comb-boxes", "Start", 4],
      ["comb-boxes", "End", 2],
      ["comb-boxes", "End", 2],
      ["comb-boxes", "End", 4],
    ]);
  });

  it("B18/B19: proposalToDraftFields carries a comb's maxLength and a radio group's options", () => {
    const base = { page: 1, x: 10, y: 10, width: 10, height: 10 };
    const specs = proposalToDraftFields([
      {
        ...base,
        key: "a",
        type: "text",
        label: "PIN",
        rule: "comb-boxes",
        maxLength: 4,
      },
      {
        ...base,
        key: "b",
        type: "radio",
        label: "Contact",
        rule: "radio-stack",
        options: ["Email", "Phone"],
      },
      { ...base, key: "c", type: "text", label: "Name", rule: "labelled-rule" },
    ]);
    expect(specs).toEqual([
      expect.objectContaining({ type: "text", name: "pin", maxLength: 4 }),
      expect.objectContaining({
        type: "radio",
        name: "contact",
        options: ["Email", "Phone"],
      }),
      expect.not.objectContaining({ maxLength: expect.anything() }),
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  7. Decisions pinned (LOW findings, not defects)
 * ------------------------------------------------------------------ */

describe("decisions the review asked to record", () => {
  it("an SSN 3-2-4 with dashes: three fields of 3, 2 and 4 (each group alone is short; the ROW holds 9)", () => {
    const rects: CardRect[] = [];
    const xs = [150, 164, 178, 202, 216, 240, 254, 268, 282];
    for (const x of xs) rects.push(rect(x, 400, 14));
    const text = [
      txt("Social security number", 20, 403, { width: 110 }),
      txt("-", 194, 403, { width: 4 }),
      txt("-", 232, 403, { width: 4 }),
    ];
    expect(said(pg({ rects, text }))).toEqual([
      ["comb-boxes", "Social security number", 3],
      ["comb-boxes", "Social security number", 2],
      ["comb-boxes", "Social security number", 4],
    ]);
  });

  it("a practice sheet (rows of 20 touching boxes, 6 pt apart, one label): one field on the labelled row, the rest `comb`", () => {
    const rects: CardRect[] = [];
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 20; k++)
        rects.push(rect(100 + 10 * k, 600 - 16 * r, 10));
    const res = run(
      pg({ rects, text: [txt("Notes", 60, 603, { width: 25 })] }),
    );
    expect(
      said(pg({ rects, text: [txt("Notes", 60, 603, { width: 25 })] })),
    ).toEqual([["comb-boxes", "Notes", 20]]);
    expect(res.excluded.filter((e) => e.rule === "comb")).toHaveLength(60);
  });
});

/* ------------------------------------------------------------------ *
 *  8. The round's corpus cases, to the saved PDF
 * ------------------------------------------------------------------ */

const RUNS = new Map<string, CaseRun>();
const ROUND = ["P102", "P103", "P104", "P105", "P106", "N95"];
beforeAll(async () => {
  for (const id of ROUND)
    RUNS.set(id, await runCase(COMB_CASES.find((c) => c.id === id)!));
}, 120_000);

interface Saved {
  name: string;
  rect: number[];
  checkBox: boolean;
  radioButton: boolean;
  maxLen: number;
}

async function chain(id: string) {
  const c = COMB_CASES.find((x) => x.id === id)!;
  const bytes = await c.build();
  const report = await detectFormFields(bytes, { loadReader: legacyPdfjs });
  const found = report.pages.flatMap((p) =>
    p.outcome === "found" ? p.proposals : [],
  );
  const context = await readFormContext(bytes);
  const { added, dropped } = toAdd(
    found,
    new Set(found.map((p) => p.key)),
    context.existingNames,
    (specs) =>
      validateFormFields(specs, context.pageSizes, context.existingNames),
  );
  expect(dropped).toEqual([]);
  const out = (
    await createFormFields(
      bytes,
      added.map((a) => a.spec),
    )
  ).bytes;
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const task = pdfjs.getDocument({
    data: out.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const saved: Saved[] = [];
    for (const a of await (await doc.getPage(1)).getAnnotations())
      if (a.subtype === "Widget")
        saved.push({
          name: String(a.fieldName),
          rect: a.rect as number[],
          checkBox: a.checkBox === true,
          radioButton: a.radioButton === true,
          maxLen: Number(a.maxLen ?? 0),
        });
    return { found, out, saved };
  } finally {
    await task.destroy();
  }
}

const centreOff = (r: number[], p: Printed) =>
  Math.max(
    Math.abs((r[0]! + r[2]!) / 2 - (p.x0 + p.x1) / 2),
    Math.abs((r[1]! + r[3]!) / 2 - (p.y0 + p.y1) / 2),
  );

describe("the round's cases through the reader and to the saved PDF", () => {
  it("health: every round case ran, and the reader proposed on the positives", () => {
    expect(RUNS.size).toBe(ROUND.length);
    for (const id of ["P102", "P103", "P104", "P105", "P106"])
      expect(RUNS.get(id)!.proposals.length, id).toBeGreaterThan(0);
    expect(RUNS.get("N95")!.proposals).toEqual([]);
  });

  for (const id of ["P102", "P103", "P105"])
    it(`${id}: saved as independent checkboxes, a widget centred on each printed square`, async () => {
      const { saved, out } = await chain(id);
      const printed = PRINTED[id]!;
      expect(saved).toHaveLength(printed.length);
      expect(saved.every((s) => s.checkBox && !s.radioButton)).toBe(true);
      expect(new Set(saved.map((s) => s.name)).size).toBe(printed.length);
      for (const p of printed)
        expect(saved.some((w) => centreOff(w.rect, p) <= 0.5)).toBe(true);
      const fields = (await PDFDocument.load(out)).getForm().getFields();
      expect(fields.some((f) => f instanceof PDFRadioGroup)).toBe(false);
    }, 60_000);

  it("P104: ONE radio field at a fractional pitch, a kid within RADIO_CENTRE_EPS of each printed square", async () => {
    const { saved, out } = await chain("P104");
    const printed = PRINTED.P104!;
    expect(saved).toHaveLength(printed.length);
    expect(new Set(saved.map((s) => s.name)).size).toBe(1);
    expect(saved.every((s) => s.radioButton)).toBe(true);
    const byTop = [...saved].sort((a, b) => b.rect[1]! - a.rect[1]!);
    byTop.forEach((w, k) =>
      expect(centreOff(w.rect, printed[k]!)).toBeLessThanOrEqual(
        DETECT_COMBS.RADIO_CENTRE_EPS,
      ),
    );
    const [f] = (await PDFDocument.load(out)).getForm().getFields();
    expect((f as PDFRadioGroup).getOptions()).toEqual([...S6.P104.options]);
  }, 60_000);

  it("P106: the comb is saved under its caption's name, /MaxLen 4, over the printed run", async () => {
    const { saved, out } = await chain("P106");
    expect(saved).toHaveLength(1);
    const cells = PRINTED.P106!;
    const [w] = saved;
    expect(w!.name).toBe("pin");
    expect(w!.maxLen).toBe(4);
    expect(Math.abs(w!.rect[0]! - cells[0]!.x0)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(w!.rect[2]! - cells[3]!.x1)).toBeLessThanOrEqual(0.5);
    const [f] = (await PDFDocument.load(out)).getForm().getFields();
    expect((f as PDFTextField).getMaxLength()).toBe(4);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  9. Copy: comb and radio over-claims, refused both ways
 * ------------------------------------------------------------------ */

/**
 * Shapes of a claim about combs and radio groups the finder cannot keep.
 * Kept here, beside the behaviour that makes each false, rather than in
 * create-forms-detect-copy.test.ts; read over the same discovered corpus.
 */
const BANNED: Record<string, RegExp> = {
  // A universal comb claim: unlabelled rows, short rows, graph paper and
  // rating rows are not suggested.
  combEvery:
    /\b(?:every|all|any|always)\b[^.;:]*\b(?:rows?|runs?|combs?)\b[^.;:]*\bbox(?:es)?\b[^.;:]*\b(?:suggest\w*|found|finds?|detect\w*|propos\w*|becomes?|made|turn\w*)\b/i,
  // A universal radio claim: multi-answer stacks, columns and fractional
  // pitches stay checkboxes.
  radioEvery:
    /\b(?:stack\w*|option)\b[^.;:]*\b(?:always|every|all|any)\b[^.;:]*\bradio\b|\b(?:always|every|all|any)\b[^.;:]*\b(?:stack\w*|option)\b[^.;:]*\bradio\b/i,
  // Character boxes passed over without a qualifier: false since S6 for
  // a labelled row of four or more.
  combPassedOver:
    /\b(?:pass(?:es|ed)? over|skips?|ignores?|leaves? out)\b[^.]*\b(?:a|any|every|all)\s+(?:rows?|runs?)\s+of\s+(?:(?:letter|character|digit|comb)\s+)?box(?:es)?\b/i,
};

const OVERCLAIMS = [
  // The FAQ as it shipped before S6 (the clause S6 made false).
  "It passes over a line with no label beside it, the cells of a table it reads as a grid, a row of boxes for one letter each, a line labelled as a signature and a line that already has a field, so add those with Add field.",
  // The review's copy mutants D1, D2 and D4, each green on the old guard.
  "Stacked option boxes are always suggested as one radio group, so check them.",
  "It passes over a row of letter boxes, so add those with Add field.",
  "Every row of four or more boxes for one character each is suggested as one text field.",
  "Every stack of option boxes becomes a radio group.",
];

const banned = (s: string) =>
  Object.entries(BANNED)
    .filter(([, re]) => re.test(s))
    .map(([name]) => name);

describe("comb and radio copy: no over-claim, both ways", () => {
  it("each banned shape catches an over-claim, and each over-claim is caught", () => {
    for (const s of OVERCLAIMS) expect(banned(s), s).not.toEqual([]);
    for (const name of Object.keys(BANNED))
      expect(
        OVERCLAIMS.some((s) => banned(s).includes(name)),
        `${name} catches an over-claim`,
      ).toBe(true);
  });

  it("nothing served matches one, and the served corpus holds the comb and radio sentences", () => {
    const served = createFormsCorpus();
    // Health: the corpus is the discovered set, and it holds what is judged.
    expect(served.length).toBeGreaterThan(200);
    const all = served.map((s) => s.text).join("\n");
    expect(all).toMatch(/four or more boxes for single characters/);
    expect(all).toMatch(/radio group/);
    expect(served.filter((s) => banned(s.text).length > 0)).toEqual([]);
  });

  it("the FAQ names the multi-answer exception while the reader keeps P102 checkboxes", () => {
    expect(RUNS.get("P102")!.proposals.map((p) => p.type)).toEqual(
      Array(4).fill("checkbox"),
    );
    const sentence = createFormsCorpus()
      .map((s) => s.text)
      .join("\n")
      .split(/(?<=[.!?])\s+/)
      .find((x) => /radio group/i.test(x) && /\bstacked\b/.test(x));
    expect(sentence).toMatch(
      /unless the words over them ask for more than one answer/,
    );
  });
});
