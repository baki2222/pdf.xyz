// @vitest-environment node
/**
 * PDF to Word's Word-table costs (#28 slice 2), held to bounds in a FRESH
 * process each (`src/tests/docx-table-measure.ts`). The figures measured on
 * 2026-11-15 sit beside the caps in `../pdf-text/table-grid.ts`. Every run
 * carries its own health check — the work was done (the cells were written,
 * the refusal counted) — so a fast run is not a run that did nothing.
 *
 * WHICH bounds are which (WAS "wall time is bounded RELATIVE to a control",
 * true of three of the seven time checks; ci-flake audit 2026-11-19):
 *  - three exit bounds against a control measured in the same job (the
 *    same page written as tabbed rows, what main delivered, or read with
 *    absorption off), #318's: 2x the control's time AND 5 s more, or 2x its
 *    peak memory AND 300 MB more — the engine, wrap and wrap-cut tests;
 *  - four absolute hang ceilings (5 s, 10 s, 30 s, 10 s) — grid, flow, over
 *    and wrap-cell.
 * Since 2026-11-22 every TIME is routed through `@/tests/time-bound` and
 * records (measure mode) until CI calibrates it; the memory halves still
 * assert. What fails on time meanwhile: the child's own kill (CHILD_KILL_MS,
 * enforced while it runs), each test's timeout, and the grid's work COUNTED
 * (reads of the cells' x-ranges), which no runner's speed moves.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectFasterThan, expectRatioBelow } from "@/tests/time-bound";
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

/**
 * A child's kill bound, enforced WHILE it runs: execFileSync blocks the
 * worker, so vitest's timeout is checked only after it returns, and a child
 * that never exits would hold the job to GitHub's 6 h default. The slowest
 * single child seen on CI: 5,509 ms (spread, 43998624497; ci-flake audit
 * 2026-11-19; 5,233 ms over 14 attempts 2026-11-19..21, 44428026069). 60 s
 * is 10.9x that, and two of them fit the 120 s tests.
 */
const CHILD_KILL_MS = 60_000;

function measure(mode: string, n: number): Measured {
  const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, mode, `${n}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: CHILD_KILL_MS,
    killSignal: "SIGKILL",
  });
  return JSON.parse(out.trim().split("\n").at(-1)!) as Measured;
}

/**
 * #318's exit bound against a control measured in the same job: red only
 * past 2x the control's time AND 5 s more, or 2x its peak memory AND 300 MB
 * more. The memory half asserts here. The time half is routed in each test,
 * as two records of the two best samples (`msBest`: each child's fresh run
 * and one more of the same work): the ratio, and the excess over the
 * control against 5 s. The helpers hold one bound each, never a
 * conjunction, so each half must stand ALONE: the ratio's record is against
 * 5, not #318's 2 — on the dev host the wrap-cut pair alone reads 2.12
 * (2.18 in the worker image), so 2 by itself would be red on honest code.
 * Both record until CI calibrates them (ci-flake audit 2026-11-19, lines
 * 72/129/142: the 5 s floor decided the predicate, 1.08-1.17x strict, and
 * the ratio was never printed).
 */
function withinMemory(got: Measured, control: Measured) {
  const heavier =
    got.rssDeltaMb > 2 * control.rssDeltaMb &&
    got.rssDeltaMb - control.rssDeltaMb > 300;
  expect(
    { heavier },
    `${JSON.stringify(got)} vs ${JSON.stringify(control)}`,
  ).toEqual({ heavier: false });
}

/** A child's best time for its work (see docx-table-measure.ts's msBest). */
const best = (m: Measured) => m.msBest ?? m.ms;

describe("Word tables are bounded", () => {
  it("the grid of a table AT the cell cap, 10 and 63 columns wide", () => {
    const narrow = measure("grid", MAX_TABLE_CELLS);
    expect(narrow.rows, JSON.stringify(narrow)).toBe(MAX_TABLE_CELLS / 10);
    expect(narrow.columns).toBe(10);
    const wideRows = Math.floor(MAX_TABLE_CELLS / 63);
    const wide = measure("grid-wide", wideRows * 63);
    expect(wide.rows, JSON.stringify(wide)).toBe(wideRows);
    expect(wide.columns).toBe(63);
    // The work, counted: reads of the cells' x-ranges at the cap against an
    // eighth of it. The sort and the chaining are near-linear (dev host
    // 2026-11-22: 8.19x narrow, 8.95x wide); an insertion sort in place of
    // `[...cells].sort` reads per pair, about 64x. 23 sits near the
    // geometric mean, so either side has 2.5x or more, on any runner. It
    // cannot see work that never reads a cell.
    for (const got of [narrow, wide]) {
      expect(got.readsEighth, JSON.stringify(got)).toBeGreaterThan(1_000);
      const nearLinear = got.reads! / got.readsEighth! < 23;
      expect(nearLinear, JSON.stringify(got)).toBe(true);
      // Measured 3 ms / +4 MB each on the dev host. CI: 2,472 ms for the
      // whole test, both children with their start-up (44299285879), so 5 s
      // a child is 2x or more; it records until CI calibrates it.
      expectFasterThan("docx-table-grid-at-cap", got.ms, 5_000, {
        mode: "measure",
        witness: "nearLinear",
        instance: String(got.mode),
      });
      expect(got.rssDeltaMb, JSON.stringify(got)).toBeLessThan(300);
    }
  }, 120_000);

  it("the flow over a table of that many cells", () => {
    const got = measure("flow", MAX_TABLE_CELLS);
    const tableRows = got.tableRows;
    expect(tableRows, JSON.stringify(got)).toBe(MAX_TABLE_CELLS / 10);
    expect(got.tablesAsTabs).toBe(0);
    // Measured 37 ms / +18 MB on the dev host. CI: 1,233 ms for the whole
    // test (44007721339), so 10 s is 8.1x; a hang ceiling, recording.
    expectFasterThan("docx-table-flow-at-cap", got.ms, 10_000, {
      mode: "measure",
      witness: "tableRows",
    });
  }, 120_000);

  it("a page AT the slot cap through the whole job, within the exit bound of its tabbed control", () => {
    const control = measure("engine-tabbed", MAX_TABLE_SLOTS_PER_PAGE);
    const got = measure("engine", MAX_TABLE_SLOTS_PER_PAGE);
    // Health: two tables, every slot written as a w:tc; the control none.
    expect(got.tables, JSON.stringify(got)).toBe(2);
    const cells = got.cells;
    expect(cells).toBe(MAX_TABLE_SLOTS_PER_PAGE);
    expect(control.tables, JSON.stringify(control)).toBe(0);
    // CI: 4,625 ms for the whole test, both children (43998624497).
    withinMemory(got, control);
    const [gotMs, controlMs] = [best(got), best(control)];
    expectRatioBelow("docx-table-engine-ratio", gotMs, controlMs, 5, {
      mode: "measure",
      witness: "cells",
      detail: `${gotMs.toFixed(0)} ms vs control ${controlMs.toFixed(0)} ms`,
    });
    expectFasterThan(
      "docx-table-engine-excess",
      Math.max(0, gotMs - controlMs),
      5_000,
      {
        mode: "measure",
        witness: "cells",
      },
    );
  }, 300_000);

  it("one table past the cell cap comes out as tabbed rows, counted, in bounded time", () => {
    const got = measure("over", MAX_TABLE_CELLS + 10);
    expect(got.tables, JSON.stringify(got)).toBe(0);
    const asTabs = got.asTabs;
    expect(asTabs).toBe(1);
    // CI: 1,809 ms for the whole test (44331878323), so 30 s is 16.6x; a
    // hang ceiling, recording.
    expectFasterThan("docx-table-over-cap", got.ms, 30_000, {
      mode: "measure",
      witness: "asTabs",
    });
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
  /** The most 3-cell rows one table may hold: the wrap pages' size. */
  const WRAP_ROWS = Math.floor(MAX_TABLE_CELLS / 3);

  it("a table AT the cell cap, every body row wrapped, through the whole job: every continuation absorbed, within the bound of absorption off", () => {
    const control = measure("wrap-off", WRAP_ROWS * 10);
    const got = measure("wrap", WRAP_ROWS * 10);
    // Health: one table, every slot a w:tc, every body row's line absorbed;
    // the control read the same page as no Word table at all.
    expect(got.tables, JSON.stringify(got)).toBe(1);
    expect(got.cells).toBe(WRAP_ROWS * 3);
    const wrapLines = got.wrapLines;
    expect(wrapLines).toBe(WRAP_ROWS - 1);
    expect(control.tables, JSON.stringify(control)).toBe(0);
    expect(control.wrapLines).toBe(0);
    // CI: 4,280 ms for the whole test (43998624497). The writer is not
    // absorption (wrap-off writes no Word table), so a writer mutant only
    // shows this ratio CAN turn red; an absorption blowup's guard is the
    // counted seam in flow-wraps.test.ts.
    withinMemory(got, control);
    const [gotMs, controlMs] = [best(got), best(control)];
    expectRatioBelow("docx-table-wrap-ratio", gotMs, controlMs, 5, {
      mode: "measure",
      witness: "wrapLines",
      detail: `${gotMs.toFixed(0)} ms vs control ${controlMs.toFixed(0)} ms`,
    });
    expectFasterThan(
      "docx-table-wrap-excess",
      Math.max(0, gotMs - controlMs),
      5_000,
      {
        mode: "measure",
        witness: "wrapLines",
      },
    );
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
    const wrapLines = got.wrapLines;
    expect(wrapLines).toBe(1);
    // CI: 4,531 ms for the whole test (ok-44321190257), the thinnest in the
    // file. Its defect (an unbudgeted cut-and-rejudge, the square of the
    // rows) is held whatever the runner by flow-wraps.test.ts's COUNTED
    // test; never weaken that one on the strength of this.
    withinMemory(got, control);
    const [gotMs, controlMs] = [best(got), best(control)];
    expectRatioBelow("docx-table-wrap-cut-ratio", gotMs, controlMs, 5, {
      mode: "measure",
      witness: "wrapLines",
      detail: `${gotMs.toFixed(0)} ms vs control ${controlMs.toFixed(0)} ms`,
    });
    expectFasterThan(
      "docx-table-wrap-cut-excess",
      Math.max(0, gotMs - controlMs),
      5_000,
      {
        mode: "measure",
        witness: "wrapLines",
      },
    );
  }, 300_000);

  it("a cell of MAX_WRAP_LINES_PER_CELL + 1 lines: the run is cut at the cap, and the rows above keep exactly the cap", () => {
    const got = measure("wrap-cell", 0);
    expect(got.tables, JSON.stringify(got)).toBe(1);
    expect(got.cells).toBe(60 * 3);
    const wrapLines = got.wrapLines;
    expect(wrapLines).toBe(MAX_WRAP_LINES_PER_CELL);
    // CI: 1,162 ms for the whole test (ok-44299285879), so 10 s is 8.6x; a
    // hang ceiling, recording.
    expectFasterThan("docx-table-wrap-cell", got.ms, 10_000, {
      mode: "measure",
      witness: "wrapLines",
    });
  }, 120_000);
});
