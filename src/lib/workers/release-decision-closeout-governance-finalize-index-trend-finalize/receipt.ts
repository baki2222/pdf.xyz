/**
 * The content-free **receipt** for one release decision closeout governance finalize index trend FINALIZATION record
 * (Phase 79).
 *
 * A finalization verdict is a thing a SIEM / governance record wants to log verbatim: "the finalize-index-trend follow-up
 * loop was <verdict> (exit <code>) over a <receiptState> primary receipt (its verdict <receiptVerdict>), with
 * <relatedSupplied> source-chain record(s) (<relatedCoherent> coherent, <relatedContradictory> contradictory), and
 * <invalid> invalid / <blocking> blocking / <incomplete> incomplete / <open> open reason(s), at <instant>". The receipt
 * is exactly that — bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement.
 * It carries no ingested prose, no reviewer identity, no path, no locator, and no digest, so it is safe to forward
 * downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup,
} from "./types";

/** Flatten the content-free receipt from the coverage summary and composite rollup. */
export function buildFinalizeIndexTrendFinalizeReceipt(
  generatedAt: string,
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeCoverage,
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReceipt {
  return {
    category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    receiptState: rollup.receiptState,
    receiptVerdict: rollup.receiptVerdict,
    relatedSupplied: coverage.suppliedRecords,
    relatedCoherent: coverage.coherentRecords,
    relatedContradictory: coverage.contradictoryRecords,
    invalid: rollup.invalid,
    blocking: rollup.blocking,
    incomplete: rollup.incomplete,
    open: rollup.open,
    strictOpenEscalated: rollup.strictOpenEscalated,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_DISCLOSURE,
  };
}
