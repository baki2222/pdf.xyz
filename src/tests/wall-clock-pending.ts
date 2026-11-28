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
    id: "xref-scan-per-byte",
    file: "src/tests/hostile/xref-duplicates.test.ts",
    reason:
      "a constant per-byte cost changes no count: a 9x per-byte mutant read 9.78-10.66 against 10, green (lane 2 review, 2026-11-22); flip to assert from CI harvests",
  },
  {
    id: "xref-scan-per-hit",
    file: "src/tests/hostile/xref-duplicates.test.ts",
    reason:
      "a constant per-hit cost changes no count: a string built per hit read 14.37 against 6, green in measure mode (lane 2 review, 2026-11-22); flip to assert from CI harvests",
  },
  {
    id: "xref-scan-hits-linear",
    file: "src/tests/hostile/xref-duplicates.test.ts",
    reason:
      "the hit counts are the same for a linear and a quadratic record step; only time tells them apart (lane 2 review, 2026-11-22); flip to assert from CI harvests",
  },
  {
    id: "content-isolation-costly-document-vs-budget",
    file: "src/tests/hostile/content-isolation.test.ts",
    reason:
      "a metered unit that costs more time per byte it reads changes no count: kinds and scan steps both stay put (lane 2 verify, 2026-11-22); flip to assert from CI harvests",
  },
  {
    id: "board-pages-at-walk-bound",
    file: "src/tests/hostile/pdfjs-board-pages.test.ts",
    reason:
      "a uniform slowdown of pdf.js's page walk changes no count: pageCount stayed equal under a 3 ms-per-page spin (witness audit, 2026-11-22); the raw 60 s bound beside it still fails meanwhile. Back to assert once 5 CI runs calibrate the id",
  },
  {
    id: "pdfjs-guard-scan-unmatched-dict",
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    reason:
      "a walk back for << on every >>stream reads bytes no count reports, and the input's length cannot change: a quarter-window walk-back passed it (witness audit, 2026-11-22); the raw 3 s bound beside it still fails meanwhile. Back to assert once 5 CI runs calibrate the id",
  },
  {
    id: "pdfjs-guard-scan-no-endstream",
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    reason:
      "a forward search for endstream from every stream keyword reads bytes no count reports, and the input's length cannot change: a capped search passed it at 87% of 8 s (witness audit, 2026-11-22); the raw 8 s bound beside it still fails meanwhile. Back to assert once 5 CI runs calibrate the id",
  },
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
  {
    id: "S6 combs and radio stacks",
    file: "src/lib/pdf/form-detect-combs-cost.test.ts",
    reason:
      "The comb and radio-stack rules' label paths (each stacked square's label, a stack's caption and the words over it, the squares' own labels, a comb's left label and what stands between, a scale's heads) must stay linear in the page's blocks, and only this ratio sees a quadratic step there: the test's health checks cover what the page returns, not what it costs. Back to assert once 5 CI runs calibrate the id (readings in the test file).",
  },
  {
    id: "grid rows",
    file: "src/lib/pdf/form-detect-grid-cost.test.ts",
    reason:
      "A checkbox grid's row text, column heads and group heads must stay linear in its rows, and only this ratio sees a whole-page read per row: every label on the page is the same with or without it. Back to assert once 5 CI runs calibrate the id (readings in the test file).",
  },
];
