/**
 * The grid a recognised table is written on in Word (#28 slice 2, tables).
 *
 * `./flow` decides WHAT is a table (its rules 1-6) and keeps every row as a
 * paragraph of cells; this module decides WHERE each cell goes: the table's
 * columns are its cells' x-ranges, chained wherever they overlap — exactly
 * `flow.ts`'s `columns()`, which calls {@link chainColumns} so there is one
 * rule, not two — and each cell sits in the column its own range fell in.
 * A row missing a value therefore has an empty column there, and the values
 * after it stay under their own headings.
 *
 * No cell can straddle two columns: a cell that overlaps two ranges chains
 * them into one. So the grid never needs a merged cell (`w:gridSpan`).
 *
 * Kept free of imports beyond types: `./flow` is in the web bundle
 * (`LONG_CELL_WORDS` is read by the tool catalogue and a guide).
 *
 * A table this module refuses is not lost: its rows stay the tab-separated
 * paragraphs they were before this slice, and the page counts them
 * (`tablesAsTabs`).
 */

/** Word's grid limit; held equal to docx-structure's `MAX_GRID_COLUMNS` by a test. */
export const MAX_TABLE_COLUMNS = 63;
/**
 * The most cells one table is written with as a Word table.
 *
 * Measured 2026-11-15 by `src/tests/docx-table-measure.ts` on the dev host
 * (Windows 11, Node 24; one fresh process per run): `grid 10000` 3 ms and
 * +4 MB, `grid-wide 9954` (63 columns) 4 ms and +4 MB, `flow 10000` 37 ms
 * and +18 MB; one table of 10,010 cells (`over`) comes out tabbed in 137 ms.
 * NOT yet measured inside the worker image (no Docker on the dev host; the
 * container step is where it can be). Held by `docx-table.cap.test.ts`.
 */
export const MAX_TABLE_CELLS = 10_000;
/** The most cells of ONE page written as Word tables, all its tables together. */
export const MAX_TABLE_CELLS_PER_PAGE = 20_000;
/**
 * Grid SLOTS (rows x columns, the empty ones included) one page may write.
 * An empty slot still costs its `w:tc` (about 70 bytes, stored), so a sparse
 * grid is bounded by slots, not by cells.
 *
 * Measured 2026-11-15 on the dev host, medians of 3 alternating with the
 * control (`docx-table-measure.ts engine 20000` against `engine-tabbed`,
 * the same page written as main's tabbed rows), the whole job including
 * the check before delivery: 350 ms and +156 MB against 238 ms and +133 MB
 * — 1.47x the time, far inside #318's exit bound (2x AND +5 s, or 2x AND
 * +300 MB). The file: 2,387,573 bytes against 1,284,055 (document.xml is
 * STORED, #318 Open 5), about 55 bytes more per cell.
 */
export const MAX_TABLE_SLOTS_PER_PAGE = 20_000;
/**
 * A vertical gap between two bands of one run larger than this many of the
 * run's median band pitches starts a new table (a grid SEGMENT).
 *
 * Measured on the captured corpus (poppler 25.07, `src/tests/poppler-samples`)
 * as centre-to-centre pitch over the run's median: the largest gap INSIDE a
 * table is SPANNING_TABLE's header, 19/16 = 1.19; the smallest gap that is
 * NOT inside one is 1.5 — REPORT_TABLES's note under its second table
 * (24/16) and SURROUNDED_INVOICE's address line above its header (36/24) —
 * and STACKED_TABLES's two tables are 3.0 apart. 1.3 sits between them.
 */
export const SEGMENT_GAP_PITCHES = 1.3;

/**
 * #28 slice 3 (wraps): a continuation line's centre may sit at most this many
 * of the run's median ROW pitches (top line of a row to the last line of the
 * row above, `flow.ts`'s `segments`) below the line above it. The design's
 * value; on the image captures (poppler 22.12, `src/tests/poppler-samples-
 * image.ts`) every continuation sits 12/18 = 0.67 row pitches below its line
 * and every note 1.0 or more. Held at or under {@link SEGMENT_GAP_PITCHES}
 * by a test: a line the gap admits must never be a gap that splits the table.
 *
 * What it cannot do: a line ONE row pitch below the last row (a note, a
 * caption) passes it. It separates a wrap from white space, not from the
 * next thing; `flow.ts`'s rule 7 has the conditions that do.
 */
export const WRAP_GAP_PITCHES = 1.25;
/**
 * The most continuation lines one cell absorbs; past it the run is cut.
 * `docx-table-measure.ts wrap-cell` (a 60-row table whose last cell carries
 * 51 lines) keeps exactly 50, in 29 ms / +3 MB on the dev host and 79 ms /
 * +4 MB in the worker image (medians of 3, 2026-11-16).
 */
export const MAX_WRAP_LINES_PER_CELL = 50;
/**
 * The most continuation lines one page absorbs, all tables together.
 * Measured 2026-11-16 (`docx-table-measure.ts`, medians of 3, alternating
 * with the same page read with absorption off, whole PDF to Word job): a
 * table at {@link MAX_TABLE_CELLS} (3,333 rows x 3), every body row wrapped,
 * absorbs 3,332 lines in 259 ms / +141 MB against 189 ms / +125 MB off on
 * the dev host (Windows 11, Node 24), and 802 ms / +55 MB against 582 ms /
 * +43 MB in the worker image (`ghcr.io/baki2222/pdfxyz-worker@sha256:7400…`,
 * node 22): inside #318's exit bound by far.
 *
 * NOT the binding bound today: the share cap (continuations <= rows) and
 * {@link MAX_TABLE_CELLS_PER_PAGE} (rows of at least two cells) already hold
 * a page under 10,000 absorbed lines by arithmetic (not measured on a
 * page of several tables); measured: a 10,000-row table (30,000 cells)
 * absorbs nothing (over the cell cap, it is kept as tabbed rows). Kept as
 * the brief's value so that a later loosening of either still meets a cap.
 */
export const MAX_WRAP_LINES_PER_PAGE = 20_000;
/**
 * The most run items (rows and held continuations) rule 7 may JUDGE on one
 * page, all its judgements together; past it every further run is read as
 * slice 2 read it. A run cut at every other continuation is judged again
 * once per cut, each time over what is left of it, so the work grows as the
 * square of its rows: measured 2026-11-16 on the dev host (Windows 11, Node
 * 24, under load) without this budget, a 3-column run of 3,000 rows whose
 * every other continuation is a number took 4,496 ms against 14 ms with
 * absorption off (2,000 rows: 1,968 ms; 1,000: 500 ms). With it: 104 ms at
 * 3,000 rows, 103 at 1,000. The whole PDF to Word job on a 3,333-row run cut
 * at every other continuation (`docx-table-measure.ts wrap-cut`, medians of
 * 3, 2026-11-16): 327 ms / +150 MB on the dev host against 189 ms / +125 MB
 * with absorption off; in the worker image 1,266 ms / +54 MB against
 * 582 ms / +43 MB.
 */
export const MAX_WRAP_JUDGE_ITEMS_PER_PAGE = 100_000;

/** The spans an x-range overlaps, by index (`x1 > start && x0 < end`). */
function overlapped(
  spans: readonly (readonly [number, number])[],
  x0: number,
  x1: number,
): number[] {
  const out: number[] = [];
  spans.forEach(([start, end], i) => {
    if (x1 > start && x0 < end) out.push(i);
  });
  return out;
}

/**
 * A one-phrase line belongs to the table around or directly above it only
 * when it sits in ONE column past the first: it starts at or after the first
 * column's end and before the last column's end, and overlaps at most one
 * column. A title, caption, paragraph line or footer starts in the first
 * column or spans several.
 *
 * ONE definition, two consumers (#28 slice 3, 2026-11-16): the table
 * detector (`../table-extract/detect.ts`, where it was born) and `./flow`'s
 * wrapped cells. They feed it different spans — detect.ts a contiguous
 * PARTITION of the table's width, flow.ts its cells' own x-extents with white
 * gaps between — so over flow's spans a line wholly in a gap, or one far
 * wider than its column, still passes; flow.ts adds {@link insideSlot}.
 */
export function fitsAsCell(
  spans: readonly (readonly [number, number])[],
  x0: number,
  x1: number,
): boolean {
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (!first || !last) return false;
  return (
    x0 >= first[1] && x0 < last[1] && overlapped(spans, x0, x1).length <= 1
  );
}

/**
 * The one span an x-range overlaps, or -1 when it overlaps none or several.
 * flow.ts's wrapped cells need exactly one: over its gapped spans a line in
 * a gap overlaps none and passes {@link fitsAsCell}.
 */
export function overlappedSpan(
  spans: readonly (readonly [number, number])[],
  x0: number,
  x1: number,
): number {
  const hit = overlapped(spans, x0, x1);
  return hit.length === 1 ? hit[0]! : -1;
}

/**
 * Column k's SLOT: from the end of the column before it to the start of the
 * column after it (the page edge for the first and last). A wrapped line may
 * be wider than every one-line cell of its column, so it is held inside the
 * slot, not the span. flow.ts's absorption and its placement invariant
 * (INV-4) both call this: one bound, so they cannot disagree.
 */
export function insideSlot(
  spans: readonly (readonly [number, number])[],
  k: number,
  x0: number,
  x1: number,
): boolean {
  const before = spans[k - 1];
  const after = spans[k + 1];
  return (
    k >= 0 &&
    k < spans.length &&
    (before === undefined || x0 >= before[1]) &&
    (after === undefined || x1 <= after[0])
  );
}

export interface GridCellInput {
  xMin: number;
  xMax: number;
}

export interface TableGrid {
  /** Each column's x-range, left to right, disjoint. */
  spans: readonly (readonly [number, number])[];
  /** `col[r][c]`: the column cell c of row r sits in; non-decreasing per row. */
  col: readonly (readonly number[])[];
}

export type GridRefusal = "cells" | "columns" | "one-column" | "order";

/**
 * Cells grouped into columns: sorted by xMin (a stable sort), each joining
 * the column before it when it starts at or before that column's right
 * edge. Loops, no spreads: a block of 10^5 cells overflows an argument list.
 */
export function chainColumns<T extends GridCellInput>(
  cells: readonly T[],
): { spans: [number, number][]; groups: T[][]; spanOf: Map<T, number> } {
  const sorted = [...cells].sort((a, b) => a.xMin - b.xMin);
  const spans: [number, number][] = [];
  const groups: T[][] = [];
  const spanOf = new Map<T, number>();
  for (const cell of sorted) {
    const last = spans[spans.length - 1];
    if (last && cell.xMin <= last[1]) {
      if (cell.xMax > last[1]) last[1] = cell.xMax;
      groups[groups.length - 1]!.push(cell);
    } else {
      spans.push([cell.xMin, cell.xMax]);
      groups.push([cell]);
    }
    spanOf.set(cell, spans.length - 1);
  }
  return { spans, groups, spanOf };
}

/**
 * The fewest rows a table is written with as a Word table — one more than
 * `flow.ts`'s `MIN_TABLE_ROWS`, which still decides what is read as a
 * table's rows. Added 2026-11-15 (#28 slice 2, review round 2): a two-line
 * running header ("Annual Report 2026 | Confidential" over "Section 3
 * Results | Page 4") passes flow.ts's rules on every page of a report, and
 * came out as a bordered 2x2 Word table on each. Two rows is a header and
 * one row at most; such a table stays the tabbed rows it was, counted.
 */
export const MIN_WORD_TABLE_ROWS = 3;

/**
 * Why a grid is NOT written as a Word table although its geometry is sound
 * (#28 slice 2, review round 2, 2026-11-15) — scope cut, not a heuristic to
 * place more: a doubtful table stays the tabbed rows main delivered and is
 * counted. Each reason is a false table the review built:
 *  - "rows": fewer than {@link MIN_WORD_TABLE_ROWS} rows (a running header);
 *  - "numbers": no column whose every cell below the first row is a NUMBER
 *    ({@link isNumberCell}) — a letterhead ("12 Harbour Road | Date
 *    2026-11-15"), Bengali prose beside a sidebar of names, two columns of
 *    Chinese prose (flow.ts's rule 4 cannot see wrapping in a script
 *    without letter case, so these passed as tables of one line per row);
 *  - "prose": a column with two or more cells that end a sentence — the
 *    right-hand column of a two-column page set beside a table, which the
 *    page-wide bands made the table's third column ("Item | Qty | Sales
 *    rose sharply.");
 *  - "header": a column whose only cell is in the first row — a heading
 *    that does not overlap its right-aligned values in x (REPORT_TABLES's
 *    "Staff" over 12 / 30 / 18), so the values got a column of their own
 *    with no heading and the heading headed an empty column: each value
 *    MOVED out from under its header.
 * A table of names and words with no figures in it is therefore tabbed, and
 * the copy says a Word table needs a column of figures.
 */
export type WordTableDoubt = "rows" | "numbers" | "prose" | "header";

/**
 * A NUMBER, as a table's figure column holds: an amount, a quantity, a date,
 * a percentage, a code — either one token (no space) with a digit and at
 * most three letters ("1,250.00", "41%", "2026-01-05", "A-100", "Q1",
 * "USD12"), or digits with only separators, signs and currency between them
 * ("$ 4.50", "1 200", "(300)"). Not a list's numbering ("1.", "a)", "iv.").
 */
export function isNumberCell(text: string): boolean {
  const t = text.trim();
  if (!/\p{N}/u.test(t)) return false;
  if (/^(?:\p{N}{1,3}[.)]|\(?(?:[a-z]|[ivxlc]{1,5})[.)])$/iu.test(t))
    return false;
  if (/^[\p{N}\p{Sc}\s.,:;%‰()[\]+\-–—−/'’#*]+$/u.test(t)) return true;
  if (/\s/u.test(t)) return false;
  return (t.match(/\p{L}/gu) ?? []).length <= 3;
}

/** Ends a sentence: a letter, then `.` `!` `?` or a CJK/Indic full stop. */
const ENDS_SENTENCE = /\p{L}[.!?。！？।]+["'”’»)\]]*$/u;

/**
 * The grid's FIGURE columns: each with two or more cells below the first row,
 * every one of them a NUMBER ({@link isNumberCell}). The "numbers" leg of
 * {@link wordTableDoubt}, which calls it — one definition: a table needs one
 * such column, and `./flow` never absorbs a wrapped line under one below the
 * header (#28 slice 3).
 */
export function figureColumns(
  rows: readonly (readonly { text: string }[])[],
  grid: TableGrid,
): ReadonlySet<number> {
  const columns = grid.spans.length;
  const numbers = Array.from({ length: columns }, () => 0);
  const notNumbers = Array.from({ length: columns }, () => 0);
  rows.forEach((row, r) => {
    if (r === 0) return;
    row.forEach((cell, c) => {
      const k = grid.col[r]![c]!;
      if (isNumberCell(cell.text)) numbers[k]! += 1;
      else notNumbers[k]! += 1;
    });
  });
  const out = new Set<number>();
  for (let k = 0; k < columns; k++)
    if (numbers[k]! >= 2 && notNumbers[k] === 0) out.add(k);
  return out;
}

/**
 * Why the grid of `rows` (each row's cells' text, in the order `grid.col`
 * places them) should stay tabbed rows, or null when it is written as a Word
 * table. See {@link WordTableDoubt}.
 */
export function wordTableDoubt(
  rows: readonly (readonly { text: string }[])[],
  grid: TableGrid,
): WordTableDoubt | null {
  if (rows.length < MIN_WORD_TABLE_ROWS) return "rows";
  const columns = grid.spans.length;
  const filled = Array.from({ length: columns }, () => 0);
  const sentences = Array.from({ length: columns }, () => 0);
  const inFirstRow = new Set(grid.col[0] ?? []);
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      const k = grid.col[r]![c]!;
      if (ENDS_SENTENCE.test(cell.text.trim())) sentences[k]! += 1;
      if (r === 0) return;
      filled[k]! += 1;
    }),
  );
  for (let k = 0; k < columns; k++)
    if (inFirstRow.has(k) && filled[k] === 0) return "header";
  if (sentences.some((n) => n >= 2)) return "prose";
  return figureColumns(rows, grid).size > 0 ? null : "numbers";
}

/**
 * The grid for one table's rows (each row's cells in xMin order), or why it
 * is not written as a Word table. In this order: the cell count against the
 * cap and the page's budget (before any sort); the chain; fewer than two or
 * more than {@link MAX_TABLE_COLUMNS} columns; the slots against the page's
 * budget; and a row whose columns go backwards ("order" — never expected,
 * and a refusal, not a throw, since a throw here would fail the user's job).
 */
export function tableGrid<T extends GridCellInput>(
  rows: readonly (readonly T[])[],
  pageBudget: { cells: number; slots: number },
): TableGrid | GridRefusal {
  let count = 0;
  for (const row of rows) count += row.length;
  if (count > MAX_TABLE_CELLS || count > pageBudget.cells) return "cells";
  const all: T[] = [];
  for (const row of rows) for (const c of row) all.push(c);
  const { spans, spanOf } = chainColumns(all);
  if (spans.length < 2) return "one-column";
  if (spans.length > MAX_TABLE_COLUMNS) return "columns";
  if (rows.length * spans.length > pageBudget.slots) return "cells";
  const col: number[][] = [];
  for (const row of rows) {
    const out: number[] = [];
    for (const c of row) {
      const k = spanOf.get(c)!;
      if (out.length && k < out[out.length - 1]!) return "order";
      out.push(k);
    }
    col.push(out);
  }
  return { spans, col };
}
