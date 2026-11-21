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
    id: "bookmarks-keystroke-actual-vs-base",
    file: "src/components/tools/runner/bookmarks-editor.test.tsx",
    reason:
      "Rows un-memoised (memo dropped on BookmarkRow, or the useMemo on its context) change only how long a keystroke's commit takes: the DOM, the text and the commit count stay the same, and React exposes no per-row render count to a test without instrumenting bookmarks-editor.tsx (outside lane 1b's files). The witness would be that count; until then the Profiler ratio records, and is set from CI or replaced by the count.",
  },
];
