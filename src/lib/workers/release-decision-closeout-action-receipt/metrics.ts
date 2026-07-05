/**
 * The process-wide, injectable sink for **release decision closeout action-plan execution receipt** outcomes (Phase 68).
 *
 * Recording whether a closeout follow-up plan's required acknowledgements closed it out folds it into one final
 * {@link ReleaseDecisionCloseoutActionReceiptVerdict} (`./reduce`). This tiny seam gives that verdict the SAME
 * content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_action_receipt_total` sample per receipt, sent to a sink that DEFAULTS to a no-op
 * (the honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the closeout action receipt: it answers "how many decision closeout action-plan
 * receipts were composed, in what verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_action_receipt_total{verdict="blocked"} > 0` catches a missing / unreadable /
 * tampered plan, an unacknowledged block, or a contradictory acknowledgement; `{verdict="incomplete"} > 0` catches a
 * missing required acknowledgement for a clear / investigate plan). It is emission-only: it forwards an
 * already-content-free sample (the bounded verdict) — never a reason id, an ack id, a count, a reviewer identity, a
 * filename, path, or byte.
 */

import { releaseDecisionCloseoutActionReceiptMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutActionReceiptVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout-action-receipt metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutActionReceiptSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutActionReceiptSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-closeout-action-receipt metric for final `verdict`. */
export function recordReleaseDecisionCloseoutActionReceipt(
  verdict: ReleaseDecisionCloseoutActionReceiptVerdict,
): void {
  sink(releaseDecisionCloseoutActionReceiptMetric(verdict));
}
