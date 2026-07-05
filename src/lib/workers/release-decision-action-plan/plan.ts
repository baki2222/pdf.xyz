/**
 * Pure, node-free **fold** for the release decision trend action plan (Phase 62).
 *
 * Turns the ingested trend (the trust boundary's output) + the applied policy into the ONE composite
 * {@link ReleaseDecisionActionPlanRollup} — verdict + urgency + action class + exit code — a reviewer acts on, plus the
 * closed set of {@link ReleaseDecisionActionPlanReason} conditions that fired. The base plan is a deterministic mapping
 * over the trend's coverage state + its OWN verdict (fail-closed precedence built into the table), refined by `--strict`:
 *
 *  - untrusted trend input (unreadable / tampered) => `invalid` / `reject-input` / exit 4 (dominates);
 *  - trend verdict `invalid`                        => `block-release` / `restore-evidence` / exit 4;
 *  - trend verdict `blocked`                        => `block-release` / `block-and-reconcile` / exit 4;
 *  - trend verdict `insufficient`                   => `investigate` / `restore-evidence` / exit 2;
 *  - trend verdict `degrading`                      => `monitor` / `stabilize-regression` / exit 3;
 *  - trend verdict `watch`                          => `monitor` / `review-followups` / exit 3;
 *  - trend verdict `improving`                      => `monitor` / `monitor-next-window` / exit 0 (BENIGN monitor);
 *  - trend verdict `stable`                         => `clear` / `none` / exit 0.
 *
 * `--strict` escalates a non-clear MONITOR / INVESTIGATE plan to `block-release` (critical / `block-and-reconcile`), a
 * hard `all-clear or block` gate; it leaves `clear` (never fabricates approval), `block-release`, and `invalid` alone.
 * When that escalation is the reason for the block, `strictEscalated` is set and `strictEscalatedFrom` records the plan
 * verdict it would have been, so the summary explains it.
 */

import type { IngestedTrend } from "./ingest";
import {
  RELEASE_DECISION_ACTION_PLAN_EXIT,
  RELEASE_DECISION_ACTION_PLAN_REASON_DETAIL,
  RELEASE_DECISION_ACTION_PLAN_REASON_IDS,
  RELEASE_DECISION_ACTION_PLAN_STRICT_ESCALATED_SUMMARY,
  RELEASE_DECISION_ACTION_PLAN_VERDICT_SUMMARY,
  type ReleaseDecisionActionPlanActionClass,
  type ReleaseDecisionActionPlanExitCode,
  type ReleaseDecisionActionPlanPolicy,
  type ReleaseDecisionActionPlanReason,
  type ReleaseDecisionActionPlanReasonId,
  type ReleaseDecisionActionPlanRollup,
  type ReleaseDecisionActionPlanSourceState,
  type ReleaseDecisionActionPlanUrgency,
  type ReleaseDecisionActionPlanVerdict,
  type ReleaseDecisionTrendVerdict,
} from "./types";

/** The bounded base plan a source posture maps onto (before `--strict`). */
interface BasePlan {
  readonly verdict: ReleaseDecisionActionPlanVerdict;
  readonly urgency: ReleaseDecisionActionPlanUrgency;
  readonly actionClass: ReleaseDecisionActionPlanActionClass;
  /** The primary fired reason for this posture, or `null` for a clean stable trend (no reason). */
  readonly reason: ReleaseDecisionActionPlanReasonId | null;
  /** True iff this is a benign `monitor` (an improving trend) — a `monitor` verdict at exit `0`. */
  readonly benignMonitor: boolean;
}

/** The base plan for a usable trend, keyed by the trend's OWN verdict. */
const BASE_FOR_TREND_VERDICT: Record<ReleaseDecisionTrendVerdict, BasePlan> = {
  invalid: {
    verdict: "block-release",
    urgency: "critical",
    actionClass: "restore-evidence",
    reason: "trend-invalid",
    benignMonitor: false,
  },
  blocked: {
    verdict: "block-release",
    urgency: "critical",
    actionClass: "block-and-reconcile",
    reason: "trend-blocked",
    benignMonitor: false,
  },
  insufficient: {
    verdict: "investigate",
    urgency: "medium",
    actionClass: "restore-evidence",
    reason: "trend-insufficient",
    benignMonitor: false,
  },
  degrading: {
    verdict: "monitor",
    urgency: "high",
    actionClass: "stabilize-regression",
    reason: "trend-degrading",
    benignMonitor: false,
  },
  watch: {
    verdict: "monitor",
    urgency: "medium",
    actionClass: "review-followups",
    reason: "trend-watch",
    benignMonitor: false,
  },
  improving: {
    verdict: "monitor",
    urgency: "low",
    actionClass: "monitor-next-window",
    reason: "trend-improving",
    benignMonitor: true,
  },
  stable: {
    verdict: "clear",
    urgency: "none",
    actionClass: "none",
    reason: null,
    benignMonitor: false,
  },
};

/** The base plan for an untrusted trend input, keyed by the (non-usable) source coverage state. */
const BASE_FOR_UNTRUSTED: Record<"unreadable" | "tampered", BasePlan> = {
  unreadable: {
    verdict: "invalid",
    urgency: "critical",
    actionClass: "reject-input",
    reason: "trend-unreadable",
    benignMonitor: false,
  },
  tampered: {
    verdict: "invalid",
    urgency: "critical",
    actionClass: "reject-input",
    reason: "trend-tampered",
    benignMonitor: false,
  },
};

/** The coverage state of the ingested trend from its recognized / usable flags. */
export function sourceState(ingested: IngestedTrend): ReleaseDecisionActionPlanSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The base plan for an ingested trend — its coverage state, then (when usable) its own verdict. */
function basePlanOf(ingested: IngestedTrend): BasePlan {
  const state = sourceState(ingested);
  if (state === "unreadable") return BASE_FOR_UNTRUSTED.unreadable;
  if (state === "tampered") return BASE_FOR_UNTRUSTED.tampered;
  // Usable ⇒ facts.verdict is trusted.
  return BASE_FOR_TREND_VERDICT[ingested.facts!.verdict];
}

/** The exit code for a resolved plan verdict + benign flag. */
function exitFor(
  verdict: ReleaseDecisionActionPlanVerdict,
  benignMonitor: boolean,
): ReleaseDecisionActionPlanExitCode {
  switch (verdict) {
    case "clear":
      return RELEASE_DECISION_ACTION_PLAN_EXIT.CLEAR;
    case "monitor":
      return benignMonitor
        ? RELEASE_DECISION_ACTION_PLAN_EXIT.CLEAR
        : RELEASE_DECISION_ACTION_PLAN_EXIT.FOLLOWUP;
    case "investigate":
      return RELEASE_DECISION_ACTION_PLAN_EXIT.INVESTIGATE;
    case "block-release":
    case "invalid":
      return RELEASE_DECISION_ACTION_PLAN_EXIT.BLOCK;
  }
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionActionPlanReasonId[],
): ReleaseDecisionActionPlanReason[] {
  return RELEASE_DECISION_ACTION_PLAN_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_ACTION_PLAN_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_ACTION_PLAN_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite plan rollup + fired reasons from the ingested trend under the policy. The base plan is the
 * fail-closed mapping above; `--strict` escalates a non-clear MONITOR / INVESTIGATE plan to `block-release`.
 */
export function computeActionPlan(
  ingested: IngestedTrend,
  policy: ReleaseDecisionActionPlanPolicy,
): { rollup: ReleaseDecisionActionPlanRollup; reasons: ReleaseDecisionActionPlanReason[] } {
  const base = basePlanOf(ingested);

  // `--strict` escalates a non-clear MONITOR / INVESTIGATE plan to block-release. `clear` (never fabricate approval),
  // `block-release`, and `invalid` are untouched.
  const canEscalate = base.verdict === "monitor" || base.verdict === "investigate";
  const strictEscalated = policy.strict && canEscalate;
  const strictEscalatedFrom: "monitor" | "investigate" | null = strictEscalated
    ? (base.verdict as "monitor" | "investigate")
    : null;

  const verdict: ReleaseDecisionActionPlanVerdict = strictEscalated ? "block-release" : base.verdict;
  const urgency: ReleaseDecisionActionPlanUrgency = strictEscalated ? "critical" : base.urgency;
  const actionClass: ReleaseDecisionActionPlanActionClass = strictEscalated
    ? "block-and-reconcile"
    : base.actionClass;
  const benignMonitor = base.benignMonitor && !strictEscalated;

  // The fired reasons: the base posture reason (if any) + the strict-escalation reason (if it fired).
  const firedIds: ReleaseDecisionActionPlanReasonId[] = [];
  if (base.reason !== null) firedIds.push(base.reason);
  if (strictEscalated) firedIds.push("strict-escalation");
  const reasons = buildReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;

  const detail = strictEscalatedFrom
    ? RELEASE_DECISION_ACTION_PLAN_STRICT_ESCALATED_SUMMARY[strictEscalatedFrom]
    : RELEASE_DECISION_ACTION_PLAN_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionActionPlanRollup = {
    verdict,
    urgency,
    actionClass,
    exitCode: exitFor(verdict, benignMonitor),
    clear: verdict === "clear",
    benignMonitor,
    reasons: orderedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict: policy.strict,
    strictEscalated,
    strictEscalatedFrom,
    detail,
  };
  return { rollup, reasons };
}
