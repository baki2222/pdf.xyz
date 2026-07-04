import { describe, expect, it } from "vitest";
import { makeTrend } from "./fixtures";
import { blockedWindow, stableWindow, watchWindow } from "./fixtures";
import { RELEASE_DECISION_TREND_POLICY_ID } from "./types";

describe("buildTrendReceipt (via the composed result)", () => {
  it("flattens the bounded verdict + window/decision counts + direction/class only", () => {
    const result = makeTrend([stableWindow(), watchWindow(), blockedWindow()]);
    const receipt = result.receipt;
    expect(receipt.category).toBe("worker-release-decision-trend");
    expect(receipt.policyId).toBe(RELEASE_DECISION_TREND_POLICY_ID);
    expect(receipt.at).toBe(result.generatedAt);
    expect(receipt.verdict).toBe(result.trend.verdict);
    expect(receipt.exitCode).toBe(result.trend.exitCode);
    expect(receipt.windowsSupplied).toBe(3);
    expect(receipt.windowsConsidered).toBe(3);
    expect(receipt.windowsUsable).toBe(3);
    expect(receipt.totalRecords).toBe(result.summary.totalRecords);
    expect(receipt.decisionCounts).toEqual(result.summary.decisionCounts);
    expect(receipt.direction).toBe(result.summary.direction);
    expect(receipt.trendClass).toBe(result.summary.trendClass);
  });

  it("is a bounded, content-free shape (only enums, small ints, a policy id, and a stamp)", () => {
    const receipt = makeTrend([stableWindow()]).receipt;
    // No nested objects other than the bounded decisionCounts map; every scalar is an enum / int / iso string.
    for (const [key, value] of Object.entries(receipt)) {
      if (key === "decisionCounts") {
        for (const n of Object.values(value as Record<string, number>)) expect(typeof n).toBe("number");
      } else {
        expect(["string", "number"]).toContain(typeof value);
      }
    }
  });
});
