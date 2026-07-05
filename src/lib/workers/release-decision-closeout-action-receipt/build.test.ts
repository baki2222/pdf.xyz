import { describe, expect, it } from "vitest";
import {
  NOW,
  blockedPlan,
  clearPlan,
  investigatePlan,
  makeReceipt,
  monitorPlan,
  notAPlan,
  policyWith,
} from "./fixtures";
import { releaseDecisionCloseoutActionReceiptExitCode } from "./types";

describe("release-decision-closeout-action-receipt build — result assembly", () => {
  it("assembles a stable, content-free completed result over a clear plan", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true }));
    expect(result.schema).toBe("pdfxyz.release-decision-closeout-action-receipt/1");
    expect(result.generatedAt).toBe(NOW);
    expect(result.metadata.planSchema).toBe("pdfxyz.release-decision-closeout-action-plan/1");
    expect(result.verdict).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.planClass).toBe("clear");
    expect(result.source.state).toBe("usable");
    expect(result.source.claimedPlanVerdict).toBe("clear");
    expect(result.source.sourceTrendVerdict).toBe("trend-stable");
    expect(result.closeoutActionReceipt.verdict).toBe("completed");
    expect(releaseDecisionCloseoutActionReceiptExitCode(result)).toBe(0);
    expect(result.guidance.length).toBeGreaterThan(0);
    expect(result.caveats.length).toBeGreaterThan(0);
  });

  it("flattens a content-free receipt with the acknowledgement coverage counts", () => {
    const result = makeReceipt(blockedPlan(), policyWith({ plan: true, block: true }));
    // block plan, ack-plan + ack-block but no ack-executed → incomplete (held but not complete).
    expect(result.verdict).toBe("incomplete");
    const r = result.receipt;
    expect(r.category).toBe("worker-release-decision-closeout-action-receipt");
    expect(r.planClass).toBe("block");
    expect(r.sourceState).toBe("usable");
    expect(r.acksRequired).toBe(3); // plan, executed, block
    expect(r.acksSatisfied).toBe(2); // plan + block supplied
    expect(r.acksMissing).toBe(1); // executed
    expect(r.acksMismatched).toBe(0);
    expect(r.disclosure).toMatch(/content-free operational execution receipt/i);
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
    });
    // An unreadable plan fails closed to blocked (Phase 68), never a vacuous completed pass.
    expect(unreadable.verdict).toBe("blocked");
  });

  it("surfaces the plan urgency / action class / latest index for a usable investigate plan", () => {
    const result = makeReceipt(investigatePlan(), policyWith({ plan: true }));
    expect(result.source.planUrgency).toBe("medium");
    expect(result.source.planActionClass).toBe("complete-evidence");
    expect(result.source.sourceTrendVerdict).toBe("trend-incomplete");
  });

  it("carries a canonical acknowledgement checklist + fired reasons on a monitor plan", () => {
    const result = makeReceipt(monitorPlan(), policyWith({ plan: true }));
    expect(result.acknowledgements.map((a) => a.id)).toEqual([
      "plan",
      "executed",
      "monitor",
      "investigation",
      "block",
    ]);
    expect(result.reasons.map((r) => r.id)).toEqual(["monitor-followup-open"]);
    expect(result.verdict).toBe("followup-open");
  });
});
