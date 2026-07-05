import { describe, expect, it } from "vitest";
import { blockedPlan, clearPlan, makeReceipt, monitorPlan, notAPlan, policyWith } from "./fixtures";

describe("release-decision-closeout-action-receipt receipt — flattened + content-free", () => {
  it("flattens a completed clear receipt with its coverage counts", () => {
    const { receipt } = makeReceipt(clearPlan(), policyWith({ plan: true }));
    expect(receipt).toMatchObject({
      category: "worker-release-decision-closeout-action-receipt",
      policyId: "pdfxyz-worker-release-decision-closeout-action-receipt",
      verdict: "completed",
      exitCode: 0,
      planClass: "clear",
      sourceState: "usable",
      claimedPlanVerdict: "clear",
      acksRequired: 1,
      acksSatisfied: 1,
      acksMissing: 0,
      acksMismatched: 0,
      strictOpenEscalated: false,
    });
  });

  it("records a strict-open escalation on the receipt", () => {
    const { receipt } = makeReceipt(monitorPlan(), policyWith({ plan: true }, true));
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.exitCode).toBe(4);
    expect(receipt.strictOpenEscalated).toBe(true);
  });

  it("an unreadable plan flattens to a blocked receipt (no plan class, null claim)", () => {
    const { receipt } = makeReceipt(notAPlan(), policyWith({ plan: true }));
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.planClass).toBeNull();
    expect(receipt.claimedPlanVerdict).toBeNull();
    expect(receipt.sourceState).toBe("unreadable");
    expect(receipt.acksRequired).toBe(0);
  });

  it("counts a contradictory acknowledgement on the receipt", () => {
    const { receipt } = makeReceipt(blockedPlan(), policyWith({ plan: true, executed: true, block: true, monitor: true }));
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.acksMismatched).toBe(1);
  });
});
