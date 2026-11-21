import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Box } from "@/lib/pdf/form-detect";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { DetectCase, Expect } from "./form-detect-fixtures";

/**
 * TEST ONLY. Slice S5's corpus cases (tables: empty ruled cells), joined
 * onto DETECT_CASES by src/tests/form-detect-fixtures.ts so the corpus run
 * both ways (form-detect.corpus.test.ts) and the real reader discover them
 * like every other case.
 *
 * Self-contained, as form-detect-boxes-fixtures.ts is: the main fixtures
 * file imports this one, so this one imports only types from it. Expected
 * boxes are computed from what each case draws and from numbers typed
 * here (a cell's field is the cell inset 1 pt; a captioned box's strip is
 * 1 pt over its bottom edge, 1.4 em tall clamped to 14..22), never read
 * back from DETECT, DETECT_BOXES or DETECT_TABLES. Labels are typed out
 * in full per case ("Item row 1"), so a change to how a cell is named
 * turns a case red rather than agreeing with itself.
 *
 * {@link PRINTED_CELLS} is where each composed-chain case drew the cells
 * it expects fields in (page 1, PDF points): the saved widget must lie
 * inside one of them.
 */

const LETTER: [number, number] = [612, 792];

const save = (d: PDFDocument) => d.save({ useObjectStreams: false });

let helvetica: PDFFont | undefined;
const measure = async () =>
  (helvetica ??= await embedDrawingFont(
    await PDFDocument.create(),
    ["Name: _"],
    "sans",
  ));

/** pdf-lib's own width of `s` in Helvetica at `size`. */
export async function width(s: string, size: number): Promise<number> {
  return (await measure()).widthOfTextAtSize(s, size);
}

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

function box(page: PDFPage, x: number, y: number, w: number, h: number): void {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.75,
  });
}

/** A ruled grid: a rule at every y, a plumb line at every x, end to end. */
function grid(page: PDFPage, xs: readonly number[], ys: readonly number[]) {
  const [x0, x1] = [xs[0]!, xs[xs.length - 1]!];
  const [y0, y1] = [ys[0]!, ys[ys.length - 1]!];
  for (const y of ys) rule(page, x0, x1, y);
  for (const x of xs) vline(page, x, y0, y1);
}

function rounded(x0: number, y0: number, x1: number, y1: number): Box {
  const x = Math.round(x0);
  const y = Math.round(y0);
  return { x, y, width: Math.round(x1) - x, height: Math.round(y1) - y };
}

/** The field filling a cell from (x0, y0) to (x1, y1): inset 1 pt. */
export function cellField(x0: number, x1: number, y0: number, y1: number) {
  return rounded(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
}

/** The strip along a captioned box's bottom edge, its caption `size` pt. */
function stripField(x0: number, x1: number, y0: number, size: number): Box {
  const h = Math.min(22, Math.max(14, 1.4 * size));
  return rounded(x0 + 1, y0 + 1, x1 - 1, y0 + 1 + h);
}

async function onePage(
  draw: (page: PDFPage) => Promise<void> | void,
): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  await draw(d.addPage(LETTER));
  return save(d);
}

/** Cell (row r from the top, column k) of a grid, as [x0, x1, y0, y1]. */
function cellOf(
  xs: readonly number[],
  ys: readonly number[],
  r: number,
  k: number,
): [number, number, number, number] {
  const top = ys.length - 1 - r;
  return [xs[k]!, xs[k + 1]!, ys[top - 1]!, ys[top]!];
}

const header = (
  label: string,
  c: [number, number, number, number],
): Expect => ({
  rule: "header-cell",
  type: "text",
  label,
  page: 1,
  box: cellField(...c),
});

/* ------------------------------------------------------------------ *
 *  Geometry, shared with the composed chain
 * ------------------------------------------------------------------ */

const range = (from: number, step: number, n: number) =>
  Array.from({ length: n }, (_, i) => from + step * i);

/** [x lines], [y rules, bottom up] and the words of each case. */
export const S5 = {
  /** 3 rows x 4 columns: a header row, two empty rows. */
  P78: {
    xs: [72, 200, 300, 400, 540],
    ys: [552, 576, 600, 624],
    head: ["Item", "Qty", "Unit price", "Amount"],
  },
  /** An invoice: a header, three filled line items, five empty ones. */
  P79: {
    xs: [72, 340, 420, 540],
    ys: range(440, 20, 10),
    head: ["Description", "Qty", "Amount"],
    filled: [
      ["Copier paper A4", "4", "19.96"],
      ["Toner cartridge", "1", "54.00"],
      ["Archive boxes", "2", "11.50"],
    ],
  },
  /** Cells drawn as separate boxes sharing their edges, 3 x 3. */
  P80: {
    xs: [72, 222, 372, 522],
    ys: [550, 576, 602, 628],
    head: ["Name", "Role", "Phone"],
  },
  /** Column heads printed over the grid's top rule, two empty rows. */
  P81: {
    xs: [72, 180, 400, 500],
    ys: [560, 584, 608],
    head: ["Date", "Activity", "Hours"],
  },
  /** One row of three touching boxes, a small caption in each top-left. */
  P82: {
    xs: [72, 300, 400, 540],
    ys: [600, 630],
    head: ["City", "State", "ZIP code"],
  },
  /** One row of three touching boxes, each captioned 4 pt over its top. */
  P83: {
    xs: [72, 300, 400, 540],
    ys: [600, 624],
    head: ["City", "State", "ZIP code"],
  },
  /** A box drawn twice 1 pt apart (a doubled border), labelled at its left. */
  P84: { inner: [141, 601, 298, 28], outer: [140, 600, 300, 30] },
  /** Labelled lines inside one big outer box (no table: S4's fields). */
  P85: {
    outer: [72, 400, 468, 200],
    lines: [
      ["Name:", 560],
      ["Email:", 520],
      ["Phone:", 480],
    ] as [string, number][],
  },
  /** A data table with one gap in a filled row: no field. */
  N79: {
    xs: [72, 240, 340, 440],
    ys: [530, 560, 590, 620, 650],
    head: ["Item", "Qty", "Price"],
    rows: [
      ["Bolt", "4", "1.00"],
      ["Nut", "", "0.50"],
      ["Washer", "10", "0.10"],
    ],
  },
  /** 4 columns x 51 empty rows, 12 pt each: 204 empty cells, over 200. */
  N80: { xs: [72, 190, 310, 430, 540], ys: range(100, 12, 53) },
  N81: {
    gridlines: [440, 480, 520, 560, 600],
    ticks: [150, 200, 250, 300, 350],
  },
  N82: {
    xs: [100, 160, 220, 280, 340, 400],
    ys: [400, 440, 480, 520, 560],
  },
  /** A month: Mon to Sun, five weeks, the first starting on a Thursday. */
  N83: {
    xs: range(72, 70, 8),
    ys: range(340, 40, 7),
    head: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },
  N84: {
    boxes: [
      [72, 200, 234, 500],
      [306, 200, 234, 500],
    ],
  },
  /** One row of FIVE touching captioned boxes: past the 2-4 of a strip. */
  N85: {
    xs: [72, 160, 250, 340, 430, 520],
    ys: [600, 630],
    head: ["Day", "Month", "Year", "Code", "Office"],
  },
} as const;

/** The calendar's day in week w (0-4), weekday k (0-6), or "" (none). */
const calendarDay = (w: number, k: number) => {
  const n = w * 7 + k - 2;
  return n >= 1 && n <= 31 ? String(n) : "";
};

/** Where each composed-chain case drew the cells it expects fields in. */
export const PRINTED_CELLS: Record<
  string,
  { x0: number; y0: number; x1: number; y1: number }[]
> = (() => {
  const cells = (
    xs: readonly number[],
    ys: readonly number[],
    rows: readonly number[],
  ) =>
    rows.flatMap((r) =>
      xs.slice(0, -1).map((_, k) => {
        const [x0, x1, y0, y1] = cellOf(xs, ys, r, k);
        return { x0, y0, x1, y1 };
      }),
    );
  return {
    P78: cells(S5.P78.xs, S5.P78.ys, [1, 2]),
    P79: cells(S5.P79.xs, S5.P79.ys, [4, 5, 6, 7, 8]),
    P80: cells(S5.P80.xs, S5.P80.ys, [1, 2]),
    P81: cells(S5.P81.xs, S5.P81.ys, [0, 1]),
    P82: cells(S5.P82.xs, S5.P82.ys, [0]),
    P83: cells(S5.P83.xs, S5.P83.ys, [0]),
  };
})();

export const TABLE_CASES: readonly DetectCase[] = [
  {
    id: "P78",
    kind: "positive",
    note: 'a ruled 3 x 4 table: "Item | Qty | Unit price | Amount" in its top row, the two rows under it empty: one field per empty cell, named by its column and row',
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head } = S5.P78;
        grid(page, xs, ys);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 4, ys[2]! + 8);
      }),
    expect: [1, 2].flatMap((r) =>
      S5.P78.head.map((h, k) =>
        header(`${h} row ${r}`, cellOf(S5.P78.xs, S5.P78.ys, r, k)),
      ),
    ),
  },
  {
    id: "P79",
    kind: "positive",
    note: "an invoice: a header row, three filled line items, then five empty ones: fields for the empty rows only, numbered by their printed row (4 to 8)",
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head, filled } = S5.P79;
        grid(page, xs, ys);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 4, cellOf(xs, ys, 0, k)[2] + 6);
        for (const [r, row] of filled.entries())
          for (const [k, s] of row.entries())
            await text(page, s, xs[k]! + 4, cellOf(xs, ys, r + 1, k)[2] + 6);
      }),
    expect: [4, 5, 6, 7, 8].flatMap((r) =>
      S5.P79.head.map((h, k) =>
        header(`${h} row ${r}`, cellOf(S5.P79.xs, S5.P79.ys, r, k)),
      ),
    ),
  },
  {
    id: "P80",
    kind: "positive",
    note: 'a table drawn as nine separate boxes sharing their edges ("Name | Role | Phone" in the top three): one field per empty box',
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head } = S5.P80;
        for (let r = 0; r < 3; r++)
          for (let k = 0; k < 3; k++) {
            const [x0, x1, y0, y1] = cellOf(xs, ys, r, k);
            box(page, x0, y0, x1 - x0, y1 - y0);
          }
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 4, ys[2]! + 8);
      }),
    expect: [1, 2].flatMap((r) =>
      S5.P80.head.map((h, k) =>
        header(`${h} row ${r}`, cellOf(S5.P80.xs, S5.P80.ys, r, k)),
      ),
    ),
  },
  {
    id: "P81",
    kind: "positive",
    note: 'column heads printed just over a ruled grid ("Date", "Activity", "Hours", each over its own column), both rows empty: the heads name the cells',
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head } = S5.P81;
        grid(page, xs, ys);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 2, ys[ys.length - 1]! + 4);
      }),
    expect: [0, 1].flatMap((r) =>
      S5.P81.head.map((h, k) =>
        header(`${h} row ${r + 1}`, cellOf(S5.P81.xs, S5.P81.ys, r, k)),
      ),
    ),
  },
  {
    id: "P82",
    kind: "positive",
    note: 'one row of three touching boxes, "City", "State", "ZIP code" in small type in each top-left: a field along each box\'s foot, as one such box alone has (slice S4 left all three to table-grid)',
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head } = S5.P82;
        for (let k = 0; k < 3; k++)
          box(page, xs[k]!, ys[0]!, xs[k + 1]! - xs[k]!, ys[1]! - ys[0]!);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 3, ys[1]! - 9, 7);
      }),
    expect: S5.P82.head.map((h, k) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: h,
      page: 1,
      box: stripField(S5.P82.xs[k]!, S5.P82.xs[k + 1]!, S5.P82.ys[0]!, 7),
    })),
  },
  {
    id: "P83",
    kind: "positive",
    note: 'one row of three touching empty boxes captioned 4 pt over each ("City", "State", "ZIP code"): each box filled by a field named by its own caption (slice S4 left all three to table-grid)',
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head } = S5.P83;
        for (let k = 0; k < 3; k++)
          box(page, xs[k]!, ys[0]!, xs[k + 1]! - xs[k]!, ys[1]! - ys[0]!);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]!, ys[1]! + 4);
      }),
    expect: S5.P83.head.map((h, k) =>
      header(h, [
        S5.P83.xs[k]!,
        S5.P83.xs[k + 1]!,
        S5.P83.ys[0]!,
        S5.P83.ys[1]!,
      ]),
    ),
  },
  {
    id: "P84",
    kind: "positive",
    note: 'an empty box labelled "Reference:" at its left, drawn twice 1 pt apart (a doubled bold border): one field over the outer box, the inner one a duplicate (slice S4 left it to table-grid)',
    build: () =>
      onePage(async (page) => {
        const [ix, iy, iw, ih] = S5.P84.inner;
        const [ox, oy, ow, oh] = S5.P84.outer;
        box(page, ox, oy, ow, oh);
        box(page, ix, iy, iw, ih);
        const s = "Reference:";
        await text(page, s, ox - 12 - (await width(s, 10)), oy + 10);
      }),
    expect: [
      {
        rule: "entry-box",
        type: "text",
        label: "Reference",
        page: 1,
        box: cellField(140, 440, 600, 630),
      },
    ],
  },
  {
    id: "P85",
    kind: "positive",
    note: 'labelled lines ("Name:", "Email:", "Phone:") inside one big outer box: one field per line, as before slice S5 (the box is no table)',
    build: () =>
      onePage(async (page) => {
        const [x, y, w, h] = S5.P85.outer;
        box(page, x, y, w, h);
        for (const [s, ly] of S5.P85.lines) {
          rule(page, 140, 500, ly);
          await text(page, s, 90, ly + 2);
        }
      }),
    expect: S5.P85.lines.map(([s, ly]) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label: s.replace(":", ""),
      page: 1,
      box: rounded(141, ly + 1, 499, ly + 15),
    })),
  },
  {
    id: "N79",
    kind: "negative",
    note: 'a filled data table ("Item | Qty | Price", three rows of goods) with the Qty of one row left blank: a row holding other text is filled, so the blank cell gets no field',
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head, rows } = S5.N79;
        grid(page, xs, ys);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 4, ys[3]! + 10);
        for (const [r, row] of rows.entries())
          for (const [k, s] of row.entries())
            if (s)
              await text(page, s, xs[k]! + 4, cellOf(xs, ys, r + 1, k)[2] + 10);
      }),
    expect: "none",
    decidedBy: "filled-cells",
    // The blank Qty cell of row 2.
    at: { page: 1, x: 290, y: 575 },
  },
  {
    id: "N80",
    kind: "negative",
    note: 'a ruled sign-up sheet: "Name | Email | Phone | Team" over 51 empty 12 pt rows, 204 empty cells: too many to suggest one by one, so one summary and no field',
    build: () =>
      onePage(async (page) => {
        const { xs, ys } = S5.N80;
        grid(page, xs, ys);
        for (const [k, h] of ["Name", "Email", "Phone", "Team"].entries())
          await text(page, h, xs[k]! + 4, ys[ys.length - 2]! + 3, 8);
      }),
    expect: "none",
    decidedBy: "large-table",
    // A cell of the top empty row (with the rule off, the top rows are
    // the ones the per-page cap keeps).
    at: { page: 1, x: 130, y: 706 },
  },
  {
    id: "N81",
    kind: "negative",
    note: "a chart's frame: a y axis, gridlines open at the right, short tick marks under the x axis, numbers at the left: no closed grid, no field",
    build: () =>
      onePage(async (page) => {
        vline(page, 100, 400, 600);
        rule(page, 100, 400, 400);
        for (const y of S5.N81.gridlines) rule(page, 100, 400, y);
        for (const x of S5.N81.ticks) vline(page, x, 396, 400);
        for (const [i, n] of ["0", "10", "20", "30", "40", "50"].entries())
          await text(page, n, 85, 397 + 40 * i, 8);
      }),
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 250, y: 445 },
  },
  {
    id: "N82",
    kind: "negative",
    note: 'a chart\'s closed grid (gridlines both ways, a frame) titled "Sales by month" over it, numbers at the left: no heads, so it stays a table and gets no field',
    build: () =>
      onePage(async (page) => {
        const { xs, ys } = S5.N82;
        grid(page, xs, ys);
        await text(page, "Sales by month", 180, ys[ys.length - 1]! + 4);
        for (const [i, y] of ys.entries())
          await text(page, String(10 * i), 85, y - 3, 8);
      }),
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 250, y: 445 },
    // With the grid off, its rules have no label: unlabelled decides next.
    seamAlsoDisable: ["unlabelled"],
  },
  {
    id: "N83",
    kind: "negative",
    note: "a month's calendar: Mon to Sun in the top row, day numbers in the cells, the first week starting on a Thursday: every week row holds numbers, so no field",
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head } = S5.N83;
        grid(page, xs, ys);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 4, ys[ys.length - 2]! + 14);
        for (let w = 0; w < 5; w++)
          for (let k = 0; k < 7; k++) {
            const s = calendarDay(w, k);
            if (s)
              await text(page, s, xs[k]! + 4, cellOf(xs, ys, w + 1, k)[3] - 12);
          }
      }),
    expect: "none",
    decidedBy: "filled-cells",
    // Monday of the first week: empty, in a row that holds numbers.
    at: { page: 1, x: 107, y: 520 },
  },
  {
    id: "N84",
    kind: "negative",
    note: 'a bordered layout: two 234 x 500 boxes side by side headed "Your details" and "Office use" over them: far taller than a row, so no cells and no field',
    build: () =>
      onePage(async (page) => {
        for (const [x, y, w, h] of S5.N84.boxes) box(page, x, y, w, h);
        await text(page, "Your details", 76, 704);
        await text(page, "Office use", 310, 704);
      }),
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 150, y: 205 },
    // With the grid off, its rules have no label: unlabelled decides next.
    seamAlsoDisable: ["unlabelled"],
  },
  {
    id: "N85",
    kind: "negative",
    note: "one row of FIVE touching boxes, a small caption in each top-left: past the two to four boxes of an address strip, so it stays a table",
    build: () =>
      onePage(async (page) => {
        const { xs, ys, head } = S5.N85;
        for (let k = 0; k < 5; k++)
          box(page, xs[k]!, ys[0]!, xs[k + 1]! - xs[k]!, ys[1]! - ys[0]!);
        for (const [k, h] of head.entries())
          await text(page, h, xs[k]! + 3, ys[1]! - 9, 7);
      }),
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 300, y: 605 },
    // With the grid off, its rules have no label: unlabelled decides next.
    seamAlsoDisable: ["unlabelled"],
  },
];
