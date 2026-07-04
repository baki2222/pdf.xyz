/**
 * Unit proofs for the release-trend metrics sink (Phase 53): it emits ONE bounded, content-free
 * `worker_release_trend_total` sample per summary, defaults to a no-op, and every sample it can emit sanitizes
 * (round-trips through the shared schema validator).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { recordReleaseTrend, resetReleaseTrendSink, setReleaseTrendSink } from "./metrics";
import { RELEASE_TREND_VERDICTS } from "./types";
import { sanitizeMetric, type WorkerMetricSample } from "../observability/metrics";

afterEach(() => resetReleaseTrendSink());

describe("release-trend metrics", () => {
  it("emits one bounded sample per verdict into the configured sink", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseTrendSink((s) => seen.push(s));
    recordReleaseTrend("failing");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      metric: "worker_release_trend_total",
      kind: "counter",
      labels: { verdict: "failing" },
      value: 1,
    });
  });

  it("every verdict produces a sample that sanitizes (schema-conformant, content-free)", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseTrendSink((s) => seen.push(s));
    for (const v of RELEASE_TREND_VERDICTS) recordReleaseTrend(v);
    expect(seen).toHaveLength(RELEASE_TREND_VERDICTS.length);
    for (const sample of seen) {
      const clean = sanitizeMetric(sample);
      expect(clean, JSON.stringify(sample)).not.toBeNull();
      expect(clean!.labels.verdict).toBe(sample.labels.verdict);
    }
  });

  it("defaults to a no-op sink (nothing thrown when unset)", () => {
    resetReleaseTrendSink();
    expect(() => recordReleaseTrend("stable")).not.toThrow();
  });

  it("a throwing sink is the caller's concern (the record helper does not swallow)", () => {
    setReleaseTrendSink(() => {
      throw new Error("sink boom");
    });
    expect(() => recordReleaseTrend("stable")).toThrow();
    resetReleaseTrendSink();
    const spy = vi.fn();
    setReleaseTrendSink(spy);
    recordReleaseTrend("unknown");
    expect(spy).toHaveBeenCalledOnce();
  });
});
