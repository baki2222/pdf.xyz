/**
 * The process-wide, injectable sink for **release evidence trend summary** outcomes (Phase 53).
 *
 * Summarizing a bounded history of operator reports folds their recommendations into one final
 * {@link ReleaseTrendVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free metric
 * contract the rest of the worker path uses: one bounded `worker_release_trend_total` sample per summary, sent
 * to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point
 * at a real collector.
 *
 * It is the run-level counter for the trend summary: it answers "how many release trend summaries were composed,
 * in what verdict" for a governance dashboard (e.g. `worker_release_trend_total{verdict="failing"} > 0` catches
 * a failing recent trend). It is emission-only: it forwards an already-content-free sample (the bounded verdict)
 * — never a reason id, a count, a filename, path, or byte.
 */

import { releaseTrendMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseTrendVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-trend metrics at `next` (a collector sink, or a test spy). */
export function setReleaseTrendSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseTrendSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-trend metric for final `verdict`. */
export function recordReleaseTrend(verdict: ReleaseTrendVerdict): void {
  sink(releaseTrendMetric(verdict));
}
