import { describe, expect, it } from "vitest";
import { blockedPlan, clearPlan, makeReceipt, monitorPlan, policyWith } from "./fixtures";
import {
  renderReleaseDecisionCloseoutGovernanceActionReceipt,
  renderReleaseDecisionCloseoutGovernanceActionReceiptJson,
} from "./render";

describe("release-decision-closeout-governance-action-receipt render — json", () => {
  it("round-trips the result as pretty JSON by default", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true }));
    const json = renderReleaseDecisionCloseoutGovernanceActionReceiptJson(result);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).schema).toBe("pdfxyz.release-decision-closeout-governance-action-receipt/1");
    expect(json).toContain("\n  "); // pretty
    const compact = renderReleaseDecisionCloseoutGovernanceActionReceiptJson(result, false);
    expect(compact).not.toContain("\n  ");
  });
});

describe("release-decision-closeout-governance-action-receipt render — text", () => {
  it("renders a review-friendly receipt with verdict, plan, acks, reasons, caveats", () => {
    const text = renderReleaseDecisionCloseoutGovernanceActionReceipt(
      makeReceipt(monitorPlan(), policyWith({ plan: true })),
      "text",
    );
    expect(text).toContain("release decision closeout governance action-plan execution receipt");
    expect(text).toContain("RECEIPT: FOLLOWUP-OPEN (exit 3)");
    expect(text).toContain("plan class: monitor");
    expect(text).toContain("SOURCE PLAN");
    expect(text).toContain("ACKNOWLEDGEMENTS");
    expect(text).toContain("REASONS");
    expect(text).toContain("CAVEATS");
    expect(text).toContain("monitor-followup-open");
  });

  it("marks a strict-open escalation in the counts line", () => {
    const text = renderReleaseDecisionCloseoutGovernanceActionReceipt(
      makeReceipt(monitorPlan(), policyWith({ plan: true }, true)),
      "text",
    );
    expect(text).toContain("RECEIPT: BLOCKED (exit 4)");
    expect(text).toMatch(/strict-open, escalated/);
  });

  it("flags contradictory + missing acknowledgements in the checklist", () => {
    const text = renderReleaseDecisionCloseoutGovernanceActionReceipt(
      makeReceipt(blockedPlan(), policyWith({ plan: true, monitor: true })),
      "text",
    );
    expect(text).toContain("contradictory acknowledgements for this class: monitor");
  });
});
