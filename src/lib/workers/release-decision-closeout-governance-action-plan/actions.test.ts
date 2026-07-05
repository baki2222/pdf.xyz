import { describe, expect, it } from "vitest";
import { buildActions, computeGovernanceActionPlan, sourceState } from "./actions";
import { defaultPolicy, ingestTrendObj, notATrend, tamperedTrend, trendFor } from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceIndexTrendVerdict } from "../release-decision-closeout-governance-index-trend/types";

/** Fold a real trend of the given source verdict under an optional policy. */
function plan(v: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict, strictWatch = false) {
  return computeGovernanceActionPlan(ingestTrendObj(trendFor(v)), defaultPolicy({ strictWatch }));
}

describe("computeGovernanceActionPlan — fail-closed verdict mapping", () => {
  it("maps each source trend verdict to the documented plan verdict + exit + action class", () => {
    expect(plan("trend-stable").rollup).toMatchObject({ verdict: "clear", exitCode: 0, actionClass: "none" });
    expect(plan("trend-incomplete").rollup).toMatchObject({
      verdict: "investigate",
      exitCode: 2,
      actionClass: "complete-evidence",
    });
    expect(plan("trend-watch").rollup).toMatchObject({
      verdict: "monitor",
      exitCode: 3,
      actionClass: "monitor-followups",
    });
    expect(plan("trend-blocked").rollup).toMatchObject({
      verdict: "block-release",
      exitCode: 4,
      actionClass: "block-and-reconcile",
    });
  });

  it("fires exactly one base reason per source verdict, in canonical order", () => {
    expect(plan("trend-stable").rollup.reasons).toEqual(["trend-stable"]);
    expect(plan("trend-incomplete").rollup.reasons).toEqual(["trend-incomplete"]);
    expect(plan("trend-watch").rollup.reasons).toEqual(["trend-watch"]);
    expect(plan("trend-blocked").rollup.reasons).toEqual(["trend-blocked"]);
  });

  it("an unreadable trend input is block-release / reject-input, never a vacuous clear", () => {
    const r = computeGovernanceActionPlan(ingestTrendObj(notATrend()), defaultPolicy());
    expect(r.rollup).toMatchObject({ verdict: "block-release", exitCode: 4, actionClass: "reject-input" });
    expect(r.rollup.reasons).toEqual(["trend-unreadable"]);
  });

  it("a tampered trend input is block-release / reject-input", () => {
    const r = computeGovernanceActionPlan(ingestTrendObj(tamperedTrend()), defaultPolicy());
    expect(r.rollup).toMatchObject({ verdict: "block-release", exitCode: 4, actionClass: "reject-input" });
    expect(r.rollup.reasons).toEqual(["trend-tampered"]);
  });
});

describe("computeGovernanceActionPlan — --strict-watch escalation", () => {
  it("escalates a monitor plan (trend-watch) to block-release, recording the escalation", () => {
    const r = plan("trend-watch", true);
    expect(r.rollup).toMatchObject({
      verdict: "block-release",
      exitCode: 4,
      actionClass: "block-and-reconcile",
      strictWatchEscalated: true,
      strictWatchEscalatedFrom: "monitor",
    });
    // Both the base watch reason and the escalation reason fire, blocking first.
    expect(r.rollup.reasons).toEqual(["strict-watch-escalation", "trend-watch"]);
    expect(r.rollup.detail).toMatch(/strict-watch/i);
  });

  it("does NOT escalate a clear / investigate / block-release plan", () => {
    expect(plan("trend-stable", true).rollup).toMatchObject({ verdict: "clear", strictWatchEscalated: false });
    expect(plan("trend-incomplete", true).rollup).toMatchObject({
      verdict: "investigate",
      strictWatchEscalated: false,
    });
    expect(plan("trend-blocked", true).rollup).toMatchObject({
      verdict: "block-release",
      strictWatchEscalated: false,
    });
  });
});

describe("sourceState + buildActions", () => {
  it("resolves the coverage state from the recognized / usable flags", () => {
    expect(sourceState(ingestTrendObj(trendFor("trend-stable")))).toBe("usable");
    expect(sourceState(ingestTrendObj(tamperedTrend()))).toBe("tampered");
    expect(sourceState(ingestTrendObj(notATrend()))).toBe("unreadable");
  });

  it("a clean stable trend recommends continue-governance-cadence, ending with keep-action-plan", () => {
    const items = buildActions(["trend-stable"]);
    expect(items.map((i) => i.id)).toEqual(["continue-governance-cadence", "keep-action-plan"]);
    expect(items.every((i) => !i.blocking)).toBe(true);
  });

  it("a blocked trend surfaces the reconcile + hold-promotion blocking steps, then keep-action-plan last", () => {
    const items = buildActions(["trend-blocked"]);
    expect(items.map((i) => i.id)).toEqual([
      "reconcile-blocked-history",
      "hold-promotion",
      "re-summarize-after-fix",
      "keep-action-plan",
    ]);
    expect(items.find((i) => i.id === "hold-promotion")?.blocking).toBe(true);
  });

  it("deduplicates the union of reason actions and always emits in canonical order", () => {
    // strict-watch escalation folds hold-promotion onto the watch posture's actions, deduped + canonically ordered.
    const items = buildActions(["strict-watch-escalation", "trend-watch"]);
    expect(items.map((i) => i.id)).toEqual([
      "hold-promotion",
      "track-watch-history",
      "re-summarize-after-fix",
      "keep-action-plan",
    ]);
  });
});
