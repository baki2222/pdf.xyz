/**
 * The process-wide, injectable sink for cleanup evidence **pipeline** outcomes (Phase 44).
 *
 * A pipeline run folds a raw provider export through two arms and rolls each to a bounded
 * {@link PipelineSeverity} (`./run`). This tiny seam gives each arm's severity the SAME
 * content-free metric contract the rest of the worker path uses: one bounded
 * `worker_cleanup_pipeline_total` sample per arm, sent to a sink that DEFAULTS to a no-op
 * (the honest "not collected") and that a deployment — or a test — can point at a real
 * collector.
 *
 * It is the run-level counter COMPLEMENT to the per-run {@link import("./types").PipelineReceipt}
 * audit record: the receipt answers "what did this composite run resolve to, per arm" for a
 * SIEM; this counter answers "how many pipeline arms, in what severity" for a dashboard/alert
 * (e.g. `worker_cleanup_pipeline_total{severity="breach"} > 0`). It is emission-only: it
 * forwards an already-content-free sample (the bounded arm + severity) — never a handle,
 * filename, object key, bucket, signed URL, endpoint, region, expiry instant, size, or byte.
 *
 * The projector and verifier arms ALSO emit their own metrics (`worker_cleanup_projection_total`,
 * `worker_cleanup_verification_total`) as they run in-process, so a dashboard sees the composite
 * severity here AND the per-stage detail there.
 */

import { cleanupPipelineMetric } from "../../observability/metrics";
import {
  NOOP_METRIC_SINK,
  type WorkerMetricSink,
} from "../../observability/collector";
import type { PipelineArm, PipelineSeverity } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point cleanup-pipeline metrics at `next` (a collector sink, or a test spy). */
export function setPipelineSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetPipelineSink(): void {
  sink = NOOP_METRIC_SINK;
}

/**
 * Emit one bounded, content-free cleanup-pipeline metric for `arm` at rolled severity
 * `severity`. Never receives a handle, filename, key, bucket, URL, endpoint, region, instant,
 * or byte.
 */
export function recordPipeline(
  arm: PipelineArm,
  severity: PipelineSeverity,
): void {
  sink(cleanupPipelineMetric(arm, severity));
}
