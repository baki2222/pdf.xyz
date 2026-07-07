/**
 * The process-wide, injectable sink for **release decision closeout governance finalize index trend finalize index trend closeout index trend action-plan
 * execution receipt** outcomes (Phase 78).
 *
 * Recording whether a finalize-index-trend-finalize-index-trend-closeout-index-trend follow-up plan's required acknowledgements closed it out folds it into one
 * final {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptVerdict} (`./reduce`). This tiny seam
 * gives that verdict the SAME content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_action_receipt_total` sample per receipt, sent to a
 * sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at a real
 * collector.
 *
 * It is the run-level counter for the finalize-index-trend-finalize-index-trend-closeout-index-trend action receipt: it answers "how many decision closeout
 * governance finalize-index-trend-finalize-index-trend-closeout-index-trend action-plan receipts were composed, in what verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_action_receipt_total{verdict="invalid"} > 0` catches
 * a missing / unreadable / tampered plan or a plan whose own verdict is invalid; `{verdict="blocked"} > 0` catches a
 * block-release plan, a contradictory acknowledgement, or a `--strict-open` escalation; `{verdict="incomplete"} > 0`
 * catches a missing required acknowledgement for a clear / monitor / investigate plan). It is emission-only: it forwards
 * an already-content-free sample (the bounded verdict) — never a reason id, an ack id, a count, a reviewer identity, a
 * filename, path, or byte.
 */

import { releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt metric for final `verdict`. */
export function recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptVerdict,
): void {
  sink(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptMetric(verdict));
}
