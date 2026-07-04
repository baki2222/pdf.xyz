/**
 * The process-wide, injectable sink for **release decision index trend summary** outcomes (Phase 61).
 *
 * Summarizing a bounded history of decision-index windows folds their index verdicts into one final
 * {@link ReleaseDecisionTrendVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free metric
 * contract the rest of the worker path uses: one bounded `worker_release_decision_trend_total` sample per trend, sent
 * to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at a
 * real collector.
 *
 * It is the run-level counter for the decision-index trend: it answers "how many decision-index trends were composed,
 * in what verdict" for a governance dashboard (e.g. `worker_release_decision_trend_total{verdict="blocked"} > 0`
 * catches a blocked / invalid window in the history, `{verdict="degrading"} > 0` catches a worsening arc,
 * `{verdict="invalid"} > 0` catches an untrustworthy window). It is emission-only: it forwards an already-content-free
 * sample (the bounded verdict) — never a reason id, a count, a reviewer identity, a filename, path, or byte.
 */

import { releaseDecisionTrendMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionTrendVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-trend metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionTrendSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionTrendSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-trend metric for final `verdict`. */
export function recordReleaseDecisionTrend(verdict: ReleaseDecisionTrendVerdict): void {
  sink(releaseDecisionTrendMetric(verdict));
}
