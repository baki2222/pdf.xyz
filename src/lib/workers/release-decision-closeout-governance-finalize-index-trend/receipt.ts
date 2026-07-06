/**
 * The content-free **audit receipt** for one release decision closeout governance finalize index trend (Phase 76).
 *
 * A trend verdict is a thing a SIEM / governance record wants to log verbatim: "the finalize-index trend was <verdict>
 * (exit <code>) over <windowsUsable> usable of <windowsConsidered> considered (<windowsSupplied> supplied) window(s),
 * index verdicts <indexed>/<open>/<incomplete>/<blocked>/<invalid>, latest <latest>, direction <direction>, class
 * <trendClass>, policy <id>@<version>, at <instant>". The receipt is exactly that — bounded enums + small integers + a
 * stable policy id + the run's own stamp + a disclosure statement. It carries no ingested prose, no reviewer identity,
 * no path, no locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary,
} from "./types";

/** Flatten the content-free audit receipt from the history summary + composite verdict. */
export function buildTrendReceipt(
  generatedAt: string,
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary,
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendRollup,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReceipt {
  return {
    category: "worker-release-decision-closeout-governance-finalize-index-trend",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    windowsSupplied: summary.windowsSupplied,
    windowsConsidered: summary.windowsConsidered,
    windowsUsable: summary.windowsUsable,
    windowVerdictCounts: summary.windowVerdictCounts,
    latest: rollup.latest,
    direction: summary.direction,
    trendClass: summary.trendClass,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_DISCLOSURE,
  };
}
