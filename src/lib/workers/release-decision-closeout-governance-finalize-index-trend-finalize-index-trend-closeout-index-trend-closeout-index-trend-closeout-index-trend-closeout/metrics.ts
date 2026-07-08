/**
 * The process-wide, injectable sink for **release decision closeout governance finalize index trend finalize index trend
 * closeout bundle** outcomes (Phase 94).
 *
 * Composing the closeout-index-trend follow-up loop folds it into one final
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict} (`./reduce`). This tiny
 * seam gives that verdict the SAME content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_trend_closeout_total` sample per
 * closeout, sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can
 * point at a real collector.
 *
 * It is the run-level counter for the closeout: it answers "how many follow-up-loop closeouts were composed, in what
 * verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_trend_closeout_total{verdict="blocked"} > 0`
 * catches a blocked receipt, a contradictory related record, or a blocked source chain; `{verdict="invalid"} > 0` catches
 * a missing / unreadable / tampered receipt). It is emission-only: it forwards an already-content-free sample (the bounded
 * verdict) — never a reason id, a record kind, a count, a reviewer identity, a filename, path, or byte.
 */

import { releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout-…-finalize-index-trend-closeout metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSink(
  next: WorkerMetricSink,
): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free closeout metric for final `verdict`. */
export function recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
): void {
  sink(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutMetric(verdict));
}
