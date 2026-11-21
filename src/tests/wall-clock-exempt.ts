import type { ExemptEntry } from "./wall-clock-audit";

/**
 * Detector members that cannot fail a test on runner speed, each with the
 * reason. Matched by file and collapsed snippet; every entry must match a
 * member (`wall-clock-bounds.test.ts`), so an entry outlives nothing.
 *
 *  - config-relation: both sides are configuration, not a measurement;
 *  - injected-clock: the "time" is a fake clock's, summed by the test;
 *  - floor: a lower bound the detector cannot see as one.
 *
 * Floors it CAN see (`toBeGreaterThan*`, a negated `toBeLessThan*`) are
 * classified by the detector itself and never enter the debt: a slower
 * runner only makes a floor easier to pass. They are printed by the guard.
 */
export const WALL_CLOCK_EXEMPT: readonly ExemptEntry[] = [
  {
    file: "src/lib/batch/limits.test.ts",
    snippet:
      "expect(BATCH_LIMITS.ocrMaxFiles * waitPerFileMs).toBeLessThanOrEqual(60 * 60 * 1000)",
    reason: "config-relation",
    why: "waitPerFileMs is the product of three configured constants (resumes, poll interval, poll attempts); nothing is timed, so no runner can make it fail.",
  },
];
