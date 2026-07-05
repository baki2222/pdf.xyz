import { describe, expect, it } from "vitest";
import {
  blockedIndex,
  coherentPlan,
  completedReceipt,
  contradictoryTrend,
  makeGovernance,
} from "./fixtures";
import { renderReleaseDecisionCloseoutGovernance } from "./render";

describe("release-decision-closeout-governance render — json", () => {
  it("round-trips the result and is pretty by default", () => {
    const result = makeGovernance({ receipt: completedReceipt(), plan: coherentPlan() });
    const json = renderReleaseDecisionCloseoutGovernance(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(result)));
    expect(json).toContain("\n  "); // pretty
    // Compact when pretty=false.
    expect(renderReleaseDecisionCloseoutGovernance(result, "json", false)).not.toContain("\n  ");
  });
});

describe("release-decision-closeout-governance render — text", () => {
  it("prints the governance verdict, the primary receipt, related records, and the caveats", () => {
    const result = makeGovernance({ receipt: completedReceipt(), plan: coherentPlan() });
    const text = renderReleaseDecisionCloseoutGovernance(result, "text");
    expect(text).toContain("release decision closeout governance bundle");
    expect(text).toContain("GOVERNANCE: CLOSED (exit 0)");
    expect(text).toContain("PRIMARY RECEIPT");
    expect(text).toContain("RELATED RECORDS");
    expect(text).toContain("ARCHIVE");
    expect(text).toContain("FOLLOW-UP");
    expect(text).toContain("CAVEATS");
  });

  it("surfaces a contradiction / blocked source chain in the text reasons", () => {
    const blocked = renderReleaseDecisionCloseoutGovernance(
      makeGovernance({ receipt: completedReceipt(), trend: contradictoryTrend() }),
      "text",
    );
    expect(blocked).toContain("GOVERNANCE: GOVERNANCE-BLOCKED (exit 4)");
    expect(blocked).toContain("trend-contradiction");

    const chain = renderReleaseDecisionCloseoutGovernance(
      makeGovernance({ receipt: completedReceipt(), index: blockedIndex() }),
      "text",
    );
    expect(chain).toContain("source-chain-blocked");
  });
});
