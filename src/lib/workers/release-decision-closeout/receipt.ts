/**
 * The content-free **receipt** for one release decision closeout bundle (Phase 64).
 *
 * A closeout verdict is a thing a SIEM / governance record wants to log verbatim: "the decision governance chain was
 * <verdict> (exit <code>) over a <receiptState> receipt (its verdict <receiptVerdict>, plan class <planClass>), with
 * <relatedSupplied> related records supplied (<relatedCoherent> coherent, <relatedContradictory> contradictory,
 * <relatedBlocking> blocking, <requiredMissing> required-missing), at <instant>". The receipt is exactly that — bounded
 * enums + small integers + a stable policy id + the run's own stamp + a disclosure statement. It carries no ingested
 * prose, no reviewer identity, no path, no locator, and no digest, so it is safe to forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_POLICY_VERSION,
  type ReleaseDecisionCloseoutReceipt,
  type ReleaseDecisionCloseoutRollup,
} from "./types";

/** Flatten the content-free receipt from the composite rollup. */
export function buildCloseoutReceipt(
  generatedAt: string,
  rollup: ReleaseDecisionCloseoutRollup,
): ReleaseDecisionCloseoutReceipt {
  return {
    category: "worker-release-decision-closeout",
    policyId: RELEASE_DECISION_CLOSEOUT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    receiptState: rollup.receiptState,
    receiptVerdict: rollup.receiptVerdict,
    planClass: rollup.planClass,
    relatedSupplied: rollup.relatedSupplied,
    relatedCoherent: rollup.relatedCoherent,
    relatedContradictory: rollup.relatedContradictory,
    relatedBlocking: rollup.relatedBlocking,
    requiredMissing: rollup.requiredMissing.length,
    strictOpenEscalated: rollup.strictOpenEscalated,
    disclosure: RELEASE_DECISION_CLOSEOUT_DISCLOSURE,
  };
}
