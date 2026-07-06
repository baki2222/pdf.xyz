/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index trend FINALIZATION record
 * result (Phase 79).
 *
 * It takes the ingested sources the trust boundary produced ({@link IngestedFinalizeIndexTrendFinalizeSources}), the run's
 * stamp, and the applied policy, and folds them into one stable
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult}: it summarizes the bounded primary receipt +
 * folds the composite finalization verdict + reasons + source-chain checklist + coverage (`./reduce`), derives the
 * ordered next-action list from the fired reasons, and flattens the content-free receipt (`./receipt`).
 *
 * Determinism: the source-chain records / reasons / next-actions are in canonical order, no field is a raw value from the
 * input, and every fact is a bounded enum / small integer / boolean — so the same ingested state + stamp + policy always
 * produce a byte-identical result. Honesty: the primary-receipt summary reports the CLAIM (untrusted when tampered),
 * while the rollup resolves the finalization posture — so a tampered / blocked / contradictory loop never yields a
 * `finalized`.
 */

import { buildFinalizeIndexTrendFinalizeReceipt } from "./receipt";
import { buildFinalizeSource, computeFinalizeIndexTrendFinalize } from "./reduce";
import type { IngestedFinalizeIndexTrendFinalizeSources } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextAction,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
} from "./types";

/**
 * Which next-action ids each fired reason recommends. The final checklist is the ordered, deduped union of these (in
 * canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_IDS} order) plus a
 * trailing `keep-finalize-record`. A clean `finalized` loop (only informational reasons, so no next-action recommended)
 * instead recommends `continue-governance-cadence` then the keep step.
 */
const REASON_NEXT_ACTIONS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId[]
> = {
  // Invalid
  "receipt-unreadable": ["recover-trusted-receipt"],
  "receipt-tampered": ["recover-trusted-receipt"],
  "related-tampered": ["recover-tampered-source"],
  // Blocking
  "receipt-blocked": ["investigate-blocked-loop"],
  "receipt-invalid": ["investigate-blocked-loop"],
  "plan-contradiction": ["reconcile-contradictory-source"],
  "trend-contradiction": ["reconcile-contradictory-source"],
  "index-contradiction": ["reconcile-contradictory-source"],
  "finalization-contradiction": ["reconcile-contradictory-source"],
  "source-chain-blocked": ["investigate-blocked-loop"],
  "strict-open-escalation": ["resolve-open-followup"],
  // Incomplete
  "required-record-missing": ["supply-required-record"],
  "receipt-incomplete": ["complete-finalization-evidence"],
  "related-unreadable": ["complete-finalization-evidence"],
  "source-chain-insufficient": ["complete-finalization-evidence"],
  // Open
  "source-chain-advisory": ["resolve-open-followup"],
  // Informational — no next-action recommended (a clean marker)
  "receipt-completed": [],
  "plan-coherent": [],
  "trend-coherent": [],
  "index-coherent": [],
  "finalization-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream document schemas). */
export function buildFinalizeIndexTrendFinalizeMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION,
    receiptSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
    planSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
    trendSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA,
    indexSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA,
    finalizationSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action id list from the fired reasons (or a clean finalized path). */
export function buildNextActionIds(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId>();
  for (const id of fired) for (const action of REASON_NEXT_ACTIONS[id]) wanted.add(action);
  if (wanted.size === 0) {
    // Only informational reasons fired (a clean finalized loop): keep the cadence, then keep the FINAL record.
    wanted.add("continue-governance-cadence");
  }
  wanted.add("keep-finalize-record"); // always the last step — keep the content-free FINAL record
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_IDS.filter((id) => wanted.has(id));
}

/** Assemble the full next-action records (id + authored detail) from the fired reasons. */
export function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextAction[] {
  return buildNextActionIds(fired).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_DETAIL[id],
  }));
}

/**
 * Fold the ingested sources + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult}. Pure and deterministic.
 */
export function buildFinalizeIndexTrendFinalizeResult(
  generatedAt: string,
  ingested: IngestedFinalizeIndexTrendFinalizeSources,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  const source = buildFinalizeSource(ingested.receipt.ingested);
  const { rollup, reasons, related, coverage } = computeFinalizeIndexTrendFinalize(
    ingested.receipt.ingested,
    ingested.related,
    policy,
  );
  const nextActions = buildNextActions(rollup.reasons);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA,
    generatedAt,
    metadata: buildFinalizeIndexTrendFinalizeMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    coverage,
    source,
    related,
    finalize: rollup,
    reasons,
    nextActions,
    nextActionIds: nextActions.map((a) => a.id),
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CAVEATS,
    receipt: buildFinalizeIndexTrendFinalizeReceipt(generatedAt, coverage, rollup),
  };
}
