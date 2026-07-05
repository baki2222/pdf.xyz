/**
 * Pure, node-free **composer** for the release decision closeout index trend action plan result (Phase 67).
 *
 * It takes the ingested trend the trust boundary produced, the run's stamp, and the applied policy, and folds them into
 * one stable {@link ReleaseDecisionCloseoutActionPlanResult}: it summarizes the bounded source, folds the composite plan
 * verdict + reasons (`./actions`), derives the ordered next-action checklist (`./actions`), surfaces the trusted source
 * trend verdict / class / arc / latest index posture, and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist are in canonical order, no field is a raw value from the input, and every fact is
 * a bounded enum / small integer / boolean — so the same ingested trend + stamp + policy always produce a byte-identical
 * result. Honesty: the source summary reports the CLAIM (untrusted when tampered), while the plan rollup resolves the
 * verdict — so a tampered / blocked / incomplete trend never yields a clear plan.
 */

import { buildActions, computeCloseoutActionPlan, sourceState } from "./actions";
import { buildCloseoutActionPlanReceipt } from "./receipt";
import type { IngestedCloseoutTrend } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_CAVEATS,
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_GUIDANCE,
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION,
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA,
  type ReleaseDecisionCloseoutActionPlanMetadata,
  type ReleaseDecisionCloseoutActionPlanPolicy,
  type ReleaseDecisionCloseoutActionPlanResult,
  type ReleaseDecisionCloseoutActionPlanSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream closeout-index-trend schema). */
export function buildCloseoutActionPlanMetadata(): ReleaseDecisionCloseoutActionPlanMetadata {
  return {
    schemaVersion: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION,
    policyId: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION,
    trendSchema: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA,
  };
}

/** Reduce the ingested trend to the bounded source summary the result records. */
export function buildCloseoutActionPlanSource(
  ingested: IngestedCloseoutTrend,
): ReleaseDecisionCloseoutActionPlanSource {
  const facts = ingested.facts;
  return {
    state: sourceState(ingested),
    claimedVerdict: ingested.verdict,
    windowsConsidered: facts ? facts.windowsConsidered : 0,
    windowsUsable: facts ? facts.windowsUsable : 0,
    totalCloseouts: facts ? facts.totalCloseouts : 0,
    sourceStrictWatch: facts ? facts.strictWatch : false,
  };
}

/**
 * Fold the ingested trend + the run stamp + the policy into the full {@link ReleaseDecisionCloseoutActionPlanResult}.
 * Pure and deterministic.
 */
export function buildCloseoutActionPlanResult(
  generatedAt: string,
  ingested: IngestedCloseoutTrend,
  policy: ReleaseDecisionCloseoutActionPlanPolicy,
): ReleaseDecisionCloseoutActionPlanResult {
  const source = buildCloseoutActionPlanSource(ingested);
  const { rollup, reasons } = computeCloseoutActionPlan(ingested, policy);
  const actions = buildActions(rollup.reasons);
  const facts = ingested.facts;
  const sourceLatestIndex = facts ? facts.latest : null;

  return {
    schema: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SCHEMA,
    generatedAt,
    metadata: buildCloseoutActionPlanMetadata(),
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
    closeoutActionPlan: rollup,
    reasons,
    actions,
    guidance: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_GUIDANCE,
    caveats: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_CAVEATS,
    receipt: buildCloseoutActionPlanReceipt(generatedAt, source, rollup, actions.length, sourceLatestIndex),
  };
}
