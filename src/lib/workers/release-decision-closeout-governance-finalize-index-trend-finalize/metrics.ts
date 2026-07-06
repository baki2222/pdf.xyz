/**
 * The process-wide, injectable sink for **release decision closeout governance finalize index trend FINALIZATION record**
 * outcomes (Phase 79).
 *
 * Rolling the finalize-index-trend follow-up loop into one final
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict} (`./reduce`) gives that verdict the SAME
 * content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_total` sample per record, sent to a sink that
 * DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the finalize-index-trend FINALIZATION record: it answers "how many finalize-index-trend
 * follow-up loops were finalized, in what verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_total{verdict="finalize-invalid"} > 0`
 * catches an unreadable / tampered primary receipt or a tampered source; `{verdict="finalize-blocked"} > 0` catches a
 * blocked / invalid receipt verdict, a contradictory record, or a blocked source chain). It is emission-only: it forwards
 * an already-content-free sample (the bounded verdict) — never a reason id, a record kind, a count, a reviewer identity, a
 * filename, path, or byte.
 */

import { releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout-governance-finalize-index-trend-finalize metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-closeout-governance-finalize-index-trend-finalize metric for final `verdict`. */
export function recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
): void {
  sink(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeMetric(verdict));
}
