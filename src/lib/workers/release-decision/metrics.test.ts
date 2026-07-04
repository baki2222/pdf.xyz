// @vitest-environment node
/**
 * Metric-sink proofs for the release decision record ledger (Phase 59). The run emits ONE bounded, content-free
 * `worker_release_decision_total{decision}` sample per decision to an injectable sink that defaults to a no-op. This
 * pins that every decision value is a schema-valid, redaction-stable label the shared sanitizer keeps.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  recordReleaseDecision,
  resetReleaseDecisionSink,
  setReleaseDecisionSink,
} from "./metrics";
import {
  releaseDecisionMetric,
  sanitizeMetric,
} from "../observability/metrics";
import type { WorkerMetricSample } from "../observability/metrics";
import { RELEASE_DECISION_DECISIONS } from "./types";

afterEach(() => resetReleaseDecisionSink());

describe("recordReleaseDecision", () => {
  it("emits one bounded sample per decision, to the injected sink", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseDecisionSink((s) => seen.push(s));
    recordReleaseDecision("proceed");
    recordReleaseDecision("reject");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      metric: "worker_release_decision_total",
      kind: "counter",
      labels: { decision: "proceed" },
      value: 1,
    });
    expect(seen[1]!.labels.decision).toBe("reject");
  });

  it("defaults to a no-op sink (does not throw with no sink set)", () => {
    resetReleaseDecisionSink();
    expect(() => recordReleaseDecision("invalid")).not.toThrow();
  });
});

describe("releaseDecisionMetric — schema-valid + redaction-stable", () => {
  it("every decision produces a sample the shared sanitizer keeps intact", () => {
    for (const decision of RELEASE_DECISION_DECISIONS) {
      const sanitized = sanitizeMetric(releaseDecisionMetric(decision));
      expect(
        sanitized,
        `decision ${decision} must survive sanitize`,
      ).not.toBeNull();
      expect(sanitized!.labels.decision).toBe(decision);
    }
  });
});
