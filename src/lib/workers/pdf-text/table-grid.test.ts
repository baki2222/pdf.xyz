import { describe, expect, it } from "vitest";
import { MAX_GRID_COLUMNS } from "@/lib/workers/pdf-office-export/docx-structure";
import {
  chainColumns,
  isNumberCell,
  MAX_TABLE_CELLS,
  MAX_TABLE_CELLS_PER_PAGE,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_SLOTS_PER_PAGE,
  MIN_WORD_TABLE_ROWS,
  tableGrid,
  wordTableDoubt,
  type GridCellInput,
} from "./table-grid";
import { expectRatioBelow } from "@/tests/time-bound";

/**
 * #28 slice 2 (tables): the grid a recognised table is written on. Each
 * row's cells arrive in xMin order (flow.ts sorts them); the grid's spans are
 * `columns()`'s chained x-ranges, and `col[r][c]` is the span cell c of row r
 * falls in.
 */
const cell = (xMin: number, xMax: number): GridCellInput => ({ xMin, xMax });
/** A cell whose every read of its x-range is counted: work, not time. */
const countedCell = (
  xMin: number,
  xMax: number,
  read: () => void,
): GridCellInput => ({
  get xMin() {
    read();
    return xMin;
  },
  get xMax() {
    read();
    return xMax;
  },
});

/** One time-boxed sample lasts at least this long, so a timer tick is noise. */
const SAMPLE_MS = 100;

/**
 * Each function's best time per call over `reps` rounds, the functions
 * interleaved inside every round (so a load change reaches all sides), each
 * sample looping until SAMPLE_MS has passed. Each function runs once
 * before, to pay what a first call pays.
 */
function interleavedBest(fns: readonly (() => unknown)[], reps = 5): number[] {
  for (const fn of fns) fn();
  const best = fns.map(() => Infinity);
  for (let k = 0; k < reps; k++)
    fns.forEach((fn, i) => {
      let calls = 0;
      let spent = 0;
      const t0 = performance.now();
      do {
        fn();
        calls += 1;
        spent = performance.now() - t0;
      } while (spent < SAMPLE_MS);
      best[i] = Math.min(best[i]!, spent / calls);
    });
  return best;
}

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

  /**
   * WAS `ms < 50 * max(control, 1)`: one cold tableGrid sample against one
   * warm chainColumns sample of the same cells (ci-flake audit 2026-11-19,
   * table-grid.test.ts:136). It passed both O(n^2) mutants the audit built —
   * a column lookup by scan in tableGrid (ratio 7.7-9.4 against 50) and a
   * copying push in chainColumns (1.1-1.2: the control slows down with the
   * subject) — and its 50 ms floor sat under a stall CI had already shown.
   *
   * Now, speed-independent first: the work counted as reads of the cells'
   * x-ranges, at 10,000 cells against 1,250. The sort and the chaining read
   * them a near-linear number of times (8.06x for the 8x step, counted on
   * this input); an insertion sort reads them per pair, about 64x. 23 is the
   * geometric mean, so either side has about 2.8x before it crosses, at any
   * runner speed. The count cannot see work that never reads a cell (the
   * scan mutant compares identities); the chainColumns test below and the
   * chunked ratio here carry that, in measure mode until CI calibrates them.
   */
  it("a 10,000-cell table is gridded in bounded time", () => {
    const rowsOf = (n: number, read: () => void = () => {}) =>
      Array.from({ length: n }, () => [
        countedCell(0, 5, read),
        countedCell(10, 15, read),
      ]);
    const readsAt = (n: number) => {
      let reads = 0;
      const grid = tableGrid(
        rowsOf(n, () => (reads += 1)),
        PAGE,
      );
      return { reads, grid };
    };
    const full = readsAt(5_000);
    const eighth = readsAt(625);
    const columns =
      typeof full.grid === "string" ? full.grid : full.grid.col.length;
    expect(columns).toBe(5_000);
    // Health: the counter saw the work (a dead getter reads 0, ratio NaN).
    expect(eighth.reads).toBeGreaterThan(625 * 2);
    const readGrowth = full.reads / eighth.reads;
    const nearLinear = readGrowth < 23;
    expect(nearLinear, `reads ${full.reads} / ${eighth.reads}`).toBe(true);

    // The time: the whole table against the same cells in 16 chunks of a
    // sixteenth, interleaved, time-boxed samples, best per call. Same
    // volume, so a uniform slowdown cancels; at the cap the separation is
    // capped near 12x (fixed 1.13-1.35, scan mutant 6.5-7.3 on the dev
    // host), which is why it only records until CI shows its spread.
    const rows = rowsOf(16 * 312);
    const chunks = Array.from({ length: 16 }, (_, i) =>
      rows.slice(i * 312, (i + 1) * 312),
    );
    const [whole, parts] = interleavedBest([
      () => tableGrid(rows, PAGE),
      () => {
        for (const part of chunks) tableGrid(part, PAGE);
      },
    ]);
    expectRatioBelow("table-grid-whole-vs-chunked", whole!, parts!, 3, {
      mode: "measure",
      witness: "columns",
    });
  });

  /**
   * chainColumns has no cell cap, so its cost shape is timed beyond the
   * table's: 40,000 cells in one call against the same 40,000 in 16 calls of
   * 2,500. Dev host (busy): fixed 1.16-1.30; a copying push (`[...group,
   * c]`) 7.0-9.0 at 10-20k and 33 at 40k. Bound 4: measure mode until CI
   * prints its own spread (rule: bound >= 2x the CI max). The 30 s timeout
   * is for a quadratic mutant (about 1.4 s a call) to end on this ratio,
   * not on the 5 s default.
   */
  it("chainColumns stays near-linear past the table cap", () => {
    const cellsOf = (n: number) =>
      Array.from({ length: n }, (_, i) => (i % 2 ? cell(10, 15) : cell(0, 5)));
    const large = cellsOf(40_000);
    const chunks = Array.from({ length: 16 }, () => cellsOf(2_500));
    const volume = chunks.reduce((k, c) => k + c.length, 0);
    expect(volume).toBe(large.length);
    const spans = chainColumns(large).spans.length;
    expect(spans).toBe(2);
    const [one, sixteen] = interleavedBest([
      () => chainColumns(large),
      () => {
        for (const c of chunks) chainColumns(c);
      },
    ]);
    expectRatioBelow("chain-columns-one-vs-chunked", one!, sixteen!, 4, {
      mode: "measure",
      witness: "spans",
    });
  }, 30_000);

  it("holds Word's limit equal to the reader's", () => {
    expect(MAX_TABLE_COLUMNS).toBe(MAX_GRID_COLUMNS);
  });
});

/**
 * Review round 2 (2026-11-15): a grid whose geometry is sound is still kept
 * as tabbed rows when the table is doubtful (`wordTableDoubt`). Each case is
 * one the review built as a FALSE Word table on the branch; each reason is
 * shown firing on its own, and a real table passing all of them.
 */
describe("wordTableDoubt", () => {
  /** Rows of [x, text] cells, gridded by the real tableGrid. */
  const doubt = (rows: [number, string][][]) => {
    const cells = rows.map((row) =>
      row.map(([x, text]) => ({ xMin: x, xMax: x + 6 * text.length, text })),
    );
    const grid = tableGrid(cells, PAGE);
    if (typeof grid === "string") throw new Error(grid);
    return wordTableDoubt(cells, grid);
  };

  it("POSITIVE CONTROL: an invoice table with a figure column is a Word table", () => {
    expect(
      doubt([
        [
          [72, "Item"],
          [300, "Qty"],
          [420, "Price"],
        ],
        [
          [72, "Widget"],
          [300, "2"],
          [420, "9.50"],
        ],
        [
          [72, "Gadget"],
          [420, "12.00"],
        ],
        [
          [72, "Gizmo"],
          [300, "5"],
          [420, "3.25"],
        ],
      ]),
    ).toBeNull();
  });

  it('"rows": a two-line running header is not a Word table', () => {
    expect(MIN_WORD_TABLE_ROWS).toBe(3);
    expect(
      doubt([
        [
          [50, "Annual Report 2026"],
          [470, "2026"],
        ],
        [
          [50, "Section 3 Results"],
          [470, "4"],
        ],
      ]),
    ).toBe("rows");
  });

  it('"numbers": a letterhead has no column of figures', () => {
    expect(
      doubt([
        [
          [50, "ACME Corporation"],
          [430, "Invoice 1042"],
        ],
        [
          [50, "12 Harbour Road"],
          [430, "Date 2026-11-15"],
        ],
        [
          [50, "Dhaka 1207"],
          [430, "Due 2026-12-15"],
        ],
      ]),
    ).toBe("numbers");
  });

  it('"numbers": a sidebar of names beside prose of a caseless script', () => {
    expect(
      doubt([
        [
          [50, "Rahim"],
          [200, "আমাদের প্রতিষ্ঠান গত বছর অনেক নতুন"],
        ],
        [
          [50, "Karim"],
          [200, "গ্রাহকের কাছে পৌঁছেছে এবং সেবার মান"],
        ],
        [
          [50, "Salma"],
          [200, "আরও উন্নত করেছে যা সবার কাছে"],
        ],
      ]),
    ).toBe("numbers");
  });

  it('"numbers": a list numbered "1." "2." "3." is not a figure column', () => {
    expect(
      doubt([
        [
          [50, "1."],
          [120, "Open the file"],
        ],
        [
          [50, "2."],
          [120, "Choose a page"],
        ],
        [
          [50, "3."],
          [120, "Press Save"],
        ],
      ]),
    ).toBe("numbers");
  });

  it('"prose": sentences set beside a table are not its third column', () => {
    expect(
      doubt([
        [
          [50, "Item"],
          [150, "Qty"],
          [330, "Sales rose sharply."],
        ],
        [
          [50, "Widget"],
          [150, "2"],
          [330, "Margins held firm."],
        ],
        [
          [50, "Gadget"],
          [150, "7"],
          [330, "Outlook remains good."],
        ],
      ]),
    ).toBe("prose");
  });

  it('"header": a heading that does not overlap its values heads no column alone', () => {
    // REPORT_TABLES_BBOX's second table, its words' x-ranges as captured.
    const cells = [
      [
        { xMin: 60, xMax: 90, text: "Office" },
        { xMin: 160, xMax: 184, text: "Staff" },
        { xMin: 240, xMax: 285, text: "Manager" },
      ],
      [
        { xMin: 60, xMax: 92, text: "London" },
        { xMin: 203, xMax: 215, text: "12" },
        { xMin: 240, xMax: 300, text: "Ada Lovelace" },
      ],
      [
        { xMin: 60, xMax: 100, text: "New York" },
        { xMin: 203, xMax: 215, text: "30" },
        { xMin: 240, xMax: 300, text: "Grace Hopper" },
      ],
    ];
    const grid = tableGrid(cells, PAGE);
    if (typeof grid === "string") throw new Error(grid);
    // The geometry alone puts "Staff" over an empty column of its own.
    expect(grid.spans).toHaveLength(4);
    expect(grid.col[0]).toEqual([0, 1, 3]);
    expect(grid.col[1]).toEqual([0, 2, 3]);
    expect(wordTableDoubt(cells, grid)).toBe("header");
  });

  it("isNumberCell: figures, dates, codes and amounts; not words, list numbers or labels", () => {
    const yes = [
      "12",
      "1,250.00",
      "$3,400.50",
      "41%",
      "2026-01-05",
      "A-100",
      "Q1",
      "(300)",
      "$ 4.50",
      "1 200",
      "১২৩",
    ];
    const no = [
      "Total",
      "Page 4",
      "Invoice 1042",
      "12 Harbour Road",
      "1.",
      "a)",
      "iv.",
      "Due 2026-12-15",
      "收入增长了20%左右",
    ];
    expect(yes.filter((t) => !isNumberCell(t))).toEqual([]);
    expect(no.filter((t) => isNumberCell(t))).toEqual([]);
  });
});
