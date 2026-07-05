/**
 * Pure, node-free **fold + action checklist** for the release decision closeout governance index trend action plan
 * (Phase 72).
 *
 * Two responsibilities, both deterministic over the ingested trend (the trust boundary's output) + the applied policy:
 *  1. {@link computeGovernanceActionPlan} folds the trend's coverage state + its OWN verdict into the ONE composite
 *     {@link ReleaseDecisionCloseoutGovernanceActionPlanRollup} — verdict + urgency + action class + exit code — a
 *     reviewer acts on, plus the closed set of {@link ReleaseDecisionCloseoutGovernanceActionPlanReason} conditions that
 *     fired. The base plan is a fail-closed mapping over the trend's coverage state + verdict, refined by
 *     `--strict-watch`:
 *
 *       - untrusted trend input (unreadable / tampered) => `block-release` / `reject-input` / exit 4 (dominates);
 *       - trend verdict `trend-blocked`                 => `block-release` / `block-and-reconcile` / exit 4;
 *       - trend verdict `trend-watch`                   => `monitor` / `monitor-followups` / exit 3;
 *       - trend verdict `trend-incomplete`              => `investigate` / `complete-evidence` / exit 2;
 *       - trend verdict `trend-stable`                  => `clear` / `none` / exit 0.
 *
 *     `--strict-watch` escalates a `monitor` plan to `block-release` (critical / `block-and-reconcile`), a hard
 *     `consistently closed or block` gate; it leaves `clear` (never fabricates approval), `investigate`, and
 *     `block-release` alone. When that escalation is the reason for the block, `strictWatchEscalated` is set and
 *     `strictWatchEscalatedFrom` records the plan verdict it would have been.
 *  2. {@link buildActions} derives the ordered, deduped next-action checklist from the fired reasons. Each emitted item
 *     is a stable id + a label from the authored allowlist + bounded urgency / expectation enums + a boolean — never
 *     free-form raw source text. Every plan ends with `keep-action-plan` (the honesty disclosure step).
 */

import type { IngestedGovernanceTrend } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_STRICT_WATCH_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutGovernanceActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceActionPlanActionId,
  type ReleaseDecisionCloseoutGovernanceActionPlanItem,
  type ReleaseDecisionCloseoutGovernanceActionPlanPolicy,
  type ReleaseDecisionCloseoutGovernanceActionPlanReason,
  type ReleaseDecisionCloseoutGovernanceActionPlanReasonId,
  type ReleaseDecisionCloseoutGovernanceActionPlanRollup,
  type ReleaseDecisionCloseoutGovernanceActionPlanSourceState,
  type ReleaseDecisionCloseoutGovernanceActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
} from "./types";

/** The bounded base plan a source posture maps onto (before `--strict-watch`). */
interface BasePlan {
  readonly verdict: ReleaseDecisionCloseoutGovernanceActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutGovernanceActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutGovernanceActionPlanActionClass;
  /** The primary fired reason for this posture (always exactly one, keyed by state / verdict). */
  readonly reason: ReleaseDecisionCloseoutGovernanceActionPlanReasonId;
}

/** The base plan for a usable trend, keyed by the trend's OWN verdict. */
const BASE_FOR_TREND_VERDICT: Record<ReleaseDecisionCloseoutGovernanceIndexTrendVerdict, BasePlan> = {
  "trend-blocked": {
    verdict: "block-release",
    urgency: "critical",
    actionClass: "block-and-reconcile",
    reason: "trend-blocked",
  },
  "trend-watch": {
    verdict: "monitor",
    urgency: "high",
    actionClass: "monitor-followups",
    reason: "trend-watch",
  },
  "trend-incomplete": {
    verdict: "investigate",
    urgency: "medium",
    actionClass: "complete-evidence",
    reason: "trend-incomplete",
  },
  "trend-stable": {
    verdict: "clear",
    urgency: "none",
    actionClass: "none",
    reason: "trend-stable",
  },
};

/** The base plan for an untrusted trend input, keyed by the (non-usable) source coverage state. */
const BASE_FOR_UNTRUSTED: Record<"unreadable" | "tampered", BasePlan> = {
  unreadable: {
    verdict: "block-release",
    urgency: "critical",
    actionClass: "reject-input",
    reason: "trend-unreadable",
  },
  tampered: {
    verdict: "block-release",
    urgency: "critical",
    actionClass: "reject-input",
    reason: "trend-tampered",
  },
};

/** The coverage state of the ingested trend from its recognized / usable flags. */
export function sourceState(
  ingested: IngestedGovernanceTrend,
): ReleaseDecisionCloseoutGovernanceActionPlanSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The base plan for an ingested trend — its coverage state, then (when usable) its own verdict. */
function basePlanOf(ingested: IngestedGovernanceTrend): BasePlan {
  const state = sourceState(ingested);
  if (state === "unreadable") return BASE_FOR_UNTRUSTED.unreadable;
  if (state === "tampered") return BASE_FOR_UNTRUSTED.tampered;
  // Usable ⇒ facts.verdict is trusted.
  return BASE_FOR_TREND_VERDICT[ingested.facts!.verdict];
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceActionPlanReasonId[],
): ReleaseDecisionCloseoutGovernanceActionPlanReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_REASON_IDS.filter((id) => fired.includes(id)).map(
    (id) => ({
      id,
      severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_REASON_DETAIL[id].severity,
      detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_REASON_DETAIL[id].detail,
    }),
  );
}

/**
 * Compute the composite plan rollup + fired reasons from the ingested trend under the policy. The base plan is the
 * fail-closed mapping above; `--strict-watch` escalates a `monitor` plan to `block-release`.
 */
export function computeGovernanceActionPlan(
  ingested: IngestedGovernanceTrend,
  policy: ReleaseDecisionCloseoutGovernanceActionPlanPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceActionPlanRollup;
  reasons: ReleaseDecisionCloseoutGovernanceActionPlanReason[];
} {
  const base = basePlanOf(ingested);

  // `--strict-watch` escalates a `monitor` plan to block-release. `clear` (never fabricate approval), `investigate`, and
  // `block-release` are untouched.
  const strictWatchEscalated = policy.strictWatch && base.verdict === "monitor";
  const strictWatchEscalatedFrom: "monitor" | null = strictWatchEscalated ? "monitor" : null;

  const verdict: ReleaseDecisionCloseoutGovernanceActionPlanVerdict = strictWatchEscalated
    ? "block-release"
    : base.verdict;
  const urgency: ReleaseDecisionCloseoutGovernanceActionPlanUrgency = strictWatchEscalated
    ? "critical"
    : base.urgency;
  const actionClass: ReleaseDecisionCloseoutGovernanceActionPlanActionClass = strictWatchEscalated
    ? "block-and-reconcile"
    : base.actionClass;

  // The fired reasons: the base posture reason + the strict-watch-escalation reason (if it fired).
  const firedIds: ReleaseDecisionCloseoutGovernanceActionPlanReasonId[] = [base.reason];
  if (strictWatchEscalated) firedIds.push("strict-watch-escalation");
  const reasons = buildReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;
  const incompletes = reasons.filter((r) => r.severity === "incomplete").length;
  const informationals = reasons.filter((r) => r.severity === "informational").length;

  const detail = strictWatchEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_STRICT_WATCH_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceActionPlanRollup = {
    verdict,
    urgency,
    actionClass,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_EXIT_FOR_VERDICT[verdict],
    clear: verdict === "clear",
    reasons: orderedIds,
    blocking,
    advisories,
    incompletes,
    informationals,
    strictWatch: policy.strictWatch,
    strictWatchEscalated,
    strictWatchEscalatedFrom,
    detail,
  };
  return { rollup, reasons };
}

/* ------------------------------------------------------------------ *
 *  The next-action checklist
 * ------------------------------------------------------------------ */

/**
 * Which action ids each fired reason recommends. The final checklist is the ordered, deduped union of these (in
 * canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_IDS} order) plus a trailing
 * `keep-action-plan`. A clean stable trend recommends `continue-governance-cadence`; the mapping is a superset union, so
 * a `--strict-watch` escalation folds the block-release actions (`hold-promotion`, `re-summarize-after-fix`) on top of
 * the watch posture's action.
 */
const REASON_ACTIONS: Record<
  ReleaseDecisionCloseoutGovernanceActionPlanReasonId,
  readonly ReleaseDecisionCloseoutGovernanceActionPlanActionId[]
> = {
  "trend-unreadable": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-tampered": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-blocked": ["reconcile-blocked-history", "hold-promotion", "re-summarize-after-fix"],
  "strict-watch-escalation": ["hold-promotion", "re-summarize-after-fix"],
  "trend-watch": ["track-watch-history", "re-summarize-after-fix"],
  "trend-incomplete": ["complete-incomplete-history", "re-summarize-after-fix"],
  "trend-stable": ["continue-governance-cadence"],
};

/** Materialize one action id into its bounded item (label + urgency + expectation + blocking). */
function toItem(
  id: ReleaseDecisionCloseoutGovernanceActionPlanActionId,
): ReleaseDecisionCloseoutGovernanceActionPlanItem {
  const detail = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_DETAIL[id];
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
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_IDS} order; every plan ends with `keep-action-plan` (the
 * honesty disclosure step). The set is small and bounded by construction, so there is no cap to surface.
 */
export function buildActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceActionPlanReasonId[],
): ReleaseDecisionCloseoutGovernanceActionPlanItem[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceActionPlanActionId>();
  for (const id of fired) for (const action of REASON_ACTIONS[id]) wanted.add(action);
  wanted.add("keep-action-plan"); // always the last step — keep the content-free follow-up record
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_IDS.filter((id) => wanted.has(id)).map(toItem);
}
