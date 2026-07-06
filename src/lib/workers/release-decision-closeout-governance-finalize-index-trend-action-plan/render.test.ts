import { describe, expect, it } from "vitest";
import { blockedTrend, degradingTrend, makePlan, stableTrend } from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan } from "./render";

describe("renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan", () => {
  it("json is stable, parseable, and round-trips the schema + verdict", () => {
    const result = makePlan(degradingTrend());
    const json = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1");
    expect(parsed.verdict).toBe("monitor");
    expect(parsed.actionPlan.verdict).toBe("monitor");
  });

  it("compact json (pretty=false) has no newline indentation", () => {
    const result = makePlan(stableTrend());
    const compact = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(result, "json", false);
    expect(compact).not.toContain("\n  ");
  });

  it("text carries the plan verdict, source trend, reasons, and next actions", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(makePlan(blockedTrend()), "text");
    expect(text).toContain("PLAN: BLOCK-RELEASE (exit 4)");
    expect(text).toContain("SOURCE TREND");
    expect(text).toContain("verdict=blocked");
    expect(text).toContain("latest-index=index-blocked");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("reconcile-blocked-history");
    expect(text).toContain("CAVEATS");
  });

  it("text marks blocking steps with a bang and shows urgency/expectation", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(makePlan(blockedTrend()), "text");
    expect(text).toMatch(/! \[immediate\/must-complete-before-release\] hold-promotion/);
  });

  it("a clear plan renders exit 0 and the routine-cadence action", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlan(makePlan(stableTrend()), "text");
    expect(text).toContain("PLAN: CLEAR (exit 0)");
    expect(text).toContain("continue-finalization-cadence");
  });
});
