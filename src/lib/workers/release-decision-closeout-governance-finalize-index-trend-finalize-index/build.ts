/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index result (Phase 80).
 *
 * It takes the ingested records the trust boundary produced (oldest → newest), the run's stamp, and the applied policy,
 * and folds them into one stable {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexResult}: it reduces the window to
 * a bounded point sequence + coverage + distribution + the latest usable summary (`./reduce`), folds the composite index
 * verdict + reasons (`./reduce`), derives the ordered next-action checklist from the fired reasons, and flattens the
 * audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / checklist in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history +
 * stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup
 * (folded separately) resolves the index — so a tampered / unreadable / blocked / thin history never yields an
 * `indexed` index.
 */

import { buildFinalizeIndexReceipt } from "./receipt";
import { computeFinalizeIndexRollup, reduceIndex } from "./reduce";
import type { IngestedFinalize } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_CHECKLIST_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexChecklistId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexChecklistItem,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexResult,
} from "./types";

/**
 * Which next-action checklist ids each fired reason recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_CHECKLIST_IDS} order) plus a trailing
 * `keep-finalize-index`. A coherent history (no invalid / blocking / open / incomplete reason) instead recommends
 * `continue-recording-finalization` then `keep-finalize-index`. Informational reasons (`latest-finalized` /
 * `history-coherent`) recommend no action.
 */
const REASON_CHECKLIST: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexChecklistId[]
> = {
  "finalization-tampered": ["recover-tampered-finalization"],
  "finalization-unreadable": ["recover-unreadable-finalization"],
  "latest-blocked": ["review-blocked-finalization"],
  "blocked-in-history": ["review-blocked-finalization"],
  "strict-open-escalation": ["review-blocked-finalization", "review-open-finalization"],
  "latest-open": ["review-open-finalization"],
  "open-threshold-exceeded": ["review-open-finalization"],
  "no-finalizations": ["supply-finalization-records"],
  "latest-incomplete": ["complete-incomplete-finalization"],
  "incomplete-threshold-exceeded": ["complete-incomplete-finalization"],
  "latest-not-finalized": ["complete-incomplete-finalization"],
  "latest-finalized": [],
  "history-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream finalization schema). */
export function buildFinalizeIndexMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_POLICY_VERSION,
    finalizeSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired reasons (or a coherent-history path). */
export function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexChecklistItem[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexChecklistId>();
  for (const id of fired) for (const step of REASON_CHECKLIST[id]) wanted.add(step);
  if (wanted.size === 0) {
    // A coherent history (only informational reasons fired): keep recording records, then keep the record.
    wanted.add("continue-recording-finalization");
  }
  wanted.add("keep-finalize-index"); // always the last step — keep the content-free finalization-history review summary
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested records (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexResult}. Pure and deterministic.
 */
export function buildFinalizeIndexResult(
  generatedAt: string,
  finalizations: readonly IngestedFinalize[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexResult {
  const { points, coverage, distribution, latest } = reduceIndex(finalizations, policy.maxFinalizations);
  const { rollup, reasons } = computeFinalizeIndexRollup(coverage, distribution, policy);
  const nextActions = buildNextActions(rollup.reasons);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA,
    generatedAt,
    metadata: buildFinalizeIndexMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    coverage,
    distribution,
    latest,
    points,
    finalizeIndex: rollup,
    reasons,
    nextActions,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_CAVEATS,
    receipt: buildFinalizeIndexReceipt(generatedAt, coverage, distribution, rollup),
  };
}
