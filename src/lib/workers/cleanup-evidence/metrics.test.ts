// @vitest-environment node
/**
 * Metric-derivation proofs for cleanup evidence posture (Phase 44): the derived
 * `worker_cleanup_evidence_posture{state,reason,provider}` gauge carries the posture's bounded
 * enums verbatim, sanitizes (round-trips the schema), and is content-free.
 */
import { describe, expect, it } from "vitest";
import { deriveCleanupEvidenceMetric } from "./metrics";
import {
  DISABLED_CLEANUP_EVIDENCE_POSTURE,
  type CleanupEvidencePosture,
} from "./types";
import { sanitizeMetric } from "../observability/metrics";

function posture(
  over: Partial<CleanupEvidencePosture> = {},
): CleanupEvidencePosture {
  return { ...DISABLED_CLEANUP_EVIDENCE_POSTURE, ...over };
}

describe("deriveCleanupEvidenceMetric", () => {
  it("emits the posture's bounded labels as a presence gauge", () => {
    const m = deriveCleanupEvidenceMetric(
      posture({
        state: "warning",
        reason: "cleanup_drift",
        provider: "remote-configured",
      }),
    );
    expect(m.metric).toBe("worker_cleanup_evidence_posture");
    expect(m.kind).toBe("gauge");
    expect(m.labels).toEqual({
      state: "warning",
      reason: "cleanup_drift",
      provider: "remote-configured",
    });
    expect(m.value).toBe(1);
  });

  it("sanitizes for every state/reason/provider combination the resolver can emit", () => {
    const combos: CleanupEvidencePosture[] = [
      posture({
        state: "disabled",
        reason: "no_report_configured",
        provider: "unknown",
      }),
      posture({
        state: "healthy",
        reason: "cleanup_verified",
        provider: "remote-configured",
      }),
      posture({
        state: "stale",
        reason: "report_missing",
        provider: "unknown",
      }),
      posture({
        state: "stale",
        reason: "report_stale",
        provider: "local-dev",
      }),
      posture({
        state: "warning",
        reason: "cleanup_drift",
        provider: "remote-configured",
      }),
      posture({
        state: "critical",
        reason: "cleanup_breach",
        provider: "unknown",
      }),
      posture({
        state: "invalid",
        reason: "report_unreadable",
        provider: "unknown",
      }),
      posture({
        state: "invalid",
        reason: "report_malformed",
        provider: "unknown",
      }),
      posture({
        state: "unknown",
        reason: "cleanup_unknown",
        provider: "not-configured",
      }),
      posture({
        state: "not-configured",
        reason: "no_report_configured",
        provider: "not-configured",
      }),
    ];
    for (const p of combos) {
      const clean = sanitizeMetric(deriveCleanupEvidenceMetric(p));
      expect(clean, JSON.stringify(p)).not.toBeNull();
    }
  });
});
