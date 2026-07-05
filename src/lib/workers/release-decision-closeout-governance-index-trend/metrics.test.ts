import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceIndexTrend,
  resetReleaseDecisionCloseoutGovernanceIndexTrendSink,
  setReleaseDecisionCloseoutGovernanceIndexTrendSink,
} from "./metrics";
import { releaseDecisionCloseoutGovernanceIndexTrendMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-governance-index-trend metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS) {
      expect(releaseDecisionCloseoutGovernanceIndexTrendMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_index_trend_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutGovernanceIndexTrendMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutGovernanceIndexTrend("trend-stable")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutGovernanceIndexTrendSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceIndexTrend("trend-blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("trend-blocked");
    resetReleaseDecisionCloseoutGovernanceIndexTrendSink();
    recordReleaseDecisionCloseoutGovernanceIndexTrend("trend-watch");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
