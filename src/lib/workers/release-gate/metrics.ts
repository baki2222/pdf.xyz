/**
 * The process-wide, injectable sink for **release readiness gate** outcomes (Phase 46).
 *
 * Running the gate folds the composed checks' exit codes into one composite
 * {@link ReleaseGateVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free
 * metric contract the rest of the worker path uses: one bounded `worker_release_gate_total` sample
 * per gate run, sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a
 * deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the gate: it answers "how many release gates ran, in what verdict"
 * for a release dashboard (e.g. `worker_release_gate_total{verdict="fail"} > 0`). It is
 * emission-only: it forwards an already-content-free sample (the bounded composite verdict) — never a
 * check output, filename, object key, path, size, instant, or byte. It does NOT double-count the
 * composed checks; those tools emit their own metrics when run in their own right.
 */

import { releaseGateMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseGateVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-gate metrics at `next` (a collector sink, or a test spy). */
export function setReleaseGateSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseGateSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-gate metric for composite `verdict`. */
export function recordReleaseGate(verdict: ReleaseGateVerdict): void {
  sink(releaseGateMetric(verdict));
}
