/**
 * The process-wide, injectable sink for **release evidence publish / handoff pack** outcomes (Phase 57).
 *
 * Composing the governance bundle + related archive / restore-drill / report / trend folds them into one final
 * {@link ReleasePublishPackVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free metric
 * contract the rest of the worker path uses: one bounded `worker_release_publish_pack_total` sample per pack, sent
 * to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at
 * a real collector.
 *
 * It is the run-level counter for the publish pack: it answers "how many handoff packs were composed, in what
 * verdict" for a release / handoff dashboard (e.g. `worker_release_publish_pack_total{verdict="blocked"} > 0`
 * catches a package that must not be shared). It is emission-only: it forwards an already-content-free sample (the
 * bounded verdict) — never a reason id, a count, a filename, path, or byte.
 */

import { releasePublishPackMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleasePublishPackVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-publish-pack metrics at `next` (a collector sink, or a test spy). */
export function setReleasePublishPackSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleasePublishPackSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-publish-pack metric for final `verdict`. */
export function recordReleasePublishPack(verdict: ReleasePublishPackVerdict): void {
  sink(releasePublishPackMetric(verdict));
}
