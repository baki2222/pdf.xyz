/**
 * The process-wide, injectable sink for **release evidence audit** outcomes (Phase 51).
 *
 * Diffing two bundles folds their bounded postures into one composite {@link ReleaseAuditVerdict}
 * (`./rollup`). This tiny seam gives that verdict the SAME content-free metric contract the rest of the
 * worker path uses: one bounded `worker_release_audit_total` sample per audit, sent to a sink that
 * DEFAULTS to a no-op (the honest "not collected") and that a deployment — or a test — can point at a real
 * collector.
 *
 * It is the run-level counter for the audit: it answers "how many release audits ran, in what verdict" for
 * a release dashboard (e.g. `worker_release_audit_total{verdict="fail"} > 0` catches a blocking regression
 * or a tampered bundle). It is emission-only: it forwards an already-content-free sample (the bounded
 * composite verdict) — never a bundle id, a regression id, a fact, a filename, path, count, or byte.
 */

import { releaseAuditMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseAuditVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

/** Point release-audit metrics at `next` (a collector sink, or a test spy). */
export function setReleaseAuditSink(next: WorkerMetricSink): void {
  sink = next;
}

/** Restore the default no-op sink (test isolation / disabling collection). */
export function resetReleaseAuditSink(): void {
  sink = NOOP_METRIC_SINK;
}

/** Emit one bounded, content-free release-audit metric for composite `verdict`. */
export function recordReleaseAudit(verdict: ReleaseAuditVerdict): void {
  sink(releaseAuditMetric(verdict));
}
