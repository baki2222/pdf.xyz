/**
 * The process-wide, injectable sink for **release decision closeout governance index trend** outcomes (Phase 71).
 *
 * Summarizing a bounded history of governance-index windows folds their index verdicts into one final
 * {@link ReleaseDecisionCloseoutGovernanceIndexTrendVerdict} (`./reduce`). This tiny seam gives that verdict the SAME
 * content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_governance_index_trend_total` sample per trend, sent to a sink that DEFAULTS to a
 * no-op (the honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the governance-index trend: it answers "how many governance-index trends were
 * composed, in what verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_governance_index_trend_total{verdict="trend-blocked"} > 0` catches a tampered /
 * blocked history, `{verdict="trend-watch"} > 0` catches a worsening arc). It is emission-only: it forwards an
 * already-content-free sample (the bounded verdict) — never a reason id, a count, a reviewer identity, a filename, path,
 * or byte.
 */

import { releaseDecisionCloseoutGovernanceIndexTrendMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutGovernanceIndexTrendVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout-governance-index-trend metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutGovernanceIndexTrendSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutGovernanceIndexTrendSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-closeout-governance-index-trend metric for final `verdict`. */
export function recordReleaseDecisionCloseoutGovernanceIndexTrend(
  verdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
): void {
  sink(releaseDecisionCloseoutGovernanceIndexTrendMetric(verdict));
}
