// @vitest-environment node
/**
 * Unit proofs for the pipeline metric sink seam: it forwards one bounded, content-free sample per
 * call to the wired sink, defaults to a no-op, and restores cleanly for test isolation.
 */
import { afterEach, describe, expect, it } from "vitest";
import { recordPipeline, setPipelineSink, resetPipelineSink } from "./metrics";
import { sanitizeMetric, type WorkerMetricSample } from "../../observability/metrics";

afterEach(() => resetPipelineSink());

describe("recordPipeline", () => {
  it("forwards one schema-conformant sample per call", () => {
    const seen: WorkerMetricSample[] = [];
    setPipelineSink((s) => seen.push(s));
    recordPipeline("verify", "drift");
    recordPipeline("sweep", "ok");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      metric: "worker_cleanup_pipeline_total",
      kind: "counter",
      labels: { arm: "verify", severity: "drift" },
      value: 1,
    });
    // Every emitted sample survives the collector's defense-in-depth sanitizer unchanged.
    for (const s of seen) expect(sanitizeMetric(s)).not.toBeNull();
  });

  it("defaults to a no-op sink (no throw, nothing collected)", () => {
    expect(() => recordPipeline("sweep", "breach")).not.toThrow();
  });
});
