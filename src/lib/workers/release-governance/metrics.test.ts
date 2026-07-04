/**
 * Unit proofs for the release-governance metrics sink (Phase 54): it emits ONE bounded, content-free
 * `worker_release_governance_total` sample per bundle, defaults to a no-op, and every sample it can emit
 * sanitizes (round-trips through the shared schema validator) — and every verdict label is redaction-stable, so
 * `sanitizeMetric` never silently drops the sample (the P40 rule).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  recordReleaseGovernance,
  resetReleaseGovernanceSink,
  setReleaseGovernanceSink,
} from "./metrics";
import { RELEASE_GOVERNANCE_VERDICTS } from "./types";
import { sanitizeMetric, type WorkerMetricSample } from "../observability/metrics";
import { redactText } from "../../telemetry/redact";

afterEach(() => resetReleaseGovernanceSink());

describe("release-governance metrics", () => {
  it("emits one bounded sample per verdict into the configured sink", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseGovernanceSink((s) => seen.push(s));
    recordReleaseGovernance("blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      metric: "worker_release_governance_total",
      kind: "counter",
      labels: { verdict: "blocked" },
      value: 1,
    });
  });

  it("every verdict produces a sample that sanitizes (schema-conformant, content-free)", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseGovernanceSink((s) => seen.push(s));
    for (const v of RELEASE_GOVERNANCE_VERDICTS) recordReleaseGovernance(v);
    expect(seen).toHaveLength(RELEASE_GOVERNANCE_VERDICTS.length);
    for (const sample of seen) {
      const clean = sanitizeMetric(sample);
      expect(clean, JSON.stringify(sample)).not.toBeNull();
      expect(clean!.labels.verdict).toBe(sample.labels.verdict);
    }
  });

  it("every verdict is a redaction-STABLE label (redactText leaves it byte-identical)", () => {
    // P40 rule: a metric label value that redactText rewrites would be dropped by sanitizeMetric.
    for (const verdict of RELEASE_GOVERNANCE_VERDICTS) {
      expect(redactText(verdict), verdict).toBe(verdict);
    }
  });

  it("defaults to a no-op sink (nothing thrown when unset)", () => {
    resetReleaseGovernanceSink();
    expect(() => recordReleaseGovernance("healthy")).not.toThrow();
  });
});
