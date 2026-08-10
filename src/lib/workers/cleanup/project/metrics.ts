/**
 * The process-wide, injectable sink for **cleanup evidence PROJECTION** outcomes (Phase 43).
 *
 * A projection run folds a raw provider export to a bounded {@link ProjectionVerdict} for a
 * bounded {@link ProjectionTarget} (`./project`, `./run`). This tiny seam gives that verdict the
 * SAME content-free metric contract the rest of the worker path uses: one bounded
 * `worker_cleanup_projection_total` sample per run, sent to a sink that DEFAULTS to a no-op (the
 * honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter COMPLEMENT to the per-run {@link import("./receipt")} audit record:
 * the receipt answers "what did this run read, drop, and warn about" for a SIEM; this counter
 * answers "how many projection runs, in what verdict, for which target" for a dashboard/alert
 * (e.g. `worker_cleanup_projection_total{verdict="unsafe"} > 0`). It is emission-only: it forwards
 * an already-content-free sample (the bounded target + verdict) — never a handle, filename, object
 * key, bucket, signed URL, endpoint, region, expiry instant, size, or byte.
 */

import { cleanupProjectionMetric } from "../../observability/metrics";
import {
  NOOP_METRIC_SINK,
  type WorkerMetricSink,
} from "../../observability/collector";
import type { ProjectionTarget, ProjectionVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point cleanup-projection metrics at `next` (a collector sink, or a test spy). */
export function setProjectionSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetProjectionSink(): void {
  sink = NOOP_METRIC_SINK;
}

/**
 * Emit one bounded, content-free cleanup-projection metric. `target` is the bounded shape the run
 * projected into; `verdict` is the aggregate outcome. Never receives a handle, filename, key,
 * bucket, URL, endpoint, region, instant, or byte.
 */
export function recordProjection(
  target: ProjectionTarget,
  verdict: ProjectionVerdict,
): void {
  sink(cleanupProjectionMetric(target, verdict));
}
