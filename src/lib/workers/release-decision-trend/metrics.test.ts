import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionTrend,
  resetReleaseDecisionTrendSink,
  setReleaseDecisionTrendSink,
} from "./metrics";
import { releaseDecisionTrendMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_TREND_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-trend metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_TREND_VERDICTS) {
      const sample = releaseDecisionTrendMetric(verdict);
      expect(sample).toEqual({
        metric: "worker_release_decision_trend_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_TREND_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionTrendMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionTrend("stable")).not.toThrow(); // default no-op
    setReleaseDecisionTrendSink((s) => seen.push(s));
    recordReleaseDecisionTrend("degrading");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("degrading");
    resetReleaseDecisionTrendSink();
    recordReleaseDecisionTrend("invalid");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
