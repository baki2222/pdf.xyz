import { describe, expect, it } from "vitest";
import {
  NOW,
  blockPlan,
  clearPlan,
  invalidPlan,
  investigatePlan,
  makeReceipt,
  monitorPlan,
  notAPlan,
  policyWith,
} from "./fixtures";
import { releaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode } from "./types";

describe("finalize-index-trend-action-receipt build — result assembly", () => {
  it("assembles a stable, content-free completed result over a clear plan", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true }));
    expect(result.schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1");
    expect(result.generatedAt).toBe(NOW);
    expect(result.metadata.planSchema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1",
    );
    expect(result.verdict).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.planClass).toBe("clear");
    expect(result.source.state).toBe("usable");
    expect(result.source.claimedPlanVerdict).toBe("clear");
    expect(result.source.sourceTrendVerdict).toBe("stable");
    expect(result.actionReceipt.verdict).toBe("completed");
    expect(result.nextActions).toEqual(["keep-action-receipt"]);
    expect(releaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode(result)).toBe(0);
    expect(result.guidance.length).toBeGreaterThan(0);
    expect(result.caveats.length).toBeGreaterThan(0);
  });

  it("flattens a content-free receipt with the acknowledgement coverage counts (block held-incomplete)", () => {
    const result = makeReceipt(blockPlan(), policyWith({ plan: true, block: true }));
    // block plan, ack-plan + ack-block but no ack-executed → still blocked (held but not complete).
    expect(result.verdict).toBe("blocked");
    const r = result.receipt;
    expect(r.category).toBe("worker-release-decision-closeout-governance-finalize-index-trend-action-receipt");
    expect(r.planClass).toBe("block");
    expect(r.sourceState).toBe("usable");
    expect(r.acksRequired).toBe(3); // plan, executed, block
    expect(r.acksSatisfied).toBe(2); // plan + block supplied
    expect(r.acksMissing).toBe(1); // executed
    expect(r.acksMismatched).toBe(0);
    expect(r.disclosure).toMatch(/content-free operational acknowledgement receipt/i);
  });

  it("records the source summary for a not-usable plan without inventing facts", () => {
    const unreadable = makeReceipt(notAPlan(), policyWith({ plan: true }));
    expect(unreadable.source).toMatchObject({
      state: "unreadable",
      claimedPlanVerdict: null,
      planClass: null,
      planUrgency: null,
      planActionClass: null,
      sourceTrendVerdict: null,
      sourceLatestIndex: null,
      blockingActions: 0,
      advisoryActions: 0,
      planStrictWatch: false,
      planRequireClean: false,
    });
    // An unreadable plan fails closed to invalid (Phase 78), never a vacuous completed pass.
    expect(unreadable.verdict).toBe("invalid");
  });

  it("a plan whose own verdict is invalid surfaces its claim but has no plan class", () => {
    const result = makeReceipt(invalidPlan(), policyWith({ plan: true, executed: true }));
    expect(result.verdict).toBe("invalid");
    expect(result.planClass).toBeNull();
    expect(result.source.claimedPlanVerdict).toBe("invalid");
    expect(result.source.state).toBe("usable");
    expect(result.nextActions).toEqual(["recover-valid-plan", "keep-action-receipt"]);
  });

  it("surfaces the plan urgency / action class / source trend for a usable investigate plan", () => {
    const result = makeReceipt(investigatePlan(), policyWith({ plan: true }));
    expect(result.source.planUrgency).toBe("soon");
    expect(result.source.planActionClass).toBe("complete-evidence");
    expect(result.source.sourceTrendVerdict).toBe("insufficient");
  });

  it("carries a canonical acknowledgement checklist + fired reasons on a monitor plan", () => {
    const result = makeReceipt(monitorPlan(), policyWith({ plan: true }));
    expect(result.acknowledgements.map((a) => a.id)).toEqual([
      "plan",
      "executed",
      "monitor",
      "investigation",
      "block",
      "clear",
    ]);
    expect(result.reasons.map((r) => r.id)).toEqual(["monitor-incomplete"]);
    expect(result.verdict).toBe("incomplete");
  });
});
