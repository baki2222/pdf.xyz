/**
 * The process-wide, injectable sink for **release decision trend action plan** outcomes (Phase 62).
 *
 * Translating a decision-trend summary into an operator follow-up plan folds it into one final
 * {@link ReleaseDecisionActionPlanVerdict} (`./plan`). This tiny seam gives that verdict the SAME content-free metric
 * contract the rest of the worker path uses: one bounded `worker_release_decision_action_plan_total` sample per plan,
 * sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at
 * a real collector.
 *
 * It is the run-level counter for the action plan: it answers "how many decision-trend action plans were composed, in
 * what verdict" for a governance dashboard (e.g. `worker_release_decision_action_plan_total{verdict="block-release"} > 0`
 * catches a blocked / invalid / strict-escalated trend, `{verdict="invalid"} > 0` catches an untrustworthy trend
 * input). It is emission-only: it forwards an already-content-free sample (the bounded verdict) — never a reason id, an
 * action id, a count, a reviewer identity, a filename, path, or byte.
 */

import { releaseDecisionActionPlanMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionActionPlanVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-action-plan metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionActionPlanSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionActionPlanSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-action-plan metric for final `verdict`. */
export function recordReleaseDecisionActionPlan(verdict: ReleaseDecisionActionPlanVerdict): void {
  sink(releaseDecisionActionPlanMetric(verdict));
}
