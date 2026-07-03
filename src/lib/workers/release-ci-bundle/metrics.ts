/**
 * The process-wide, injectable sink for **release evidence CI bundle** outcomes (Phase 50).
 *
 * Composing the chain folds the four stages' bounded facts + their consistency into one composite
 * {@link ReleaseCiBundleVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free
 * metric contract the rest of the worker path uses: one bounded `worker_release_ci_bundle_total` sample
 * per bundle, sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a
 * deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the CI bundle: it answers "how many release bundles were composed, in
 * what verdict" for a release dashboard (e.g. `worker_release_ci_bundle_total{verdict="fail"} > 0`
 * catches a chain that failed or was internally inconsistent). It is emission-only: it forwards an
 * already-content-free sample (the bounded composite verdict) — never a stage id, a consistency id, a
 * fact, a filename, path, count, or byte.
 */

import { releaseCiBundleMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseCiBundleVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-ci-bundle metrics at `next` (a collector sink, or a test spy). */
export function setReleaseCiBundleSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseCiBundleSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-ci-bundle metric for composite `verdict`. */
export function recordReleaseCiBundle(verdict: ReleaseCiBundleVerdict): void {
  sink(releaseCiBundleMetric(verdict));
}
