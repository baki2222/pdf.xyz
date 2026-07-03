/**
 * The process-wide, injectable sink for **release evidence artifact** outcomes (Phase 47).
 *
 * Generating an artifact folds the archived gate verdict + this build's provenance into one
 * composite {@link ReleaseArtifactVerdict} (`./build`). This tiny seam gives that verdict the SAME
 * content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_artifact_total` sample per generated artifact, sent to a sink that DEFAULTS to a
 * no-op (the honest "not collected") and that a deployment — or a test — can point at a real
 * collector.
 *
 * It is the run-level counter for the artifact: it answers "how many release artifacts were
 * generated, in what verdict" for a release dashboard (e.g.
 * `worker_release_artifact_total{verdict="fail"} > 0`). It is emission-only: it forwards an
 * already-content-free sample (the bounded composite verdict) — never a digest, gate output,
 * filename, object key, path, size, instant, or byte. It does NOT double-count the archived gate;
 * that tool emits its own metric when run in its own right. A `--verify` run records nothing (it
 * generates no new artifact).
 */

import { releaseArtifactMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseArtifactVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-artifact metrics at `next` (a collector sink, or a test spy). */
export function setReleaseArtifactSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseArtifactSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-artifact metric for composite `verdict`. */
export function recordReleaseArtifact(verdict: ReleaseArtifactVerdict): void {
  sink(releaseArtifactMetric(verdict));
}
