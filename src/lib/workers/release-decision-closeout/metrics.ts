/**
 * The process-wide, injectable sink for **release decision closeout bundle** outcomes (Phase 64).
 *
 * Composing the release decision governance chain folds it into one final {@link ReleaseDecisionCloseoutVerdict}
 * (`./reduce`). This tiny seam gives that verdict the SAME content-free metric contract the rest of the worker path uses:
 * one bounded `worker_release_decision_closeout_total` sample per closeout, sent to a sink that DEFAULTS to a no-op (the
 * honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the closeout: it answers "how many decision closeouts were composed, in what verdict"
 * for a governance dashboard (e.g. `worker_release_decision_closeout_total{verdict="closeout-blocked"} > 0` catches a
 * tampered / blocked receipt, a contradictory related record, or a blocked source chain;
 * `{verdict="closeout-incomplete"} > 0` catches a missing receipt or a missing required related record). It is
 * emission-only: it forwards an already-content-free sample (the bounded verdict) — never a reason id, a record kind, a
 * count, a reviewer identity, a filename, path, or byte.
 */

import { releaseDecisionCloseoutMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-closeout metric for final `verdict`. */
export function recordReleaseDecisionCloseout(verdict: ReleaseDecisionCloseoutVerdict): void {
  sink(releaseDecisionCloseoutMetric(verdict));
}
