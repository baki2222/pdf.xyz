import { describe, expect, it } from "vitest";
import {
  coherentPlan,
  completedReceipt,
  contradictoryPlan,
  makeCloseout,
  openReceipt,
  openWindow,
  policyWith,
} from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout } from "./render";

const completed = completedReceipt();

describe("renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout", () => {
  it("json is parseable, pinned to the schema, and round-trips the verdict + coverage", () => {
    const result = makeCloseout(completed, { plan: coherentPlan() });
    const json = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout/1",
    );
    expect(parsed.verdict).toBe("closed");
    expect(parsed.coverage.exitCode).toBe(0);
    expect(parsed.receipt.category).toBe(
      "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout",
    );
  });

  it("compact json omits indentation", () => {
    const result = makeCloseout(completed);
    expect(
      renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(result, "json", false),
    ).not.toContain("\n  ");
  });

  it("text carries the closeout verdict, plan class, primary receipt, and the related checklist", () => {
    const result = makeCloseout(completed, { plan: coherentPlan(), index: openWindow() });
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(result, "text");
    expect(text).toMatch(/CLOSEOUT: OPEN \(exit 3\)/);
    expect(text).toContain("plan class: clear");
    expect(text).toContain("PRIMARY RECEIPT");
    expect(text).toContain("RELATED RECORDS");
    expect(text).toMatch(/plan \(optional\): usable, signal=coherent/);
    expect(text).toMatch(/index \(optional\): usable, signal=advisory, index-open/);
    expect(text).toContain("SOURCE CHAIN");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("text shows a blocked closeout for a contradictory related record", () => {
    const result = makeCloseout(completed, { plan: contradictoryPlan() });
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(result, "text");
    expect(text).toMatch(/CLOSEOUT: BLOCKED \(exit 4\)/);
    expect(text).toMatch(/plan \(optional\): usable, signal=contradictory, block/);
  });

  it("text notes a strict-open escalation and any missing required records", () => {
    const escalated = makeCloseout(openReceipt(), {}, policyWith({}, true));
    const etext = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(
      escalated,
      "text",
    );
    expect(etext).toMatch(/CLOSEOUT: BLOCKED \(exit 4\)/);
    expect(etext).toContain("strict-open");

    const required = makeCloseout(completed, {}, policyWith({ plan: true }));
    const rtext = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseout(required, "text");
    expect(rtext).toContain("missing required records: plan");
  });
});
