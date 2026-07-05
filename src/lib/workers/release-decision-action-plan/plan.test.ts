import { describe, expect, it } from "vitest";
import { ingestTrendObj, notATrend, tamperedTrend, trendFor } from "./fixtures";
import { computeActionPlan, sourceState } from "./plan";
import type { ReleaseDecisionActionPlanPolicy } from "./types";

const LOOSE: ReleaseDecisionActionPlanPolicy = { strict: false, maxActions: 8 };
const STRICT: ReleaseDecisionActionPlanPolicy = { strict: true, maxActions: 8 };

/** Fold a real trend-verdict fixture into its plan rollup under `policy`. */
function planFor(verdict: Parameters<typeof trendFor>[0], policy = LOOSE) {
  return computeActionPlan(ingestTrendObj(trendFor(verdict)), policy).rollup;
}

describe("release-decision-action-plan fold — source trend → plan", () => {
  it("maps each trend verdict to the documented plan verdict / urgency / action class / exit", () => {
    const table = [
      ["stable", "clear", "none", "none", 0],
      ["improving", "monitor", "low", "monitor-next-window", 0],
      ["watch", "monitor", "medium", "review-followups", 3],
      ["degrading", "monitor", "high", "stabilize-regression", 3],
      ["insufficient", "investigate", "medium", "restore-evidence", 2],
      ["blocked", "block-release", "critical", "block-and-reconcile", 4],
      ["invalid", "block-release", "critical", "restore-evidence", 4],
    ] as const;
    for (const [tv, verdict, urgency, actionClass, exit] of table) {
      const r = planFor(tv);
      expect(r.verdict, tv).toBe(verdict);
      expect(r.urgency, tv).toBe(urgency);
      expect(r.actionClass, tv).toBe(actionClass);
      expect(r.exitCode, tv).toBe(exit);
    }
  });

  it("a benign improving monitor is exit 0; a watch / degrading monitor is exit 3", () => {
    expect(planFor("improving").benignMonitor).toBe(true);
    expect(planFor("improving").exitCode).toBe(0);
    expect(planFor("watch").benignMonitor).toBe(false);
    expect(planFor("degrading").benignMonitor).toBe(false);
  });

  it("only `clear` sets the clear flag", () => {
    expect(planFor("stable").clear).toBe(true);
    for (const v of ["improving", "watch", "degrading", "insufficient", "blocked", "invalid"] as const) {
      expect(planFor(v).clear, v).toBe(false);
    }
  });

  it("an untrustworthy input (unreadable / tampered) is invalid / reject-input / exit 4", () => {
    const unreadable = computeActionPlan(ingestTrendObj(notATrend()), LOOSE).rollup;
    expect(unreadable.verdict).toBe("invalid");
    expect(unreadable.actionClass).toBe("reject-input");
    expect(unreadable.exitCode).toBe(4);
    expect(unreadable.reasons).toContain("trend-unreadable");

    const tampered = computeActionPlan(ingestTrendObj(tamperedTrend()), LOOSE).rollup;
    expect(tampered.verdict).toBe("invalid");
    expect(tampered.reasons).toContain("trend-tampered");
  });

  it("fires the matching reason for each source posture", () => {
    expect(planFor("stable").reasons).toEqual([]);
    expect(planFor("improving").reasons).toContain("trend-improving");
    expect(planFor("watch").reasons).toContain("trend-watch");
    expect(planFor("degrading").reasons).toContain("trend-degrading");
    expect(planFor("insufficient").reasons).toContain("trend-insufficient");
    expect(planFor("blocked").reasons).toContain("trend-blocked");
    expect(planFor("invalid").reasons).toContain("trend-invalid");
  });

  describe("--strict escalation", () => {
    it("escalates a non-clear monitor / investigate plan to block-release, urgency critical", () => {
      for (const [v, from] of [
        ["improving", "monitor"],
        ["watch", "monitor"],
        ["degrading", "monitor"],
        ["insufficient", "investigate"],
      ] as const) {
        const r = planFor(v, STRICT);
        expect(r.verdict, v).toBe("block-release");
        expect(r.urgency, v).toBe("critical");
        expect(r.actionClass, v).toBe("block-and-reconcile");
        expect(r.exitCode, v).toBe(4);
        expect(r.strictEscalated, v).toBe(true);
        expect(r.strictEscalatedFrom, v).toBe(from);
        expect(r.reasons, v).toContain("strict-escalation");
      }
    });

    it("never fabricates approval for a clear trend (stable stays clear)", () => {
      const r = planFor("stable", STRICT);
      expect(r.verdict).toBe("clear");
      expect(r.exitCode).toBe(0);
      expect(r.strictEscalated).toBe(false);
      expect(r.strictEscalatedFrom).toBeNull();
    });

    it("leaves an already-blocking / invalid plan unchanged (no strict escalation reason)", () => {
      const blocked = planFor("blocked", STRICT);
      expect(blocked.verdict).toBe("block-release");
      expect(blocked.strictEscalated).toBe(false);
      const invalid = computeActionPlan(ingestTrendObj(tamperedTrend()), STRICT).rollup;
      expect(invalid.verdict).toBe("invalid");
      expect(invalid.strictEscalated).toBe(false);
    });
  });

  it("reports the source coverage state", () => {
    expect(sourceState(ingestTrendObj(trendFor("stable")))).toBe("usable");
    expect(sourceState(ingestTrendObj(tamperedTrend()))).toBe("tampered");
    expect(sourceState(ingestTrendObj(notATrend()))).toBe("unreadable");
  });
});
