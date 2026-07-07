import { describe, expect, it } from "vitest";
import { buildActions, computeActionPlan, sourceState } from "./actions";
import { defaultPolicy, ingestTrendObj, notATrend, tamperedTrend, trendFor } from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy } from "./types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/types";

/** Fold a real trend of the given source verdict under an optional policy. */
function plan(
  v: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy> = {},
) {
  return computeActionPlan(ingestTrendObj(trendFor(v)), defaultPolicy(over));
}

describe("computeActionPlan — fail-closed verdict mapping", () => {
  it("maps each source trend verdict to the documented plan verdict + urgency + exit + action class", () => {
    expect(plan("stable").rollup).toMatchObject({ verdict: "clear", urgency: "routine", exitCode: 0, actionClass: "none" });
    // improving is a BENIGN monitor (low/routine urgency, exit 3) — never a clear, never a block by default.
    expect(plan("improving").rollup).toMatchObject({
      verdict: "monitor",
      urgency: "routine",
      exitCode: 3,
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
    // A trend whose OWN verdict is invalid (an untrustworthy window in its history) is INVALID (exit 4), not block-release.
    expect(plan("invalid").rollup).toMatchObject({
      verdict: "invalid",
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

  it("counts the fired reason severities (an invalid-history trend is invalid, a blocked trend is blocking)", () => {
    expect(plan("invalid").rollup).toMatchObject({ invalidInputs: 1, blocking: 0 });
    expect(plan("blocked").rollup).toMatchObject({ invalidInputs: 0, blocking: 1 });
    expect(plan("improving").rollup).toMatchObject({ advisories: 1, informationals: 0 });
    expect(plan("stable").rollup).toMatchObject({ advisories: 0, informationals: 1 });
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

describe("computeActionPlan — --strict escalation", () => {
  it("escalates every non-clear MONITOR plan (improving / watch / degrading) to block-release, recording the escalation", () => {
    const r = plan("watch", { strict: true });
    expect(r.rollup).toMatchObject({
      verdict: "block-release",
      exitCode: 4,
      urgency: "immediate",
      actionClass: "block-and-reconcile",
      strict: true,
      strictEscalated: true,
      escalatedFrom: "monitor",
    });
    // Both the base watch reason and the escalation reason fire, the blocking one first (canonical order).
    expect(r.rollup.reasons).toEqual(["strict-escalation", "trend-watch"]);
    expect(r.rollup.detail).toMatch(/strict|escalat/i);
    expect(plan("degrading", { strict: true }).rollup.verdict).toBe("block-release");
    expect(plan("improving", { strict: true }).rollup).toMatchObject({
      verdict: "block-release",
      strictEscalated: true,
      escalatedFrom: "monitor",
    });
  });

  it("escalates an INVESTIGATE plan (insufficient) to block-release, escalatedFrom investigate", () => {
    const r = plan("insufficient", { strict: true });
    expect(r.rollup).toMatchObject({
      verdict: "block-release",
      strictEscalated: true,
      escalatedFrom: "investigate",
    });
    expect(r.rollup.reasons).toEqual(["strict-escalation", "trend-insufficient"]);
  });

  it("does NOT escalate a clear / block-release / invalid plan, and never weakens the invalid precedence", () => {
    expect(plan("stable", { strict: true }).rollup).toMatchObject({ verdict: "clear", strictEscalated: false });
    expect(plan("blocked", { strict: true }).rollup).toMatchObject({ verdict: "block-release", strictEscalated: false });
    expect(plan("invalid", { strict: true }).rollup).toMatchObject({ verdict: "invalid", strictEscalated: false });
    // An unreadable input stays INVALID (not downgraded to block-release) — invalid precedence is never weakened.
    const r = computeActionPlan(ingestTrendObj(notATrend()), defaultPolicy({ strict: true }));
    expect(r.rollup.verdict).toBe("invalid");
    expect(r.rollup.strictEscalated).toBe(false);
  });
});

describe("sourceState + buildActions", () => {
  it("resolves the coverage state from the recognized / usable flags", () => {
    expect(sourceState(ingestTrendObj(trendFor("stable")))).toBe("usable");
    expect(sourceState(ingestTrendObj(tamperedTrend()))).toBe("tampered");
    expect(sourceState(ingestTrendObj(notATrend()))).toBe("unreadable");
  });

  it("a clean stable trend recommends continue-closeout-cadence, ending with keep-action-plan", () => {
    const built = buildActions(["trend-stable"], 8);
    expect(built.items.map((i) => i.id)).toEqual(["continue-closeout-cadence", "keep-action-plan"]);
    expect(built.items.every((i) => !i.blocking)).toBe(true);
    expect(built).toMatchObject({ considered: 2, dropped: 0 });
  });

  it("a blocked trend surfaces the reconcile + hold-promotion blocking steps, then keep-action-plan last", () => {
    const built = buildActions(["trend-blocked"], 8);
    expect(built.items.map((i) => i.id)).toEqual([
      "reconcile-blocked-history",
      "hold-promotion",
      "re-summarize-after-fix",
      "keep-action-plan",
    ]);
    expect(built.items.find((i) => i.id === "hold-promotion")?.blocking).toBe(true);
  });

  it("deduplicates the union of reason actions and always emits in canonical order", () => {
    // strict escalation folds hold-promotion onto the watch posture's actions, deduped + canonically ordered.
    const built = buildActions(["strict-escalation", "trend-watch"], 8);
    expect(built.items.map((i) => i.id)).toEqual([
      "hold-promotion",
      "track-watch-followups",
      "re-summarize-after-fix",
      "keep-action-plan",
    ]);
  });

  it("--max-actions caps the checklist to the highest-priority N and surfaces the dropped count", () => {
    const full = buildActions(["trend-blocked"], 8); // 4 candidates
    expect(full.considered).toBe(4);
    const capped = buildActions(["trend-blocked"], 2);
    expect(capped.items.map((i) => i.id)).toEqual(["reconcile-blocked-history", "hold-promotion"]);
    expect(capped).toMatchObject({ considered: 4, dropped: 2 });
  });
});
