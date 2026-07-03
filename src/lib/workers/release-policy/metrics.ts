/**
 * The process-wide, injectable sink for **release evidence policy** outcomes (Phase 49).
 *
 * Evaluating a policy folds the archive's bounded facts + the operator's thresholds into one composite
 * {@link ReleasePolicyVerdict} (`./rollup`). This tiny seam gives that verdict the SAME content-free
 * metric contract the rest of the worker path uses: one bounded `worker_release_policy_total` sample
 * per evaluation, sent to a sink that DEFAULTS to a no-op (the honest "not collected") and that a
 * deployment — or a test — can point at a real collector.
 *
 * It is the run-level counter for the policy gate: it answers "how many release policies were
 * evaluated, in what verdict" for a release dashboard (e.g. `worker_release_policy_total{verdict="fail"}
 * > 0` catches an archive that violated a blocking threshold). It is emission-only: it forwards an
 * already-content-free sample (the bounded composite verdict) — never a violation id, a fact, a
 * filename, path, count, age, or byte.
 */

import { releasePolicyMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleasePolicyVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-policy metrics at `next` (a collector sink, or a test spy). */
export function setReleasePolicySink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleasePolicySink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-policy metric for composite `verdict`. */
export function recordReleasePolicy(verdict: ReleasePolicyVerdict): void {
  sink(releasePolicyMetric(verdict));
}
