/**
 * Pure, node-free **composer** for the release decision closeout bundle result (Phase 64).
 *
 * It takes the ingested primary receipt + the ingested related records (the trust boundary's output), the run's stamp,
 * and the applied policy (the `--require-*` flags + `--strict-open`), and folds them into one stable
 * {@link ReleaseDecisionCloseoutResult}: it summarizes the bounded primary receipt, folds the composite closeout verdict +
 * reasons + related-record checklist (`./reduce`), and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist are in canonical order, no field is a raw value from any input, and every fact is a
 * bounded enum / small integer / boolean — so the same ingested records + stamp + policy always produce a byte-identical
 * result. Honesty: the source summary reports the receipt's CLAIM (untrusted when tampered), while the closeout rollup
 * resolves the verdict — so a tampered / blocked receipt or an inconsistent chain never yields a `closed` closeout.
 */

import { computeCloseout, sourceStateOf } from "./reduce";
import { buildCloseoutReceipt } from "./receipt";
import type { IngestedCloseoutReceipt, IngestedRelatedRecord } from "./ingest";
import {
  RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_SCHEMA,
  RELEASE_DECISION_INDEX_SCHEMA,
  RELEASE_DECISION_SCHEMA,
  RELEASE_DECISION_TREND_SCHEMA,
  type ReleaseDecisionCloseoutMetadata,
  type ReleaseDecisionCloseoutPolicy,
  type ReleaseDecisionCloseoutResult,
  type ReleaseDecisionCloseoutSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream schemas). */
export function buildCloseoutMetadata(): ReleaseDecisionCloseoutMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_POLICY_VERSION,
    receiptSchema: RELEASE_DECISION_ACTION_RECEIPT_SCHEMA,
    planSchema: RELEASE_DECISION_ACTION_PLAN_SCHEMA,
    trendSchema: RELEASE_DECISION_TREND_SCHEMA,
    decisionSchema: RELEASE_DECISION_SCHEMA,
    indexSchema: RELEASE_DECISION_INDEX_SCHEMA,
  };
}

/** Reduce the ingested primary receipt to the bounded source summary the result records. */
export function buildCloseoutSource(receipt: IngestedCloseoutReceipt): ReleaseDecisionCloseoutSource {
  const f = receipt.facts;
  return {
    state: sourceStateOf(receipt),
    // Trusted verdict when usable; the untrusted claim when tampered; `null` when unreadable.
    receiptVerdict: receipt.usable && f ? f.receiptVerdict : receipt.claimedVerdict,
    planClass: f ? f.planClass : null,
    claimedPlanVerdict: f ? f.claimedPlanVerdict : null,
    sourceTrendVerdict: f ? f.sourceTrendVerdict : null,
    planUrgency: f ? f.planUrgency : null,
    planActionClass: f ? f.planActionClass : null,
    benignMonitor: f ? f.benignMonitor : false,
    acksRequired: f ? f.acksRequired : 0,
    acksSatisfied: f ? f.acksSatisfied : 0,
    acksMissing: f ? f.acksMissing : 0,
    receiptStrictOpen: f ? f.receiptStrictOpen : false,
  };
}

/**
 * Fold the ingested primary receipt + related records + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutResult}. Pure and deterministic.
 */
export function buildCloseoutResult(
  generatedAt: string,
  receipt: IngestedCloseoutReceipt,
  records: readonly IngestedRelatedRecord[],
  policy: ReleaseDecisionCloseoutPolicy,
): ReleaseDecisionCloseoutResult {
  const source = buildCloseoutSource(receipt);
  const { rollup, reasons, related } = computeCloseout(receipt, records, policy);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_SCHEMA,
    generatedAt,
    metadata: buildCloseoutMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    planClass: rollup.planClass,
    source,
    related,
    closeout: rollup,
    reasons,
    guidance: RELEASE_DECISION_CLOSEOUT_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_CAVEATS,
    receipt: buildCloseoutReceipt(generatedAt, rollup),
  };
}
