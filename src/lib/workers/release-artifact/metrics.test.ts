/**
 * Metric-sink tests for the release evidence artifact (Phase 47): one bounded, content-free,
 * schema-conformant sample per generated artifact, injectable and defaulting to a no-op. Every
 * verdict survives the shared sanitizer (redaction-stable label), so a careless label can never leak.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { recordReleaseArtifact, resetReleaseArtifactSink, setReleaseArtifactSink } from "./metrics";
import { releaseArtifactMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_ARTIFACT_VERDICTS } from "./types";

afterEach(() => resetReleaseArtifactSink());

describe("release-artifact metrics", () => {
  it("forwards one bounded worker_release_artifact_total sample to the sink", () => {
    const sink = vi.fn();
    setReleaseArtifactSink(sink);
    recordReleaseArtifact("fail");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toEqual({
      metric: "worker_release_artifact_total",
      kind: "counter",
      labels: { verdict: "fail" },
      value: 1,
    });
  });

  it("defaults to a no-op sink after reset (never throws)", () => {
    resetReleaseArtifactSink();
    expect(() => recordReleaseArtifact("pass")).not.toThrow();
  });

  it("every verdict produces a sample the shared sanitizer accepts (redaction-stable)", () => {
    for (const verdict of RELEASE_ARTIFACT_VERDICTS) {
      const sample = releaseArtifactMetric(verdict);
      expect(sanitizeMetric(sample)).toEqual(sample);
    }
  });
});
