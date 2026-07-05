/**
 * Pure, node-free **composer** for the release decision trend action plan result (Phase 62).
 *
 * It takes the ingested trend the trust boundary produced, the run's stamp, and the applied policy, and folds them into
 * one stable {@link ReleaseDecisionActionPlanResult}: it summarizes the bounded source, folds the composite plan verdict
 * + reasons (`./plan`), derives the ordered next-action checklist under the `--max-actions` cap (`./actions`), surfaces
 * the trusted source trend verdict / class / arc, and flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist are in canonical order, no field is a raw value from the input, and every fact
 * is a bounded enum / small integer / boolean — so the same ingested trend + stamp + policy always produce a
 * byte-identical result. Honesty: the source summary reports the CLAIM (untrusted when tampered), while the plan rollup
 * resolves the verdict — so a tampered / blocked / insufficient trend never yields a clear plan.
 */

import { buildActions } from "./actions";
import { computeActionPlan, sourceState } from "./plan";
import { buildActionPlanReceipt } from "./receipt";
import type { IngestedTrend } from "./ingest";
import {
  RELEASE_DECISION_ACTION_PLAN_CAVEATS,
  RELEASE_DECISION_ACTION_PLAN_GUIDANCE,
  RELEASE_DECISION_ACTION_PLAN_POLICY_ID,
  RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION,
  RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_TREND_SCHEMA,
  type ReleaseDecisionActionPlanMetadata,
  type ReleaseDecisionActionPlanPolicy,
  type ReleaseDecisionActionPlanResult,
  type ReleaseDecisionActionPlanSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream trend schema). */
export function buildActionPlanMetadata(): ReleaseDecisionActionPlanMetadata {
  return {
    schemaVersion: RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION,
    policyId: RELEASE_DECISION_ACTION_PLAN_POLICY_ID,
    policyVersion: RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION,
    trendSchema: RELEASE_DECISION_TREND_SCHEMA,
  };
}

/** Reduce the ingested trend to the bounded source summary the result records. */
export function buildActionPlanSource(ingested: IngestedTrend): ReleaseDecisionActionPlanSource {
  const facts = ingested.facts;
  return {
    state: sourceState(ingested),
    claimedVerdict: ingested.verdict,
    windowsConsidered: facts ? facts.windowsConsidered : 0,
    windowsUsable: facts ? facts.windowsUsable : 0,
    totalRecords: facts ? facts.totalRecords : 0,
    sourceStrict: facts ? facts.strict : false,
  };
}

/**
 * Fold the ingested trend + the run stamp + the policy into the full {@link ReleaseDecisionActionPlanResult}. Pure and
 * deterministic.
 */
export function buildActionPlanResult(
  generatedAt: string,
  ingested: IngestedTrend,
  policy: ReleaseDecisionActionPlanPolicy,
): ReleaseDecisionActionPlanResult {
  const source = buildActionPlanSource(ingested);
  const { rollup, reasons } = computeActionPlan(ingested, policy);
  const actions = buildActions(rollup.reasons, policy.maxActions);
  const facts = ingested.facts;

  return {
    schema: RELEASE_DECISION_ACTION_PLAN_SCHEMA,
    generatedAt,
    metadata: buildActionPlanMetadata(),
    policy,
    verdict: rollup.verdict,
    urgency: rollup.urgency,
    actionClass: rollup.actionClass,
    exitCode: rollup.exitCode,
    // The surfaced source trend facets are the TRUSTED ones (null when not usable); the untrusted CLAIM lives in
    // `source.claimedVerdict`, so a tampered trend never surfaces a trusted-looking verdict / class / arc.
    sourceTrendVerdict: facts ? facts.verdict : null,
    sourceTrendClass: facts ? facts.trendClass : null,
    sourceArcDirection: facts ? facts.direction : null,
    source,
    plan: rollup,
    reasons,
    actions: actions.items,
    guidance: RELEASE_DECISION_ACTION_PLAN_GUIDANCE,
    caveats: RELEASE_DECISION_ACTION_PLAN_CAVEATS,
    receipt: buildActionPlanReceipt(generatedAt, source, rollup, actions),
  };
}
