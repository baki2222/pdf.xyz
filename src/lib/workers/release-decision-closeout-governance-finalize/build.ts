/**
 * Pure, node-free **composer** for the release decision closeout governance finalization bundle result (Phase 74).
 *
 * It takes the ingested sources the trust boundary produced ({@link IngestedGovernanceFinalizeSources}), the run's stamp,
 * and the applied policy, and folds them into one stable {@link ReleaseDecisionCloseoutGovernanceFinalizeResult}: it
 * summarizes the bounded primary receipt + folds the composite finalization verdict + reasons + related checklist +
 * coverage (`./reduce`), derives the archive checklist + the ordered follow-up assignment list from the fired reasons,
 * and flattens the content-free receipt (`./receipt`).
 *
 * Determinism: the related records / reasons / archive items / follow-ups are in canonical order, no field is a raw value
 * from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested state + stamp +
 * policy always produce a byte-identical result. Honesty: the primary-receipt summary reports the CLAIM (untrusted when
 * tampered), while the rollup resolves the finalization posture — so a tampered / blocked / contradictory chain never
 * yields a `finalized`.
 */

import { buildGovernanceFinalizeReceipt } from "./receipt";
import { buildGovernanceFinalizeSource, computeGovernanceFinalize } from "./reduce";
import type { IngestedGovernanceFinalizeSources } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeArchiveGuidance,
  type ReleaseDecisionCloseoutGovernanceFinalizeChecklistId,
  type ReleaseDecisionCloseoutGovernanceFinalizeFollowup,
  type ReleaseDecisionCloseoutGovernanceFinalizeFollowupId,
  type ReleaseDecisionCloseoutGovernanceFinalizeMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizePolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord,
  type ReleaseDecisionCloseoutGovernanceFinalizeResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeSource,
} from "./types";

/**
 * Which follow-up assignment ids each fired reason recommends. The final checklist is the ordered, deduped union of these
 * (in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_IDS} order) plus a trailing
 * `archive-finalize-bundle`. A clean `finalized` bundle (only informational reasons, so no follow-up recommended) instead
 * recommends `continue-governance-cadence` then the archive step.
 */
const REASON_FOLLOWUPS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeFollowupId[]
> = {
  // Blocking
  "receipt-tampered": ["recover-tampered-record"],
  "receipt-blocked": ["investigate-blocked-finalization"],
  "related-tampered": ["recover-tampered-record"],
  "plan-contradiction": ["reconcile-contradictory-record"],
  "trend-contradiction": ["reconcile-contradictory-record"],
  "source-chain-blocked": ["investigate-blocked-finalization"],
  "strict-open-escalation": ["resolve-open-followup"],
  // Open
  "receipt-followup-open": ["resolve-open-followup"],
  "source-chain-advisory": ["resolve-open-followup"],
  // Incomplete
  "receipt-unreadable": ["complete-finalization-evidence"],
  "receipt-incomplete": ["complete-finalization-evidence"],
  "related-unreadable": ["complete-finalization-evidence"],
  "source-chain-insufficient": ["complete-finalization-evidence"],
  "required-record-missing": ["supply-required-record"],
  // Informational — no follow-up recommended (a clean marker)
  "receipt-completed": [],
  "plan-coherent": [],
  "trend-coherent": [],
  "source-chain-coherent": [],
};

/** Assemble the stable identity block (with the pinned upstream document schemas). */
export function buildGovernanceFinalizeMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION,
    receiptSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA,
    planSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_SCHEMA,
    trendSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA,
    indexSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
    governanceSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
  };
}

/** Derive the ordered, deduped follow-up assignment list from the fired reasons (or a clean finalized path). */
export function buildFollowUps(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeFollowup[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeFollowupId>();
  for (const id of fired) for (const followup of REASON_FOLLOWUPS[id]) wanted.add(followup);
  if (wanted.size === 0) {
    // Only informational reasons fired (a clean finalized chain): keep the cadence, then archive the final record.
    wanted.add("continue-governance-cadence");
  }
  wanted.add("archive-finalize-bundle"); // always the last step — keep the content-free FINAL governance record
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_DETAIL[id],
  }));
}

/** The archive-checklist id for each recognized related record kind. */
const RECORD_CHECKLIST: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord["kind"],
  ReleaseDecisionCloseoutGovernanceFinalizeChecklistId
> = {
  plan: "governance-plan",
  trend: "governance-index-trend",
  index: "governance-index",
  governance: "governance-bundle",
};

/** Derive the archive checklist — the recognized primary receipt + recognized related records + always this bundle. */
export function buildArchive(
  source: ReleaseDecisionCloseoutGovernanceFinalizeSource,
  related: readonly ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord[],
): ReleaseDecisionCloseoutGovernanceFinalizeArchiveGuidance {
  const present = new Set<ReleaseDecisionCloseoutGovernanceFinalizeChecklistId>();
  // A recognized document is one whose schema was recognized (usable or tampered) — worth keeping as evidence.
  if (source.state === "usable" || source.state === "tampered") present.add("primary-receipt");
  for (const r of related) {
    if (r.state === "usable" || r.state === "tampered") present.add(RECORD_CHECKLIST[r.kind]);
  }
  present.add("finalize-bundle"); // always keep the content-free FINAL governance record
  const items = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CHECKLIST_IDS.filter((id) => present.has(id));
  const extra = items.length > 1;
  return {
    items,
    note: extra
      ? "Archive each recognized record above, plus this bundle, as CI artifacts — they are the content-free release-decision-closeout-governance-finalize record for this review. This bundle never uploads or promotes them."
      : "No release record was recognized, so there is nothing to archive but this bundle; supply a readable primary receipt (and, optionally, the related plan / trend / index / governance bundle) and re-run.",
  };
}

/**
 * Fold the ingested sources + the run stamp + the policy into the full {@link ReleaseDecisionCloseoutGovernanceFinalizeResult}.
 * Pure and deterministic.
 */
export function buildGovernanceFinalizeResult(
  generatedAt: string,
  ingested: IngestedGovernanceFinalizeSources,
  policy: ReleaseDecisionCloseoutGovernanceFinalizePolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  const source = buildGovernanceFinalizeSource(ingested.receipt.ingested);
  const { rollup, reasons, related, coverage } = computeGovernanceFinalize(
    ingested.receipt.ingested,
    ingested.related,
    policy,
  );
  const followUps = buildFollowUps(rollup.reasons);
  const archive = buildArchive(source, related);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
    generatedAt,
    metadata: buildGovernanceFinalizeMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    coverage,
    source,
    related,
    governanceFinalize: rollup,
    reasons,
    archive,
    followUps,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CAVEATS,
    receipt: buildGovernanceFinalizeReceipt(generatedAt, coverage, rollup),
  };
}
