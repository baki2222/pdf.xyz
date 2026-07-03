/**
 * The process-wide, injectable sink for **release evidence index** outcomes (Phase 48).
 *
 * Building an index folds the archived artifacts' digest integrity + retention posture into one
 * composite {@link ReleaseIndexVerdict} (`./rollup`). This tiny seam gives that verdict the SAME
 * content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_index_total` sample per built index, sent to a sink that DEFAULTS to a no-op (the
 * honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the index: it answers "how many retention manifests were built, in
 * what verdict" for a release dashboard (e.g. `worker_release_index_total{verdict="invalid"} > 0`
 * catches a tampered artifact entering the archive). It is emission-only: it forwards an
 * already-content-free sample (the bounded composite verdict) — never a digest, an artifact fact, a
 * filename, path, count, age, or byte. It does NOT double-count the indexed artifacts; those tools
 * emit their own metrics when run in their own right.
 */

import { releaseIndexMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseIndexVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-index metrics at `next` (a collector sink, or a test spy). */
export function setReleaseIndexSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseIndexSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-index metric for composite `verdict`. */
export function recordReleaseIndex(verdict: ReleaseIndexVerdict): void {
  sink(releaseIndexMetric(verdict));
}
