import { describe, expect, it } from "vitest";
import {
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  makeCloseout,
  openReceipt,
  policyWith,
} from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout } from "./render";

const completed = completedReceipt();

describe("renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout", () => {
  it("json is parseable, pinned to the schema, and round-trips the verdict + coverage", () => {
    const result = makeCloseout(completed, { plan: coherentPlan() });
    const json = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/1",
    );
    expect(parsed.verdict).toBe("closed");
    expect(parsed.coverage.exitCode).toBe(0);
    expect(parsed.receipt.category).toBe(
      "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout",
    );
  });

  it("compact json omits indentation", () => {
    const result = makeCloseout(completed);
    expect(
      renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(result, "json", false),
    ).not.toContain("\n  ");
  });

  it("text carries the closeout verdict, plan class, primary receipt, the related checklist, and the source chain", () => {
    const result = makeCloseout(completed, { plan: coherentPlan(), trend: coherentTrend() });
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(result, "text");
    expect(text).toMatch(/CLOSEOUT: CLOSED \(exit 0\)/);
    expect(text).toContain("plan class: clear");
    expect(text).toContain("PRIMARY RECEIPT");
    expect(text).toContain("RELATED RECORDS");
    expect(text).toMatch(/plan \(optional\): usable, signal=coherent/);
    expect(text).toMatch(/trend \(optional\): usable, signal=coherent/);
    expect(text).toContain("SOURCE CHAIN");
    expect(text).toMatch(/receipt-trend=stable/);
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("text shows an OPEN closeout for a followup-open receipt (exit 3)", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(makeCloseout(openReceipt()), "text");
    expect(text).toMatch(/CLOSEOUT: OPEN \(exit 3\)/);
  });

  it("text shows an INVALID closeout for a contradictory related record (an incoherent chain)", () => {
    const result = makeCloseout(completed, { plan: contradictoryPlan() });
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(result, "text");
    expect(text).toMatch(/CLOSEOUT: INVALID \(exit 4\)/);
    expect(text).toMatch(/plan \(optional\): usable, signal=contradictory, block/);
  });

  it("text notes a strict-open escalation and any missing required records", () => {
    const escalated = makeCloseout(openReceipt(), {}, policyWith({}, true));
    const etext = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      escalated,
      "text",
    );
    expect(etext).toMatch(/CLOSEOUT: BLOCKED \(exit 4\)/);
    expect(etext).toContain("strict-open");

    const required = makeCloseout(completed, {}, policyWith({ plan: true }));
    const rtext = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(required, "text");
    expect(rtext).toContain("missing required records: plan");
  });
});
