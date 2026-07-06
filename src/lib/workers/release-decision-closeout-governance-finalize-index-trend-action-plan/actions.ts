/**
 * Pure, node-free **fold + action checklist** for the release decision closeout governance finalize index trend action
 * plan (Phase 77).
 *
 * Two responsibilities, both deterministic over the ingested trend (the trust boundary's output) + the applied policy:
 *  1. {@link computeActionPlan} folds the trend's coverage state + its OWN verdict into the ONE composite
 *     {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanRollup} — verdict + urgency + action class +
 *     exit code — a reviewer acts on, plus the closed set of
 *     {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReason} conditions that fired. The base plan is
 *     a fail-closed mapping over the trend's coverage state + verdict:
 *
 *       - untrusted trend input (unreadable / tampered) => `invalid` / `reject-input` / exit 4 (dominates; never weakened);
 *       - trend verdict `blocked`                        => `block-release` / `block-and-reconcile` / exit 4;
 *       - trend verdict `invalid`                        => `block-release` / `restore-history` / exit 4;
 *       - trend verdict `insufficient`                   => `investigate` / `complete-evidence` / exit 2;
 *       - trend verdict `degrading`                      => `monitor` / `stabilize-regression` / exit 3 (high);
 *       - trend verdict `watch`                          => `monitor` / `monitor-followups` / exit 3 (soon);
 *       - trend verdict `improving`                      => `clear` / `confirm-improvement` / exit 0;
 *       - trend verdict `stable`                         => `clear` / `none` / exit 0.
 *
 *     `--strict-watch` escalates a `monitor` plan to `block-release` (immediate / `block-and-reconcile`), and
 *     `--require-clean` escalates every non-`clear` plan (`monitor` / `investigate`) to `block-release` — hard gates for a
 *     high-assurance review. Neither ever touches `clear` (never fabricates approval), a base `block-release`, or an
 *     `invalid` input (the fail-closed precedence of an untrustworthy input is never weakened). When a knob is the reason
 *     for the block, its escalation reason fires and `escalatedFrom` records the plan verdict it would have been.
 *  2. {@link buildActions} derives the ordered, deduped next-action checklist from the fired reasons. Each emitted item
 *     is a stable id + a label from the authored allowlist + bounded urgency / expectation enums + a boolean — never
 *     free-form raw source text. Every plan ends with `keep-action-plan` (the honesty disclosure step).
 */

import type { IngestedFinalizeIndexTrend } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanItem,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
} from "./types";

/** The bounded base plan a source posture maps onto (before the `--strict-watch` / `--require-clean` knobs). */
interface BasePlan {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass;
  /** The primary fired reason for this posture (always exactly one, keyed by state / verdict). */
  readonly reason: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReasonId;
}

/** The base plan for a usable trend, keyed by the trend's OWN verdict. */
const BASE_FOR_TREND_VERDICT: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict, BasePlan> = {
  blocked: {
    verdict: "block-release",
    urgency: "immediate",
    actionClass: "block-and-reconcile",
    reason: "trend-blocked",
  },
  invalid: {
    verdict: "block-release",
    urgency: "immediate",
    actionClass: "restore-history",
    reason: "trend-invalid",
  },
  insufficient: {
    verdict: "investigate",
    urgency: "soon",
    actionClass: "complete-evidence",
    reason: "trend-insufficient",
  },
  degrading: {
    verdict: "monitor",
    urgency: "high",
    actionClass: "stabilize-regression",
    reason: "trend-degrading",
  },
  watch: {
    verdict: "monitor",
    urgency: "soon",
    actionClass: "monitor-followups",
    reason: "trend-watch",
  },
  improving: {
    verdict: "clear",
    urgency: "routine",
    actionClass: "confirm-improvement",
    reason: "trend-improving",
  },
  stable: {
    verdict: "clear",
    urgency: "routine",
    actionClass: "none",
    reason: "trend-stable",
  },
};

/** The base plan for an untrusted trend input, keyed by the (non-usable) source coverage state. */
const BASE_FOR_UNTRUSTED: Record<"unreadable" | "tampered", BasePlan> = {
  unreadable: {
    verdict: "invalid",
    urgency: "immediate",
    actionClass: "reject-input",
    reason: "trend-unreadable",
  },
  tampered: {
    verdict: "invalid",
    urgency: "immediate",
    actionClass: "reject-input",
    reason: "trend-tampered",
  },
};

/** The coverage state of the ingested trend from its recognized / usable flags. */
export function sourceState(
  ingested: IngestedFinalizeIndexTrend,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The base plan for an ingested trend — its coverage state, then (when usable) its own verdict. */
function basePlanOf(ingested: IngestedFinalizeIndexTrend): BasePlan {
  const state = sourceState(ingested);
  if (state === "unreadable") return BASE_FOR_UNTRUSTED.unreadable;
  if (state === "tampered") return BASE_FOR_UNTRUSTED.tampered;
  // Usable ⇒ facts.verdict is trusted.
  return BASE_FOR_TREND_VERDICT[ingested.facts!.verdict];
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS.filter((id) =>
    fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite plan rollup + fired reasons from the ingested trend under the policy. The base plan is the
 * fail-closed mapping above; `--strict-watch` escalates a `monitor` plan to `block-release`, and `--require-clean`
 * escalates every non-`clear` plan (`monitor` / `investigate`) to `block-release`.
 */
export function computeActionPlan(
  ingested: IngestedFinalizeIndexTrend,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanRollup;
  reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReason[];
} {
  const base = basePlanOf(ingested);

  // Policy escalations. `--strict-watch` escalates a `monitor` plan; `--require-clean` escalates any non-clear plan
  // (`monitor` / `investigate`). Neither touches `clear`, a base `block-release`, or an `invalid` input.
  const canStrictWatch = base.verdict === "monitor";
  const canRequireClean = base.verdict === "monitor" || base.verdict === "investigate";
  const strictWatchEscalated = policy.strictWatch && canStrictWatch;
  const requireCleanEscalated = policy.requireClean && canRequireClean;
  const escalated = strictWatchEscalated || requireCleanEscalated;
  const escalatedFrom: "monitor" | "investigate" | null = escalated
    ? (base.verdict as "monitor" | "investigate")
    : null;

  const verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict = escalated
    ? "block-release"
    : base.verdict;
  const urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency = escalated
    ? "immediate"
    : base.urgency;
  const actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass = escalated
    ? "block-and-reconcile"
    : base.actionClass;

  // The fired reasons: the base posture reason + whichever escalation reasons fired (emitted in canonical order).
  const firedIds: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReasonId[] = [base.reason];
  if (strictWatchEscalated) firedIds.push("strict-watch-escalation");
  if (requireCleanEscalated) firedIds.push("require-clean-escalation");
  const reasons = buildReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;
  const informationals = reasons.filter((r) => r.severity === "informational").length;

  const detail = escalatedFrom
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ESCALATED_SUMMARY[escalatedFrom]
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanRollup = {
    verdict,
    urgency,
    actionClass,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXIT_FOR_VERDICT[verdict],
    clear: verdict === "clear",
    reasons: orderedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    informationals,
    strictWatch: policy.strictWatch,
    requireClean: policy.requireClean,
    strictWatchEscalated,
    requireCleanEscalated,
    escalatedFrom,
    detail,
  };
  return { rollup, reasons };
}

/* ------------------------------------------------------------------ *
 *  The next-action checklist
 * ------------------------------------------------------------------ */

/**
 * Which action ids each fired reason recommends. The final checklist is the ordered, deduped union of these (in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_IDS} order) plus a trailing
 * `keep-action-plan`. The mapping is a superset union, so a `--strict-watch` / `--require-clean` escalation folds the
 * block-release actions (`hold-promotion`, `re-summarize-after-fix`) on top of the source posture's action.
 */
const REASON_ACTIONS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionId[]
> = {
  "trend-unreadable": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-tampered": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-blocked": ["reconcile-blocked-history", "hold-promotion", "re-summarize-after-fix"],
  "trend-invalid": ["restore-untrusted-history", "hold-promotion", "re-summarize-after-fix"],
  "strict-watch-escalation": ["hold-promotion", "re-summarize-after-fix"],
  "require-clean-escalation": ["hold-promotion", "re-summarize-after-fix"],
  "trend-insufficient": ["complete-insufficient-history", "re-summarize-after-fix"],
  "trend-degrading": ["investigate-degrading-arc", "re-summarize-after-fix"],
  "trend-watch": ["track-watch-followups", "re-summarize-after-fix"],
  "trend-stable": ["continue-finalization-cadence"],
  "trend-improving": ["confirm-improvement-sustained"],
};

/** Materialize one action id into its bounded item (label + urgency + expectation + blocking). */
function toItem(
  id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionId,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanItem {
  const detail = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL[id];
  return {
    id,
    label: detail.label,
    urgency: detail.urgency,
    expectation: detail.expectation,
    blocking: detail.expectation === "must-complete-before-release",
  };
}

/**
 * Derive the ordered, deduped next-action checklist from the fired reasons. Emitted in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_IDS} order; every plan ends with
 * `keep-action-plan` (the honesty disclosure step). The set is small and bounded by construction, so there is no cap to
 * surface.
 */
export function buildActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanItem[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionId>();
  for (const id of fired) for (const action of REASON_ACTIONS[id]) wanted.add(action);
  wanted.add("keep-action-plan"); // always the last step — keep the content-free follow-up record
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_IDS.filter((id) =>
    wanted.has(id),
  ).map(toItem);
}
