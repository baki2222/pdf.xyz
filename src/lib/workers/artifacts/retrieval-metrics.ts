/**
 * The process-wide, injectable sink for **artifact-retrieval** decisions.
 *
 * The client-facing download boundary is a web route, not part of the worker's
 * dependency-injected executor, so it has no {@link WorkerMetricSink} threaded through
 * it. This tiny seam gives it the SAME content-free metric contract the worker path
 * uses: one bounded `worker_artifact_retrieval_total` sample per decision, sent to a
 * sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or
 * a test — can point at a real collector. It is emission-only: it never buffers bytes
 * and only ever forwards a bounded, already-content-free sample (a served/denied
 * outcome, the bounded reason, and the output kind — never a handle, filename, key,
 * signed URL, size, or byte).
 */

import { artifactRetrievalMetric } from "../observability/metrics";
import {
  NOOP_METRIC_SINK,
  type WorkerMetricSink,
} from "../observability/collector";
import type { ArtifactOutputKind } from "./types";
import {
  retrievalOutcomeFor,
  type ArtifactAccessReason,
  type RetrievalStorageProvider,
} from "./access";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point retrieval-decision metrics at `next` (a collector sink, or a test spy). */
export function setArtifactRetrievalSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetArtifactRetrievalSink(): void {
  sink = NOOP_METRIC_SINK;
}

/**
 * Emit one bounded, content-free retrieval-decision metric. `reason` folds to the
 * `served`/`denied` outcome; `kind` is the served output kind (or `unknown` for a
 * denial); `provider` is the bounded storage backend the decision came from
 * (`local-dev` vs `remote-configured` vs `not-configured`), so a dashboard can split
 * local-dev from storage-backed retrieval without any high-cardinality label. Never
 * receives a handle, filename, key, bucket, URL, size, or byte.
 */
export function recordArtifactRetrieval(
  reason: ArtifactAccessReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
): void {
  sink(
    artifactRetrievalMetric(
      retrievalOutcomeFor(reason),
      reason,
      kind,
      provider,
    ),
  );
}
