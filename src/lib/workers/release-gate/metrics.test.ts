/**
 * Metric-sink tests for the release readiness gate (Phase 46): one bounded, content-free,
 * schema-conformant sample per run, injectable and defaulting to a no-op.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { recordReleaseGate, resetReleaseGateSink, setReleaseGateSink } from "./metrics";
import { releaseGateMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_GATE_VERDICTS } from "./types";

afterEach(() => resetReleaseGateSink());

describe("release-gate metrics", () => {
  it("forwards one bounded worker_release_gate_total sample to the sink", () => {
    const sink = vi.fn();
    setReleaseGateSink(sink);
    recordReleaseGate("fail");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toEqual({
      metric: "worker_release_gate_total",
      kind: "counter",
      labels: { verdict: "fail" },
      value: 1,
    });
  });

  it("defaults to a no-op sink after reset (never throws)", () => {
    resetReleaseGateSink();
    expect(() => recordReleaseGate("pass")).not.toThrow();
  });

  it("every verdict produces a sample the shared sanitizer accepts (redaction-stable)", () => {
    for (const verdict of RELEASE_GATE_VERDICTS) {
      const sample = releaseGateMetric(verdict);
      expect(sanitizeMetric(sample)).toEqual(sample);
    }
  });
});
