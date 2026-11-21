/**
 * Writes the wall-clock guard's two debt lists from the tree as it is:
 * `src/tests/wall-clock-debt.ts` (comparisons, uncalibrated routed calls,
 * undetected audit seeds) and `src/tests/fixed-sleep-debt.ts` (fixed
 * sleeps). Both are GENERATED: sorted, one entry per line, keyed by file,
 * collapsed snippet and occurrence index (never a line number), and tagged
 * with the owning lane, so a merge regenerates them instead of hand-merging.
 *
 *   node scripts/wall-clock-debt.mjs                 # check: exit 1 if a list differs
 *   node scripts/wall-clock-debt.mjs --write         # shrink-only rewrite
 *   node scripts/wall-clock-debt.mjs --write --accept-new
 *                                                    # also ADD entries: only at ship
 *                                                    # time, after merging main
 *
 * Without --accept-new an entry not already listed is printed and the run
 * fails: the lists may only shrink, and a new timing check goes through the
 * helpers instead.
 *
 * It runs the writer inside a child vitest (the one test in
 * wall-clock-bounds.test.ts that runs only when WALL_CLOCK_DEBT_MODE is
 * set), because the corpus is derived through vitest's own config loader.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const mode = argv.includes("--write")
  ? argv.includes("--accept-new")
    ? "write-accept-new"
    : "write"
  : "check";
const vitest = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);
const run = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "src/tests/wall-clock-bounds.test.ts",
    "-t",
    "debt generator",
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, WALL_CLOCK_DEBT_MODE: mode },
  },
);
process.exit(run.status ?? 2);
