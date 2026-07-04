/**
 * The process-wide, injectable sink for **release decision ledger index** outcomes (Phase 60).
 *
 * Indexing a bounded batch of decision records folds their decisions into one final
 * {@link ReleaseDecisionIndexVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free metric
 * contract the rest of the worker path uses: one bounded `worker_release_decision_index_total` sample per index,
 * sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point
 * at a real collector.
 *
 * It is the run-level counter for the ledger index: it answers "how many decision ledger indexes were composed, in
 * what verdict" for a review dashboard (e.g. `worker_release_decision_index_total{verdict="blocked"} > 0` catches a
 * rejected / invalid decision in the batch, `{verdict="invalid"} > 0` catches an untrustworthy record). It is
 * emission-only: it forwards an already-content-free sample (the bounded verdict) — never a reason id, a count, a
 * reviewer identity, a filename, path, or byte.
 */

import { releaseDecisionIndexMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionIndexVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-index metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionIndexSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionIndexSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-index metric for final `verdict`. */
export function recordReleaseDecisionIndex(verdict: ReleaseDecisionIndexVerdict): void {
  sink(releaseDecisionIndexMetric(verdict));
}
