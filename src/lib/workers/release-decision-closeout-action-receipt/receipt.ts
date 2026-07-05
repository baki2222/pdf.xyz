/**
 * The content-free **receipt** for one release decision closeout action-plan execution receipt (Phase 68).
 *
 * A receipt verdict is a thing a SIEM / governance record wants to log verbatim: "the decision closeout action-plan was
 * <verdict> (exit <code>) over a <sourceState> plan of class <planClass> (its verdict <claimedPlanVerdict>), with
 * <acksSatisfied> of <acksRequired> required acknowledgements present (<acksMissing> missing, <acksMismatched>
 * contradictory), at <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id +
 * the run's own stamp + a disclosure statement. It carries no ingested prose, no reviewer identity, no path, no
 * locator, and no digest, so it is safe to forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_VERSION,
  type ReleaseDecisionCloseoutActionReceiptReceipt,
  type ReleaseDecisionCloseoutActionReceiptRollup,
  type ReleaseDecisionCloseoutActionReceiptSource,
} from "./types";

/** Flatten the content-free receipt from the source summary and composite rollup. */
export function buildCloseoutActionReceiptReceipt(
  generatedAt: string,
  source: ReleaseDecisionCloseoutActionReceiptSource,
  rollup: ReleaseDecisionCloseoutActionReceiptRollup,
): ReleaseDecisionCloseoutActionReceiptReceipt {
  const acksRequired = rollup.requiredAcks.length;
  const acksMissing = rollup.missingAcks.length;
  return {
    category: "worker-release-decision-closeout-action-receipt",
    policyId: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    planClass: rollup.planClass,
    sourceState: source.state,
    claimedPlanVerdict: source.claimedPlanVerdict,
    acksRequired,
    acksSatisfied: acksRequired - acksMissing,
    acksMissing,
    acksMismatched: rollup.mismatchedAcks.length,
    strictOpenEscalated: rollup.strictOpenEscalated,
    disclosure: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_DISCLOSURE,
  };
}
