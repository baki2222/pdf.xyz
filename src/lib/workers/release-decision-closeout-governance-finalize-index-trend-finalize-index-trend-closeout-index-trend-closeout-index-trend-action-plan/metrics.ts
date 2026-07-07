/**
 * The process-wide, injectable sink for **release decision closeout governance finalize index trend finalize index trend
 * closeout index trend action plan** outcomes (Phase 87).
 *
 * Translating a closeout-index trend into an operator follow-up plan folds it into one final
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict} (`./actions`). This tiny seam gives that
 * verdict the SAME content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_action_plan_total` sample per plan, sent to a sink
 * that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at a real
 * collector.
 *
 * It is the run-level counter for the closeout-index-trend action plan: it answers "how many closeout-index trend action
 * plans were composed, in what verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_action_plan_total{verdict="block-release"} > 0`
 * catches a blocked / invalid-history / escalated trend, `{verdict="invalid"} > 0` catches an unreadable / tampered
 * trend input, `{verdict="investigate"} > 0` catches an inconclusive trend, `{verdict="monitor"} > 0` catches a watch /
 * degrading trend). It is emission-only: it forwards an already-content-free sample (the bounded verdict) — never a
 * reason id, an action id, a count, a reviewer identity, a filename, path, or byte.
 */

import { releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-…-closeout-index-trend-action-plan metrics at `next`. */
export function setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free closeout-index-trend action-plan metric for final `verdict`. */
export function recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
): void {
  sink(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanMetric(verdict));
}
