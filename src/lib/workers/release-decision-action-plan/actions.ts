/**
 * Pure, node-free **action checklist** builder for the release decision trend action plan (Phase 62).
 *
 * Derives the ordered, deduped next-action checklist from the fired reasons, then applies the `--max-actions` cap
 * (keeping the highest-priority N in canonical {@link RELEASE_DECISION_ACTION_PLAN_ACTION_IDS} order, and surfacing how
 * many were dropped — never a silent truncation). Each emitted item is a stable id + a label from the authored
 * allowlist + bounded urgency / expectation enums + a boolean — never free-form raw source text.
 *
 * A clean stable trend (no fired reasons) recommends `continue-decision-cadence`; every plan ends with
 * `keep-action-plan` (the honesty disclosure step). The mapping is a superset union, so a `--strict` escalation folds
 * the block-release actions (`hold-promotion`, `re-summarize-after-fix`) on top of the source posture's action.
 */

import {
  RELEASE_DECISION_ACTION_PLAN_ACTION_DETAIL,
  RELEASE_DECISION_ACTION_PLAN_ACTION_IDS,
  type ReleaseDecisionActionPlanActionId,
  type ReleaseDecisionActionPlanItem,
  type ReleaseDecisionActionPlanReasonId,
} from "./types";

/**
 * Which action ids each fired reason recommends. The final checklist is the ordered, deduped union of these (in
 * canonical {@link RELEASE_DECISION_ACTION_PLAN_ACTION_IDS} order) plus a trailing `keep-action-plan`. A clean stable
 * trend (no reasons) recommends `continue-decision-cadence`.
 */
const REASON_ACTIONS: Record<
  ReleaseDecisionActionPlanReasonId,
  readonly ReleaseDecisionActionPlanActionId[]
> = {
  "trend-unreadable": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-tampered": ["reject-and-recover-trend", "hold-promotion", "re-summarize-after-fix"],
  "trend-blocked": ["reconcile-blocked-window", "hold-promotion", "re-summarize-after-fix"],
  "trend-invalid": ["restore-flagged-window", "hold-promotion", "re-summarize-after-fix"],
  "strict-escalation": ["hold-promotion", "re-summarize-after-fix"],
  "trend-insufficient": ["complete-insufficient-evidence", "re-summarize-after-fix"],
  "trend-degrading": ["investigate-degrading-arc", "re-summarize-after-fix"],
  "trend-watch": ["track-watch-followups"],
  "trend-improving": ["confirm-improvement-sustained"],
};

/** Materialize one action id into its bounded item (label + urgency + expectation + blocking). */
function toItem(id: ReleaseDecisionActionPlanActionId): ReleaseDecisionActionPlanItem {
  const detail = RELEASE_DECISION_ACTION_PLAN_ACTION_DETAIL[id];
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
  readonly items: readonly ReleaseDecisionActionPlanItem[];
  /** How many candidate action items the plan derived before the cap. */
  readonly considered: number;
  /** How many candidate action items the `--max-actions` cap dropped (never a silent truncation). */
  readonly dropped: number;
}

/**
 * Derive the ordered, deduped next-action checklist from the fired reasons, then keep the highest-priority `maxActions`.
 * A `maxActions` of 0 or less emits nothing (still surfacing the full considered count) — but the parser guarantees
 * `maxActions >= 1`, so at least the top-priority action always survives in practice.
 */
export function buildActions(
  fired: readonly ReleaseDecisionActionPlanReasonId[],
  maxActions: number,
): BuiltActions {
  const wanted = new Set<ReleaseDecisionActionPlanActionId>();
  for (const id of fired) for (const action of REASON_ACTIONS[id]) wanted.add(action);
  if (fired.length === 0) wanted.add("continue-decision-cadence"); // a clean stable trend
  wanted.add("keep-action-plan"); // always the last step — keep the content-free follow-up record

  const ordered = RELEASE_DECISION_ACTION_PLAN_ACTION_IDS.filter((id) => wanted.has(id));
  const cap = Number.isSafeInteger(maxActions) && maxActions > 0 ? maxActions : 0;
  const kept = cap >= ordered.length ? ordered : ordered.slice(0, cap);

  return {
    items: kept.map(toItem),
    considered: ordered.length,
    dropped: ordered.length - kept.length,
  };
}
