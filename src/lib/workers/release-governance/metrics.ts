/**
 * The process-wide, injectable sink for **release evidence governance bundle** outcomes (Phase 54).
 *
 * Composing the window's trend + latest report / audit folds them into one final
 * {@link ReleaseGovernanceVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free metric
 * contract the rest of the worker path uses: one bounded `worker_release_governance_total` sample per bundle,
 * sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can
 * point at a real collector.
 *
 * It is the run-level counter for the governance bundle: it answers "how many governance bundles were composed,
 * in what verdict" for a governance dashboard (e.g. `worker_release_governance_total{verdict="blocked"} > 0`
 * catches a blocked review window). It is emission-only: it forwards an already-content-free sample (the bounded
 * verdict) — never a reason id, a count, a filename, path, or byte.
 */

import { releaseGovernanceMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseGovernanceVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-governance metrics at `next` (a collector sink, or a test spy). */
export function setReleaseGovernanceSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseGovernanceSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-governance metric for final `verdict`. */
export function recordReleaseGovernance(verdict: ReleaseGovernanceVerdict): void {
  sink(releaseGovernanceMetric(verdict));
}
