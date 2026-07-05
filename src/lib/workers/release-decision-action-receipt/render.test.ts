import { describe, expect, it } from "vitest";
import { blockedPlan, clearPlan, makeReceipt, policyWith, watchMonitorPlan } from "./fixtures";
import { renderReleaseDecisionActionReceipt } from "./render";

describe("release-decision-action-receipt render — json", () => {
  it("round-trips to a stable object carrying the schema + top-level rollup", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true }));
    const json = renderReleaseDecisionActionReceipt(result, "json");
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-decision-action-receipt/1");
    expect(parsed.verdict).toBe("completed");
    expect(parsed.actionReceipt.verdict).toBe("completed");
    expect(parsed.actionReceipt.exitCode).toBe(0);
    expect(json.endsWith("\n")).toBe(true);
  });

  it("honors pretty=false (single line)", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true }));
    const compact = renderReleaseDecisionActionReceipt(result, "json", false);
    expect(compact.trimEnd().includes("\n")).toBe(false);
  });
});

describe("release-decision-action-receipt render — text", () => {
  it("prints the verdict, plan class, acknowledgements, reasons, and caveats", () => {
    const result = makeReceipt(watchMonitorPlan(), policyWith({ plan: true }));
    const text = renderReleaseDecisionActionReceipt(result, "text");
    expect(text).toMatch(/RECEIPT: FOLLOWUP-OPEN \(exit 3\)/);
    expect(text).toMatch(/plan class: monitor/);
    expect(text).toContain("ACKNOWLEDGEMENTS");
    expect(text).toContain("REASONS");
    expect(text).toContain("CAVEATS");
    // The missing required acks are surfaced, never silently.
    expect(text).toMatch(/missing required acknowledgements: followups, monitor/);
  });

  it("surfaces contradictory acknowledgements in text", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true, block: true }));
    const text = renderReleaseDecisionActionReceipt(result, "text");
    expect(text).toMatch(/RECEIPT: BLOCKED/);
    expect(text).toMatch(/contradictory acknowledgements for this class: block/);
  });

  it("marks a block plan's completed acknowledgements", () => {
    const result = makeReceipt(blockedPlan(), policyWith({ plan: true, followups: true, block: true }));
    const text = renderReleaseDecisionActionReceipt(result, "text");
    expect(text).toMatch(/RECEIPT: COMPLETED \(exit 0\)/);
    expect(text).toMatch(/\[x\] block \(required, supplied\)/);
  });
});
