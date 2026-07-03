/**
 * Pure, node-free **rollup** for the release CI bundle (Phase 50).
 *
 * Folds the reduced per-stage severities + the consistency links into the ONE composite
 * {@link ReleaseCiBundleVerdict} + exit code a CI/operator acts on. The ladder is about the WHOLE
 * chain's coherence — fail-closed on anything it cannot trust or certify:
 *
 *  - `fail` (worst) — a supplied stage's verdict mapped to `fail` (a failed build / invalid archive /
 *    blocking policy violation), OR a blocking consistency link MISMATCHED (two stages describe
 *    different evidence — a tamper or a stale/mixed input). A failed or incoherent chain dominates.
 *  - `unknown`      — the chain could not be certified: a supplied stage was UNREADABLE, a present
 *    stage's verdict was indeterminate/empty, or NO archive-decision stage (index/policy) was supplied.
 *    Checked after fail so a real failure is never masked, but before warn so an uncertifiable chain
 *    never masquerades as a mere advisory.
 *  - `warn`         — no failure and no inconsistency, but a present stage raised an advisory verdict.
 *  - `pass` (best)  — every supplied stage passed/ok, every link held, and an archive-decision stage
 *    was present.
 *
 * Monotonic on the shared `0 pass / 2 unknown / 3 warn / 4 fail` exit ladder, and fail-closed: absent /
 * unreadable / decision-less evidence never yields `pass`, and any stage failure or link mismatch forces
 * `fail`. Drivers are emitted in the stable {@link RELEASE_CI_BUNDLE_DRIVERS} order — a superset view,
 * so a reader sees every condition that applied, not only the winning one.
 */

import {
  RELEASE_CI_BUNDLE_EXIT,
  RELEASE_CI_BUNDLE_STAGE_IDS,
  RELEASE_CI_BUNDLE_VERDICT_SUMMARY,
  type ReleaseCiBundleDriver,
  type ReleaseCiBundleExitCode,
  type ReleaseCiBundleRollup,
  type ReleaseCiBundleStage,
  type ReleaseCiBundleStageId,
  type ReleaseCiBundleConsistencyCheck,
  type ReleaseCiBundleVerdict,
} from "./types";

/** The authoritative verdict → exit code map. */
export const RELEASE_CI_BUNDLE_EXIT_FOR_VERDICT: Record<ReleaseCiBundleVerdict, ReleaseCiBundleExitCode> =
  {
    pass: RELEASE_CI_BUNDLE_EXIT.PASS,
    unknown: RELEASE_CI_BUNDLE_EXIT.UNKNOWN,
    warn: RELEASE_CI_BUNDLE_EXIT.WARN,
    fail: RELEASE_CI_BUNDLE_EXIT.FAIL,
  };

/** Stage authority order (most authoritative first): the policy is the chain's terminal decision. */
const DECISION_PRIORITY: readonly ReleaseCiBundleStageId[] = ["policy", "index", "artifact", "gate"];

/** The most authoritative PRESENT (supplied + recognized) stage, or `null` if none is present. */
export function pickDecisionStage(stages: readonly ReleaseCiBundleStage[]): ReleaseCiBundleStageId | null {
  for (const id of DECISION_PRIORITY) {
    if (stages.some((s) => s.stage === id && s.present)) return id;
  }
  return null;
}

/**
 * Compute the composite rollup from the reduced stages + the consistency links.
 *
 * Fail-closed precedence: a stage `fail` or a link `mismatch` ⇒ `fail`; else an unreadable/indeterminate
 * stage or a decision-less chain ⇒ `unknown`; else a stage `warn` ⇒ `warn`; else `pass`.
 */
export function computeBundleRollup(
  stages: readonly ReleaseCiBundleStage[],
  consistency: readonly ReleaseCiBundleConsistencyCheck[],
): ReleaseCiBundleRollup {
  const present = stages.filter((s) => s.present);
  const stagesPresent = present.length;
  const chainComplete = stagesPresent === RELEASE_CI_BUNDLE_STAGE_IDS.length;
  const decisionStage = pickDecisionStage(stages);
  const inconsistencies = consistency.filter((c) => c.status === "mismatch").length;

  const anyFailed = present.some((s) => s.severity === "fail");
  const anyInconsistent = inconsistencies > 0;
  const anyUnreadable = stages.some((s) => s.source === "unreadable");
  const anyUnknown = present.some((s) => s.severity === "unknown");
  const hasDecision = present.some((s) => s.stage === "index" || s.stage === "policy");
  const anyWarn = present.some((s) => s.severity === "warn");

  const drivers: ReleaseCiBundleDriver[] = [];
  if (anyFailed) drivers.push("stage-failed");
  if (anyInconsistent) drivers.push("chain-inconsistent");
  if (anyUnreadable) drivers.push("stage-unreadable");
  if (anyUnknown) drivers.push("stage-unknown");
  if (!hasDecision) drivers.push("incomplete-chain");
  if (anyWarn) drivers.push("stage-warned");

  let verdict: ReleaseCiBundleVerdict;
  if (anyFailed || anyInconsistent) verdict = "fail";
  else if (anyUnreadable || anyUnknown || !hasDecision) verdict = "unknown";
  else if (anyWarn) verdict = "warn";
  else verdict = "pass";

  return {
    verdict,
    exitCode: RELEASE_CI_BUNDLE_EXIT_FOR_VERDICT[verdict],
    ready: verdict === "pass",
    drivers,
    chainComplete,
    decisionStage,
    stagesPresent,
    inconsistencies,
    detail: RELEASE_CI_BUNDLE_VERDICT_SUMMARY[verdict],
  };
}
