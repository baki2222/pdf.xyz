import { describe, expect, it } from "vitest";
import { buildActions, computeActionPlan, sourceState } from "./actions";
import { defaultPolicy, ingestTrendObj, notATrend, tamperedTrend, trendFor } from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/types";

/** Fold a real trend of the given source verdict under an optional policy. */
function plan(
  v: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
  over: { strictWatch?: boolean; requireClean?: boolean } = {},
) {
  return computeActionPlan(ingestTrendObj(trendFor(v)), defaultPolicy(over));
}

describe("computeActionPlan — fail-closed verdict mapping", () => {
  it("maps each source trend verdict to the documented plan verdict + urgency + exit + action class", () => {
    expect(plan("stable").rollup).toMatchObject({ verdict: "clear", urgency: "routine", exitCode: 0, actionClass: "none" });
    expect(plan("improving").rollup).toMatchObject({
      verdict: "clear",
      urgency: "routine",
      exitCode: 0,
      actionClass: "confirm-improvement",
    });
    expect(plan("watch").rollup).toMatchObject({
      verdict: "monitor",
      urgency: "soon",
      exitCode: 3,
      actionClass: "monitor-followups",
    });
    expect(plan("degrading").rollup).toMatchObject({
      verdict: "monitor",
      urgency: "high",
      exitCode: 3,
      actionClass: "stabilize-regression",
    });
    expect(plan("insufficient").rollup).toMatchObject({
      verdict: "investigate",
      urgency: "soon",
      exitCode: 2,
      actionClass: "complete-evidence",
    });
    expect(plan("blocked").rollup).toMatchObject({
      verdict: "block-release",
      urgency: "immediate",
      exitCode: 4,
      actionClass: "block-and-reconcile",
    });
    expect(plan("invalid").rollup).toMatchObject({
      verdict: "block-release",
      urgency: "immediate",
      exitCode: 4,
      actionClass: "restore-history",
    });
  }, 30_000); // builds all seven real trends first-time (~1s each)

  it("fires exactly one base reason per source verdict", () => {
    expect(plan("stable").rollup.reasons).toEqual(["trend-stable"]);
    expect(plan("improving").rollup.reasons).toEqual(["trend-improving"]);
    expect(plan("watch").rollup.reasons).toEqual(["trend-watch"]);
    expect(plan("degrading").rollup.reasons).toEqual(["trend-degrading"]);
    expect(plan("insufficient").rollup.reasons).toEqual(["trend-insufficient"]);
    expect(plan("blocked").rollup.reasons).toEqual(["trend-blocked"]);
    expect(plan("invalid").rollup.reasons).toEqual(["trend-invalid"]);
  });

  it("an unreadable trend input is invalid / reject-input, never a vacuous clear", () => {
    const r = computeActionPlan(ingestTrendObj(notATrend()), defaultPolicy());
    expect(r.rollup).toMatchObject({ verdict: "invalid", exitCode: 4, urgency: "immediate", actionClass: "reject-input" });
    expect(r.rollup.reasons).toEqual(["trend-unreadable"]);
  });

  it("a tampered trend input is invalid / reject-input", () => {
    const r = computeActionPlan(ingestTrendObj(tamperedTrend()), defaultPolicy());
    expect(r.rollup).toMatchObject({ verdict: "invalid", exitCode: 4, actionClass: "reject-input" });
    expect(r.rollup.reasons).toEqual(["trend-tampered"]);
  });
});

describe("computeActionPlan — --strict-watch escalation", () => {
  it("escalates a monitor plan (watch / degrading) to block-release, recording the escalation", () => {
    const r = plan("watch", { strictWatch: true });
    expect(r.rollup).toMatchObject({
      verdict: "block-release",
      exitCode: 4,
      urgency: "immediate",
      actionClass: "block-and-reconcile",
      strictWatchEscalated: true,
      escalatedFrom: "monitor",
    });
    // Both the base watch reason and the escalation reason fire, blocking first.
    expect(r.rollup.reasons).toEqual(["strict-watch-escalation", "trend-watch"]);
    expect(r.rollup.detail).toMatch(/strict-watch|policy escalation/i);
    expect(plan("degrading", { strictWatch: true }).rollup.verdict).toBe("block-release");
  });

  it("does NOT escalate a clear / investigate / block-release plan", () => {
    expect(plan("stable", { strictWatch: true }).rollup).toMatchObject({ verdict: "clear", strictWatchEscalated: false });
    expect(plan("improving", { strictWatch: true }).rollup).toMatchObject({ verdict: "clear", strictWatchEscalated: false });
    expect(plan("insufficient", { strictWatch: true }).rollup).toMatchObject({
      verdict: "investigate",
      strictWatchEscalated: false,
    });
    expect(plan("blocked", { strictWatch: true }).rollup).toMatchObject({
      verdict: "block-release",
      strictWatchEscalated: false,
    });
  });
});

describe("computeActionPlan — --require-clean escalation", () => {
  it("escalates every non-clear plan (monitor / investigate) to block-release", () => {
    expect(plan("watch", { requireClean: true }).rollup).toMatchObject({
      verdict: "block-release",
      requireCleanEscalated: true,
      escalatedFrom: "monitor",
    });
    expect(plan("insufficient", { requireClean: true }).rollup).toMatchObject({
      verdict: "block-release",
      requireCleanEscalated: true,
      escalatedFrom: "investigate",
    });
    expect(plan("insufficient", { requireClean: true }).rollup.reasons).toEqual([
      "require-clean-escalation",
      "trend-insufficient",
    ]);
  });

  it("leaves a clear (stable / improving) plan clear, and never weakens the invalid input precedence", () => {
    expect(plan("stable", { requireClean: true }).rollup.verdict).toBe("clear");
    expect(plan("improving", { requireClean: true }).rollup.verdict).toBe("clear");
    // An unreadable input stays INVALID (not downgraded to block-release) — invalid precedence is never weakened.
    const r = computeActionPlan(ingestTrendObj(notATrend()), defaultPolicy({ requireClean: true }));
    expect(r.rollup.verdict).toBe("invalid");
    expect(r.rollup.requireCleanEscalated).toBe(false);
  });

  it("both knobs on a watch trend fire both escalation reasons, canonically ordered", () => {
    const r = plan("watch", { strictWatch: true, requireClean: true });
    expect(r.rollup.verdict).toBe("block-release");
    expect(r.rollup.reasons).toEqual(["strict-watch-escalation", "require-clean-escalation", "trend-watch"]);
  });
});

describe("sourceState + buildActions", () => {
  it("resolves the coverage state from the recognized / usable flags", () => {
    expect(sourceState(ingestTrendObj(trendFor("stable")))).toBe("usable");
    expect(sourceState(ingestTrendObj(tamperedTrend()))).toBe("tampered");
    expect(sourceState(ingestTrendObj(notATrend()))).toBe("unreadable");
  });

  it("a clean stable trend recommends continue-finalization-cadence, ending with keep-action-plan", () => {
    const items = buildActions(["trend-stable"]);
    expect(items.map((i) => i.id)).toEqual(["continue-finalization-cadence", "keep-action-plan"]);
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
      "track-watch-followups",
      "re-summarize-after-fix",
      "keep-action-plan",
    ]);
  });
});
