// @native-canvas
/**
 * Slice S5 of the Create Forms field finder (tables: empty ruled cells),
 * held the house way (CLAUDE.md, "Guards — house style"):
 *
 *  - DETECT_TABLES against a literal table typed from the brief, and the
 *    new rule ids in DETECTION_RULES / EXCLUSION_RULES;
 *  - each decision on hand-built pages, at its boundary and just past it:
 *    what a header row is (every cell but a blank corner), a header row
 *    printed over the grid, a row with some text (skipped whole unless the
 *    text is only its row label), 200 against 201 empty cells, the row
 *    heights a cell may have, a single row of 2 to 4 touching boxes, and
 *    a box drawn twice 1 pt apart;
 *  - the S5 corpus (src/tests/form-detect-tables-fixtures.ts, joined onto
 *    DETECT_CASES) through the REAL reader, with health checks that
 *    `header-cell` proposes on positives here and `filled-cells` and
 *    `large-table` each decide a negative here;
 *  - the composed chain, judged where it is consumed: detect -> proposal
 *    -> the Find fields chunk's own Add (`toAdd`) -> createFormFields ->
 *    pdf.js reading the SAVED PDF: every widget inside a cell it was found
 *    in, every name unique; the table of over 200 empty cells adds nothing
 *    and shows its one summary line;
 *  - cost: form-detect-tables-cost.test.ts (a file of its own, as S4's).
 *
 * The corpus's case list and size bounds are in form-detect.corpus.test.ts;
 * this file holds only what S5 added.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createFormFields,
  readFormContext,
  validateFormFields,
} from "./create-forms";
import {
  DETECTION_RULES,
  DETECT_TABLES,
  EXCLUSION_RULES,
  classifyPage,
  nameFor,
  proposalToDraftFields,
  type CardPage,
  type CardRect,
  type CardSeg,
  type CardText,
} from "./form-detect";
import { detectFormFields } from "./form-detect-read";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import {
  summarize,
  toAdd,
} from "@/components/tools/runner/create-forms-detect";
import {
  PRINTED_CELLS,
  TABLE_CASES,
} from "@/tests/form-detect-tables-fixtures";
import {
  decidingAt,
  legacyPdfjs,
  runCase,
  unexplained,
  type CaseRun,
} from "@/tests/form-detect-fixtures";

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

const vseg = (x: number, y0: number, y1: number): CardSeg => ({
  ...hseg(x, x, y0),
  y1,
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

/**
 * A ruled grid: columns at `xs`, rows `h` tall from `top` down, `rows`
 * rows. `cell(r, k)` is the text in row r (0 = top) column k, "" for
 * none, set 3 pt in and 5 pt up.
 */
function table(
  xs: readonly number[],
  rows: number,
  cell: (r: number, k: number) => string,
  o: { top?: number; h?: number; more?: Partial<CardPage> } = {},
): CardPage {
  const top = o.top ?? 700;
  const h = o.h ?? 20;
  const ys = Array.from({ length: rows + 1 }, (_, i) => top - h * i);
  const text: CardText[] = [];
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < xs.length - 1; k++) {
      const s = cell(r, k);
      if (s) text.push(txt(s, xs[k]! + 3, ys[r + 1]! + 5));
    }
  return pg({
    height: Math.max(792, top + 100),
    segs: [
      ...ys.map((y) => hseg(xs[0]!, xs[xs.length - 1]!, y)),
      ...xs.map((x) => vseg(x, ys[rows]!, top)),
      ...(o.more?.segs ?? []),
    ],
    text: [...text, ...(o.more?.text ?? [])],
    rects: o.more?.rects ?? [],
  });
}

const XS = [72, 200, 300, 400, 540];
const HEAD = ["Item", "Qty", "Unit price", "Amount"];
/** A header row, then `rows` rows filled by `body`. */
const headed = (
  rows: number,
  body: (r: number, k: number) => string = () => "",
  xs: readonly number[] = XS,
  head: readonly string[] = HEAD,
) => table(xs, rows + 1, (r, k) => (r === 0 ? (head[k] ?? "") : body(r, k)));

const run = (p: CardPage, disable: string[] = []) =>
  classifyPage(p, { disable: new Set(disable) as never });
const cells = (p: CardPage) =>
  run(p).proposals.filter((x) => x.rule === "header-cell");
const labels = (p: CardPage) => cells(p).map((x) => x.label);
const rules = (p: CardPage) => run(p).excluded.map((e) => e.rule);

/* ------------------------------------------------------------------ *
 *  The tables
 * ------------------------------------------------------------------ */

describe("S5 tables", () => {
  // The second, independent bound (CLAUDE.md, guards rule 3): typed from
  // the slice's brief, not read back from the code.
  it("every DETECT_TABLES value is the brief's (a literal table, not a read-back)", () => {
    expect({ ...DETECT_TABLES }).toEqual({
      TABLE_MAX_CELLS: 200,
      STRIP_MIN_CELLS: 2,
      STRIP_MAX_CELLS: 4,
    });
  });

  it("header-cell is a detection rule in plain words naming table cells; filled-cells and large-table are exclusions", () => {
    const plain = Object.fromEntries(
      DETECTION_RULES.map((r) => [r.id, r.plain]),
    );
    expect(plain["header-cell"]).toBe("empty table cells under a heading");
    expect(plain["header-cell"]).toMatch(/\btable cells\b/);
    // The copy lists DETECTION_RULES joined by ", " and " and ".
    expect(plain["header-cell"]).not.toMatch(/, | and /);
    const ids = EXCLUSION_RULES.map((r) => r.id);
    expect(ids).toContain("filled-cells");
    expect(ids).toContain("large-table");
    // table-grid stays: grids without a header row keep it.
    expect(ids).toContain("table-grid");
  });
});

/* ------------------------------------------------------------------ *
 *  What a header row is
 * ------------------------------------------------------------------ */

describe("a header row: every cell of the top row holds a heading, a blank corner allowed", () => {
  it("a 3 x 4 grid with headings over two empty rows: exactly the 8 empty cells, named by column and row", () => {
    const p = headed(2);
    expect(labels(p)).toEqual([
      "Item row 1",
      "Qty row 1",
      "Unit price row 1",
      "Amount row 1",
      "Item row 2",
      "Qty row 2",
      "Unit price row 2",
      "Amount row 2",
    ]);
    // Each field is its cell, inset 1 pt.
    expect(cells(p)[0]).toMatchObject({
      x: 73,
      y: 661,
      width: 126,
      height: 18,
      type: "text",
    });
    // The grid's own rules are still table-grid, never fields themselves.
    expect(run(p).proposals.every((x) => x.rule === "header-cell")).toBe(true);
    expect(rules(p).filter((r) => r === "table-grid").length).toBeGreaterThan(
      0,
    );
  });

  it("one blank heading in the middle: no header row, so the grid stays a table (nothing proposed)", () => {
    const p = headed(2, () => "", XS, ["Item", "", "Unit price", "Amount"]);
    expect(run(p).proposals).toEqual([]);
    expect(rules(p)).toContain("table-grid");
  });

  it("a blank top-left corner over row labels is a header row: the label column gets no field", () => {
    const p = headed(
      2,
      (r, k) => (k === 0 ? ["", "Monday", "Tuesday"][r]! : ""),
      XS,
      ["", "Start", "Finish", "Hours"],
    );
    expect(labels(p)).toEqual([
      "Monday Start",
      "Monday Finish",
      "Monday Hours",
      "Tuesday Start",
      "Tuesday Finish",
      "Tuesday Hours",
    ]);
  });

  it("an empty top row with no heads over it is no header: table-grid stays (N4, N61)", () => {
    const p = table(XS, 3, () => "");
    expect(run(p).proposals).toEqual([]);
    expect(rules(p)).toContain("table-grid");
    expect(rules(p)).not.toContain("filled-cells");
  });

  it("heads printed just over the top rule, each inside its column, are the header row; every row is a body row", () => {
    const over = (dy: number, x: (k: number) => number) =>
      table(XS, 2, () => "", {
        more: {
          text: HEAD.map((h, k) => txt(h, x(k), 700 + dy, { width: 30 })),
        },
      });
    const inCol = (k: number) => XS[k]! + 3;
    // Baseline 4 pt over: its descent (2) 2 pt over the rule.
    expect(labels(over(4, inCol))).toEqual([
      "Item row 1",
      "Qty row 1",
      "Unit price row 1",
      "Amount row 1",
      "Item row 2",
      "Qty row 2",
      "Unit price row 2",
      "Amount row 2",
    ]);
    // Descent 14 pt over the rule (the caption reach) still; 15 not.
    expect(cells(over(16, inCol))).toHaveLength(8);
    expect(cells(over(17.1, inCol))).toEqual([]);
    // A head crossing a column line is no column's head.
    expect(cells(over(4, (k) => (k === 1 ? XS[2]! - 10 : inCol(k))))).toEqual(
      [],
    );
  });

  it("a title over the grid spanning several columns is no header (a chart's or a schedule's)", () => {
    const p = table(XS, 3, () => "", {
      more: { text: [txt("Sales by month", 150, 704, { width: 200 })] },
    });
    expect(run(p).proposals).toEqual([]);
  });

  // Mutant M7 (a head crossing a column line skipped, not refusing the
  // heads) passed every test above, whose spanning titles had no heads
  // beside them: a group title over heads is the case that tells them apart.
  it("heads over every column with a group title spanning two of them in the same band: no header", () => {
    const heads = HEAD.map((h, k) => txt(h, XS[k]! + 3, 704, { width: 30 }));
    expect(
      cells(table(XS, 2, () => "", { more: { text: heads } })),
    ).toHaveLength(8);
    const grouped = table(XS, 2, () => "", {
      more: {
        text: [...heads, txt("Price", 250, 714, { width: 100 })],
      },
    });
    expect(run(grouped).proposals).toEqual([]);
  });

  // Mutant M10 (headings with no letter accepted) passed every test above.
  it("a top row of data with a number in it is no header row (a headerless table's first line item)", () => {
    const data = headed(2, () => "", XS, ["Bolt", "4", "1.00", "1.00"]);
    expect(run(data).proposals).toEqual([]);
    // Control: the same row in words is a header row.
    expect(
      cells(headed(2, () => "", XS, ["Bolt", "Qty", "Each", "Sum"])),
    ).toHaveLength(8);
  });
});

/* ------------------------------------------------------------------ *
 *  Rows with some text, filled tables
 * ------------------------------------------------------------------ */

describe("filled cells propose nothing", () => {
  it("an all-filled data table: zero fields (no cell is empty; its lines stay table-grid)", () => {
    const p = headed(3, (r, k) => `v${r}${k}`);
    expect(run(p).proposals).toEqual([]);
    expect(rules(p)).toContain("table-grid");
    // No empty cell, so none to pass over as filled-cells.
    expect(rules(p)).not.toContain("filled-cells");
  });

  it("an invoice, 3 filled line items then 5 empty: fields only in the empty rows, numbered as printed (4 to 8)", () => {
    const p = headed(8, (r, k) => (r <= 3 ? `x${k}` : ""));
    expect(new Set(labels(p).map((l) => l!.replace(/^.* row /, "")))).toEqual(
      new Set(["4", "5", "6", "7", "8"]),
    );
    expect(cells(p)).toHaveLength(20);
  });

  it("a row with text beyond its first cell is skipped WHOLE: its empty cells are filled-cells, no field", () => {
    // Row 2 holds "Nut" and "0.50" with its Qty blank.
    const p = headed(3, (r, k) =>
      r === 2 ? ["Nut", "", "0.50", "0.50"][k]! : `x${k}`,
    );
    expect(run(p).proposals).toEqual([]);
    const filled = run(p).excluded.filter((e) => e.rule === "filled-cells");
    expect(filled).toHaveLength(1);
    expect(filled[0]!.box).toMatchObject({ x: 201, width: 98 });
    // Seam: with the rule off, that blank cell is a field.
    expect(run(p, ["filled-cells"]).proposals.map((x) => x.label)).toEqual([
      "Qty row 2",
    ]);
  });

  it("a row holding only its row label (letters) in the first cell is read cell by cell; a number there is a filled row", () => {
    const word = headed(1, (_, k) => (k === 0 ? "Monday" : ""));
    expect(labels(word)).toEqual([
      "Monday Qty",
      "Monday Unit price",
      "Monday Amount",
    ]);
    // A calendar's day number alone in a row's first cell is data.
    const number = headed(1, (_, k) => (k === 0 ? "31" : ""));
    expect(run(number).proposals).toEqual([]);
    expect(rules(number)).toContain("filled-cells");
  });

  it("two columns, a heading row and labelled rows (N39's shape): each field named by its row label alone", () => {
    const p = headed(
      2,
      (r, k) => (k === 0 ? ["", "Name", "Email"][r]! : ""),
      [72, 180, 400],
      ["Question", "Answer"],
    );
    expect(labels(p)).toEqual(["Name", "Email"]);
  });

  it("a two-column label table with NO header row is still table-cell, as before S5", () => {
    const p = table([72, 180, 400], 3, (r, k) =>
      k === 0 ? ["Name", "Address", "Email"][r]! : "",
    );
    expect(run(p).proposals.map((x) => [x.rule, x.label])).toEqual([
      ["table-cell", "Name"],
      ["table-cell", "Address"],
      ["table-cell", "Email"],
    ]);
  });

  it("a square in a cell is not an empty cell", () => {
    const p = headed(1, () => "", XS, HEAD);
    const sq = { ...p, rects: [rect(320, 665, 10, 10)] };
    expect(labels(sq)).not.toContain("Unit price row 1");
  });

  // KNOWN MISS (a false positive, slice S5, decided and reported): a
  // calendar printed with a sixth week row left empty reads like an
  // invoice's blank line items, and nothing on the page tells them apart.
  // Pinned so a fix shows here; corpus N83 (five filled weeks) is zero.
  it("KNOWN MISS: a calendar with an empty sixth week row proposes a field per day of that row", () => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const xs = Array.from({ length: 8 }, (_, i) => 72 + 66 * i);
    const p = headed(
      6,
      (r, k) => (r <= 5 ? String((r - 1) * 7 + k + 1) : ""),
      xs,
      days,
    );
    expect(labels(p)).toEqual(days.map((d) => `${d} row 6`));
  });
});

/* ------------------------------------------------------------------ *
 *  Size bounds
 * ------------------------------------------------------------------ */

describe("more than 200 empty cells: not expanded, one summary", () => {
  /** Three columns; `blank` empty rows, then (optionally) one labelled row. */
  const sheet = (blank: number, labelled: boolean) =>
    table(
      [72, 200, 330, 460],
      1 + blank + (labelled ? 1 : 0),
      (r, k) =>
        r === 0
          ? ["Name", "Email", "Team"][k]!
          : labelled && r === blank + 1 && k === 0
            ? "Spare"
            : "",
      { top: 3000, h: 14 },
    );

  it("200 empty cells are expanded (60 shown, the page cap counts the rest); 201 are one large-table, no field", () => {
    const at200 = run(sheet(66, true));
    expect(at200.excluded.filter((e) => e.rule === "large-table")).toEqual([]);
    expect(
      at200.proposals.filter((x) => x.rule === "header-cell"),
    ).toHaveLength(60);
    expect(at200.counts.capped).toBe(140);
    expect(at200.counts.largeTables).toBe(0);

    const at201 = run(sheet(67, false));
    expect(at201.proposals).toEqual([]);
    const large = at201.excluded.filter((e) => e.rule === "large-table");
    expect(large).toHaveLength(1);
    // One entry for the whole table: its outline.
    expect(large[0]!.box).toMatchObject({ x: 72, width: 388 });
    expect(at201.counts.largeTables).toBe(1);
    expect(at201.counts.capped).toBe(0);
    // ...and nothing about it is listed cell by cell.
    expect(at201.excluded.filter((e) => e.rule === "filled-cells")).toEqual([]);
  });

  it("the summary says it in one line, singular and plural, telling the reader to add the fields by hand", () => {
    const line = (n: number) =>
      summarize({
        pages: [{ page: 1, outcome: "no-candidates" }],
        counts: { ...run(pg()).counts, largeTables: n },
        excluded: [],
      }).map((l) => l.text);
    expect(line(1)).toContain(
      "1 table has more than 200 empty cells, too many to suggest one by one: add its fields with Add field.",
    );
    expect(line(2)).toContain(
      "2 tables have more than 200 empty cells, too many to suggest one by one: add their fields with Add field.",
    );
    expect(line(0).some((l) => /200 empty cells/.test(l))).toBe(false);
  });
});

describe("row heights: a cell is 12 to 120 pt tall", () => {
  it("12 pt rows are read, 11.9 are not; 120 pt rows are read (multiline), 120.1 are not", () => {
    const at = (h: number) =>
      table(XS, 2, (r, k) => (r === 0 ? HEAD[k]! : ""), { h });
    expect(cells(at(12))).toHaveLength(4);
    expect(cells(at(11.9))).toEqual([]);
    const tall = cells(at(120));
    expect(tall).toHaveLength(4);
    expect(tall.every((x) => x.multiline === true)).toBe(true);
    expect(cells(at(120.1))).toEqual([]);
    // A 20 pt row is one line.
    expect(cells(at(20)).some((x) => x.multiline)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 *  One row of touching boxes (S4's known misses)
 * ------------------------------------------------------------------ */

describe("a single row of 2 to 4 touching labelled boxes", () => {
  const strip = (n: number, where: "inside" | "over") => {
    const xs = Array.from({ length: n + 1 }, (_, i) => 72 + 100 * i);
    const names = ["City", "State", "Zip", "Country", "Code"];
    return pg({
      rects: xs
        .slice(0, -1)
        .map((x) => rect(x, 600, 100, where === "inside" ? 30 : 24)),
      text: xs
        .slice(0, -1)
        .map((x, k) =>
          where === "inside"
            ? txt(names[k]!, x + 3, 621, { size: 7, width: 15 })
            : txt(names[k]!, x, 628, { width: 20 }),
        ),
    });
  };

  it("captions in each top-left: 2, 3 and 4 boxes each get a field along the foot; 5 stay a table", () => {
    for (const n of [2, 3, 4]) {
      const got = run(strip(n, "inside")).proposals;
      expect(
        got.map((x) => [x.rule, x.label]),
        String(n),
      ).toEqual(
        ["City", "State", "Zip", "Country"]
          .slice(0, n)
          .map((l) => ["labelled-rule", l]),
      );
      expect(got[0]).toMatchObject({ x: 73, y: 601, width: 98, height: 14 });
    }
    expect(run(strip(5, "inside")).proposals).toEqual([]);
    expect(rules(strip(5, "inside"))).toContain("table-grid");
  });

  it("captions over each box: 2 to 4 boxes are filled, each named by its own caption; 5 stay a table", () => {
    for (const n of [2, 3, 4])
      expect(labels(strip(n, "over")), String(n)).toEqual(
        ["City", "State", "Zip", "Country"].slice(0, n),
      );
    expect(run(strip(5, "over")).proposals).toEqual([]);
  });

  it("a row of touching boxes with no captions stays a table", () => {
    const p = pg({ rects: [rect(72, 600, 100, 30), rect(172, 600, 100, 30)] });
    expect(run(p).proposals).toEqual([]);
    expect(rules(p)).toContain("table-grid");
  });
});

describe("a box drawn twice about 1 pt apart (a doubled border)", () => {
  // INVERTED from S4's behaviour: at 0.5 and 1 pt apart each box's edges
  // touched the other's plumb lines, so the box went to table-grid and got
  // no field (S4 read it right only from 1.5 pt, as two boxes, one a
  // duplicate). A box drawn again within GRID_TOUCH_EPS of itself on every
  // side is now ONE box, the outer one.
  const doubled = (d: number) =>
    pg({
      rects: [
        rect(140, 600, 300, 30),
        rect(140 - d, 600 - d, 300 + 2 * d, 30 + 2 * d),
      ],
      text: [txt("Ref:", 108, 610, { width: 20 })],
    });
  it("0.5 and 1 pt apart: one box, one entry-box field over the outer one; 1.5 pt, two boxes, one a duplicate (S4)", () => {
    for (const d of [0.5, 1]) {
      const r = run(doubled(d));
      expect(
        r.proposals.map((x) => [x.rule, x.label, x.x, x.width]),
        String(d),
      ).toEqual([
        [
          "entry-box",
          "Ref",
          Math.round(141 - d),
          Math.round(141 - d + 298 + 2 * d) - Math.round(141 - d),
        ],
      ]);
      expect(r.excluded, String(d)).toEqual([]);
    }
    const apart = run(doubled(1.5));
    expect(apart.proposals.map((x) => [x.rule, x.label])).toEqual([
      ["entry-box", "Ref"],
    ]);
    expect(apart.excluded.map((e) => e.rule)).toEqual(["duplicate"]);
  });

  it("control: two boxes side by side 1 pt apart are not one box drawn twice", () => {
    const p = pg({
      rects: [rect(140, 600, 100, 30), rect(241, 600, 100, 30)],
      text: [txt("Ref:", 108, 610, { width: 20 })],
    });
    expect(run(p).proposals.map((x) => x.rule)).not.toContain("duplicate");
    expect(rules(p)).not.toContain("duplicate");
  });
});

/* ------------------------------------------------------------------ *
 *  Names
 * ------------------------------------------------------------------ */

describe("names: the label through the builder's own name helper, unique and stable", () => {
  it("'Unit price row 1' names unit_price_row_1; two runs name alike; a clash takes _2", () => {
    const p = headed(2, () => "", XS, [
      "Item",
      "Unit price (£)",
      "Item",
      "Qty",
    ]);
    const once = proposalToDraftFields(cells(p)).map((s) => s.name);
    expect(once.slice(0, 4)).toEqual([
      "item_row_1",
      "unit_price_row_1",
      "item_row_1_2",
      "qty_row_1",
    ]);
    expect(new Set(once).size).toBe(once.length);
    expect(proposalToDraftFields(cells(p)).map((s) => s.name)).toEqual(once);
    expect(nameFor("Monday Start", "text", new Set(), 1)).toBe("monday_start");
  });
});

/* ------------------------------------------------------------------ *
 *  The S5 corpus through the real reader
 * ------------------------------------------------------------------ */

const RUNS = new Map<string, CaseRun>();
beforeAll(async () => {
  for (const c of TABLE_CASES) RUNS.set(c.id, await runCase(c));
}, 120_000);

describe("the S5 corpus, through the real reader", () => {
  it("health: the corpus is the size it was written at, both ways", () => {
    const n = (k: string) => TABLE_CASES.filter((c) => c.kind === k).length;
    expect(n("positive")).toBe(8);
    expect(n("negative")).toBe(7);
    expect(RUNS.size).toBe(TABLE_CASES.length);
  });

  it("health: header-cell proposes on positives here; filled-cells and large-table each decide a negative here", () => {
    const pos = TABLE_CASES.filter(
      (c) =>
        c.kind === "positive" &&
        RUNS.get(c.id)!.proposals.some((p) => p.rule === "header-cell"),
    );
    expect(pos.map((c) => c.id)).toEqual(["P78", "P79", "P80", "P81", "P83"]);
    const decided = (rule: string) =>
      TABLE_CASES.filter(
        (c) =>
          c.kind === "negative" &&
          c.at &&
          decidingAt(RUNS.get(c.id)!, c.at)?.rule === rule,
      ).map((c) => c.id);
    expect(decided("filled-cells")).toEqual(["N79", "N83"]);
    expect(decided("large-table")).toEqual(["N80"]);
  });

  for (const c of TABLE_CASES)
    it(`${c.id} (${c.kind}): ${c.note}`, () => {
      expect(unexplained(c, RUNS.get(c.id)!)).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 *  The composed chain, read back from the saved PDF
 * ------------------------------------------------------------------ */

/** Each widget pdf.js reads back from the saved PDF: name and rect. */
async function savedWidgets(bytes: Uint8Array) {
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const out: { name: string; rect: number[] }[] = [];
    for (let n = 1; n <= doc.numPages; n++)
      for (const a of await (await doc.getPage(n)).getAnnotations())
        if (a.subtype === "Widget")
          out.push({ name: String(a.fieldName), rect: a.rect as number[] });
    return out;
  } finally {
    await task.destroy();
  }
}

/** The case through the reader, Add (every suggestion) and Create form. */
async function chain(id: string) {
  const c = TABLE_CASES.find((x) => x.id === id)!;
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
  const saved =
    added.length === 0
      ? []
      : await savedWidgets(
          (
            await createFormFields(
              bytes,
              added.map((a) => a.spec),
            )
          ).bytes,
        );
  return { c, report, found, added, dropped, saved };
}

describe("composed chain: detect -> proposal -> Add -> Create form -> pdf.js reads the saved field", () => {
  const ids = Object.keys(PRINTED_CELLS);
  it("health: the chain runs over every printed case", () => {
    expect(ids.sort()).toEqual(["P78", "P79", "P80", "P81", "P82", "P83"]);
  });

  for (const id of ids)
    it(`${id}: each saved widget sits inside a printed cell, one widget a cell, names unique`, async () => {
      const { c, found, dropped, saved } = await chain(id);
      const printed = PRINTED_CELLS[id]!;
      expect(dropped).toEqual([]);
      expect(found.length).toBe((c.expect as unknown[]).length);
      expect(saved.length).toBe(found.length);
      expect(new Set(saved.map((w) => w.name)).size).toBe(saved.length);
      const used = new Set<number>();
      for (const w of saved) {
        const [x0, y0, x1, y1] = w.rect;
        const i = printed.findIndex(
          (b) =>
            x0! >= b.x0 - 0.5 &&
            x1! <= b.x1 + 0.5 &&
            y0! >= b.y0 - 0.5 &&
            y1! <= b.y1 + 0.5,
        );
        expect(i, `${w.name} ${JSON.stringify(w.rect)}`).toBeGreaterThanOrEqual(
          0,
        );
        expect(used.has(i), `${w.name}: a second widget in one cell`).toBe(
          false,
        );
        used.add(i);
      }
    }, 60_000);

  it("N80: the table of 204 empty cells adds nothing, and the summary says so in one line", async () => {
    const { report, found, saved } = await chain("N80");
    expect(found).toEqual([]);
    expect(saved).toEqual([]);
    expect(report.counts.largeTables).toBe(1);
    const lines = summarize(report).map((l) => l.text);
    expect(lines.filter((l) => /200 empty cells/.test(l))).toEqual([
      "1 table has more than 200 empty cells, too many to suggest one by one: add its fields with Add field.",
    ]);
  }, 60_000);
});
