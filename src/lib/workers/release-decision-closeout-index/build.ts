/**
 * Pure, node-free **composer** for the release decision closeout index result (Phase 65).
 *
 * It takes the ingested closeouts the trust boundary produced (oldest → newest), the run's stamp, and the applied
 * policy, and folds them into one stable {@link ReleaseDecisionCloseoutIndexResult}: it reduces the window to a bounded
 * point sequence + ledger summary + the latest usable verdict (`./reduce`), folds the composite index verdict +
 * reasons (`./reduce`), derives the ordered next-action checklist from the fired reasons, and flattens the audit
 * receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / checklist in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history +
 * stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup
 * (folded separately) resolves the index — so a tampered / blocked / thin history never yields an `indexed` index.
 */

import { buildCloseoutIndexReceipt } from "./receipt";
import { computeCloseoutIndexRollup, reduceIndex } from "./reduce";
import type { IngestedCloseout } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_DETAIL,
  RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_INDEX_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_SCHEMA,
  type ReleaseDecisionCloseoutIndexChecklistId,
  type ReleaseDecisionCloseoutIndexChecklistItem,
  type ReleaseDecisionCloseoutIndexMetadata,
  type ReleaseDecisionCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutIndexReasonId,
  type ReleaseDecisionCloseoutIndexResult,
} from "./types";

/**
 * Which next-action checklist ids each fired reason recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_IDS} order) plus a trailing `keep-closeout-index`.
 * A coherent history (no blocking / open / incomplete reason) instead recommends `continue-recording-closeouts` then
 * `keep-closeout-index`. Informational reasons (`latest-closed` / `history-coherent`) recommend no action.
 */
const REASON_CHECKLIST: Record<
  ReleaseDecisionCloseoutIndexReasonId,
  readonly ReleaseDecisionCloseoutIndexChecklistId[]
> = {
  "closeout-tampered": ["recover-tampered-closeouts"],
  "latest-blocked": ["review-blocked-closeouts"],
  "blocked-threshold-exceeded": ["review-blocked-closeouts"],
  "strict-open-escalation": ["review-blocked-closeouts", "review-open-closeouts"],
  "latest-open": ["review-open-closeouts"],
  "open-threshold-exceeded": ["review-open-closeouts"],
  "no-closeouts": ["supply-closeout-records"],
  "closeout-unreadable": ["recover-unreadable-closeouts"],
  "latest-incomplete": ["complete-incomplete-closeouts"],
  "incomplete-threshold-exceeded": ["complete-incomplete-closeouts"],
  "latest-closed": [],
  "history-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream closeout schema). */
export function buildCloseoutIndexMetadata(): ReleaseDecisionCloseoutIndexMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_VERSION,
    closeoutSchema: RELEASE_DECISION_CLOSEOUT_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired reasons (or a coherent-history path). */
export function buildChecklist(
  fired: readonly ReleaseDecisionCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutIndexChecklistItem[] {
  const wanted = new Set<ReleaseDecisionCloseoutIndexChecklistId>();
  for (const id of fired) for (const step of REASON_CHECKLIST[id]) wanted.add(step);
  if (wanted.size === 0) {
    // A coherent history (only informational reasons fired): keep recording closeouts, then keep the record.
    wanted.add("continue-recording-closeouts");
  }
  wanted.add("keep-closeout-index"); // always the last step — keep the content-free ledger review summary
  return RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested closeouts (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutIndexResult}. Pure and deterministic.
 */
export function buildCloseoutIndexResult(
  generatedAt: string,
  closeouts: readonly IngestedCloseout[],
  policy: ReleaseDecisionCloseoutIndexPolicy,
): ReleaseDecisionCloseoutIndexResult {
  const { points, ledger, latest } = reduceIndex(closeouts, policy.maxCloseouts);
  const { rollup, reasons } = computeCloseoutIndexRollup(ledger, latest, policy);
  const checklist = buildChecklist(rollup.reasons);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
    generatedAt,
    metadata: buildCloseoutIndexMetadata(),
    policy,
    ledger,
    points,
    closeoutIndex: rollup,
    reasons,
    checklist,
    guidance: RELEASE_DECISION_CLOSEOUT_INDEX_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_INDEX_CAVEATS,
    receipt: buildCloseoutIndexReceipt(generatedAt, ledger, rollup),
  };
}
