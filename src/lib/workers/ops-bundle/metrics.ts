/**
 * The process-wide, injectable sink for **operations evidence bundle** outcomes (Phase 45).
 *
 * Assembling a bundle folds an operator's own content-free ops-check + cleanup-pipeline summaries
 * into one composite {@link OpsBundleSeverity} (`./build`). This tiny seam gives that verdict the
 * SAME content-free metric contract the rest of the worker path uses: one bounded
 * `worker_ops_bundle_total` sample per generated bundle, sent to a sink that DEFAULTS to a no-op
 * (the honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the aggregator: it answers "how many bundles, in what severity"
 * for a scheduled monitor/dashboard (e.g. `worker_ops_bundle_total{severity="critical"} > 0`). It
 * is emission-only: it forwards an already-content-free sample (the bounded composite severity) —
 * never a handle, filename, object key, bucket, signed URL, endpoint, region, instant, size, or
 * byte. It does NOT double-count the composed signals; those emit their own metrics elsewhere.
 */

import { opsBundleMetric } from "../observability/metrics";
import {
  NOOP_METRIC_SINK,
  type WorkerMetricSink,
} from "../observability/collector";
import {
  isOpsBundleUsageError,
  type OpsBundleOutcome,
  type OpsBundleSeverity,
} from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point ops-bundle metrics at `next` (a collector sink, or a test spy). */
export function setOpsBundleSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetOpsBundleSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free ops-bundle metric for composite `severity`. */
export function recordOpsBundle(severity: OpsBundleSeverity): void {
  sink(opsBundleMetric(severity));
}

/**
 * The composite severity a whole outcome resolves to for the metric: a usage error is the
 * bounded `usage` severity; a full bundle contributes its rollup severity.
 */
export function severityForOutcome(
  outcome: OpsBundleOutcome,
): OpsBundleSeverity {
  return isOpsBundleUsageError(outcome) ? "usage" : outcome.rollup.severity;
}
