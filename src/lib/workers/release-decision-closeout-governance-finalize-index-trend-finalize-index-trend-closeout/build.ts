/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index trend finalize index trend
 * closeout bundle result (Phase 84).
 *
 * It takes the ingested primary receipt + the ingested related records (the trust boundary's output), the run's stamp,
 * and the applied policy (the `--require-*` flags + `--strict-open`), and folds them into one stable
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutResult}: it summarizes the bounded
 * primary receipt, folds the composite closeout coverage + reasons + related-record checklist + source-chain posture +
 * next actions (`./reduce`), and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist / next actions are in canonical order, no field is a raw value from any input, and
 * every fact is a bounded enum / small integer / boolean — so the same ingested records + stamp + policy always produce a
 * byte-identical result. Honesty: the primary-receipt summary reports the receipt's CLAIM (untrusted when tampered),
 * while the coverage resolves the verdict — so a tampered / blocked receipt or an inconsistent chain never yields a
 * `closed` closeout.
 */

import { computeCloseout, sourceStateOf } from "./reduce";
import { buildCloseoutReceipt } from "./receipt";
import type { IngestedCloseoutReceipt, IngestedRelatedRecord } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPrimaryReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutResult,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream schemas). */
export function buildCloseoutMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_POLICY_VERSION,
    receiptSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
    planSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
    trendSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_SCHEMA,
    indexSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA,
  };
}

/** Reduce the ingested primary receipt to the bounded primary-receipt summary the result records. */
export function buildCloseoutPrimaryReceipt(
  receipt: IngestedCloseoutReceipt,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPrimaryReceipt {
  const f = receipt.facts;
  return {
    state: sourceStateOf(receipt),
    // Trusted verdict when usable; the untrusted claim when tampered; `null` when unreadable.
    receiptVerdict: receipt.usable && f ? f.receiptVerdict : receipt.claimedVerdict,
    planClass: f ? f.planClass : null,
    claimedPlanVerdict: f ? f.claimedPlanVerdict : null,
    sourceTrendVerdict: f ? f.sourceTrendVerdict : null,
    sourceLatestIndex: f ? f.sourceLatestIndex : null,
    planUrgency: f ? f.planUrgency : null,
    planActionClass: f ? f.planActionClass : null,
    blockingActions: f ? f.blockingActions : 0,
    advisoryActions: f ? f.advisoryActions : 0,
    planStrictWatch: f ? f.planStrictWatch : false,
    planRequireClean: f ? f.planRequireClean : false,
    acksRequired: f ? f.acksRequired : 0,
    acksSatisfied: f ? f.acksSatisfied : 0,
    acksMissing: f ? f.acksMissing : 0,
    receiptStrictOpen: f ? f.receiptStrictOpen : false,
  };
}

/**
 * Fold the ingested primary receipt + related records + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutResult}. Pure and deterministic.
 */
export function buildCloseoutResult(
  generatedAt: string,
  receipt: IngestedCloseoutReceipt,
  records: readonly IngestedRelatedRecord[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutResult {
  const primaryReceipt = buildCloseoutPrimaryReceipt(receipt);
  const { coverage, reasons, related, sourceChain, nextActions } = computeCloseout(receipt, records, policy);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_SCHEMA,
    generatedAt,
    metadata: buildCloseoutMetadata(),
    policy,
    verdict: coverage.verdict,
    exitCode: coverage.exitCode,
    primaryReceipt,
    related,
    sourceChain,
    coverage,
    reasons,
    nextActions,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_CAVEATS,
    receipt: buildCloseoutReceipt(generatedAt, coverage, sourceChain.posture),
  };
}
