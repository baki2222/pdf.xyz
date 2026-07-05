import { describe, expect, it } from "vitest";
import { NOW, makePlan, notATrend, stableTrend, tamperedTrend, watchTrend } from "./fixtures";

describe("closeout-action-plan receipt — content-free flattened summary", () => {
  it("flattens the verdict, urgency, action class, exit, and source posture", () => {
    const r = makePlan(watchTrend()).receipt;
    expect(r).toMatchObject({
      category: "worker-release-decision-closeout-action-plan",
      policyId: "pdfxyz-worker-release-decision-closeout-action-plan",
      at: NOW,
      verdict: "monitor",
      urgency: "high",
      actionClass: "monitor-followups",
      exitCode: 3,
      sourceState: "usable",
      sourceTrendVerdict: "trend-watch",
      sourceLatestIndex: "index-open",
      strictWatchEscalated: false,
    });
    expect(r.actionsEmitted).toBeGreaterThan(0);
    expect(r.disclosure).toMatch(/content-free/i);
  });

  it("carries the untrusted CLAIM for a tampered trend, and null latest for an unreadable one", () => {
    expect(makePlan(tamperedTrend()).receipt).toMatchObject({
      sourceState: "tampered",
      sourceTrendVerdict: "trend-blocked",
      sourceLatestIndex: null,
    });
    expect(makePlan(notATrend()).receipt).toMatchObject({
      sourceState: "unreadable",
      sourceTrendVerdict: null,
      sourceLatestIndex: null,
      verdict: "block-release",
    });
  });

  it("records the strict-watch escalation flag", () => {
    expect(makePlan(watchTrend(), { strictWatch: true }).receipt).toMatchObject({
      verdict: "block-release",
      strictWatchEscalated: true,
    });
    expect(makePlan(stableTrend()).receipt.strictWatchEscalated).toBe(false);
  });
});
