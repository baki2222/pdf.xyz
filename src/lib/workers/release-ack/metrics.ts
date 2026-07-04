/**
 * The process-wide, injectable sink for **release evidence handoff acknowledgement** outcomes (Phase 58).
 *
 * Acknowledging a publish pack folds the pack posture + the operator's decision into one final
 * {@link ReleaseAckVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free metric contract the
 * rest of the worker path uses: one bounded `worker_release_ack_total` sample per acknowledgement, sent to a sink that
 * DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the acknowledgement: it answers "how many handoff acknowledgements were recorded, in
 * what verdict" for a release / handoff dashboard (e.g. `worker_release_ack_total{verdict="rejected"} > 0` catches a
 * rejected package, `{verdict="invalid"} > 0` catches an untrustworthy input). It is emission-only: it forwards an
 * already-content-free sample (the bounded verdict) — never a reviewer identity, a decision, a reason id, a count, a
 * filename, path, or byte.
 */

import { releaseAckMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseAckVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-ack metrics at `next` (a collector sink, or a test spy). */
export function setReleaseAckSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseAckSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-ack metric for final `verdict`. */
export function recordReleaseAck(verdict: ReleaseAckVerdict): void {
  sink(releaseAckMetric(verdict));
}
