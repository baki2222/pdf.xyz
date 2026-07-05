import { describe, expect, it } from "vitest";
import { makePlan, trendFor } from "./fixtures";
import { renderReleaseDecisionActionPlan } from "./render";

describe("release-decision-action-plan render", () => {
  it("json is stable, parseable, and round-trips the result", () => {
    const result = makePlan(trendFor("degrading"));
    const json = renderReleaseDecisionActionPlan(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(result)));
  });

  it("compact json drops indentation", () => {
    const result = makePlan(trendFor("stable"));
    expect(renderReleaseDecisionActionPlan(result, "json", false)).not.toContain("\n  ");
  });

  it("text renders the plan verdict, urgency, action class, reasons, source, and actions", () => {
    const text = renderReleaseDecisionActionPlan(makePlan(trendFor("blocked")), "text");
    expect(text).toMatch(/PLAN: BLOCK-RELEASE \(exit 4\)/);
    expect(text).toMatch(/urgency: critical {3}action: block-and-reconcile/);
    expect(text).toMatch(/reasons: trend-blocked/);
    expect(text).toMatch(/SOURCE TREND/);
    expect(text).toMatch(/verdict=blocked/);
    expect(text).toMatch(/NEXT ACTIONS/);
    expect(text).toMatch(/reconcile-blocked-window/);
    expect(text).toMatch(/CAVEATS/);
  });

  it("text marks blocking actions and shows the dropped-action count under a cap", () => {
    const text = renderReleaseDecisionActionPlan(makePlan(trendFor("blocked"), { maxActions: 1 }), "text");
    expect(text).toMatch(/! \[critical\/must-complete-before-release\] reconcile-blocked-window/);
    expect(text).toMatch(/dropped by --max-actions=1/);
  });

  it("text explains a strict escalation", () => {
    const text = renderReleaseDecisionActionPlan(makePlan(trendFor("watch"), { strict: true }), "text");
    expect(text).toMatch(/PLAN: BLOCK-RELEASE/);
    expect(text).toMatch(/strict, escalated/);
    expect(text).toMatch(/strict-escalation/);
  });

  it("a clear plan renders exit 0 with a continue-cadence action", () => {
    const text = renderReleaseDecisionActionPlan(makePlan(trendFor("stable")), "text");
    expect(text).toMatch(/PLAN: CLEAR \(exit 0\)/);
    expect(text).toMatch(/continue-decision-cadence/);
  });
});
