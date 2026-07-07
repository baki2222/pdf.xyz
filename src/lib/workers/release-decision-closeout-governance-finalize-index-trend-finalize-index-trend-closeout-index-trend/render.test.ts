import { describe, expect, it } from "vitest";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrend } from "./render";
import { blockedWindow, indexedWindow, makeTrend, openWindow } from "./fixtures";

describe("renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrend", () => {
  it("json is stable, parseable, and pins the schema + verdict", () => {
    const r = makeTrend([indexedWindow(), openWindow()]);
    const json = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrend(r, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1");
    expect(parsed.verdict).toBe("degrading");
    expect(parsed.trend.direction).toBe("degrading");
  });

  it("compact json (pretty=false) has no newlines inside the document", () => {
    const r = makeTrend([indexedWindow(), openWindow()]);
    expect(
      renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrend(r, "json", false).trimEnd(),
    ).not.toContain("\n");
  });

  it("text surfaces the verdict, the histograms, the sequence, and the caveats", () => {
    const r = makeTrend([indexedWindow(), blockedWindow()]);
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrend(r, "text");
    expect(text).toContain("release decision closeout governance finalize index trend finalize index trend closeout index trend");
    expect(text).toContain("TREND: BLOCKED (exit 4)");
    expect(text).toContain("by window index:");
    expect(text).toContain("by closeout:");
    expect(text).toContain("SEQUENCE (oldest → newest)");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("text renders an empty considered history without throwing", () => {
    const text = renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrend(
      makeTrend([]),
      "text",
    );
    expect(text).toContain("(no windows considered)");
    expect(text).toContain("INSUFFICIENT");
  });
});
