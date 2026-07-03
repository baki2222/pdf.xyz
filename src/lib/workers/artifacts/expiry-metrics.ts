/**
 * The process-wide, injectable sink for **storage-backed artifact-lifecycle/expiry**
 * evaluations.
 *
 * For every object the bucket still returns, the storage-backed retrieval reader resolves a
 * bounded {@link StorageArtifactLifecycle} state from the object's signed lifecycle evidence
 * (`./lifecycle`). This tiny seam gives that decision the SAME content-free metric contract
 * the rest of the worker path uses: one bounded `worker_artifact_expiry_total` sample per
 * present-object read, sent to a sink that DEFAULTS to a no-op (the honest "not collected")
 * and that a deployment — or a test — can point at a real collector. It is emission-only: it
 * forwards a bounded, already-content-free sample (the lifecycle state and the bounded storage
 * provider — never a handle, filename, object key, bucket, signed URL, expiry instant, size,
 * or byte).
 *
 * It is deliberately separate from the retrieval-decision metric (`./retrieval-metrics`):
 * that one counts served/denied ACCESS outcomes; this one is the lifecycle/expiry lens — how
 * often the bucket served an object the app already considers expired or tombstoned (drift),
 * versus a live object, versus one with no lifecycle evidence at all.
 */

import { artifactExpiryMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { StorageArtifactLifecycle } from "./lifecycle";
import type { RetrievalStorageProvider } from "./access";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point artifact-lifecycle/expiry metrics at `next` (a collector sink, or a test spy). */
export function setArtifactExpirySink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetArtifactExpirySink(): void {
  sink = NOOP_METRIC_SINK;
}

/**
 * Emit one bounded, content-free artifact-lifecycle/expiry metric. `state` is
 * `live`/`expired`/`deleted`/`unknown`; `provider` is the bounded storage backend. An
 * `expired` or `deleted` state is by construction the "object present after the app no
 * longer considers it downloadable" drift signal; `unknown` is the "no usable lifecycle
 * metadata" signal. Never receives a handle, filename, key, bucket, URL, instant, or byte.
 */
export function recordArtifactExpiry(
  state: StorageArtifactLifecycle,
  provider: RetrievalStorageProvider,
): void {
  sink(artifactExpiryMetric(state, provider));
}
