/**
 * The process-wide, injectable sink for **storage-artifact cleanup-verification** outcomes
 * (Phase 42).
 *
 * A cleanup verification folds a set of content-free evidence to a bounded {@link CleanupVerdict}
 * (`./verify`). This tiny seam gives that verdict the SAME content-free metric contract the rest
 * of the worker path uses: one bounded `worker_cleanup_verification_total` sample per run, sent
 * to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a
 * test — can point at a real collector. It is emission-only: it forwards an already-content-free
 * sample (the verdict and the bounded storage provider — never a handle, filename, object key,
 * bucket, signed URL, expiry instant, count of a specific object, size, or byte).
 *
 * It is deliberately separate from the retrieval/expiry metrics (`../artifacts/expiry-metrics`):
 * those count what the retrieval boundary DENIED as it served live traffic; this counts whether
 * an out-of-band cleanup VERIFICATION could prove those denied objects' bytes are actually gone.
 */

import { cleanupVerificationMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { RetrievalStorageProvider } from "../artifacts/access";
import type { CleanupVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point cleanup-verification metrics at `next` (a collector sink, or a test spy). */
export function setCleanupVerificationSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetCleanupVerificationSink(): void {
  sink = NOOP_METRIC_SINK;
}

/**
 * Emit one bounded, content-free cleanup-verification metric. `verdict` is the aggregate
 * outcome; `provider` is the bounded storage backend. Never receives a handle, filename, key,
 * bucket, URL, instant, or byte.
 */
export function recordCleanupVerification(
  verdict: CleanupVerdict,
  provider: RetrievalStorageProvider,
): void {
  sink(cleanupVerificationMetric(verdict, provider));
}
