import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionActionPlan,
  resetReleaseDecisionActionPlanSink,
  setReleaseDecisionActionPlanSink,
} from "./metrics";
import { releaseDecisionActionPlanMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_ACTION_PLAN_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-action-plan metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_ACTION_PLAN_VERDICTS) {
      expect(releaseDecisionActionPlanMetric(verdict)).toEqual({
        metric: "worker_release_decision_action_plan_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_ACTION_PLAN_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionActionPlanMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionActionPlan("clear")).not.toThrow(); // default no-op
    setReleaseDecisionActionPlanSink((s) => seen.push(s));
    recordReleaseDecisionActionPlan("block-release");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("block-release");
    resetReleaseDecisionActionPlanSink();
    recordReleaseDecisionActionPlan("invalid");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
