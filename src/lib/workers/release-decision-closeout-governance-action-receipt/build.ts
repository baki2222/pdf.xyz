/**
 * Pure, node-free **composer** for the release decision closeout governance action-plan execution receipt result
 * (Phase 73).
 *
 * It takes the ingested plan the trust boundary produced, the run's stamp, and the applied policy (the operator's
 * bounded acknowledgements + `--strict-open`), and folds them into one stable
 * {@link ReleaseDecisionCloseoutGovernanceActionReceiptResult}: it summarizes the bounded source plan, folds the
 * composite receipt verdict + reasons + acknowledgement checklist (`./reduce`), and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist are in canonical order, no field is a raw value from the input, and every fact
 * is a bounded enum / small integer / boolean — so the same ingested plan + stamp + policy always produce a
 * byte-identical result. Honesty: the source summary reports the CLAIM (untrusted when tampered), while the receipt
 * rollup resolves the verdict — so a tampered / unacknowledged plan never yields a completed receipt.
 */

import { computeReceipt, sourceStateOf } from "./reduce";
import { buildGovernanceActionReceiptReceipt } from "./receipt";
import type { IngestedGovernancePlan } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceActionReceiptMetadata,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceActionReceiptResult,
  type ReleaseDecisionCloseoutGovernanceActionReceiptSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream plan schema). */
export function buildGovernanceActionReceiptMetadata(): ReleaseDecisionCloseoutGovernanceActionReceiptMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_POLICY_VERSION,
    planSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_SCHEMA,
  };
}

/** Reduce the ingested plan to the bounded source summary the result records. */
export function buildGovernanceActionReceiptSource(
  ingested: IngestedGovernancePlan,
): ReleaseDecisionCloseoutGovernanceActionReceiptSource {
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
 * Fold the ingested plan + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceActionReceiptResult}. Pure and deterministic.
 */
export function buildGovernanceActionReceiptResult(
  generatedAt: string,
  ingested: IngestedGovernancePlan,
  policy: ReleaseDecisionCloseoutGovernanceActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceActionReceiptResult {
  const source = buildGovernanceActionReceiptSource(ingested);
  const { rollup, reasons, acknowledgements } = computeReceipt(ingested, policy);

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA,
    generatedAt,
    metadata: buildGovernanceActionReceiptMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    planClass: rollup.planClass,
    source,
    governanceActionReceipt: rollup,
    acknowledgements,
    reasons,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_CAVEATS,
    receipt: buildGovernanceActionReceiptReceipt(generatedAt, source, rollup),
  };
}
