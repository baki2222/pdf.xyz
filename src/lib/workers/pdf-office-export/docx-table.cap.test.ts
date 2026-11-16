// @vitest-environment node
/**
 * PDF to Word's Word-table costs (#28 slice 2), held to bounds in a FRESH
 * process each (`src/tests/docx-table-measure.ts`). The figures measured on
 * 2026-11-15 sit beside the caps in `../pdf-text/table-grid.ts`. Every run
 * carries its own health check — the work was done (the cells were written,
 * the refusal counted) — so a fast run is not a run that did nothing.
 *
 * Wall time is bounded RELATIVE to a control measured in the same job (the
 * same page written as tabbed rows, what main delivered), with #318's exit
 * bound: red only past 2x the control's time AND 5 s more, or 2x its peak
 * memory AND 300 MB more. CI's runners are not the dev host.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_TABLE_CELLS,
  MAX_TABLE_SLOTS_PER_PAGE,
  MAX_WRAP_LINES_PER_CELL,
} from "../pdf-text/table-grid";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(ROOT, "src", "tests", "docx-table-measure.ts");

type Measured = { ms: number; rssDeltaMb: number } & Record<
  string,
  number | undefined
>;

function measure(mode: string, n: number): Measured {
  const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, mode, `${n}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(out.trim().split("\n").at(-1)!) as Measured;
}

describe("Word tables are bounded", () => {
  it("the grid of a table AT the cell cap, 10 and 63 columns wide", () => {
    const narrow = measure("grid", MAX_TABLE_CELLS);
    expect(narrow.rows, JSON.stringify(narrow)).toBe(MAX_TABLE_CELLS / 10);
    expect(narrow.columns).toBe(10);
    const wideRows = Math.floor(MAX_TABLE_CELLS / 63);
    const wide = measure("grid-wide", wideRows * 63);
    expect(wide.rows, JSON.stringify(wide)).toBe(wideRows);
    expect(wide.columns).toBe(63);
    // Measured 3 ms / +4 MB each on the dev host.
    for (const got of [narrow, wide]) {
      expect(got.ms, JSON.stringify(got)).toBeLessThan(5_000);
      expect(got.rssDeltaMb, JSON.stringify(got)).toBeLessThan(300);
    }
  }, 120_000);

  it("the flow over a table of that many cells", () => {
    const got = measure("flow", MAX_TABLE_CELLS);
    expect(got.tableRows, JSON.stringify(got)).toBe(MAX_TABLE_CELLS / 10);
    expect(got.tablesAsTabs).toBe(0);
    // Measured 37 ms / +18 MB on the dev host.
    expect(got.ms, JSON.stringify(got)).toBeLessThan(10_000);
  }, 120_000);

  it("a page AT the slot cap through the whole job, within the exit bound of its tabbed control", () => {
    const control = measure("engine-tabbed", MAX_TABLE_SLOTS_PER_PAGE);
    const got = measure("engine", MAX_TABLE_SLOTS_PER_PAGE);
    // Health: two tables, every slot written as a w:tc; the control none.
    expect(got.tables, JSON.stringify(got)).toBe(2);
    expect(got.cells).toBe(MAX_TABLE_SLOTS_PER_PAGE);
    expect(control.tables, JSON.stringify(control)).toBe(0);
    const slower = got.ms > 2 * control.ms && got.ms - control.ms > 5_000;
    const heavier =
      got.rssDeltaMb > 2 * control.rssDeltaMb &&
      got.rssDeltaMb - control.rssDeltaMb > 300;
    expect(
      { slower, heavier },
      `${JSON.stringify(got)} vs ${JSON.stringify(control)}`,
    ).toEqual({ slower: false, heavier: false });
  }, 300_000);

  it("one table past the cell cap comes out as tabbed rows, counted, in bounded time", () => {
    const got = measure("over", MAX_TABLE_CELLS + 10);
    expect(got.tables, JSON.stringify(got)).toBe(0);
    expect(got.asTabs).toBe(1);
    expect(got.ms, JSON.stringify(got)).toBeLessThan(30_000);
  }, 300_000);

  it("a block of 200,000 aligned bands does not overflow an argument list (the spreads before any cap)", () => {
    const got = measure("spread", 200_000);
    expect(got.error, JSON.stringify(got)).toBeUndefined();
    expect(got.paragraphs).toBe(200_000);
    // One run of 400,000 cells: over every cap, so kept as tabbed rows.
    expect(got.tablesAsTabs).toBe(1);
  }, 300_000);

  /**
   * #28 slice 3 (wraps), 2026-11-16. Each run against the same page read
   * with absorption OFF (`wrap-off`, slice 2's delivery) with #318's exit
   * bound. Medians of 3 on the dev host (Windows 11, Node 24), alternating:
   * wrap-off 189 ms / +125 MB, wrap 259 ms / +141 MB, wrap-cut 327 ms /
   * +150 MB, wrap-cell 29 ms / +3 MB. In the worker image (sha256:7400…,
   * node 22, throwaway container): wrap-off 582 ms / +43 MB, wrap 802 ms /
   * +55 MB, wrap-cut 1,266 ms / +54 MB, wrap-cell 79 ms / +4 MB.
   */
  const withinBound = (got: Measured, control: Measured) => {
    const slower = got.ms > 2 * control.ms && got.ms - control.ms > 5_000;
    const heavier =
      got.rssDeltaMb > 2 * control.rssDeltaMb &&
      got.rssDeltaMb - control.rssDeltaMb > 300;
    expect(
      { slower, heavier },
      `${JSON.stringify(got)} vs ${JSON.stringify(control)}`,
    ).toEqual({ slower: false, heavier: false });
  };
  /** The most 3-cell rows one table may hold: the wrap pages' size. */
  const WRAP_ROWS = Math.floor(MAX_TABLE_CELLS / 3);

  it("a table AT the cell cap, every body row wrapped, through the whole job: every continuation absorbed, within the bound of absorption off", () => {
    const control = measure("wrap-off", WRAP_ROWS * 10);
    const got = measure("wrap", WRAP_ROWS * 10);
    // Health: one table, every slot a w:tc, every body row's line absorbed;
    // the control read the same page as no Word table at all.
    expect(got.tables, JSON.stringify(got)).toBe(1);
    expect(got.cells).toBe(WRAP_ROWS * 3);
    expect(got.wrapLines).toBe(WRAP_ROWS - 1);
    expect(control.tables, JSON.stringify(control)).toBe(0);
    expect(control.wrapLines).toBe(0);
    withinBound(got, control);
  }, 300_000);

  it("the same table cut at every other continuation (the cut-and-rejudge worst case): within the bound of absorption off", () => {
    const control = measure("wrap-off", WRAP_ROWS * 10);
    const got = measure("wrap-cut", WRAP_ROWS * 10);
    // Health, as measured: the header and the first two rows stay one
    // table (row 1's line absorbed, row 2's number cuts the run); every
    // later run is one row and its line, under the three rows a Word table
    // needs.
    expect(got.tables, JSON.stringify(got)).toBe(1);
    expect(got.cells).toBe(9);
    expect(got.wrapLines).toBe(1);
    withinBound(got, control);
  }, 300_000);

  it("a cell of MAX_WRAP_LINES_PER_CELL + 1 lines: the run is cut at the cap, and the rows above keep exactly the cap", () => {
    const got = measure("wrap-cell", 0);
    expect(got.tables, JSON.stringify(got)).toBe(1);
    expect(got.cells).toBe(60 * 3);
    expect(got.wrapLines).toBe(MAX_WRAP_LINES_PER_CELL);
    expect(got.ms, JSON.stringify(got)).toBeLessThan(10_000);
  }, 120_000);
});
