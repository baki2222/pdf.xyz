/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index trend result (Phase 76).
 *
 * It takes the ingested windows the trust boundary produced (oldest → newest), the run's stamp, and the applied policy,
 * and folds them into one stable {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult}: it reduces the
 * history to a bounded point sequence + summary AND folds the composite trend verdict + reasons (`./reduce`), maps the
 * summary onto the result's bounded coverage / windowDistribution / finalizationDistribution / latest / trend blocks,
 * derives the ordered next-action list from the fired reasons + verdict, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / next-actions in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history +
 * stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup
 * (folded separately) resolves the trend — so a tampered / blocked / thin history never yields a clean pass.
 */

import { buildTrendReceipt } from "./receipt";
import { computeTrendRollup, reduceTrend } from "./reduce";
import type { IngestedFinalizeIndex } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextAction,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
} from "./types";

/**
 * Which next-action ids each fired reason recommends. The final list is the ordered, deduped union of these (in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_IDS} order) plus, for a `stable` history,
 * a trailing `continue-indexing-finalizations`, and for an `improving` history a `note-improving-trend`, always followed
 * by `keep-finalize-index-trend`. Informational reasons recommend no action.
 */
const REASON_NEXT_ACTIONS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextActionId[]
> = {
  "window-unreadable": ["recover-unreadable-windows"],
  "window-tampered": ["recover-tampered-windows"],
  "window-index-blocked": ["review-blocked-windows"],
  "window-index-invalid": ["review-blocked-windows"],
  "strict-open-escalation": ["review-strict-open"],
  "no-usable-windows": ["supply-finalize-indexes"],
  "latest-incomplete": ["complete-incomplete-windows"],
  "only-incomplete": ["complete-incomplete-windows"],
  "latest-open": ["review-open-windows", "review-degrading-trend"],
  "trend-degrading": ["review-degrading-trend"],
  "window-open": ["review-open-windows"],
  "window-incomplete": ["complete-incomplete-windows"],
  "require-latest-miss": ["review-degrading-trend"],
  "latest-indexed": [],
  "trend-improving": ["note-improving-trend"],
  "history-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream finalize-index schema). */
export function buildTrendMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_POLICY_VERSION,
    finalizeIndexSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action list from the fired reasons + the resolved verdict. */
export function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId[],
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextAction[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendNextActionId>();
  for (const id of fired) for (const step of REASON_NEXT_ACTIONS[id]) wanted.add(step);
  if (verdict === "improving") wanted.add("note-improving-trend");
  if (verdict === "stable") {
    // A coherent history: keep indexing finalization bundles, then keep the record.
    wanted.add("continue-indexing-finalizations");
  }
  wanted.add("keep-finalize-index-trend"); // always the last step — keep the content-free governance review summary
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_IDS.filter((id) => wanted.has(id)).map(
    (id) => ({
      id,
      detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_NEXT_ACTION_DETAIL[id],
    }),
  );
}

/**
 * Fold the ingested windows (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult}. Pure and deterministic.
 */
export function buildTrendResult(
  generatedAt: string,
  windows: readonly IngestedFinalizeIndex[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult {
  const { points, summary } = reduceTrend(windows, policy.maxWindows);
  const { rollup, reasons } = computeTrendRollup(summary, policy);
  const nextActions = buildNextActions(rollup.reasons, rollup.verdict);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA,
    generatedAt,
    metadata: buildTrendMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    coverage: {
      windowsSupplied: summary.windowsSupplied,
      windowsConsidered: summary.windowsConsidered,
      windowsUsable: summary.windowsUsable,
      windowsUnreadable: summary.windowsUnreadable,
      windowsTampered: summary.windowsTampered,
      truncated: summary.truncated,
      droppedOldest: summary.droppedOldest,
    },
    windowDistribution: {
      verdictCounts: summary.windowVerdictCounts,
      newest: summary.newest,
      oldest: summary.oldest,
    },
    finalizationDistribution: {
      verdictCounts: summary.finalizationVerdictCounts,
      totalConsidered: summary.totalFinalizations,
      totalUsable: summary.totalUsableFinalizations,
    },
    latest: summary.latest,
    points,
    trend: {
      direction: rollup.direction,
      class: rollup.trendClass,
    },
    reasons,
    nextActions,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CAVEATS,
    receipt: buildTrendReceipt(generatedAt, summary, rollup),
  };
}
