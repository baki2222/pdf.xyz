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
    id: "S5 tables",
    file: "src/lib/pdf/form-detect-tables-cost.test.ts",
    reason:
      "The table rule's cost must stay linear in the page's tables. This ratio sees a quadratic read of each cell's words, but NOT any one of the three band lookups S5 added put back alone (each reads under the bound at 16x; all three together read over it), so those rest on review and the before-and-after readings. The test's health checks cover what the rule returns, not what it costs. Back to assert once 5 CI runs calibrate the id (readings in the test file).",
  },
  {
    id: "S6 combs and radio stacks",
    file: "src/lib/pdf/form-detect-combs-cost.test.ts",
    reason:
      "The comb and radio-stack rules' label paths (each stacked square's label, a stack's caption and the words over it, the squares' own labels, a comb's left label and what stands between, a scale's heads) must stay linear in the page's blocks, and only this ratio sees a quadratic step there: the test's health checks cover what the page returns, not what it costs. Back to assert once 5 CI runs calibrate the id (readings in the test file).",
  },
];
