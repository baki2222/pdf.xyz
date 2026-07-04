/**
 * Pure, node-free **composer** for the release evidence trend summary result (Phase 53).
 *
 * It takes the ingested reports the trust boundary produced (oldest → newest), the run's stamp, and the applied
 * policy, and folds them into one stable {@link ReleaseTrendResult}: it reduces the window to a bounded point
 * sequence + history summary (`./reduce`), folds the composite trend verdict + reasons (`./rollup`), derives the
 * ordered follow-up checklist from the fired reasons, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / follow-ups in canonical order, no field is
 * a raw value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested
 * history + stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while
 * the rollup (folded separately) resolves the trend — so a tampered / failing / thin history never yields a
 * `stable` trend.
 */

import { buildTrendReceipt } from "./receipt";
import { reduceTrend } from "./reduce";
import { computeTrendRollup } from "./rollup";
import type { IngestedReport } from "./ingest";
import {
  RELEASE_REPORT_SCHEMA,
  RELEASE_TREND_CAVEATS,
  RELEASE_TREND_FOLLOWUP_DETAIL,
  RELEASE_TREND_FOLLOWUP_IDS,
  RELEASE_TREND_GUIDANCE,
  RELEASE_TREND_POLICY_ID,
  RELEASE_TREND_POLICY_VERSION,
  RELEASE_TREND_SCHEMA,
  type ReleaseTrendFollowup,
  type ReleaseTrendFollowupId,
  type ReleaseTrendMetadata,
  type ReleaseTrendPolicy,
  type ReleaseTrendReasonId,
  type ReleaseTrendResult,
} from "./types";

/**
 * Which follow-up ids each fired reason recommends. The final checklist is the ordered, deduped union of these
 * (in canonical {@link RELEASE_TREND_FOLLOWUP_IDS} order) plus a trailing `archive-trend`. A clean stable trend
 * (no reasons) instead recommends `continue-monitoring` then `archive-trend`.
 */
const REASON_FOLLOWUPS: Record<ReleaseTrendReasonId, readonly ReleaseTrendFollowupId[]> = {
  "report-tampered": ["recover-tampered-report"],
  "latest-hold-fail": ["investigate-failing-trend"],
  "repeated-hold-fail": ["investigate-failing-trend"],
  "latest-not-ready": ["gate-latest-release"],
  "report-unreadable": ["supply-report-history"],
  "no-usable-reports": ["supply-report-history"],
  "latest-needs-evidence": ["gate-latest-release", "supply-report-history"],
  "latest-hold-warning": ["review-warning-trend"],
  "repeated-hold-warning": ["review-warning-trend"],
  "trend-degraded": ["review-warning-trend"],
};

/** Assemble the stable identity block (with the pinned upstream report schema). */
export function buildTrendMetadata(): ReleaseTrendMetadata {
  return {
    schemaVersion: RELEASE_TREND_POLICY_VERSION,
    policyId: RELEASE_TREND_POLICY_ID,
    policyVersion: RELEASE_TREND_POLICY_VERSION,
    reportSchema: RELEASE_REPORT_SCHEMA,
  };
}

/** Derive the ordered, deduped follow-up checklist from the fired reasons (or a clean stable path). */
export function buildFollowUps(fired: readonly ReleaseTrendReasonId[]): ReleaseTrendFollowup[] {
  const wanted = new Set<ReleaseTrendFollowupId>();
  if (fired.length === 0) {
    // A clean stable trend: keep monitoring, then archive the record.
    wanted.add("continue-monitoring");
  } else {
    for (const id of fired) for (const followup of REASON_FOLLOWUPS[id]) wanted.add(followup);
  }
  wanted.add("archive-trend"); // always the last step — keep the content-free governance record
  return RELEASE_TREND_FOLLOWUP_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_TREND_FOLLOWUP_DETAIL[id],
  }));
}

/**
 * Fold the ingested reports (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseTrendResult}. Pure and deterministic.
 */
export function buildTrendResult(
  generatedAt: string,
  reports: readonly IngestedReport[],
  policy: ReleaseTrendPolicy,
): ReleaseTrendResult {
  const { points, history, usableRecommendations } = reduceTrend(reports, policy.maxReports);
  const { rollup, reasons } = computeTrendRollup(history, usableRecommendations, policy);
  const followUps = buildFollowUps(rollup.reasons);

  return {
    schema: RELEASE_TREND_SCHEMA,
    generatedAt,
    metadata: buildTrendMetadata(),
    policy,
    history,
    points,
    trend: rollup,
    reasons,
    followUps,
    guidance: RELEASE_TREND_GUIDANCE,
    caveats: RELEASE_TREND_CAVEATS,
    receipt: buildTrendReceipt(generatedAt, policy, history, rollup),
  };
}
