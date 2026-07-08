/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend result (Phase 96).
 *
 * It takes the ingested windows the trust boundary produced (oldest → newest), the run's stamp, and the applied policy, and
 * folds them into one stable
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult}: it reduces the
 * history to a bounded point sequence + summary AND folds the composite trend verdict + reasons (`./reduce`), maps the
 * summary onto the result's bounded coverage / windowDistribution / closeoutDistribution / latest / trend blocks, derives
 * the ordered next-action list from the fired reasons + verdict, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / next-actions in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history + stamp +
 * policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup (folded
 * separately) resolves the trend — so a tampered / blocked / thin history never yields a clean pass.
 */

import { buildTrendReceipt } from "./receipt";
import { computeTrendRollup, reduceTrend } from "./reduce";
import type { IngestedCloseoutIndex } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextAction,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
} from "./types";

/**
 * Which next-action ids each fired reason recommends. The final list is the ordered, deduped union of these (in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_IDS}
 * order) plus, for a `stable` history, a trailing `continue-indexing-closeouts`, and for an `improving` history a
 * `note-improving-trend`, always followed by `keep-closeout-index-trend`. Informational reasons recommend no action.
 */
const REASON_NEXT_ACTIONS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextActionId[]
> = {
  "index-unreadable": ["recover-unreadable-indexes"],
  "index-tampered": ["recover-tampered-indexes"],
  "latest-blocked": ["review-blocked-indexes"],
  "blocked-threshold-exceeded": ["review-blocked-indexes"],
  "strict-open-escalation": ["review-strict-open"],
  "no-indexes": ["supply-closeout-indexes"],
  "latest-incomplete": ["complete-incomplete-indexes"],
  "incomplete-threshold-exceeded": ["complete-incomplete-indexes"],
  "latest-open": ["review-watch-indexes", "review-degrading-trend"],
  "open-threshold-exceeded": ["review-watch-indexes"],
  "trend-degrading": ["review-degrading-trend"],
  "require-latest-miss": ["review-degrading-trend"],
  "latest-all-closed": [],
  "trend-improving": ["note-improving-trend"],
  "history-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream closeout-index schema). */
export function buildTrendMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
    closeoutIndexSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action list from the fired reasons + the resolved verdict. */
export function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[],
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextAction[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendNextActionId>();
  for (const id of fired) for (const step of REASON_NEXT_ACTIONS[id]) wanted.add(step);
  if (verdict === "improving") wanted.add("note-improving-trend");
  if (verdict === "stable") {
    // A coherent history: keep indexing closeouts, then keep the record.
    wanted.add("continue-indexing-closeouts");
  }
  wanted.add("keep-closeout-index-trend"); // always the last step — keep the content-free governance review summary
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_IDS.filter(
    (id) => wanted.has(id),
  ).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_NEXT_ACTION_DETAIL[id],
  }));
}

/**
 * Fold the ingested windows (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult}. Pure and
 * deterministic.
 */
export function buildTrendResult(
  generatedAt: string,
  windows: readonly IngestedCloseoutIndex[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult {
  const { points, summary } = reduceTrend(windows, policy.maxIndexes);
  const { rollup, reasons } = computeTrendRollup(summary, policy);
  const nextActions = buildNextActions(rollup.reasons, rollup.verdict);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
    generatedAt,
    metadata: buildTrendMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    coverage: {
      indexesSupplied: summary.indexesSupplied,
      indexesConsidered: summary.indexesConsidered,
      indexesUsable: summary.indexesUsable,
      indexesUnreadable: summary.indexesUnreadable,
      indexesTampered: summary.indexesTampered,
      truncated: summary.truncated,
      droppedOldest: summary.droppedOldest,
    },
    windowDistribution: {
      verdictCounts: summary.indexVerdictCounts,
      newest: summary.newest,
      oldest: summary.oldest,
    },
    closeoutDistribution: {
      verdictCounts: summary.closeoutVerdictCounts,
      totalConsidered: summary.totalCloseouts,
      totalUsable: summary.totalUsableCloseouts,
    },
    latest: summary.latest,
    points,
    trend: {
      direction: rollup.direction,
      class: rollup.trendClass,
    },
    reasons,
    nextActions,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CAVEATS,
    receipt: buildTrendReceipt(generatedAt, summary, rollup),
  };
}
