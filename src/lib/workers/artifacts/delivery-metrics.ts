/**
 * The process-wide, injectable sink for **artifact-download delivery** decisions — the
 * delivery counterpart to `./retrieval-metrics`.
 *
 * The retrieval sink records the ACCESS decision (was the handle granted); this one
 * records the second gate: given access was granted, were the bytes then safely
 * delivered? Both are emitted by the client-facing download route (a web endpoint, not
 * part of the DI'd executor), so this tiny seam gives delivery the SAME content-free
 * metric contract — one bounded `worker_artifact_delivery_total` sample per delivery
 * decision, to a sink that DEFAULTS to a no-op (the honest "not collected") and that a
 * deployment — or a test — can point at a real collector. Emission-only: it never
 * buffers bytes and only ever forwards a bounded, already-content-free sample (a
 * delivered/denied outcome, the bounded reason, the output kind, and the bounded
 * storage provider — never a handle, filename, key, signed URL, byte range, size, or
 * byte).
 */

import { artifactDeliveryMetric } from "../observability/metrics";
import {
  NOOP_METRIC_SINK,
  type WorkerMetricSink,
} from "../observability/collector";
import { deliveryOutcomeFor, type ArtifactDeliveryReason } from "./delivery";
import type { RetrievalStorageProvider } from "./access";
import type { ArtifactOutputKind } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point delivery-decision metrics at `next` (a collector sink, or a test spy). */
export function setArtifactDeliverySink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetArtifactDeliverySink(): void {
  sink = NOOP_METRIC_SINK;
}

/**
 * Emit one bounded, content-free delivery-decision metric. `reason` folds to the
 * `delivered`/`denied` outcome; `kind` is the served output kind (or `unknown` for a
 * pre-decision failure); `provider` is the bounded storage backend the download came
 * from. Never receives a handle, filename, key, bucket, URL, byte range, size, or byte.
 */
export function recordArtifactDelivery(
  reason: ArtifactDeliveryReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
): void {
  sink(
    artifactDeliveryMetric(deliveryOutcomeFor(reason), reason, kind, provider),
  );
}
