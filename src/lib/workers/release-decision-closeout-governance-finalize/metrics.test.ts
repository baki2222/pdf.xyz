import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerMetricSample } from "../observability/metrics";
import {
  recordReleaseDecisionCloseoutGovernanceFinalize,
  resetReleaseDecisionCloseoutGovernanceFinalizeSink,
  setReleaseDecisionCloseoutGovernanceFinalizeSink,
} from "./metrics";

afterEach(() => resetReleaseDecisionCloseoutGovernanceFinalizeSink());

describe("release-decision-closeout-governance-finalize metrics — content-free sink", () => {
  it("emits one bounded counter sample per verdict", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseDecisionCloseoutGovernanceFinalizeSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceFinalize("finalize-blocked");
    expect(seen).toEqual([
      {
        metric: "worker_release_decision_closeout_governance_finalize_total",
        kind: "counter",
        labels: { verdict: "finalize-blocked" },
        value: 1,
      },
    ]);
  });

  it("defaults to a no-op sink after reset (nothing collected)", () => {
    const spy = vi.fn();
    setReleaseDecisionCloseoutGovernanceFinalizeSink(spy);
    resetReleaseDecisionCloseoutGovernanceFinalizeSink();
    recordReleaseDecisionCloseoutGovernanceFinalize("finalized");
    expect(spy).not.toHaveBeenCalled();
  });

  it("only ever carries the bounded verdict label (no reason / count / locator)", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseDecisionCloseoutGovernanceFinalizeSink((s) => seen.push(s));
    for (const v of ["finalized", "finalize-incomplete", "finalize-open", "finalize-blocked"] as const) {
      recordReleaseDecisionCloseoutGovernanceFinalize(v);
    }
    for (const s of seen) expect(Object.keys(s.labels)).toEqual(["verdict"]);
  });
});
