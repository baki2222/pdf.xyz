import { describe, expect, it } from "vitest";
import { completedReceipt, coherentPlan, coherentTrend, makeFinalize } from "./fixtures";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize as render } from "./render";

describe("finalize-index-trend-finalize render", () => {
  const result = makeFinalize(completedReceipt(), { plan: coherentPlan(), trend: coherentTrend() });

  it("json is pretty by default, parseable, and round-trips the result", () => {
    const json = render(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(result);
    expect(render(result, "json", false)).not.toContain("\n  ");
  });

  it("text carries the verdict headline, the source-chain checklist, and the caveats", () => {
    const text = render(result, "text");
    expect(text).toContain("FINALIZE: FINALIZED (exit 0)");
    expect(text).toContain("PRIMARY RECEIPT");
    expect(text).toContain("SOURCE-CHAIN RECORDS");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
    // The coherent supplied records show up with a checked mark.
    expect(text).toMatch(/\[x\] plan \(optional\)/);
    expect(text).toMatch(/\[x\] trend \(optional\)/);
  });
});
