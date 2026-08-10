/**
 * Pure, node-free **rollup** for the release readiness gate (Phase 46).
 *
 * It folds the bounded per-check {@link ReleaseCheckOutcome}s into one composite
 * {@link ReleaseGateRollup}: the single verdict + exit code an operator/scheduler acts on.
 *
 * The fold is the shared worker exit ladder (`0 pass / 2 unknown / 3 warn / 4 fail`, with `1 usage`
 * owned by the CLI entry), taken as the numeric-max over the included checks — identical in spirit to
 * `worker:ops-check` / `worker:ops-bundle`, so an operator reads one ladder across the whole suite.
 * It is fail-closed by construction: any non-`pass` included check keeps the verdict off `pass`, and
 * a run with NO included checks resolves to `unknown` (never a vacuous `pass`).
 */

import {
  RELEASE_GATE_EXIT,
  RELEASE_GATE_VERDICT_SUMMARY,
  type ReleaseCheckId,
  type ReleaseCheckOutcome,
  type ReleaseCheckStatus,
  type ReleaseGateExitCode,
  type ReleaseGateRollup,
  type ReleaseGateVerdict,
} from "./types";

/** A non-skip check's contribution to the composite exit ladder. */
const STATUS_EXIT: Record<Exclude<ReleaseCheckStatus, "skip">, number> = {
  pass: RELEASE_GATE_EXIT.PASS,
  unknown: RELEASE_GATE_EXIT.UNKNOWN,
  warn: RELEASE_GATE_EXIT.WARN,
  fail: RELEASE_GATE_EXIT.FAIL,
};

/** Project a composite exit code onto the bounded gate verdict. */
export function verdictForExit(code: number): ReleaseGateVerdict {
  if (code >= RELEASE_GATE_EXIT.FAIL) return "fail";
  if (code === RELEASE_GATE_EXIT.WARN) return "warn";
  if (code === RELEASE_GATE_EXIT.UNKNOWN) return "unknown";
  return "pass";
}

/** The authoritative verdict → exit code map (the inverse of {@link verdictForExit} for the 4 verdicts). */
export const RELEASE_GATE_EXIT_FOR_VERDICT: Record<
  ReleaseGateVerdict,
  ReleaseGateExitCode
> = {
  pass: RELEASE_GATE_EXIT.PASS,
  unknown: RELEASE_GATE_EXIT.UNKNOWN,
  warn: RELEASE_GATE_EXIT.WARN,
  fail: RELEASE_GATE_EXIT.FAIL,
};

/**
 * Rank per-check statuses so the rollup can name the single WORST status that drove the verdict.
 * `skip` is excluded from the rollup entirely (it ranks below `pass` here only as a floor default).
 */
const STATUS_RANK: Record<ReleaseCheckStatus, number> = {
  skip: -1,
  pass: 0,
  unknown: 1,
  warn: 2,
  fail: 3,
};

/** Fold the per-check outcomes into the composite rollup. */
export function computeRollup(
  checks: readonly ReleaseCheckOutcome[],
): ReleaseGateRollup {
  const included = checks.filter((c) => c.status !== "skip");
  const skippedChecks = checks.length - included.length;
  const passedChecks = included.filter((c) => c.status === "pass").length;

  // The blockers: every included check that did not pass (fail / warn / unknown), in catalog order.
  const blockers: ReleaseCheckId[] = included
    .filter((c) => c.status !== "pass")
    .map((c) => c.id);

  // The worst per-check status actually present (for the human headline).
  let worst: ReleaseCheckStatus = "pass";
  for (const c of included) {
    if (STATUS_RANK[c.status] > STATUS_RANK[worst]) worst = c.status;
  }

  // A run with no included checks cannot certify readiness → honest unknown, never a vacuous pass.
  const compositeExit =
    included.length === 0
      ? RELEASE_GATE_EXIT.UNKNOWN
      : included.reduce(
          (max, c) =>
            Math.max(
              max,
              STATUS_EXIT[c.status as Exclude<ReleaseCheckStatus, "skip">],
            ),
          RELEASE_GATE_EXIT.PASS as number,
        );

  const verdict = verdictForExit(compositeExit);

  return {
    verdict,
    exitCode: RELEASE_GATE_EXIT_FOR_VERDICT[verdict],
    ready: verdict === "pass",
    worst: included.length === 0 ? "unknown" : worst,
    blockers,
    includedChecks: included.length,
    passedChecks,
    skippedChecks,
    detail: RELEASE_GATE_VERDICT_SUMMARY[verdict],
  };
}
