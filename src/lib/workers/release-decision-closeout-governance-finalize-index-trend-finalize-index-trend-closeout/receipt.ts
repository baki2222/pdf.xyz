/**
 * The content-free **receipt** for one release decision closeout governance finalize index trend finalize index trend
 * closeout bundle (Phase 84).
 *
 * A closeout verdict is a thing a SIEM / governance record wants to log verbatim: "the finalization-index-trend follow-up
 * loop was <verdict> (exit <code>) over a <receiptState> receipt (its verdict <receiptVerdict>, plan class <planClass>),
 * with <relatedSupplied> related records supplied (<relatedCoherent> coherent, <relatedContradictory> contradictory,
 * <relatedBlocking> blocking, <requiredMissing> required-missing), source chain <sourceChainPosture>, at <instant>". The
 * receipt is exactly that — bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure
 * statement. It carries no ingested prose, no reviewer identity, no path, no locator, and no digest, so it is safe to
 * forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutRelationSignal,
} from "./types";

/** Flatten the content-free receipt from the composite coverage + the source-chain posture. */
export function buildCloseoutReceipt(
  generatedAt: string,
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutCoverage,
  sourceChainPosture: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutReceipt {
  return {
    category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_VERSION,
    at: generatedAt,
    verdict: coverage.verdict,
    exitCode: coverage.exitCode,
    receiptState: coverage.receiptState,
    receiptVerdict: coverage.receiptVerdict,
    planClass: coverage.planClass,
    relatedSupplied: coverage.relatedSupplied,
    relatedCoherent: coverage.relatedCoherent,
    relatedContradictory: coverage.relatedContradictory,
    relatedBlocking: coverage.relatedBlocking,
    requiredMissing: coverage.requiredMissing.length,
    sourceChainPosture,
    strictOpenEscalated: coverage.strictOpenEscalated,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_DISCLOSURE,
  };
}
