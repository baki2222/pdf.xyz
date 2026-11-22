import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import type { Box } from "@/lib/pdf/form-detect";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { DetectCase, Expect } from "./form-detect-fixtures";
import {
  boxFont,
  drawBoxes,
  glyphBox,
  t3Advance,
} from "./form-detect-precision-fixtures";

/**
 * TEST ONLY. Slice S6's corpus cases (combs and radio clusters), joined
 * onto DETECT_CASES by src/tests/form-detect-fixtures.ts so the corpus run
 * both ways (form-detect.corpus.test.ts) and the real reader discover them
 * like every other case.
 *
 * Self-contained, as the S4 and S5 fixture files are: the main fixtures
 * file imports this one, so this one imports only types from it (and the
 * S3 file's Type 3 box font, for the glyph stack). Expected boxes are
 * computed from what each case draws and from numbers typed here, never
 * read back from DETECT or DETECT_COMBS:
 *
 *  - a comb's text field is the printed run itself, edge to edge (no
 *    inset: a comb flag, should the builder ever set one, divides the
 *    field's width by its character limit, so the field must be the run);
 *  - a radio group's box is its TOP button: a square of the printed pitch
 *    less 6 pt (the builder's own stacking gap, typed here, not imported),
 *    centred on the top printed square, rounded to whole points;
 *  - a checkbox is its square inset 1 pt.
 *
 * {@link PRINTED} is where each composed-chain case drew what it expects a
 * field over (page 1, PDF points): form-detect-combs.test.ts holds every
 * saved widget to it.
 */

const LETTER: [number, number] = [612, 792];

const save = (d: PDFDocument) => d.save({ useObjectStreams: false });

async function text(
  page: PDFPage,
  s: string,
  x: number,
  y: number,
  size = 10,
): Promise<void> {
  page.drawText(s, {
    x,
    y,
    size,
    font: await embedDrawingFont(page.doc, [s], "sans"),
    color: rgb(0, 0, 0),
  });
}

function square(page: PDFPage, x: number, y: number, s: number): void {
  page.drawRectangle({
    x,
    y,
    width: s,
    height: s,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
}

function rule(page: PDFPage, x0: number, x1: number, y: number): void {
  page.drawLine({
    start: { x: x0, y },
    end: { x: x1, y },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
}

function vline(page: PDFPage, x: number, y0: number, y1: number): void {
  page.drawLine({
    start: { x, y: y0 },
    end: { x, y: y1 },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
}

async function onePage(
  draw: (page: PDFPage) => Promise<void> | void,
): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  await draw(d.addPage(LETTER));
  return save(d);
}

/** One printed square, PDF points. */
export interface Printed {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const sq = (x: number, y: number, s: number): Printed => ({
  x0: x,
  y0: y,
  x1: x + s,
  y1: y + s,
});

/** A comb's field: the run from its first cell's left to its last's right. */
function combField(label: string | null, cells: readonly Printed[]): Expect {
  const x0 = cells[0]!.x0;
  const x1 = cells[cells.length - 1]!.x1;
  return {
    rule: "comb-boxes",
    type: "text",
    label,
    page: 1,
    box: {
      x: x0,
      y: cells[0]!.y0,
      width: x1 - x0,
      height: cells[0]!.y1 - cells[0]!.y0,
    },
    maxLength: cells.length,
  };
}

/** The builder's gap between stacked radio buttons, typed (not imported). */
const BUILDER_GAP = 6;

/** A radio group's top button over a printed stack (top square first). */
function radioField(
  label: string | null,
  stack: readonly Printed[],
  options: string[],
): Expect {
  const top = stack[0]!;
  const pitch = (top.y0 - stack[stack.length - 1]!.y0) / (stack.length - 1);
  const step = Math.round(pitch);
  const s = step - BUILDER_GAP;
  const x = Math.round((top.x0 + top.x1) / 2 - s / 2);
  // The top button's centre: where each printed square puts it (its own
  // centre, raised by its place in the stack at the builder's whole-point
  // step), averaged, so a fractional pitch's drift splits above and below
  // (review round 1). At a whole-point pitch it is the top square's centre.
  const centre =
    stack.reduce((sum, p, k) => sum + (p.y0 + p.y1) / 2 + k * step, 0) /
    stack.length;
  const y = Math.round(centre - s / 2);
  return {
    rule: "radio-stack",
    type: "radio",
    label,
    page: 1,
    box: { x, y, width: s, height: s },
    options,
  };
}

/** A square's checkbox: inset 1 pt. */
function checkbox(label: string, p: Printed): Expect {
  const side = Math.min(p.x1 - p.x0, p.y1 - p.y0) - 2;
  const box: Box = { x: p.x0 + 1, y: p.y0 + 1, width: side, height: side };
  return { rule: "square-checkbox", type: "checkbox", label, page: 1, box };
}

/** `n` equal cells of side `s`, edge to edge, from (x, y). */
const run = (x: number, y: number, s: number, n: number): Printed[] =>
  Array.from({ length: n }, (_, k) => sq(x + s * k, y, s));

/** A column of squares of side `s`, top one at y, each `pitch` lower. */
const column = (
  x: number,
  y: number,
  s: number,
  pitch: number,
  n: number,
): Printed[] => Array.from({ length: n }, (_, k) => sq(x, y - pitch * k, s));

/* ------------------------------------------------------------------ *
 *  The geometry each case draws
 * ------------------------------------------------------------------ */

/** Each case's printed shapes, typed once and read by build and expect. */
export const S6 = {
  P90: { cells: run(150, 400, 14, 8), label: "Account number" },
  P91: {
    groups: [run(140, 500, 14, 2), run(176, 500, 14, 2), run(212, 500, 14, 4)],
    slashes: [170.6, 206.6],
    label: "Date of birth",
  },
  P92: { cells: run(300, 600, 14, 6), caption: "Postcode" },
  P93: {
    stack: column(72, 650, 12, 18, 3),
    options: ["Email", "Phone", "Post"],
    caption: "Preferred contact",
  },
  P94: {
    stack: column(300, 500, 12, 17, 4),
    options: ["Red", "Green", "Blue", "Other"],
  },
  P95: {
    stack: column(400, 400, 12, 19, 3),
    options: ["Yes", "No", "Not sure"],
  },
  /** A two-column ruled table, the comb in row 1's right cell. */
  P96: {
    xs: [72, 200, 400],
    ys: [328, 352, 376, 400],
    rows: ["Account number", "Name", "City"],
    cells: run(210, 381, 14, 8),
  },
  P97: {
    stack: column(72, 300, 12, 24, 3),
    options: ["Passport", "Driving licence", "Utility bill"],
  },
  P98: { stack: column(300, 300, 12, 18, 2), options: ["Yes", "No"] },
  P99: {
    row: [sq(72, 200, 12), sq(140, 200, 12), sq(208, 200, 12)],
    options: ["Yes", "No", "Maybe"],
  },
  P100: {
    stack: [sq(300, 214, 14), sq(300, 196, 12), sq(300, 180, 10)],
    options: ["Small", "Medium", "Large"],
  },
  /** Box symbols at 12 pt, 14 pt apart: their ink is 8.4 pt, a gap of 5.6. */
  P101: { x: 72, ys: [700, 686, 672], options: ["Tea", "Coffee", "Water"] },
  N91: { cells: run(200, 300, 14, 6) },
  N92: { cells: run(150, 250, 14, 3), label: "Age" },
  N93: {
    cells: [
      sq(150, 200, 12),
      sq(162, 200, 14),
      sq(176, 200, 12),
      sq(188, 200, 14),
    ],
    label: "Code",
  },
  N94: { x: 150, top: 600, side: 12, rows: 6, cols: 10, label: "Sketch" },
  // Review round 1 (2026-11-22): the corpus had no multi-answer stack at
  // the radio gap, no fractional pitch, no far-left text beside a
  // captioned comb, and no rating row of touching boxes.
  P102: {
    stack: column(72, 650, 12, 18, 4),
    options: ["Fever", "Cough", "Headache", "Fatigue"],
    caption: "Tick all that apply",
  },
  P103: {
    stack: column(300, 650, 12, 18, 3),
    options: [
      "I agree to the terms of service",
      "Send me the newsletter",
      "I consent to data processing",
    ],
  },
  /** 12.4 pt squares, gap 6: a pitch of 18.4, three of them (drift 0.4 a row). */
  P104: {
    stack: column(72, 500, 12.4, 18.4, 3),
    options: ["Small", "Medium", "Large"],
  },
  /** The same pitch, six of them: the last button would sit 2 pt off. */
  P105: {
    stack: column(300, 500, 12.4, 18.4, 6),
    options: ["One", "Two", "Three", "Four", "Five", "Six"],
  },
  P106: {
    cells: run(480, 300, 14, 4),
    caption: "PIN",
    far: "Office use only",
  },
  N95: {
    ys: [200, 180, 160],
    rows: ["Service quality", "Value for money", "Staff"],
    heads: ["1", "2", "3", "4", "5"],
    x: 250,
  },
} as const;

/** Where the composed chain must find each saved widget, by case. */
export const PRINTED: Record<string, readonly Printed[]> = {
  P90: S6.P90.cells,
  P91: S6.P91.groups.flat(),
  P92: S6.P92.cells,
  P93: S6.P93.stack,
  P94: S6.P94.stack,
  P95: S6.P95.stack,
  P97: S6.P97.stack,
  P102: S6.P102.stack,
  P103: S6.P103.stack,
  P104: S6.P104.stack,
  P105: S6.P105.stack,
  P106: S6.P106.cells,
};

/* ------------------------------------------------------------------ *
 *  The cases
 * ------------------------------------------------------------------ */

export const COMB_CASES: readonly DetectCase[] = [
  {
    id: "P90",
    kind: "positive",
    note: '"Account number" beside eight equal 14 pt boxes edge to edge: ONE text field over the eight, limited to 8 characters, never eight checkboxes',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.P90.label, 72, 403);
        for (const c of S6.P90.cells) square(page, c.x0, c.y0, 14);
      }),
    expect: [combField(S6.P90.label, S6.P90.cells)],
  },
  {
    id: "P91",
    kind: "positive",
    note: '"Date of birth" beside DD MM YYYY boxes in three groups 8 pt apart, a "/" between them: one field per group (2, 2 and 4 characters), each named from the label',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.P91.label, 72, 503);
        for (const c of S6.P91.groups.flat()) square(page, c.x0, c.y0, 14);
        for (const x of S6.P91.slashes) await text(page, "/", x, 503);
      }),
    expect: S6.P91.groups.map((g) => combField(S6.P91.label, g)),
  },
  {
    id: "P92",
    kind: "positive",
    note: '"Postcode" printed over six boxes, nothing to their left: the caption labels one 6-character field',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.P92.caption, 300, 618, 9);
        for (const c of S6.P92.cells) square(page, c.x0, c.y0, 14);
      }),
    expect: [combField(S6.P92.caption, S6.P92.cells)],
  },
  {
    id: "P93",
    kind: "positive",
    note: '"Preferred contact" over three 12 pt boxes stacked 6 pt apart, "Email", "Phone", "Post" to their right: one radio group of three, named from the caption',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.P93.caption, 72, 668);
        for (const [k, c] of S6.P93.stack.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P93.options[k]!, 88, c.y0 + 2);
        }
      }),
    expect: [radioField(S6.P93.caption, S6.P93.stack, [...S6.P93.options])],
  },
  {
    id: "P94",
    kind: "positive",
    note: "four 12 pt boxes stacked 5 pt apart (the builder's gap less 1), each labelled on its right, no caption: one radio group, buttons 11 pt so the builder's stack lands on the printed one",
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P94.stack.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P94.options[k]!, 316, c.y0 + 2);
        }
      }),
    expect: [radioField(null, S6.P94.stack, [...S6.P94.options])],
  },
  {
    id: "P95",
    kind: "positive",
    note: "three 12 pt boxes stacked 7 pt apart (the builder's gap plus 1), labelled on the right: one radio group, buttons 13 pt",
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P95.stack.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P95.options[k]!, 416, c.y0 + 2);
        }
      }),
    expect: [radioField(null, S6.P95.stack, [...S6.P95.options])],
  },
  {
    id: "P96",
    kind: "positive",
    note: 'a two-column ruled table, "Account number" | eight comb boxes in row 1, "Name" and "City" with empty right cells: the comb is one 8-character field named from its row; DECIDED, the table is no label table (one of its right cells holds drawn boxes, S5), so Name and City are left to Add field and its rules are table-grid',
    build: () =>
      onePage(async (page) => {
        const { xs, ys, rows, cells } = S6.P96;
        for (const y of ys) rule(page, xs[0]!, xs[2]!, y);
        for (const x of xs) vline(page, x, ys[0]!, ys[3]!);
        for (const [r, s] of rows.entries())
          await text(page, s, xs[0]! + 4, ys[3 - r]! - 16);
        for (const c of cells) square(page, c.x0, c.y0, 14);
      }),
    expect: [combField("Account number", S6.P96.cells)],
  },
  {
    id: "P97",
    kind: "positive",
    note: "a checklist: three 12 pt boxes 12 pt apart, each labelled on its right: three checkboxes, not a radio group (the builder could not stack them where they are printed)",
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P97.stack.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P97.options[k]!, 88, c.y0 + 2);
        }
      }),
    expect: S6.P97.stack.map((c, k) => checkbox(S6.P97.options[k]!, c)),
  },
  {
    id: "P98",
    kind: "positive",
    note: '"Yes" and "No", two boxes stacked 6 pt apart: two checkboxes (a radio group needs three)',
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P98.stack.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P98.options[k]!, 316, c.y0 + 2);
        }
      }),
    expect: S6.P98.stack.map((c, k) => checkbox(S6.P98.options[k]!, c)),
  },
  {
    id: "P99",
    kind: "positive",
    note: '"[] Yes [] No [] Maybe" in one row: three checkboxes (the builder stacks a radio group downward only)',
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P99.row.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P99.options[k]!, c.x1 + 4, c.y0 + 2);
        }
      }),
    expect: S6.P99.row.map((c, k) => checkbox(S6.P99.options[k]!, c)),
  },
  {
    id: "P100",
    kind: "positive",
    note: "three boxes of 14, 12 and 10 pt stacked 4 pt apart, labelled on the right: three checkboxes (a radio group's buttons are one size)",
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P100.stack.entries()) {
          square(page, c.x0, c.y0, c.x1 - c.x0);
          await text(page, S6.P100.options[k]!, c.x1 + 4, c.y0 + 2);
        }
      }),
    expect: S6.P100.stack.map((c, k) => checkbox(S6.P100.options[k]!, c)),
  },
  {
    id: "P101",
    kind: "positive",
    note: "three box SYMBOLS (U+2610) typed in a column, 14 pt apart, labels to their right: three checkboxes, never a radio group (typed boxes are not drawn squares)",
    build: () =>
      onePage(async (page) => {
        boxFont(page);
        const { x, ys, options } = S6.P101;
        for (const [k, y] of ys.entries()) {
          drawBoxes(page, ["empty"], x, y, 12);
          await text(page, options[k]!, x + t3Advance(12) + 4, y, 12);
        }
      }),
    expect: S6.P101.ys.map((y, k) => ({
      rule: "box-glyph" as const,
      type: "checkbox" as const,
      label: S6.P101.options[k]!,
      page: 1,
      box: glyphBox(S6.P101.x, t3Advance(12), y, 12),
    })),
  },
  {
    id: "N91",
    kind: "negative",
    note: "six comb boxes with no label anywhere near: no field (a comb needs a label), and never six checkboxes",
    build: () =>
      onePage((page) => {
        for (const c of S6.N91.cells) square(page, c.x0, c.y0, 14);
      }),
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: 207, y: 307 },
    seamAlsoDisable: ["unlabelled"],
  },
  {
    id: "N92",
    kind: "negative",
    note: '"Age" beside three comb boxes: fewer than four, so no field, as before slice S6',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.N92.label, 120, 253);
        for (const c of S6.N92.cells) square(page, c.x0, c.y0, 14);
      }),
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: 157, y: 257 },
  },
  {
    id: "N93",
    kind: "negative",
    note: '"Code" beside four boxes of 12 and 14 pt alternately, edge to edge: not a comb (its cells differ), so no comb field; the two within reach of the label are checkboxes, as before slice S6, and the rest unlabelled',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.N93.label, 120, 203);
        for (const c of S6.N93.cells) square(page, c.x0, c.y0, c.x1 - c.x0);
      }),
    expect: [
      checkbox(S6.N93.label, S6.N93.cells[0]),
      checkbox(S6.N93.label, S6.N93.cells[1]),
    ],
    decidedBy: "unlabelled",
    at: { page: 1, x: 182, y: 206 },
  },
  {
    id: "N94",
    kind: "negative",
    note: 'graph paper: a grid of 6 x 10 edge-to-edge 12 pt squares, "Sketch" to the left of its top row: no comb field and no radio group',
    build: () =>
      onePage(async (page) => {
        const { x, top, side, rows, cols, label } = S6.N94;
        await text(page, label, 100, top + 3);
        for (let r = 0; r < rows; r++)
          for (let k = 0; k < cols; k++)
            square(page, x + side * k, top - side * r, side);
      }),
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: 156, y: 606 },
  },
  {
    id: "P102",
    kind: "positive",
    note: '"Tick all that apply" over four 12 pt boxes stacked 6 pt apart, labelled on the right: four checkboxes, never one radio group (a radio group would allow one answer)',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.P102.caption, 72, 668);
        for (const [k, c] of S6.P102.stack.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P102.options[k]!, 88, c.y0 + 2);
        }
      }),
    expect: S6.P102.stack.map((c, k) => checkbox(S6.P102.options[k]!, c)),
  },
  {
    id: "P103",
    kind: "positive",
    note: 'a consent stack at the radio gap ("I agree to the terms of service", "Send me the newsletter", "I consent to data processing"): three checkboxes, each ticked on its own',
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P103.stack.entries()) {
          square(page, c.x0, c.y0, 12);
          await text(page, S6.P103.options[k]!, 316, c.y0 + 2);
        }
      }),
    expect: S6.P103.stack.map((c, k) => checkbox(S6.P103.options[k]!, c)),
  },
  {
    id: "P104",
    kind: "positive",
    note: "three 12.4 pt boxes 6 pt apart (a fractional 18.4 pt pitch), labelled on the right: one radio group, its whole-point buttons within 1 pt of each printed square's centre",
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P104.stack.entries()) {
          square(page, c.x0, c.y0, c.x1 - c.x0);
          await text(page, S6.P104.options[k]!, 89, c.y0 + 2);
        }
      }),
    expect: [radioField(null, S6.P104.stack, [...S6.P104.options])],
  },
  {
    id: "P105",
    kind: "positive",
    note: "six 12.4 pt boxes at the same fractional pitch: six checkboxes (the builder's whole-point stack would end 2 pt off the last square)",
    build: () =>
      onePage(async (page) => {
        for (const [k, c] of S6.P105.stack.entries()) {
          square(page, c.x0, c.y0, c.x1 - c.x0);
          await text(page, S6.P105.options[k]!, 317, c.y0 + 2);
        }
      }),
    expect: S6.P105.stack.map((c, k) => checkbox(S6.P105.options[k]!, c)),
  },
  {
    id: "P106",
    kind: "positive",
    note: '"PIN" over four comb boxes, "Office use only" 400 pt to their left on the same row: one 4-character field named from its caption, never from the far text',
    build: () =>
      onePage(async (page) => {
        await text(page, S6.P106.far, 50, 303);
        await text(page, S6.P106.caption, 480, 318, 9);
        for (const c of S6.P106.cells) square(page, c.x0, c.y0, 14);
      }),
    expect: [combField(S6.P106.caption, S6.P106.cells)],
  },
  {
    id: "N95",
    kind: "negative",
    note: 'a rating grid of touching boxes: three labelled rows of five 14 pt boxes, 6 pt apart, under the heads "1" to "5" 26 pt over the top row: no text fields (a scale is ticked, not typed into), every box `comb`',
    build: () =>
      onePage(async (page) => {
        const { ys, rows, heads, x } = S6.N95;
        for (const [r, y] of ys.entries()) {
          await text(page, rows[r]!, 100, y + 3);
          for (const c of run(x, y, 14, 5)) square(page, c.x0, c.y0, 14);
        }
        // The heads 26 pt over the top row: past a headed grid's reach
        // (GRID_HEAD_ABOVE 20, which would make these checkboxes), so only
        // the scale's own reach (40) leaves them out.
        for (const [k, h] of heads.entries())
          await text(page, h, x + 14 * k + 5, ys[0]! + 40, 8);
      }),
    expect: "none",
    decidedBy: "comb",
    at: { page: 1, x: 257, y: 187 },
    // Its row label is 80 pt off, past a square's label reach, as N91's.
    seamAlsoDisable: ["unlabelled"],
  },
];
