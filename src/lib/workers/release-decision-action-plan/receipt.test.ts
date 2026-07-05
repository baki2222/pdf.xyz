import { describe, expect, it } from "vitest";
import { makePlan, notATrend, trendFor } from "./fixtures";
import { RELEASE_DECISION_ACTION_PLAN_DISCLOSURE } from "./types";

describe("release-decision-action-plan receipt — content-free summary", () => {
  it("flattens the plan verdict, urgency, action class, exit, and source into bounded fields", () => {
    const { receipt } = makePlan(trendFor("blocked"));
    expect(receipt.category).toBe("worker-release-decision-action-plan");
    expect(receipt.verdict).toBe("block-release");
    expect(receipt.urgency).toBe("critical");
    expect(receipt.actionClass).toBe("block-and-reconcile");
    expect(receipt.exitCode).toBe(4);
    expect(receipt.sourceState).toBe("usable");
    expect(receipt.sourceTrendVerdict).toBe("blocked");
    expect(receipt.at).toBe("2026-07-04T00:00:00.000Z");
  });

  it("records the emitted / considered / dropped action counts", () => {
    const full = makePlan(trendFor("blocked"));
    expect(full.receipt.actionsConsidered).toBe(4);
    expect(full.receipt.actionsEmitted).toBe(4);
    expect(full.receipt.actionsDropped).toBe(0);

    const capped = makePlan(trendFor("blocked"), { maxActions: 2 });
    expect(capped.receipt.actionsEmitted).toBe(2);
    expect(capped.receipt.actionsConsidered).toBe(4);
    expect(capped.receipt.actionsDropped).toBe(2);
  });

  it("surfaces the untrusted claimed verdict for a tampered / unreadable source", () => {
    expect(makePlan(notATrend()).receipt.sourceState).toBe("unreadable");
    expect(makePlan(notATrend()).receipt.sourceTrendVerdict).toBeNull();
  });

  it("records the strict-escalation flag", () => {
    expect(makePlan(trendFor("watch"), { strict: true }).receipt.strictEscalated).toBe(true);
    expect(makePlan(trendFor("watch")).receipt.strictEscalated).toBe(false);
  });

  it("carries the authored disclosure statement (not sign-off / approval / audit log)", () => {
    const { receipt } = makePlan(trendFor("stable"));
    expect(receipt.disclosure).toBe(RELEASE_DECISION_ACTION_PLAN_DISCLOSURE);
    expect(receipt.disclosure).toMatch(/content-free operational follow-up plan ONLY/);
    expect(receipt.disclosure).toMatch(/NOT a legal \/ compliance sign-off/);
  });
});
