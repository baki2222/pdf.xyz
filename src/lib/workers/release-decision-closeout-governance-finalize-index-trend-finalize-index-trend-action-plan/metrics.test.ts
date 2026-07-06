import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlan,
  resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanSink,
  setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanSink,
} from "./metrics";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanMetric,
  sanitizeMetric,
} from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("finalize-index-trend-action-plan metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS) {
      expect(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_plan_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlan("clear")).not.toThrow();
    setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlan("block-release");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("block-release");
    resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanSink();
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlan("monitor");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
