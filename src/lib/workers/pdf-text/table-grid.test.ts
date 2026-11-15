import { describe, expect, it } from "vitest";
import { MAX_GRID_COLUMNS } from "@/lib/workers/pdf-office-export/docx-structure";
import {
  chainColumns,
  MAX_TABLE_CELLS,
  MAX_TABLE_CELLS_PER_PAGE,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_SLOTS_PER_PAGE,
  tableGrid,
  type GridCellInput,
} from "./table-grid";

/**
 * #28 slice 2 (tables): the grid a recognised table is written on. Each
 * row's cells arrive in xMin order (flow.ts sorts them); the grid's spans are
 * `columns()`'s chained x-ranges, and `col[r][c]` is the span cell c of row r
 * falls in.
 */
const cell = (xMin: number, xMax: number): GridCellInput => ({ xMin, xMax });
const PAGE = {
  cells: MAX_TABLE_CELLS_PER_PAGE,
  slots: MAX_TABLE_SLOTS_PER_PAGE,
};

describe("tableGrid", () => {
  it("chains overlapping x-ranges into spans and puts each cell in its own", () => {
    const grid = tableGrid(
      [
        [cell(50, 85), cell(160, 175), cell(270, 285)],
        [cell(50, 77), cell(160, 184), cell(270, 294)],
      ],
      PAGE,
    );
    expect(grid).toEqual({
      spans: [
        [50, 85],
        [160, 184],
        [270, 294],
      ],
      col: [
        [0, 1, 2],
        [0, 1, 2],
      ],
    });
  });

  it("an empty column in a row keeps the next value in ITS column, not shifted left", () => {
    const grid = tableGrid(
      [
        [cell(72, 100), cell(300, 320), cell(420, 450)],
        [cell(72, 110), cell(420, 452)],
      ],
      PAGE,
    );
    if (typeof grid === "string") throw new Error(grid);
    expect(grid.col[1]).toEqual([0, 2]);
  });

  it("two cells of one row that chain into one span share it, in xMin order", () => {
    // SPANNING_TABLE's shape: a header cell over two sub-columns.
    const grid = tableGrid(
      [
        [cell(60, 95), cell(200, 314)],
        [cell(200, 215), cell(280, 295), cell(360, 375)],
        [cell(60, 87), cell(200, 224), cell(280, 304), cell(360, 384)],
      ],
      PAGE,
    );
    if (typeof grid === "string") throw new Error(grid);
    expect(grid.spans).toEqual([
      [60, 95],
      [200, 314],
      [360, 384],
    ]);
    expect(grid.col).toEqual([
      [0, 1],
      [1, 1, 2],
      [0, 1, 1, 2],
    ]);
  });

  it("refuses a grid of one column, and one of more than Word's 63", () => {
    expect(tableGrid([[cell(0, 10)], [cell(5, 20)]], PAGE)).toBe("one-column");
    const wide = (n: number) =>
      Array.from({ length: n }, (_, k) => cell(k * 10, k * 10 + 5));
    const at = tableGrid([wide(63), wide(63)], PAGE);
    expect(typeof at === "string" ? at : at.spans.length).toBe(63);
    expect(tableGrid([wide(64), wide(64)], PAGE)).toBe("columns");
  });

  it("refuses a table over the cell cap, or over what the page has left, before chaining", () => {
    const row = [cell(0, 5), cell(10, 15)];
    const rows = Array.from({ length: MAX_TABLE_CELLS / 2 + 1 }, () => row);
    expect(tableGrid(rows, PAGE)).toBe("cells");
    expect(tableGrid([row, row], { cells: 3, slots: 100 })).toBe("cells");
    // Slots count the empties: 2 rows x 3 spans = 6 slots.
    expect(
      tableGrid(
        [
          [cell(0, 5), cell(10, 15)],
          [cell(0, 5), cell(20, 25)],
        ],
        { cells: 100, slots: 5 },
      ),
    ).toBe("cells");
  });

  it('refuses ("order") rather than throws when a row is not in xMin order', () => {
    expect(
      tableGrid(
        [
          [cell(100, 120), cell(0, 10)],
          [cell(0, 10), cell(100, 120)],
        ],
        PAGE,
      ),
    ).toBe("order");
  });

  it("a 10,000-cell table is gridded in bounded time", () => {
    const rows = Array.from({ length: 5_000 }, () => [
      cell(0, 5),
      cell(10, 15),
    ]);
    const t0 = performance.now();
    const grid = tableGrid(rows, PAGE);
    const ms = performance.now() - t0;
    expect(typeof grid === "string" ? grid : grid.col.length).toBe(5_000);
    // A control-relative bound: chaining the same cells by hand.
    const c0 = performance.now();
    chainColumns(rows.flat());
    const control = performance.now() - c0;
    expect(ms).toBeLessThan(50 * Math.max(control, 1));
  });

  it("holds Word's limit equal to the reader's", () => {
    expect(MAX_TABLE_COLUMNS).toBe(MAX_GRID_COLUMNS);
  });
});
