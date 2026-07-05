import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerMetricSample } from "../observability/metrics";
import {
  recordReleaseDecisionCloseoutGovernance,
  resetReleaseDecisionCloseoutGovernanceSink,
  setReleaseDecisionCloseoutGovernanceSink,
} from "./metrics";

afterEach(() => resetReleaseDecisionCloseoutGovernanceSink());

describe("release-decision-closeout-governance metrics — content-free sink", () => {
  it("emits one bounded counter sample per verdict", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseDecisionCloseoutGovernanceSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernance("governance-blocked");
    expect(seen).toEqual([
      {
        metric: "worker_release_decision_closeout_governance_total",
        kind: "counter",
        labels: { verdict: "governance-blocked" },
        value: 1,
      },
    ]);
  });

  it("defaults to a no-op sink after reset (nothing collected)", () => {
    const spy = vi.fn();
    setReleaseDecisionCloseoutGovernanceSink(spy);
    resetReleaseDecisionCloseoutGovernanceSink();
    recordReleaseDecisionCloseoutGovernance("closed");
    expect(spy).not.toHaveBeenCalled();
  });

  it("only ever carries the bounded verdict label (no reason / count / locator)", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseDecisionCloseoutGovernanceSink((s) => seen.push(s));
    for (const v of ["closed", "governance-incomplete", "governance-open", "governance-blocked"] as const) {
      recordReleaseDecisionCloseoutGovernance(v);
    }
    for (const s of seen) expect(Object.keys(s.labels)).toEqual(["verdict"]);
  });
});
