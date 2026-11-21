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
];
