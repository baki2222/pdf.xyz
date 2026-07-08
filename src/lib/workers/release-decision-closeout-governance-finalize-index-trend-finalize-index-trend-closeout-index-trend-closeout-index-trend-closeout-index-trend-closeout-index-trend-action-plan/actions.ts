/**
 * Pure, node-free **fold + action checklist** for the release decision closeout governance finalize index trend finalize
 * index trend closeout index trend action plan (Phase 102).
 *
 * Two responsibilities, both deterministic over the ingested trend (the trust boundary's output) + the applied policy:
 *  1. {@link computeActionPlan} folds the trend's coverage state + its OWN verdict into the ONE composite
 *     {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanRollup} — verdict + urgency + action class +
 *     exit code — a reviewer acts on, plus the closed set of
 *     {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReason} conditions that fired. The base plan is
 *     a fail-closed mapping over the trend's coverage state + verdict:
 *
 *       - untrusted trend input (unreadable / tampered) => `invalid` / `reject-input` / exit 4 (dominates; never weakened);
 *       - trend verdict `invalid` (invalid-history)      => `invalid` / `restore-history` / exit 4 (never weakened);
 *       - trend verdict `blocked`                        => `block-release` / `block-and-reconcile` / exit 4;
 *       - trend verdict `insufficient`                   => `investigate` / `complete-evidence` / exit 2;
 *       - trend verdict `degrading`                      => `monitor` / `stabilize-regression` / exit 3 (high);
 *       - trend verdict `watch`                          => `monitor` / `monitor-followups` / exit 3 (soon);
 *       - trend verdict `improving`                      => `monitor` / `confirm-improvement` / exit 3 (benign, routine);
 *       - trend verdict `stable`                         => `clear` / `none` / exit 0.
 *
 *     `--strict` escalates every non-`clear` plan (`monitor` / `investigate`) to `block-release` (immediate /
 *     `block-and-reconcile`) — a hard gate for a
 *     high-assurance review. Neither ever touches `clear` (never fabricates approval), a base `block-release`, or an
 *     `invalid` input (the fail-closed precedence of an untrustworthy input is never weakened). When a knob is the reason
 *     for the block, its escalation reason fires and `escalatedFrom` records the plan verdict it would have been.
 *  2. {@link buildActions} derives the ordered, deduped next-action checklist from the fired reasons. Each emitted item
 *     is a stable id + a label from the authored allowlist + bounded urgency / expectation enums + a boolean — never
 *     free-form raw source text. Every plan ends with `keep-action-plan` (the honesty disclosure step).
 */

import type { IngestedCloseoutIndexTrend } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanItem,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
} from "./types";

/** The bounded base plan a source posture maps onto (before the `--strict` knob). */
interface BasePlan {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass;
  /** The primary fired reason for this posture (always exactly one, keyed by state / verdict). */
  readonly reason: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId;
}

/** The base plan for a usable trend, keyed by the trend's OWN verdict. */
const BASE_FOR_TREND_VERDICT: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict, BasePlan> = {
  blocked: {
    verdict: "block-release",
    urgency: "immediate",
    actionClass: "block-and-reconcile",
    reason: "trend-blocked",
  },
  invalid: {
    verdict: "invalid",
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
    verdict: "monitor",
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
  ingested: IngestedCloseoutIndexTrend,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The base plan for an ingested trend — its coverage state, then (when usable) its own verdict. */
function basePlanOf(ingested: IngestedCloseoutIndexTrend): BasePlan {
  const state = sourceState(ingested);
  if (state === "unreadable") return BASE_FOR_UNTRUSTED.unreadable;
  if (state === "tampered") return BASE_FOR_UNTRUSTED.tampered;
  // Usable ⇒ facts.verdict is trusted.
  return BASE_FOR_TREND_VERDICT[ingested.facts!.verdict];
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_IDS.filter((id) =>
    fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite plan rollup + fired reasons from the ingested trend under the policy. The base plan is the
 * fail-closed mapping above; `--strict` escalates every non-`clear` MONITOR / INVESTIGATE plan (an improving / watch /
 * degrading / insufficient trend) to `block-release`. It never touches `clear` (a coherent stable trend) or `invalid`
 * (an untrustworthy input / invalid-history trend) — the fail-closed precedence of an untrustworthy input is never
 * weakened, and a stable trend is never fabricated into a block.
 */
export function computeActionPlan(
  ingested: IngestedCloseoutIndexTrend,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanRollup;
  reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReason[];
} {
  const base = basePlanOf(ingested);

  // `--strict` escalates a non-clear MONITOR / INVESTIGATE plan to block-release. `clear` (never fabricate approval),
  // a base `block-release`, and `invalid` (an untrusted input / invalid-history trend) are untouched.
  const canEscalate = base.verdict === "monitor" || base.verdict === "investigate";
  const strictEscalated = policy.strict && canEscalate;
  const escalatedFrom: "monitor" | "investigate" | null = strictEscalated
    ? (base.verdict as "monitor" | "investigate")
    : null;

  const verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict = strictEscalated
    ? "block-release"
    : base.verdict;
  const urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency = strictEscalated
    ? "immediate"
    : base.urgency;
  const actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass = strictEscalated
    ? "block-and-reconcile"
    : base.actionClass;

  // The fired reasons: the base posture reason + the strict-escalation reason (if it fired), in canonical order.
  const firedIds: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId[] = [base.reason];
  if (strictEscalated) firedIds.push("strict-escalation");
  const reasons = buildReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;
  const informationals = reasons.filter((r) => r.severity === "informational").length;

  const detail = escalatedFrom
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ESCALATED_SUMMARY[escalatedFrom]
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanRollup = {
    verdict,
    urgency,
    actionClass,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT_FOR_VERDICT[verdict],
    clear: verdict === "clear",
    reasons: orderedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    informationals,
    strict: policy.strict,
    strictEscalated,
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
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_IDS} order) plus a trailing
 * `keep-action-plan`. The mapping is a superset union, so a `--strict` escalation folds the block-release actions
 * (`hold-promotion`, `re-summarize-after-fix`) on top of the source posture's action.
 */
const REASON_ACTIONS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId[]
> = {
  "trend-unreadable": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-tampered": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-invalid": ["restore-untrusted-history", "hold-promotion", "re-summarize-after-fix"],
  "trend-blocked": ["reconcile-blocked-history", "hold-promotion", "re-summarize-after-fix"],
  "strict-escalation": ["hold-promotion", "re-summarize-after-fix"],
  "trend-insufficient": ["complete-insufficient-history", "re-summarize-after-fix"],
  "trend-degrading": ["investigate-degrading-arc", "re-summarize-after-fix"],
  "trend-watch": ["track-watch-followups", "re-summarize-after-fix"],
  "trend-improving": ["confirm-improvement-sustained"],
  "trend-stable": ["continue-closeout-cadence"],
};

/** Materialize one action id into its bounded item (label + urgency + expectation + blocking). */
function toItem(
  id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanItem {
  const detail = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL[id];
  return {
    id,
    label: detail.label,
    urgency: detail.urgency,
    expectation: detail.expectation,
    blocking: detail.expectation === "must-complete-before-release",
  };
}

/** The bounded outcome of building the checklist: the emitted (capped) items + how many were considered / dropped. */
export interface BuiltActions {
  /** The emitted action items, in canonical order (after the `--max-actions` cap). */
  readonly items: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanItem[];
  /** How many candidate action items the plan derived before the cap. */
  readonly considered: number;
  /** How many candidate action items the `--max-actions` cap dropped (never a silent truncation). */
  readonly dropped: number;
}

/**
 * Derive the ordered, deduped next-action checklist from the fired reasons, then keep the highest-priority `maxActions`
 * in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_IDS} order
 * (surfacing how many were dropped — never a silent truncation). Every plan ends with `keep-action-plan` (the honesty
 * disclosure step) unless the cap drops it. A `maxActions` of 0 or less emits nothing (still surfacing the full
 * considered count) — but the parser guarantees `maxActions >= 1`, so the top-priority action always survives in practice.
 */
export function buildActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId[],
  maxActions: number,
): BuiltActions {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId>();
  for (const id of fired) for (const action of REASON_ACTIONS[id]) wanted.add(action);
  wanted.add("keep-action-plan"); // always the last step — keep the content-free follow-up record

  const ordered = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_IDS.filter(
    (id) => wanted.has(id),
  );
  const cap = Number.isSafeInteger(maxActions) && maxActions > 0 ? maxActions : 0;
  const kept = cap >= ordered.length ? ordered : ordered.slice(0, cap);

  return {
    items: kept.map(toItem),
    considered: ordered.length,
    dropped: ordered.length - kept.length,
  };
}
