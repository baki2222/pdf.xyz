/**
 * Pure, node-free **composer** for the release decision ledger index result (Phase 60).
 *
 * It takes the ingested records the trust boundary produced (oldest → newest), the run's stamp, and the applied
 * policy, and folds them into one stable {@link ReleaseDecisionIndexResult}: it reduces the window to a bounded
 * point sequence + ledger summary (`./reduce`), folds the composite index verdict + reasons (`./rollup`), derives
 * the ordered next-action checklist from the fired reasons, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / checklist in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested batch +
 * stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup
 * (folded separately) resolves the index — so a tampered / rejected / thin batch never yields a `stable` index.
 */

import { buildIndexReceipt } from "./receipt";
import { computeIndexRollup } from "./rollup";
import { reduceIndex } from "./reduce";
import type { IngestedDecision } from "./ingest";
import {
  RELEASE_DECISION_INDEX_CHECKLIST_DETAIL,
  RELEASE_DECISION_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_INDEX_CAVEATS,
  RELEASE_DECISION_INDEX_GUIDANCE,
  RELEASE_DECISION_INDEX_POLICY_ID,
  RELEASE_DECISION_INDEX_POLICY_VERSION,
  RELEASE_DECISION_INDEX_SCHEMA,
  RELEASE_DECISION_SCHEMA,
  type ReleaseDecisionIndexChecklistId,
  type ReleaseDecisionIndexChecklistItem,
  type ReleaseDecisionIndexMetadata,
  type ReleaseDecisionIndexPolicy,
  type ReleaseDecisionIndexReasonId,
  type ReleaseDecisionIndexResult,
} from "./types";

/**
 * Which next-action checklist ids each fired reason recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_DECISION_INDEX_CHECKLIST_IDS} order) plus a trailing `keep-decision-index`. A
 * clean stable batch (no reasons) instead recommends `continue-recording-decisions` then `keep-decision-index`.
 */
const REASON_CHECKLIST: Record<ReleaseDecisionIndexReasonId, readonly ReleaseDecisionIndexChecklistId[]> = {
  "record-unreadable": ["recover-invalid-records"],
  "record-tampered": ["recover-invalid-records"],
  "decision-rejected": ["review-blocking-decisions"],
  "decision-invalid": ["review-blocking-decisions"],
  "no-usable-records": ["supply-decision-records"],
  "decision-insufficient": ["complete-insufficient-evidence"],
  "decision-hold": ["review-advisory-decisions"],
  "decision-followup": ["review-advisory-decisions"],
};

/** Assemble the stable identity block (with the pinned upstream decision schema). */
export function buildIndexMetadata(): ReleaseDecisionIndexMetadata {
  return {
    schemaVersion: RELEASE_DECISION_INDEX_POLICY_VERSION,
    policyId: RELEASE_DECISION_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_INDEX_POLICY_VERSION,
    decisionSchema: RELEASE_DECISION_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired reasons (or a clean stable path). */
export function buildChecklist(
  fired: readonly ReleaseDecisionIndexReasonId[],
): ReleaseDecisionIndexChecklistItem[] {
  const wanted = new Set<ReleaseDecisionIndexChecklistId>();
  if (fired.length === 0) {
    // A clean stable batch: keep recording decisions, then keep the record.
    wanted.add("continue-recording-decisions");
  } else {
    for (const id of fired) for (const step of REASON_CHECKLIST[id]) wanted.add(step);
  }
  wanted.add("keep-decision-index"); // always the last step — keep the content-free ledger review summary
  return RELEASE_DECISION_INDEX_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_DECISION_INDEX_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested records (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionIndexResult}. Pure and deterministic.
 */
export function buildIndexResult(
  generatedAt: string,
  records: readonly IngestedDecision[],
  policy: ReleaseDecisionIndexPolicy,
): ReleaseDecisionIndexResult {
  const { points, ledger } = reduceIndex(records, policy.maxRecords);
  const { rollup, reasons } = computeIndexRollup(ledger, policy);
  const checklist = buildChecklist(rollup.reasons);

  return {
    schema: RELEASE_DECISION_INDEX_SCHEMA,
    generatedAt,
    metadata: buildIndexMetadata(),
    policy,
    ledger,
    points,
    index: rollup,
    reasons,
    checklist,
    guidance: RELEASE_DECISION_INDEX_GUIDANCE,
    caveats: RELEASE_DECISION_INDEX_CAVEATS,
    receipt: buildIndexReceipt(generatedAt, ledger, rollup),
  };
}
