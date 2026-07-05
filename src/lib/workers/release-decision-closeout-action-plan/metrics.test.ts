import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutActionPlan,
  resetReleaseDecisionCloseoutActionPlanSink,
  setReleaseDecisionCloseoutActionPlanSink,
} from "./metrics";
import { releaseDecisionCloseoutActionPlanMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-action-plan metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICTS) {
      expect(releaseDecisionCloseoutActionPlanMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_action_plan_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutActionPlanMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutActionPlan("clear")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutActionPlanSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutActionPlan("block-release");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("block-release");
    resetReleaseDecisionCloseoutActionPlanSink();
    recordReleaseDecisionCloseoutActionPlan("monitor");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
