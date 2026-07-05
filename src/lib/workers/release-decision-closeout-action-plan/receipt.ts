/**
 * The content-free **receipt** for one release decision closeout index trend action plan (Phase 67).
 *
 * A plan verdict is a thing a SIEM / governance record wants to log verbatim: "the closeout-index trend action plan was
 * <verdict> (exit <code>) at <urgency> urgency, action class <actionClass>, over a <sourceState> trend (its verdict
 * <sourceTrendVerdict>, latest index <sourceLatestIndex>), with <actionsEmitted> action(s), at <instant>". The receipt
 * is exactly that — bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement.
 * It carries no ingested prose, no reviewer identity, no path, no locator, and no digest, so it is safe to forward
 * downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION,
  type ReleaseDecisionCloseoutActionPlanReceipt,
  type ReleaseDecisionCloseoutActionPlanRollup,
  type ReleaseDecisionCloseoutActionPlanSource,
  type ReleaseDecisionCloseoutIndexVerdict,
} from "./types";

/** Flatten the content-free receipt from the source summary, composite rollup, and built checklist. */
export function buildCloseoutActionPlanReceipt(
  generatedAt: string,
  source: ReleaseDecisionCloseoutActionPlanSource,
  rollup: ReleaseDecisionCloseoutActionPlanRollup,
  actionsEmitted: number,
  sourceLatestIndex: ReleaseDecisionCloseoutIndexVerdict | null,
): ReleaseDecisionCloseoutActionPlanReceipt {
  return {
    category: "worker-release-decision-closeout-action-plan",
    policyId: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    urgency: rollup.urgency,
    actionClass: rollup.actionClass,
    exitCode: rollup.exitCode,
    sourceState: source.state,
    sourceTrendVerdict: source.claimedVerdict,
    sourceLatestIndex,
    actionsEmitted,
    strictWatchEscalated: rollup.strictWatchEscalated,
    disclosure: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_DISCLOSURE,
  };
}
