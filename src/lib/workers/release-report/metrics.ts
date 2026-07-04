/**
 * The process-wide, injectable sink for **release evidence operator report** outcomes (Phase 52).
 *
 * Composing the two release-evidence composites folds their bounded postures into one final
 * {@link ReleaseReportRecommendation} (`./rollup`). This tiny seam gives that recommendation the SAME
 * content-free metric contract the rest of the worker path uses: one bounded `worker_release_report_total`
 * sample per report, sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a
 * deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the operator report: it answers "how many release reports were composed, in
 * what recommendation" for a release dashboard (e.g. `worker_release_report_total{recommendation="hold-fail"}
 * > 0` catches a release held at handoff). It is emission-only: it forwards an already-content-free sample
 * (the bounded recommendation) — never a source id, a rationale id, a fact, a filename, path, count, or byte.
 */

import { releaseReportMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseReportRecommendation } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-report metrics at `next` (a collector sink, or a test spy). */
export function setReleaseReportSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseReportSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-report metric for final `recommendation`. */
export function recordReleaseReport(recommendation: ReleaseReportRecommendation): void {
  sink(releaseReportMetric(recommendation));
}
