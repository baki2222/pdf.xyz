import { describe, expect, it } from "vitest";
import { renderReleaseDecisionCloseoutIndexTrend } from "./render";
import { blockedIndex, indexedIndex, makeTrend, openIndex } from "./fixtures";

describe("renderReleaseDecisionCloseoutIndexTrend", () => {
  it("json is stable, parseable, and pins the schema + verdict", () => {
    const r = makeTrend([indexedIndex(), openIndex()]);
    const json = renderReleaseDecisionCloseoutIndexTrend(r, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-decision-closeout-index-trend/1");
    expect(parsed.closeoutIndexTrend.verdict).toBe("trend-watch");
  });

  it("compact json (pretty=false) has no newlines inside the document", () => {
    const r = makeTrend([indexedIndex()]);
    const compact = renderReleaseDecisionCloseoutIndexTrend(r, "json", false).trimEnd();
    expect(compact.includes("\n")).toBe(false);
  });

  it("text surfaces the verdict, the histograms, the sequence, and the caveats", () => {
    const r = makeTrend([indexedIndex(), blockedIndex()]);
    const text = renderReleaseDecisionCloseoutIndexTrend(r, "text");
    expect(text).toContain("release decision closeout index trend");
    expect(text).toContain("TREND: TREND-BLOCKED (exit 4)");
    expect(text).toContain("by window index:");
    expect(text).toContain("by closeout:");
    expect(text).toContain("SEQUENCE (oldest → newest)");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("text renders an empty considered history without throwing", () => {
    const r = makeTrend([]);
    const text = renderReleaseDecisionCloseoutIndexTrend(r, "text");
    expect(text).toContain("(no windows considered)");
    expect(text).toContain("TREND-INCOMPLETE");
  });
});
