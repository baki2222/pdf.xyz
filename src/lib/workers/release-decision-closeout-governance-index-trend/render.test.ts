import { describe, expect, it } from "vitest";
import { renderReleaseDecisionCloseoutGovernanceIndexTrend } from "./render";
import { blockedWindow, indexedWindow, makeTrend, watchWindow } from "./fixtures";

describe("renderReleaseDecisionCloseoutGovernanceIndexTrend", () => {
  it("json is stable, parseable, and pins the schema + verdict", () => {
    const r = makeTrend([indexedWindow(), watchWindow()]);
    const json = renderReleaseDecisionCloseoutGovernanceIndexTrend(r, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-decision-closeout-governance-index-trend/1");
    expect(parsed.governanceIndexTrend.verdict).toBe("trend-watch");
  });

  it("compact json (pretty=false) has no newlines inside the document", () => {
    const r = makeTrend([indexedWindow()]);
    const compact = renderReleaseDecisionCloseoutGovernanceIndexTrend(r, "json", false).trimEnd();
    expect(compact.includes("\n")).toBe(false);
  });

  it("text surfaces the verdict, the histograms, the sequence, and the caveats", () => {
    const r = makeTrend([indexedWindow(), blockedWindow()]);
    const text = renderReleaseDecisionCloseoutGovernanceIndexTrend(r, "text");
    expect(text).toContain("release decision closeout governance index trend");
    expect(text).toContain("TREND: TREND-BLOCKED (exit 4)");
    expect(text).toContain("by window index:");
    expect(text).toContain("by governance:");
    expect(text).toContain("SEQUENCE (oldest → newest)");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("text renders an empty considered history without throwing", () => {
    const r = makeTrend([]);
    const text = renderReleaseDecisionCloseoutGovernanceIndexTrend(r, "text");
    expect(text).toContain("(no windows considered)");
    expect(text).toContain("TREND-INCOMPLETE");
  });
});
