/**
 * Pure, node-free **composer** for the release decision closeout action-plan execution receipt result (Phase 68).
 *
 * It takes the ingested plan the trust boundary produced, the run's stamp, and the applied policy (the operator's
 * bounded acknowledgements + `--strict-open`), and folds them into one stable
 * {@link ReleaseDecisionCloseoutActionReceiptResult}: it summarizes the bounded source plan, folds the composite receipt
 * verdict + reasons + acknowledgement checklist (`./reduce`), and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist are in canonical order, no field is a raw value from the input, and every fact
 * is a bounded enum / small integer / boolean — so the same ingested plan + stamp + policy always produce a
 * byte-identical result. Honesty: the source summary reports the CLAIM (untrusted when tampered), while the receipt
 * rollup resolves the verdict — so a tampered / unacknowledged plan never yields a completed receipt.
 */

import { computeReceipt, sourceStateOf } from "./reduce";
import { buildCloseoutActionReceiptReceipt } from "./receipt";
import type { IngestedCloseoutPlan } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_SCHEMA,
  type ReleaseDecisionCloseoutActionReceiptMetadata,
  type ReleaseDecisionCloseoutActionReceiptPolicy,
  type ReleaseDecisionCloseoutActionReceiptResult,
  type ReleaseDecisionCloseoutActionReceiptSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream plan schema). */
export function buildCloseoutActionReceiptMetadata(): ReleaseDecisionCloseoutActionReceiptMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_POLICY_VERSION,
    planSchema: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SCHEMA,
  };
}

/** Reduce the ingested plan to the bounded source summary the result records. */
export function buildCloseoutActionReceiptSource(
  ingested: IngestedCloseoutPlan,
): ReleaseDecisionCloseoutActionReceiptSource {
  const facts = ingested.facts;
  return {
    state: sourceStateOf(ingested),
    claimedPlanVerdict: ingested.claimedVerdict,
    planClass: facts ? facts.planClass : null,
    planUrgency: facts ? facts.urgency : null,
    planActionClass: facts ? facts.actionClass : null,
    sourceTrendVerdict: facts ? facts.sourceTrendVerdict : null,
    sourceLatestIndex: facts ? facts.sourceLatestIndex : null,
    blockingActions: facts ? facts.blockingActions : 0,
    advisoryActions: facts ? facts.advisoryActions : 0,
    planStrictWatch: facts ? facts.planStrictWatch : false,
  };
}

/**
 * Fold the ingested plan + the run stamp + the policy into the full {@link ReleaseDecisionCloseoutActionReceiptResult}.
 * Pure and deterministic.
 */
export function buildCloseoutActionReceiptResult(
  generatedAt: string,
  ingested: IngestedCloseoutPlan,
  policy: ReleaseDecisionCloseoutActionReceiptPolicy,
): ReleaseDecisionCloseoutActionReceiptResult {
  const source = buildCloseoutActionReceiptSource(ingested);
  const { rollup, reasons, acknowledgements } = computeReceipt(ingested, policy);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_SCHEMA,
    generatedAt,
    metadata: buildCloseoutActionReceiptMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    planClass: rollup.planClass,
    source,
    closeoutActionReceipt: rollup,
    acknowledgements,
    reasons,
    guidance: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CAVEATS,
    receipt: buildCloseoutActionReceiptReceipt(generatedAt, source, rollup),
  };
}
