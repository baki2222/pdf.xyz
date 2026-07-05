/**
 * The content-free **receipt** for one release decision closeout governance finalization bundle (Phase 74).
 *
 * A finalization verdict is a thing a SIEM / governance record wants to log verbatim: "the closeout-governance chain was
 * <verdict> (exit <code>) over a <receiptState> primary receipt (its verdict <receiptVerdict>), with <relatedSupplied>
 * related record(s) (<relatedCoherent> coherent, <relatedContradictory> contradictory, <relatedBlocking> blocking), and
 * <blocking> blocking / <open> open / <incomplete> incomplete reason(s), at <instant>". The receipt is exactly that —
 * bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement. It carries no
 * ingested prose, no reviewer identity, no path, no locator, and no digest, so it is safe to forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceFinalizeCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeRollup,
} from "./types";

/** Flatten the content-free receipt from the coverage summary and composite rollup. */
export function buildGovernanceFinalizeReceipt(
  generatedAt: string,
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeCoverage,
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeRollup,
): ReleaseDecisionCloseoutGovernanceFinalizeReceipt {
  return {
    category: "worker-release-decision-closeout-governance-finalize",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    receiptState: rollup.receiptState,
    receiptVerdict: rollup.receiptVerdict,
    relatedSupplied: coverage.relatedSupplied,
    relatedCoherent: coverage.relatedCoherent,
    relatedContradictory: coverage.relatedContradictory,
    relatedBlocking: coverage.relatedBlocking,
    blocking: rollup.blocking,
    open: rollup.open,
    incomplete: rollup.incomplete,
    strictOpenEscalated: rollup.strictOpenEscalated,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_DISCLOSURE,
  };
}
