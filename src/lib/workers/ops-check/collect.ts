/**
 * Node-free composition helpers shared by the healthcheck CLI runner and its tests.
 *
 * The Node-only wiring (resolving the real runtime, reading the heartbeat) lives in
 * the script; these helpers turn the already-resolved, content-free structs into the
 * snapshot + SLO report the alert policy consumes, so all the interesting composition
 * is unit-testable without a runtime, a broker, or a native binary.
 */

import {
  collectOperatorProbeSnapshot,
  type RuntimeSnapshotSource,
  type WorkerOperationsSnapshot,
} from "../observability/snapshot";
import {
  createWorkerMetricsCollector,
  type WorkerMetricsSnapshot,
} from "../observability/collector";
import { deriveRuntimeMetrics, type RuntimeMetricSource } from "../observability/derive";
import { evaluateSlos, type SloReport } from "../observability/slo";
import type { HeartbeatLiveness } from "../heartbeat/types";

/**
 * The structural subset of the worker runtime the CLI reads — the union of what the
 * probe snapshot ({@link RuntimeSnapshotSource}) and the runtime SLO derivation
 * ({@link RuntimeMetricSource}) each need. A `WorkerRuntime` is structurally
 * compatible, so the script passes its resolved runtime straight through.
 */
export type OpsCheckRuntime = RuntimeSnapshotSource & RuntimeMetricSource;

/**
 * Fold a resolved runtime's point-in-time readiness posture into a metrics snapshot
 * and evaluate the SLOs over it. Only the always-observable indicators
 * (engine-readiness, lifecycle-drift when a verification ran) are non-`unknown` here —
 * a probe processed no jobs, so the traffic SLOs are honestly "no data". A monitor
 * that wants the traffic SLOs pipes in a `metrics` series (see `ingest.ts`).
 */
export function evaluateRuntimeSlos(runtime: RuntimeMetricSource): SloReport {
  return evaluateSlos(runtimeMetricsSnapshot(runtime));
}

/** Fold a resolved runtime's point-in-time readiness posture into a metrics snapshot. */
function runtimeMetricsSnapshot(runtime: RuntimeMetricSource): WorkerMetricsSnapshot {
  const collector = createWorkerMetricsCollector();
  for (const sample of deriveRuntimeMetrics(runtime)) collector.record(sample);
  return collector.snapshot();
}

/** A live-collected snapshot, its SLO report, and the metric series behind them. */
export interface CollectedOperations {
  readonly snapshot: WorkerOperationsSnapshot;
  /** The SLO report, or `null` for the config-only web source (no runtime posture). */
  readonly slo: SloReport | null;
  /** The metric series behind the SLOs, or `null`; reused by the Prometheus renderer. */
  readonly metrics: WorkerMetricsSnapshot | null;
}

/**
 * Compose the operator-probe operations from a resolved runtime and a classified
 * heartbeat liveness (Phase 30). The snapshot carries the runtime's real engine/OCR/
 * scanner/guardrail evidence with heartbeat-driven liveness — never self-asserted (see
 * {@link collectOperatorProbeSnapshot}). SLOs come from the runtime readiness posture.
 */
export function collectRuntimeOperations(
  runtime: OpsCheckRuntime,
  daemonLiveness: HeartbeatLiveness,
): CollectedOperations {
  const metrics = runtimeMetricsSnapshot(runtime);
  return {
    snapshot: collectOperatorProbeSnapshot(runtime, { daemonLiveness }),
    slo: evaluateSlos(metrics),
    metrics,
  };
}

/** Re-export for the script's convenience, so it imports one module. */
export type { SloReport, WorkerOperationsSnapshot, WorkerMetricsSnapshot };
