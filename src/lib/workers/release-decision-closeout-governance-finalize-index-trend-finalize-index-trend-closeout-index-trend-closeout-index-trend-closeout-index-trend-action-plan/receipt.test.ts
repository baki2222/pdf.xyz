import { describe, expect, it } from "vitest";
import { NOW, degradingTrend, makePlan, notATrend, stableTrend, tamperedTrend } from "./fixtures";

describe("closeout-index-trend-action-plan receipt — content-free flattened summary", () => {
  it("flattens the verdict, urgency, action class, exit, and source posture", () => {
    const r = makePlan(degradingTrend()).receipt;
    expect(r).toMatchObject({
      category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan",
      policyId: "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan",
      at: NOW,
      verdict: "monitor",
      urgency: "high",
      actionClass: "stabilize-regression",
      exitCode: 3,
      sourceState: "usable",
      sourceTrendVerdict: "degrading",
      sourceLatestIndex: "open",
      escalated: false,
    });
    expect(r.actionsEmitted).toBeGreaterThan(0);
    expect(r.disclosure).toMatch(/content-free/i);
  });

  it("carries the untrusted CLAIM for a tampered trend, and null latest for an unreadable one", () => {
    expect(makePlan(tamperedTrend()).receipt).toMatchObject({
      sourceState: "tampered",
      sourceTrendVerdict: "blocked",
      sourceLatestIndex: null,
      verdict: "invalid",
    });
    expect(makePlan(notATrend()).receipt).toMatchObject({
      sourceState: "unreadable",
      sourceTrendVerdict: null,
      sourceLatestIndex: null,
      verdict: "invalid",
    });
  });

  it("records the escalation flag for a --strict block, and the max-actions accounting", () => {
    expect(makePlan(degradingTrend(), { strict: true }).receipt).toMatchObject({
      verdict: "block-release",
      escalated: true,
    });
    expect(makePlan(stableTrend()).receipt.escalated).toBe(false);
    // The receipt carries the bounded checklist accounting (emitted + dropped), never a silent cap.
    const capped = makePlan(degradingTrend(), { maxActions: 1 }).receipt;
    expect(capped.actionsEmitted).toBe(1);
    expect(capped.actionsDropped).toBeGreaterThan(0);
  });
});
