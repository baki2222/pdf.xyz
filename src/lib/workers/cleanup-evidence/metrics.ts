/**
 * The content-free metric derivation for cleanup evidence posture (Phase 44).
 *
 * It turns a resolved {@link CleanupEvidencePosture} into a single presence gauge sample,
 * `worker_cleanup_evidence_posture{state,reason,provider}` — the run-level signal a dashboard or
 * alert keys on (e.g. `worker_cleanup_evidence_posture{state="stale"} > 0`). Every label is a
 * bounded, redaction-stable enum drawn straight from the posture, so the derivation cannot carry
 * anything the posture did not already safely hold — never a filename, path, object key, bucket,
 * URL, endpoint, region, instant, size, or byte.
 *
 * Pure and node-free: a total mapping from an already-content-free posture to one bounded sample.
 */

import {
  cleanupEvidencePostureMetric,
  type WorkerMetricSample,
} from "../observability/metrics";
import type { CleanupEvidencePosture } from "./types";

/**
 * Derive the `worker_cleanup_evidence_posture{state,reason,provider}` gauge for a posture. The
 * three labels are the posture's own bounded enums; the value is the presence flag `1`.
 */
export function deriveCleanupEvidenceMetric(
  posture: CleanupEvidencePosture,
): WorkerMetricSample {
  return cleanupEvidencePostureMetric(
    posture.state,
    posture.reason,
    posture.provider,
  );
}
