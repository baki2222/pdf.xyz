/**
 * The process-wide, injectable sink for **release decision record** outcomes (Phase 59).
 *
 * Deciding over a publish pack + acknowledgement folds both postures + their coherence into one final
 * {@link ReleaseDecisionDecision} (`./rollup`). This tiny seam gives that decision the SAME content-free metric
 * contract the rest of the worker path uses: one bounded `worker_release_decision_total` sample per decision, sent to
 * a sink that DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at a real
 * collector.
 *
 * It is the run-level counter for the decision: it answers "how many release decisions were recorded, in what
 * outcome" for a release ledger dashboard (e.g. `worker_release_decision_total{decision="reject"} > 0` catches a
 * rejected release, `{decision="invalid"} > 0` catches an untrustworthy / incoherent pair). It is emission-only: it
 * forwards an already-content-free sample (the bounded decision) — never a reviewer identity, a reason id, a count, a
 * filename, path, or byte.
 */

import { releaseDecisionMetric } from "../observability/metrics";
import {
  NOOP_METRIC_SINK,
  type WorkerMetricSink,
} from "../observability/collector";
import type { ReleaseDecisionDecision } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision metric for final `decision`. */
export function recordReleaseDecision(decision: ReleaseDecisionDecision): void {
  sink(releaseDecisionMetric(decision));
}
