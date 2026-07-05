/**
 * Pure, node-free **composer** for the release decision action-plan execution receipt result (Phase 63).
 *
 * It takes the ingested plan the trust boundary produced, the run's stamp, and the applied policy (the operator's
 * bounded acknowledgements + `--strict-open`), and folds them into one stable {@link ReleaseDecisionActionReceiptResult}:
 * it summarizes the bounded source plan, folds the composite receipt verdict + reasons + acknowledgement checklist
 * (`./reduce`), and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist are in canonical order, no field is a raw value from the input, and every fact
 * is a bounded enum / small integer / boolean — so the same ingested plan + stamp + policy always produce a
 * byte-identical result. Honesty: the source summary reports the CLAIM (untrusted when tampered), while the receipt
 * rollup resolves the verdict — so a tampered / unacknowledged plan never yields a completed receipt.
 */

import { computeReceipt, sourceStateOf } from "./reduce";
import { buildActionReceiptReceipt } from "./receipt";
import type { IngestedPlan } from "./ingest";
import {
  RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_ACTION_RECEIPT_CAVEATS,
  RELEASE_DECISION_ACTION_RECEIPT_GUIDANCE,
  RELEASE_DECISION_ACTION_RECEIPT_POLICY_ID,
  RELEASE_DECISION_ACTION_RECEIPT_POLICY_VERSION,
  RELEASE_DECISION_ACTION_RECEIPT_SCHEMA,
  type ReleaseDecisionActionReceiptMetadata,
  type ReleaseDecisionActionReceiptPolicy,
  type ReleaseDecisionActionReceiptResult,
  type ReleaseDecisionActionReceiptSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream plan schema). */
export function buildActionReceiptMetadata(): ReleaseDecisionActionReceiptMetadata {
  return {
    schemaVersion: RELEASE_DECISION_ACTION_RECEIPT_POLICY_VERSION,
    policyId: RELEASE_DECISION_ACTION_RECEIPT_POLICY_ID,
    policyVersion: RELEASE_DECISION_ACTION_RECEIPT_POLICY_VERSION,
    planSchema: RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  };
}

/** Reduce the ingested plan to the bounded source summary the result records. */
export function buildActionReceiptSource(ingested: IngestedPlan): ReleaseDecisionActionReceiptSource {
  const facts = ingested.facts;
  return {
    state: sourceStateOf(ingested),
    claimedPlanVerdict: ingested.claimedVerdict,
    planClass: facts ? facts.planClass : null,
    planUrgency: facts ? facts.urgency : null,
    planActionClass: facts ? facts.actionClass : null,
    benignMonitor: facts ? facts.benignMonitor : false,
    sourceTrendVerdict: facts ? facts.sourceTrendVerdict : null,
    blockingActions: facts ? facts.blockingActions : 0,
    advisoryActions: facts ? facts.advisoryActions : 0,
    planStrict: facts ? facts.planStrict : false,
  };
}

/**
 * Fold the ingested plan + the run stamp + the policy into the full {@link ReleaseDecisionActionReceiptResult}. Pure and
 * deterministic.
 */
export function buildActionReceiptResult(
  generatedAt: string,
  ingested: IngestedPlan,
  policy: ReleaseDecisionActionReceiptPolicy,
): ReleaseDecisionActionReceiptResult {
  const source = buildActionReceiptSource(ingested);
  const { rollup, reasons, acknowledgements } = computeReceipt(ingested, policy);

  return {
    schema: RELEASE_DECISION_ACTION_RECEIPT_SCHEMA,
    generatedAt,
    metadata: buildActionReceiptMetadata(),
    policy,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    planClass: rollup.planClass,
    source,
    actionReceipt: rollup,
    acknowledgements,
    reasons,
    guidance: RELEASE_DECISION_ACTION_RECEIPT_GUIDANCE,
    caveats: RELEASE_DECISION_ACTION_RECEIPT_CAVEATS,
    receipt: buildActionReceiptReceipt(generatedAt, source, rollup),
  };
}
