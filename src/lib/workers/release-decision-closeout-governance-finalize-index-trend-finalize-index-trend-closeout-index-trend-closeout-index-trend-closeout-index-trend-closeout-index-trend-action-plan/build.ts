/**
 * Pure, node-free **composer** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend action plan result (Phase 102).
 *
 * It takes the ingested trend the trust boundary produced, the run's stamp, and the applied policy, and folds them into
 * one stable {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult}: it summarizes the bounded
 * source, folds the composite plan verdict + reasons (`./actions`), derives the ordered next-action checklist + its
 * compact id view (`./actions`), surfaces the trusted source trend verdict / class / arc / latest closeout-index
 * posture, and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist are in canonical order, no field is a raw value from the input, and every fact is
 * a bounded enum / small integer / boolean — so the same ingested trend + stamp + policy always produce a byte-identical
 * result. Honesty: the source summary reports the CLAIM (untrusted when tampered), while the plan rollup resolves the
 * verdict — so a tampered / blocked / inconclusive trend never yields a clear plan.
 */

import { buildActions, computeActionPlan, sourceState } from "./actions";
import { buildCloseoutIndexTrendActionPlanReceipt } from "./receipt";
import type { IngestedCloseoutIndexTrend } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanMetadata,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream closeout-index-trend schema). */
export function buildCloseoutIndexTrendActionPlanMetadata(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_VERSION,
    trendSchema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
  };
}

/** Reduce the ingested trend to the bounded source summary the result records. */
export function buildCloseoutIndexTrendActionPlanSource(
  ingested: IngestedCloseoutIndexTrend,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSource {
  const facts = ingested.facts;
  return {
    state: sourceState(ingested),
    claimedVerdict: ingested.verdict,
    indexesConsidered: facts ? facts.indexesConsidered : 0,
    indexesUsable: facts ? facts.indexesUsable : 0,
    totalCloseouts: facts ? facts.totalCloseouts : 0,
    sourceStrictOpen: facts ? facts.strictOpen : false,
  };
}

/**
 * Fold the ingested trend + the run stamp + the policy into the full
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult}. Pure and deterministic.
 */
export function buildCloseoutIndexTrendActionPlanResult(
  generatedAt: string,
  ingested: IngestedCloseoutIndexTrend,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult {
  const source = buildCloseoutIndexTrendActionPlanSource(ingested);
  const { rollup, reasons } = computeActionPlan(ingested, policy);
  const built = buildActions(rollup.reasons, policy.maxActions);
  const plan = built.items;
  const nextActions = plan.map((item) => item.id);
  const facts = ingested.facts;
  const sourceLatestIndex = facts ? facts.latest : null;

  return {
    schema: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SCHEMA,
    generatedAt,
    metadata: buildCloseoutIndexTrendActionPlanMetadata(),
    policy,
    verdict: rollup.verdict,
    urgency: rollup.urgency,
    actionClass: rollup.actionClass,
    exitCode: rollup.exitCode,
    // The surfaced source trend facets are the TRUSTED ones (null when not usable); the untrusted CLAIM lives in
    // `source.claimedVerdict`, so a tampered trend never surfaces a trusted-looking verdict / class / arc / latest.
    sourceTrendVerdict: facts ? facts.verdict : null,
    sourceTrendClass: facts ? facts.trendClass : null,
    sourceArcDirection: facts ? facts.direction : null,
    sourceLatestIndex,
    source,
    actionPlan: rollup,
    reasons,
    plan,
    nextActions,
    maxActions: policy.maxActions,
    actionsConsidered: built.considered,
    actionsDropped: built.dropped,
    guidance: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_CAVEATS,
    receipt: buildCloseoutIndexTrendActionPlanReceipt(generatedAt, source, rollup, plan.length, built.dropped, sourceLatestIndex),
  };
}
