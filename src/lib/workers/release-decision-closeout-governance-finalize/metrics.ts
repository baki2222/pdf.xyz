/**
 * The process-wide, injectable sink for **release decision closeout governance finalization bundle** outcomes (Phase 74).
 *
 * Rolling the whole closeout-governance chain into one final {@link ReleaseDecisionCloseoutGovernanceFinalizeVerdict}
 * (`./reduce`) gives that verdict the SAME content-free metric contract the rest of the worker path uses: one bounded
 * `worker_release_decision_closeout_governance_finalize_total` sample per bundle, sent to a sink that DEFAULTS to a no-op
 * (the honest "not collected") and that a deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the closeout-governance finalization bundle: it answers "how many decision
 * closeout-governance finalizations were composed, in what verdict" for a governance dashboard (e.g.
 * `worker_release_decision_closeout_governance_finalize_total{verdict="finalize-blocked"} > 0` catches a tampered /
 * blocked receipt, a contradictory / tampered related record, or a blocked source chain;
 * `{verdict="finalize-incomplete"} > 0` catches a missing / unreadable / incomplete primary receipt or a
 * required-but-missing related record). It is emission-only: it forwards an already-content-free sample (the bounded
 * verdict) — never a reason id, a record kind, a count, a reviewer identity, a filename, path, or byte.
 */

import { releaseDecisionCloseoutGovernanceFinalizeMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseDecisionCloseoutGovernanceFinalizeVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-decision-closeout-governance-finalize metrics at `next` (a collector sink, or a test spy). */
export function setReleaseDecisionCloseoutGovernanceFinalizeSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseDecisionCloseoutGovernanceFinalizeSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-decision-closeout-governance-finalize metric for final `verdict`. */
export function recordReleaseDecisionCloseoutGovernanceFinalize(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
): void {
  sink(releaseDecisionCloseoutGovernanceFinalizeMetric(verdict));
}
