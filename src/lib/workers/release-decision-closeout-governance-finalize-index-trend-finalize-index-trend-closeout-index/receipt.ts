/**
 * The content-free **audit receipt** for one release decision closeout governance finalize index trend finalize index
 * trend closeout INDEX (Phase 85).
 *
 * An index verdict is a thing a SIEM / review record wants to log verbatim: "the closeout index was <verdict> (exit
 * <code>) over <closeoutsUsable> usable of <closeoutsConsidered> considered (<closeoutsSupplied> supplied) record(s),
 * verdicts <closed>/<incomplete>/<open>/<blocked>/<invalid>, latest <latest>, class <trendClass>, policy <id>@<version>,
 * at <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id + the run's own stamp
 * + a disclosure statement. It carries no ingested prose, no reviewer identity, no path, no locator, and no digest, so it
 * is safe to forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRollup,
} from "./types";

/** Flatten the content-free audit receipt from the coverage + distribution summary + composite verdict. */
export function buildCloseoutIndexReceipt(
  generatedAt: string,
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution,
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRollup,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReceipt {
  return {
    category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    closeoutsSupplied: coverage.closeoutsSupplied,
    closeoutsConsidered: coverage.closeoutsConsidered,
    closeoutsUsable: coverage.closeoutsUsable,
    closeoutsUnreadable: coverage.closeoutsUnreadable,
    closeoutsTampered: coverage.closeoutsTampered,
    verdictCounts: distribution.verdictCounts,
    latest: rollup.latest,
    trendClass: distribution.trendClass,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_DISCLOSURE,
  };
}
