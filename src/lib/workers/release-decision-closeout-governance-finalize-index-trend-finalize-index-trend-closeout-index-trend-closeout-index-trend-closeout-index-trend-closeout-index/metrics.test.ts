import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndex as record,
  resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSink as reset,
  setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSink as setSink,
} from "./metrics";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexMetric as metric,
  sanitizeMetric,
} from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-…-closeout-index metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS) {
      expect(metric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS) {
      const clean = sanitizeMetric(metric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => record("all-closed")).not.toThrow(); // default no-op
    setSink((s) => seen.push(s));
    record("invalid");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("invalid");
    reset();
    record("incomplete");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
