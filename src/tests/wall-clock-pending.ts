import type { PendingEntry } from "./time-bound-core";

/**
 * Measure-mode bounds that have no speed-independent witness yet.
 *
 * Measure mode records a timing and never fails on it. That is the right
 * start for a bound nobody has measured on CI (design 1.6) — and, unchecked,
 * a switch that turns a regression detector off (critic P6, CLAUDE.md rule
 * 2). So a measure-mode call must either name a `witness` — an assertion in
 * the SAME test on a count, a byte length or a shape, which catches the
 * defect whatever the runner's speed (#382's JPEG-encode count is the model)
 * — or be listed here with the reason it has none yet.
 *
 * The guard (`wall-clock-bounds.test.ts`) holds this list both ways: every
 * entry names a measure-mode call that exists and has no witness, and the
 * list never exceeds {@link PENDING_CAP}. The vitest reporter prints every
 * entry on every CI run.
 */
export const PENDING_CAP = 25;

export const WALL_CLOCK_PENDING: readonly PendingEntry[] = [
  {
    id: "S4 entry boxes",
    file: "src/lib/pdf/form-detect-boxes-cost.test.ts",
    reason:
      "The entry-box rule's cost must stay linear in the page's boxes, and only this ratio sees a quadratic step: the test's health checks cover what the rule returns, not what it costs. Back to assert once 5 CI runs calibrate the id (bound 45 against 16.7 to 21.6 measured; mutants 74 to 232).",
  },
  {
    id: "S4 stacks",
    file: "src/lib/pdf/form-detect-boxes-cost.test.ts",
    reason:
      "The stacked-line rule's cost must stay linear in the page's stacks, and only this ratio sees a quadratic step: the test's health checks cover what the rule returns, not what it costs. Back to assert once 5 CI runs calibrate the id (bound 45 against 17.1 to 20.5 measured; mutants 74 to 94).",
  },
  {
    id: "watermark-open-range-checked-not-expanded",
    file: "src/components/tools/runner/batch/settings-batch-behaviour.dom.test.tsx",
    reason:
      "Typing an open range ('1-', '3-') must be checked as ranges, not expanded, and only this time sees work that grows with the range: the test's Set.add count pins the old mechanism, and the same expansion into an array (30M entries) or a Map (5M entries) keeps it at 0 while the typing time grows 2x to 4.8x. Back to assert once 5 CI runs calibrate the id (bound 500; CI maximum 367 ms).",
  },
  {
    id: "S5 tables",
    file: "src/lib/pdf/form-detect-tables-cost.test.ts",
    reason:
      "The table rule's cost must stay linear in the page's tables. This ratio sees a quadratic read of each cell's words, but NOT any one of the three band lookups S5 added put back alone (each reads under the bound at 16x; all three together read over it), so those rest on review and the before-and-after readings. The test's health checks cover what the rule returns, not what it costs. Back to assert once 5 CI runs calibrate the id (readings in the test file).",
  },
];
