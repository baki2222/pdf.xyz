/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index trend action-plan execution
 * receipt result (Phase 78).
 *
 * It takes the ingested plan the trust boundary produced, the run's stamp, and the applied policy (the operator's
 * bounded acknowledgements + `--strict-open`), and folds them into one stable
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult}: it summarizes the bounded source plan,
 * folds the composite receipt verdict + reasons + acknowledgement checklist + next actions (`./reduce`), and flattens
 * the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist / next-actions are in canonical order, no field is a raw value from the input,
 * and every fact is a bounded enum / small integer / boolean — so the same ingested plan + stamp + policy always produce
 * a byte-identical result. Honesty: the source summary reports the CLAIM (untrusted when tampered), while the receipt
 * rollup resolves the verdict — so a tampered / invalid / under-acknowledged plan never yields a completed receipt.
 */

import { computeReceipt, sourceStateOf } from "./reduce";
import { buildFinalizeIndexTrendActionReceiptReceipt } from "./receipt";
import type { IngestedFinalizeIndexTrendActionPlan } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream plan schema). */
export function buildFinalizeIndexTrendActionReceiptMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION,
    planSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  };
}

/** Reduce the ingested plan to the bounded source summary the result records. */
export function buildFinalizeIndexTrendActionReceiptSource(
  ingested: IngestedFinalizeIndexTrendActionPlan,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSource {
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
    planRequireClean: facts ? facts.planRequireClean : false,
  };
}

/**
 * Fold the ingested plan + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult}. Pure and deterministic.
 */
export function buildFinalizeIndexTrendActionReceiptResult(
  generatedAt: string,
  ingested: IngestedFinalizeIndexTrendActionPlan,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  const source = buildFinalizeIndexTrendActionReceiptSource(ingested);
  const { rollup, reasons, acknowledgements, nextActions } = computeReceipt(ingested, policy);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
    generatedAt,
    metadata: buildFinalizeIndexTrendActionReceiptMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    planClass: rollup.planClass,
    source,
    actionReceipt: rollup,
    acknowledgements,
    reasons,
    nextActions,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CAVEATS,
    receipt: buildFinalizeIndexTrendActionReceiptReceipt(generatedAt, source, rollup),
  };
}
