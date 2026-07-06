/**
 * The content-free **receipt** for one release decision closeout governance finalize index trend action plan (Phase 77).
 *
 * A plan verdict is a thing a SIEM / governance record wants to log verbatim: "the finalize-index trend action plan was
 * <verdict> (exit <code>) at <urgency> urgency, action class <actionClass>, over a <sourceState> trend (its verdict
 * <sourceTrendVerdict>, latest finalize-index <sourceLatestIndex>), with <actionsEmitted> action(s), at <instant>". The
 * receipt is exactly that — bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure
 * statement. It carries no ingested prose, no reviewer identity, no path, no locator, and no digest, so it is safe to
 * forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanSource,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
} from "./types";

/** Flatten the content-free receipt from the source summary, composite rollup, and built checklist. */
export function buildFinalizeIndexTrendActionPlanReceipt(
  generatedAt: string,
  source: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanSource,
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanRollup,
  actionsEmitted: number,
  sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReceipt {
  return {
    category: "worker-release-decision-closeout-governance-finalize-index-trend-action-plan",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    urgency: rollup.urgency,
    actionClass: rollup.actionClass,
    exitCode: rollup.exitCode,
    sourceState: source.state,
    sourceTrendVerdict: source.claimedVerdict,
    sourceLatestIndex,
    actionsEmitted,
    escalated: rollup.strictWatchEscalated || rollup.requireCleanEscalated,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_DISCLOSURE,
  };
}
