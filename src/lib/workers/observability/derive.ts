/**
 * Pure derivations from the worker's existing **point-in-time readouts** into
 * content-free {@link WorkerMetricSample}s.
 *
 * These cover the observability signals that are NOT per-job events the executor or
 * daemon emit — deployment-facet readiness, engine/gate capability presence, and a
 * lifecycle-verification verdict — turning the honest structs those subsystems
 * already produce (`WorkerDeploymentReadiness.facets`, the compression/OCR/scanner
 * health, a `LifecycleVerification`) into gauge/counter samples. They are disjoint
 * from the executor/daemon direct-emit paths, so wiring both never double-counts.
 *
 * Node-free and pure: each function is a total mapping from an already-content-free
 * input to bounded samples, so it is unit-testable without any runtime, and it
 * cannot introduce a label the input did not already safely carry.
 */

import type { OperationalFacet } from "../deploy/readiness";
import {
  engineCapabilityMetric,
  lifecycleDriftMetric,
  lifecycleVerificationMetric,
  readinessMetric,
  type LifecycleMetricVerdict,
  type WorkerMetricSample,
} from "./metrics";

/**
 * One `worker_readiness{facet,state}` gauge per deployment facet. The facet ids and
 * states are already the bounded {@link import("../deploy/readiness").FacetId} /
 * {@link import("../deploy/readiness").FacetState} enums, so the mapping is total
 * and content-free.
 */
export function deriveReadinessMetrics(
  facets: readonly OperationalFacet[],
): WorkerMetricSample[] {
  return facets.map((facet) => readinessMetric(facet.id, facet.state));
}

/** Presence-only inputs for the engine/gate capability gauges. */
export interface EngineCapabilityInput {
  /** Deep image compression available (a native engine is installed). */
  readonly compressionDeep: boolean;
  /** A real OCR engine + runner are wired on this worker. */
  readonly ocrReady: boolean;
  /** A real malware scanner is configured and actually inspects bytes. */
  readonly scannerActive: boolean;
}

/**
 * The `worker_engine_capability` gauges. Lossless structural repack is ALWAYS
 * available (pure-JS pdf-lib), so `compression_lossless` is unconditionally `true`;
 * `compression_deep`, `ocr`, and `scanner` reflect presence-only readiness. Never
 * names an engine binary, version, path, or endpoint — only the bounded capability
 * id and a boolean.
 */
export function deriveEngineCapabilityMetrics(
  input: EngineCapabilityInput,
): WorkerMetricSample[] {
  return [
    engineCapabilityMetric("compression_lossless", true),
    engineCapabilityMetric("compression_deep", input.compressionDeep),
    engineCapabilityMetric("ocr", input.ocrReady),
    engineCapabilityMetric("scanner", input.scannerActive),
  ];
}

/**
 * The structural subset of the worker runtime the readiness/engine derivation reads.
 * Declared locally (not imported from the Node-only runtime) so this stays node-free;
 * the daemon passes its `WorkerRuntime`, which is structurally compatible.
 */
export interface RuntimeMetricSource {
  readonly deployment: { readonly facets: readonly OperationalFacet[] };
  readonly compression: { readonly deep: boolean };
  readonly ocr: { readonly ready: boolean };
  readonly scanner: { readonly active: boolean };
}

/**
 * Every point-in-time gauge for a resolved runtime: one `worker_readiness` per
 * deployment facet plus the four `worker_engine_capability` presence gauges. The one
 * call the daemon CLI makes to reflect its readiness posture into the metric snapshot.
 */
export function deriveRuntimeMetrics(
  source: RuntimeMetricSource,
): WorkerMetricSample[] {
  return [
    ...deriveReadinessMetrics(source.deployment.facets),
    ...deriveEngineCapabilityMetrics({
      compressionDeep: source.compression.deep,
      ocrReady: source.ocr.ready,
      scannerActive: source.scanner.active,
    }),
  ];
}

/** Input for the lifecycle-verification derivation. */
export interface LifecycleMetricInput {
  readonly verdict: LifecycleMetricVerdict;
  /** Count of the app's OWN backstop rules found drifted (default 0). */
  readonly driftedRules?: number;
}

/**
 * A `worker_lifecycle_verification_total{verdict}` counter plus a
 * `worker_lifecycle_drift_rules` gauge. `driftedRules` is a small, bounded count of
 * the app's own `pdfxyz-*` rules — never an observed rule id, prefix, or value.
 */
export function deriveLifecycleMetrics(
  input: LifecycleMetricInput,
): WorkerMetricSample[] {
  return [
    lifecycleVerificationMetric(input.verdict),
    lifecycleDriftMetric(input.driftedRules ?? 0),
  ];
}
