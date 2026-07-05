import { describe, expect, it } from "vitest";
import {
  blockedIndex,
  coherentPlan,
  completedReceipt,
  contradictoryTrend,
  makeGovernanceFinalize,
} from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceFinalize } from "./render";

describe("release-decision-closeout-governance-finalize render — json", () => {
  it("round-trips the result and is pretty by default", () => {
    const result = makeGovernanceFinalize({ receipt: completedReceipt(), plan: coherentPlan() });
    const json = renderReleaseDecisionCloseoutGovernanceFinalize(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(result)));
    expect(json).toContain("\n  "); // pretty
    // Compact when pretty=false.
    expect(renderReleaseDecisionCloseoutGovernanceFinalize(result, "json", false)).not.toContain("\n  ");
  });
});

describe("release-decision-closeout-governance-finalize render — text", () => {
  it("prints the finalization verdict, the primary receipt, related records, and the caveats", () => {
    const result = makeGovernanceFinalize({ receipt: completedReceipt(), plan: coherentPlan() });
    const text = renderReleaseDecisionCloseoutGovernanceFinalize(result, "text");
    expect(text).toContain("release decision closeout governance finalization bundle");
    expect(text).toContain("FINALIZE: FINALIZED (exit 0)");
    expect(text).toContain("PRIMARY RECEIPT");
    expect(text).toContain("RELATED RECORDS");
    expect(text).toContain("ARCHIVE");
    expect(text).toContain("FOLLOW-UP");
    expect(text).toContain("CAVEATS");
  });

  it("surfaces a contradiction / blocked source chain in the text reasons", () => {
    const blocked = renderReleaseDecisionCloseoutGovernanceFinalize(
      makeGovernanceFinalize({ receipt: completedReceipt(), trend: contradictoryTrend() }),
      "text",
    );
    expect(blocked).toContain("FINALIZE: FINALIZE-BLOCKED (exit 4)");
    expect(blocked).toContain("trend-contradiction");

    const chain = renderReleaseDecisionCloseoutGovernanceFinalize(
      makeGovernanceFinalize({ receipt: completedReceipt(), index: blockedIndex() }),
      "text",
    );
    expect(chain).toContain("source-chain-blocked");
  });
});
