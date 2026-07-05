import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutIndexTrend,
  resetReleaseDecisionCloseoutIndexTrendSink,
  setReleaseDecisionCloseoutIndexTrendSink,
} from "./metrics";
import { releaseDecisionCloseoutIndexTrendMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-index-trend metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS) {
      expect(releaseDecisionCloseoutIndexTrendMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_index_trend_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutIndexTrendMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutIndexTrend("trend-stable")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutIndexTrendSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutIndexTrend("trend-blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("trend-blocked");
    resetReleaseDecisionCloseoutIndexTrendSink();
    recordReleaseDecisionCloseoutIndexTrend("trend-watch");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
