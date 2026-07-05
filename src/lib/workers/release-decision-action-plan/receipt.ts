/**
 * The content-free **receipt** for one release decision trend action plan (Phase 62).
 *
 * A plan verdict is a thing a SIEM / governance record wants to log verbatim: "the decision-trend action plan was
 * <verdict> (exit <code>) at <urgency> urgency, action class <actionClass>, over a <sourceState> trend (its verdict
 * <sourceTrendVerdict>), with <actionsEmitted> of <actionsConsidered> actions, at <instant>". The receipt is exactly
 * that — bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement. It carries
 * no ingested prose, no reviewer identity, no path, no locator, and no digest, so it is safe to forward downstream.
 */

import {
  RELEASE_DECISION_ACTION_PLAN_DISCLOSURE,
  RELEASE_DECISION_ACTION_PLAN_POLICY_ID,
  RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION,
  type ReleaseDecisionActionPlanReceipt,
  type ReleaseDecisionActionPlanRollup,
  type ReleaseDecisionActionPlanSource,
} from "./types";
import type { BuiltActions } from "./actions";

/** Flatten the content-free receipt from the source summary, composite rollup, and built checklist. */
export function buildActionPlanReceipt(
  generatedAt: string,
  source: ReleaseDecisionActionPlanSource,
  rollup: ReleaseDecisionActionPlanRollup,
  actions: BuiltActions,
): ReleaseDecisionActionPlanReceipt {
  return {
    category: "worker-release-decision-action-plan",
    policyId: RELEASE_DECISION_ACTION_PLAN_POLICY_ID,
    policyVersion: RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    urgency: rollup.urgency,
    actionClass: rollup.actionClass,
    exitCode: rollup.exitCode,
    sourceState: source.state,
    sourceTrendVerdict: source.claimedVerdict,
    actionsEmitted: actions.items.length,
    actionsConsidered: actions.considered,
    actionsDropped: actions.dropped,
    strictEscalated: rollup.strictEscalated,
    disclosure: RELEASE_DECISION_ACTION_PLAN_DISCLOSURE,
  };
}
