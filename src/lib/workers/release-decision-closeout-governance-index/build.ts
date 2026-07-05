/**
 * Pure, node-free **composer** for the release decision closeout governance index result (Phase 70).
 *
 * It takes the ingested bundles the trust boundary produced (oldest → newest), the run's stamp, and the applied policy,
 * and folds them into one stable {@link ReleaseDecisionCloseoutGovernanceIndexResult}: it reduces the window to a
 * bounded point sequence + ledger summary + the latest usable verdict (`./reduce`), folds the composite index verdict +
 * reasons (`./reduce`), derives the ordered next-action checklist from the fired reasons, and flattens the audit receipt
 * (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / checklist in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history +
 * stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup
 * (folded separately) resolves the index — so a tampered / blocked / thin history never yields an `indexed` index.
 */

import { buildGovernanceIndexReceipt } from "./receipt";
import { computeGovernanceIndexRollup, reduceIndex } from "./reduce";
import type { IngestedGovernance } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceIndexChecklistId,
  type ReleaseDecisionCloseoutGovernanceIndexChecklistItem,
  type ReleaseDecisionCloseoutGovernanceIndexMetadata,
  type ReleaseDecisionCloseoutGovernanceIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceIndexResult,
} from "./types";

/**
 * Which next-action checklist ids each fired reason recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_IDS} order) plus a trailing
 * `keep-governance-index`. A coherent history (no blocking / open / incomplete reason) instead recommends
 * `continue-recording-governance` then `keep-governance-index`. Informational reasons (`latest-closed` /
 * `history-coherent`) recommend no action.
 */
const REASON_CHECKLIST: Record<
  ReleaseDecisionCloseoutGovernanceIndexReasonId,
  readonly ReleaseDecisionCloseoutGovernanceIndexChecklistId[]
> = {
  "governance-tampered": ["recover-tampered-governance"],
  "latest-blocked": ["review-blocked-governance"],
  "blocked-threshold-exceeded": ["review-blocked-governance"],
  "strict-open-escalation": ["review-blocked-governance", "review-open-governance"],
  "latest-open": ["review-open-governance"],
  "open-threshold-exceeded": ["review-open-governance"],
  "no-governance": ["supply-governance-records"],
  "governance-unreadable": ["recover-unreadable-governance"],
  "latest-incomplete": ["complete-incomplete-governance"],
  "incomplete-threshold-exceeded": ["complete-incomplete-governance"],
  "latest-closed": [],
  "history-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream governance schema). */
export function buildGovernanceIndexMetadata(): ReleaseDecisionCloseoutGovernanceIndexMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION,
    governanceSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired reasons (or a coherent-history path). */
export function buildChecklist(
  fired: readonly ReleaseDecisionCloseoutGovernanceIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceIndexChecklistItem[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceIndexChecklistId>();
  for (const id of fired) for (const step of REASON_CHECKLIST[id]) wanted.add(step);
  if (wanted.size === 0) {
    // A coherent history (only informational reasons fired): keep recording bundles, then keep the record.
    wanted.add("continue-recording-governance");
  }
  wanted.add("keep-governance-index"); // always the last step — keep the content-free governance-history review summary
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested bundles (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceIndexResult}. Pure and deterministic.
 */
export function buildGovernanceIndexResult(
  generatedAt: string,
  governance: readonly IngestedGovernance[],
  policy: ReleaseDecisionCloseoutGovernanceIndexPolicy,
): ReleaseDecisionCloseoutGovernanceIndexResult {
  const { points, ledger, latest } = reduceIndex(governance, policy.maxGovernance);
  const { rollup, reasons } = computeGovernanceIndexRollup(ledger, latest, policy);
  const checklist = buildChecklist(rollup.reasons);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
    generatedAt,
    metadata: buildGovernanceIndexMetadata(),
    policy,
    ledger,
    points,
    governanceIndex: rollup,
    reasons,
    checklist,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CAVEATS,
    receipt: buildGovernanceIndexReceipt(generatedAt, ledger, rollup),
  };
}
