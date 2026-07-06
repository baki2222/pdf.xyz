/**
 * The content-free **audit receipt** for one release decision closeout governance finalize index (Phase 75).
 *
 * An index verdict is a thing a SIEM / review record wants to log verbatim: "the finalize index was <verdict> (exit
 * <code>) over <finalizationsUsable> usable of <finalizationsConsidered> considered (<finalizationsSupplied> supplied)
 * bundle(s), verdicts <finalized>/<incomplete>/<open>/<blocked>, latest <latest>, class <trendClass>, policy
 * <id>@<version>, at <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id +
 * the run's own stamp + a disclosure statement. It carries no ingested prose, no reviewer identity, no path, no
 * locator, and no digest, so it is safe to forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexRollup,
} from "./types";

/** Flatten the content-free audit receipt from the coverage + distribution summary + composite verdict. */
export function buildFinalizeIndexReceipt(
  generatedAt: string,
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution,
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexRollup,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexReceipt {
  return {
    category: "worker-release-decision-closeout-governance-finalize-index",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    finalizationsSupplied: coverage.finalizationsSupplied,
    finalizationsConsidered: coverage.finalizationsConsidered,
    finalizationsUsable: coverage.finalizationsUsable,
    finalizationsUnreadable: coverage.finalizationsUnreadable,
    finalizationsTampered: coverage.finalizationsTampered,
    verdictCounts: distribution.verdictCounts,
    latest: rollup.latest,
    trendClass: distribution.trendClass,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_DISCLOSURE,
  };
}
