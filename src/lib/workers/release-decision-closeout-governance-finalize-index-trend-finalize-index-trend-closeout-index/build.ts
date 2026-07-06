/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index trend finalize index trend
 * closeout INDEX result (Phase 85).
 *
 * It takes the ingested records the trust boundary produced (oldest → newest), the run's stamp, and the applied policy,
 * and folds them into one stable
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexResult}: it reduces the window
 * to a bounded point sequence + coverage + distribution + the latest usable summary (`./reduce`), folds the composite
 * index verdict + reasons (`./reduce`), derives the ordered next-action checklist from the fired reasons, and flattens the
 * audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / checklist in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history + stamp
 * + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup (folded
 * separately) resolves the index — so a tampered / unreadable / blocked / thin history never yields an `indexed` index.
 */

import { buildCloseoutIndexReceipt } from "./receipt";
import { computeCloseoutIndexRollup, reduceIndex } from "./reduce";
import type { IngestedCloseout } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexChecklistId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexChecklistItem,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexResult,
} from "./types";

/**
 * Which next-action checklist ids each fired reason recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_IDS}
 * order) plus a trailing `keep-closeout-index`. A coherent history (no invalid / blocking / open / incomplete reason)
 * instead recommends `continue-recording-closeout` then `keep-closeout-index`. Informational reasons (`latest-closed` /
 * `history-coherent`) recommend no action.
 */
const REASON_CHECKLIST: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexChecklistId[]
> = {
  "closeout-tampered": ["recover-tampered-closeout"],
  "closeout-unreadable": ["recover-unreadable-closeout"],
  "latest-blocked": ["review-blocked-closeout"],
  "blocked-in-history": ["review-blocked-closeout"],
  "strict-open-escalation": ["review-blocked-closeout", "review-open-closeout"],
  "latest-open": ["review-open-closeout"],
  "open-threshold-exceeded": ["review-open-closeout"],
  "no-closeouts": ["supply-closeout-records"],
  "latest-incomplete": ["complete-incomplete-closeout"],
  "incomplete-threshold-exceeded": ["complete-incomplete-closeout"],
  "latest-not-closed": ["complete-incomplete-closeout"],
  "latest-closed": [],
  "history-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream closeout schema). */
export function buildCloseoutIndexMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION,
    closeoutSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired reasons (or a coherent-history path). */
export function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexChecklistItem[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexChecklistId>();
  for (const id of fired) for (const step of REASON_CHECKLIST[id]) wanted.add(step);
  if (wanted.size === 0) {
    // A coherent history (only informational reasons fired): keep recording records, then keep the record.
    wanted.add("continue-recording-closeout");
  }
  wanted.add("keep-closeout-index"); // always the last step — keep the content-free closeout-history review summary
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_IDS.filter(
    (id) => wanted.has(id),
  ).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested records (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexResult}. Pure and
 * deterministic.
 */
export function buildCloseoutIndexResult(
  generatedAt: string,
  closeouts: readonly IngestedCloseout[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexResult {
  const { points, coverage, distribution, latest } = reduceIndex(closeouts, policy.maxCloseouts);
  const { rollup, reasons } = computeCloseoutIndexRollup(coverage, distribution, policy);
  const nextActions = buildNextActions(rollup.reasons);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA,
    generatedAt,
    metadata: buildCloseoutIndexMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    coverage,
    distribution,
    latest,
    points,
    closeoutIndex: rollup,
    reasons,
    nextActions,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_CAVEATS,
    receipt: buildCloseoutIndexReceipt(generatedAt, coverage, distribution, rollup),
  };
}
