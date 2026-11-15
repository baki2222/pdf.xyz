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
} from "../pdf-text/table-grid";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(ROOT, "src", "tests", "docx-table-measure.ts");

function measure(mode: string, n: number): Record<string, number> {
  const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, mode, `${n}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(out.trim().split("\n").at(-1)!) as Record<string, number>;
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
});
