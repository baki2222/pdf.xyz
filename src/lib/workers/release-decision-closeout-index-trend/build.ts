/**
 * Pure, node-free **composer** for the release decision closeout index trend result (Phase 66).
 *
 * It takes the ingested windows the trust boundary produced (oldest → newest), the run's stamp, and the applied policy,
 * and folds them into one stable {@link ReleaseDecisionCloseoutIndexTrendResult}: it reduces the history to a bounded
 * point sequence + summary AND folds the composite trend verdict + reasons (`./reduce`), derives the ordered next-action
 * checklist from the fired reasons + verdict, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / checklist in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history +
 * stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup
 * (folded separately) resolves the trend — so a tampered / blocked / thin history never yields a `trend-stable`.
 */

import { buildTrendReceipt } from "./receipt";
import { computeTrendRollup, reduceTrend } from "./reduce";
import type { IngestedCloseoutIndex } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_DETAIL,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA,
  type ReleaseDecisionCloseoutIndexTrendChecklistId,
  type ReleaseDecisionCloseoutIndexTrendChecklistItem,
  type ReleaseDecisionCloseoutIndexTrendMetadata,
  type ReleaseDecisionCloseoutIndexTrendPolicy,
  type ReleaseDecisionCloseoutIndexTrendReasonId,
  type ReleaseDecisionCloseoutIndexTrendResult,
  type ReleaseDecisionCloseoutIndexTrendVerdict,
} from "./types";

/**
 * Which next-action checklist ids each fired reason recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_IDS} order) plus, for a `trend-stable`
 * history, a trailing `continue-indexing-closeouts`, always followed by `keep-closeout-index-trend`. Informational
 * reasons (`latest-indexed` / `history-coherent`) recommend no action; `trend-improving` recommends
 * `note-improving-trend`.
 */
const REASON_CHECKLIST: Record<
  ReleaseDecisionCloseoutIndexTrendReasonId,
  readonly ReleaseDecisionCloseoutIndexTrendChecklistId[]
> = {
  "index-tampered": ["recover-tampered-indexes"],
  "latest-blocked": ["review-blocked-indexes"],
  "blocked-threshold-exceeded": ["review-blocked-indexes"],
  "strict-watch-escalation": ["review-strict-watch", "review-watch-indexes"],
  "latest-open": ["review-watch-indexes"],
  "watch-threshold-exceeded": ["review-watch-indexes"],
  "trend-degrading": ["review-degrading-trend"],
  "no-indexes": ["supply-closeout-indexes"],
  "index-unreadable": ["recover-unreadable-indexes"],
  "latest-incomplete": ["complete-incomplete-indexes"],
  "incomplete-threshold-exceeded": ["complete-incomplete-indexes"],
  "latest-indexed": [],
  "trend-improving": ["note-improving-trend"],
  "history-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream closeout-index schema). */
export function buildTrendMetadata(): ReleaseDecisionCloseoutIndexTrendMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_POLICY_VERSION,
    indexSchema: RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired reasons + the resolved verdict. */
export function buildChecklist(
  fired: readonly ReleaseDecisionCloseoutIndexTrendReasonId[],
  verdict: ReleaseDecisionCloseoutIndexTrendVerdict,
): ReleaseDecisionCloseoutIndexTrendChecklistItem[] {
  const wanted = new Set<ReleaseDecisionCloseoutIndexTrendChecklistId>();
  for (const id of fired) for (const step of REASON_CHECKLIST[id]) wanted.add(step);
  if (verdict === "trend-stable") {
    // A coherent history: keep indexing closeouts, then keep the record.
    wanted.add("continue-indexing-closeouts");
  }
  wanted.add("keep-closeout-index-trend"); // always the last step — keep the content-free governance review summary
  return RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested windows (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutIndexTrendResult}. Pure and deterministic.
 */
export function buildTrendResult(
  generatedAt: string,
  windows: readonly IngestedCloseoutIndex[],
  policy: ReleaseDecisionCloseoutIndexTrendPolicy,
): ReleaseDecisionCloseoutIndexTrendResult {
  const { points, summary } = reduceTrend(windows, policy.maxIndexes);
  const { rollup, reasons } = computeTrendRollup(summary, policy);
  const checklist = buildChecklist(rollup.reasons, rollup.verdict);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA,
    generatedAt,
    metadata: buildTrendMetadata(),
    policy,
    summary,
    points,
    closeoutIndexTrend: rollup,
    reasons,
    checklist,
    guidance: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CAVEATS,
    receipt: buildTrendReceipt(generatedAt, summary, rollup),
  };
}
