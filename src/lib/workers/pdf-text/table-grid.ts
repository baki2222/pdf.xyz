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
