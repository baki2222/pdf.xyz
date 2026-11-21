import { readFileSync } from "node:fs";
import path from "node:path";
import type { RoutedCall } from "./wall-clock-detector";

/**
 * Reading `time-bounds.calibration.json` and judging a routed call against
 * it. The PROPERTY (design 2, CLAUDE.md rule 2) is CI-measured headroom of
 * at least 2x — "uses the helper" is only the mechanism. The calibration
 * file is a constant, and a constant has no relationships to constrain
 * (rule 3), so each entry carries what lets it go stale visibly:
 *
 *  - `bodyHash`: the test body it was harvested from. An edited test is
 *    uncalibrated until re-harvested (critic P5);
 *  - `runs` with each run's unit-suite duration: five fast runners cannot
 *    certify 2x on their own — the window must include a slow one
 *    (`slowRunnerFloorS`; CI's unit step ran 1010-1677 s over the 12
 *    passing runs of 2026-11-18, a 1.66x spread);
 *  - failed runs count as much as passing ones (survivorship, critic P5).
 *
 * A floor needs no calibration: a slower runner only makes it easier.
 */

export interface CalibrationRun {
  conclusion: string;
  /** The unit suite's own Duration line, in seconds; absent for e2e-only harvests. */
  unitSuiteS?: number;
}

export interface CalibrationEntry {
  kind: "ceiling" | "ratio" | "floor";
  n: number;
  /** ms for a ceiling, the ratio itself for a ratio. */
  ciMax: number;
  ciP50: number;
  runs: string[];
  source: "time-bound lines" | "ci-durations test max (upper bound)";
  bodyHash: string;
}

export interface Calibration {
  slowRunnerFloorS: number;
  runs: Record<string, CalibrationRun>;
  entries: Record<string, CalibrationEntry>;
}

export const CALIBRATION_FILE = path.join(
  __dirname,
  "time-bounds.calibration.json",
);

export function readCalibration(file = CALIBRATION_FILE): Calibration {
  return JSON.parse(readFileSync(file, "utf8")) as Calibration;
}

export const MIN_RUNS = 5;
export const MARGIN = 2;

/** null when the call may assert; otherwise why it may not. */
export function calibrationProblem(
  call: RoutedCall,
  cal: Calibration,
): string | null {
  if (call.mode === "measure" || call.kind === "floor") return null;
  if (call.id === null) return "its id is not a string literal";
  const entry = cal.entries[call.id];
  if (!entry) return `no calibration for "${call.id}"`;
  if (entry.bodyHash !== call.bodyHash)
    return `"${call.id}" was calibrated against a different test body (${entry.bodyHash}, now ${call.bodyHash}): re-harvest`;
  if (entry.n < MIN_RUNS)
    return `"${call.id}" has n=${entry.n} CI runs, fewer than ${MIN_RUNS}`;
  const slow = entry.runs.filter(
    (r) => (cal.runs[r]?.unitSuiteS ?? 0) >= cal.slowRunnerFloorS,
  );
  if (slow.length === 0)
    return `"${call.id}" was calibrated on fast runners only (no run with a unit suite of ${cal.slowRunnerFloorS} s or more)`;
  if (call.bound === undefined)
    return `"${call.id}"'s bound (${call.boundText}) is not a literal or same-file const`;
  if (call.bound < MARGIN * entry.ciMax)
    return `"${call.id}"'s bound ${call.bound} is under ${MARGIN} x its CI max ${entry.ciMax}`;
  return null;
}
