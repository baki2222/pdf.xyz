import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceActionPlan,
  resetReleaseDecisionCloseoutGovernanceActionPlanSink,
  setReleaseDecisionCloseoutGovernanceActionPlanSink,
} from "./metrics";
import { releaseDecisionCloseoutGovernanceActionPlanMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-governance-action-plan metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS) {
      expect(releaseDecisionCloseoutGovernanceActionPlanMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_action_plan_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutGovernanceActionPlanMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutGovernanceActionPlan("clear")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutGovernanceActionPlanSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceActionPlan("block-release");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("block-release");
    resetReleaseDecisionCloseoutGovernanceActionPlanSink();
    recordReleaseDecisionCloseoutGovernanceActionPlan("monitor");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
