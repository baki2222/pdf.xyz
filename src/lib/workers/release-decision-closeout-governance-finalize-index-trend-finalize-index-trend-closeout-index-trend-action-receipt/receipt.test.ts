import { describe, expect, it } from "vitest";
import { blockPlan, clearPlan, invalidPlan, makeReceipt, monitorPlan, notAPlan, policyWith } from "./fixtures";

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt receipt — flattened + content-free", () => {
  it("flattens a completed clear receipt with its coverage counts", () => {
    const { receipt } = makeReceipt(clearPlan(), policyWith({ plan: true, clear: true }));
    expect(receipt).toMatchObject({
      category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt",
      policyId: "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt",
      verdict: "completed",
      exitCode: 0,
      planClass: "clear",
      sourceState: "usable",
      claimedPlanVerdict: "clear",
      acksRequired: 2,
      acksSatisfied: 2,
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

  it("an unreadable plan flattens to an invalid receipt (no plan class, null claim)", () => {
    const { receipt } = makeReceipt(notAPlan(), policyWith({ plan: true }));
    expect(receipt.verdict).toBe("invalid");
    expect(receipt.planClass).toBeNull();
    expect(receipt.claimedPlanVerdict).toBeNull();
    expect(receipt.sourceState).toBe("unreadable");
    expect(receipt.acksRequired).toBe(0);
  });

  it("a plan whose own verdict is invalid flattens to a BLOCK-class receipt (usable, held)", () => {
    const { receipt } = makeReceipt(invalidPlan(), policyWith({ plan: true }));
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.planClass).toBe("block");
    expect(receipt.claimedPlanVerdict).toBe("invalid");
    expect(receipt.sourceState).toBe("usable");
  });

  it("counts a contradictory acknowledgement on the receipt", () => {
    const { receipt } = makeReceipt(blockPlan(), policyWith({ plan: true, block: true, monitor: true }));
    expect(receipt.verdict).toBe("blocked");
    expect(receipt.acksMismatched).toBe(1);
  });
});
