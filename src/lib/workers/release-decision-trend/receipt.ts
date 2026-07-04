/**
 * The content-free **audit receipt** for one release decision index trend summary (Phase 61).
 *
 * A trend verdict is a thing a SIEM / governance record wants to log verbatim: "the decision-index trend was <verdict>
 * (exit <code>) over <windowsUsable> usable of <windowsConsidered> considered (<windowsSupplied> supplied) window(s),
 * <totalRecords> records, decisions <proceed>/<followup>/<hold>/<reject>/<insufficient>/<invalid>, direction
 * <direction>, class <trendClass>, policy <id>@<version>, at <instant>". The receipt is exactly that — bounded enums +
 * small integers + a stable policy id + the run's own stamp. It carries no ingested prose, no reviewer identity, no
 * path, no locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_DECISION_TREND_POLICY_ID,
  RELEASE_DECISION_TREND_POLICY_VERSION,
  type ReleaseDecisionTrendReceipt,
  type ReleaseDecisionTrendRollup,
  type ReleaseDecisionTrendSummary,
} from "./types";

/** Flatten the content-free audit receipt from the history summary + composite verdict. */
export function buildTrendReceipt(
  generatedAt: string,
  summary: ReleaseDecisionTrendSummary,
  rollup: ReleaseDecisionTrendRollup,
): ReleaseDecisionTrendReceipt {
  return {
    category: "worker-release-decision-trend",
    policyId: RELEASE_DECISION_TREND_POLICY_ID,
    policyVersion: RELEASE_DECISION_TREND_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    windowsSupplied: summary.windowsSupplied,
    windowsConsidered: summary.windowsConsidered,
    windowsUsable: summary.windowsUsable,
    totalRecords: summary.totalRecords,
    decisionCounts: summary.decisionCounts,
    direction: summary.direction,
    trendClass: summary.trendClass,
  };
}
