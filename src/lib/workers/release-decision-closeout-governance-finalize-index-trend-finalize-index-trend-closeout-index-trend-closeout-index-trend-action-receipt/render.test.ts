import { describe, expect, it } from "vitest";
import { blockPlan, clearPlan, makeReceipt, monitorPlan, policyWith } from "./fixtures";
import {
  renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt,
  renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptJson,
} from "./render";

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt render — json", () => {
  it("round-trips the result as pretty JSON by default", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true }));
    const json = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptJson(result);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).schema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1",
    );
    expect(json).toContain("\n  "); // pretty
    const compact = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptJson(result, false);
    expect(compact).not.toContain("\n  ");
  });
});

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt render — text", () => {
  it("renders a review-friendly receipt with verdict, plan, acks, reasons, next actions, caveats", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt(
      makeReceipt(monitorPlan(), policyWith({ plan: true })),
      "text",
    );
    expect(text).toContain("release decision closeout governance finalize index trend finalize index trend closeout index trend action-plan execution receipt");
    expect(text).toContain("RECEIPT: FOLLOWUP-OPEN (exit 3)");
    expect(text).toContain("plan class: monitor");
    expect(text).toContain("SOURCE PLAN");
    expect(text).toContain("ACKNOWLEDGEMENTS");
    expect(text).toContain("REASONS");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
    expect(text).toContain("monitor-followup-open");
    expect(text).toContain("plan-strict=false");
    expect(text).toMatch(/counts: .*\bopen\b/);
  });

  it("marks a strict-open escalation in the counts line", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt(
      makeReceipt(monitorPlan(), policyWith({ plan: true }, true)),
      "text",
    );
    expect(text).toContain("RECEIPT: BLOCKED (exit 4)");
    expect(text).toMatch(/strict-open, escalated/);
  });

  it("flags contradictory acknowledgements in the checklist", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt(
      makeReceipt(blockPlan(), policyWith({ plan: true, monitor: true })),
      "text",
    );
    expect(text).toContain("contradictory acknowledgements for this class: monitor");
  });
});
