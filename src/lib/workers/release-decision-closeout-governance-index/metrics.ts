/**
 * The process-wide, injectable sink for **release decision closeout governance index** outcomes (Phase 70).
 *
 * Indexing a bounded history of governance bundles folds their verdicts into one final
 * {@link ReleaseDecisionCloseoutGovernanceIndexVerdict} (`./reduce`). This tiny seam gives that verdict the SAME
 * content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_governance_index_total` sample per index, sent to a sink that DEFAULTS to a no-op
 * (the honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the governance index: it answers "how many governance indexes were composed, in what
 * verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_governance_index_total{verdict="index-blocked"} > 0` catches a tampered / blocked
 * history, `{verdict="index-incomplete"} > 0` catches a coverage gap). It is emission-only: it forwards an
 * already-content-free sample (the bounded verdict) — never a reason id, a count, a reviewer identity, a filename, path,
 * or byte.
 */

import { releaseDecisionCloseoutGovernanceIndexMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutGovernanceIndexVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout-governance-index metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutGovernanceIndexSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutGovernanceIndexSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-closeout-governance-index metric for final `verdict`. */
export function recordReleaseDecisionCloseoutGovernanceIndex(
  verdict: ReleaseDecisionCloseoutGovernanceIndexVerdict,
): void {
  sink(releaseDecisionCloseoutGovernanceIndexMetric(verdict));
}
