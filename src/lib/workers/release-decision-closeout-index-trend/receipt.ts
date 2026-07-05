/**
 * The content-free **audit receipt** for one release decision closeout index trend (Phase 66).
 *
 * A trend verdict is a thing a SIEM / governance record wants to log verbatim: "the closeout-index trend was <verdict>
 * (exit <code>) over <indexesUsable> usable of <indexesConsidered> considered (<indexesSupplied> supplied) window(s),
 * index verdicts <indexed>/<incomplete>/<open>/<blocked>, latest <latest>, direction <direction>, class <trendClass>,
 * policy <id>@<version>, at <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy
 * id + the run's own stamp + a disclosure statement. It carries no ingested prose, no reviewer identity, no path, no
 * locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
  type ReleaseDecisionCloseoutIndexTrendReceipt,
  type ReleaseDecisionCloseoutIndexTrendRollup,
  type ReleaseDecisionCloseoutIndexTrendSummary,
} from "./types";

/** Flatten the content-free audit receipt from the history summary + composite verdict. */
export function buildTrendReceipt(
  generatedAt: string,
  summary: ReleaseDecisionCloseoutIndexTrendSummary,
  rollup: ReleaseDecisionCloseoutIndexTrendRollup,
): ReleaseDecisionCloseoutIndexTrendReceipt {
  return {
    category: "worker-release-decision-closeout-index-trend",
    policyId: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    indexesSupplied: summary.indexesSupplied,
    indexesConsidered: summary.indexesConsidered,
    indexesUsable: summary.indexesUsable,
    indexVerdictCounts: summary.indexVerdictCounts,
    latest: rollup.latest,
    direction: summary.direction,
    trendClass: summary.trendClass,
    disclosure: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DISCLOSURE,
  };
}
