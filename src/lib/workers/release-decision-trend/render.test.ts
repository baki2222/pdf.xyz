import { describe, expect, it } from "vitest";
import { renderReleaseDecisionTrend } from "./render";
import { makeTrend } from "./fixtures";
import { blockedWindow, stableWindow, watchWindow } from "./fixtures";

describe("renderReleaseDecisionTrend — json", () => {
  it("round-trips to the same result object (pretty by default)", () => {
    const result = makeTrend([stableWindow(), watchWindow()]);
    const json = renderReleaseDecisionTrend(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(result);
  });

  it("honours the compact (non-pretty) flag", () => {
    const result = makeTrend([stableWindow()]);
    expect(renderReleaseDecisionTrend(result, "json", false)).not.toContain("\n  ");
  });
});

describe("renderReleaseDecisionTrend — text", () => {
  it("prints the verdict, history summary, sequence, checklist, and caveats", () => {
    const result = makeTrend([stableWindow(), blockedWindow()]);
    const text = renderReleaseDecisionTrend(result, "text");
    expect(text).toContain("release decision index trend summary");
    expect(text).toContain("TREND: BLOCKED (exit 4)");
    expect(text).toContain("by window verdict:");
    expect(text).toContain("by decision:");
    expect(text).toContain("SEQUENCE (oldest → newest)");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
    // The honesty caveat is present.
    expect(text).toMatch(/NOT a legal audit log/);
  });

  it("shows the direction + class and the per-window sequence", () => {
    const text = renderReleaseDecisionTrend(makeTrend([watchWindow(), stableWindow()]), "text");
    expect(text).toContain("direction=improving");
    expect(text).toContain("TREND: IMPROVING (exit 0)");
    expect(text).toMatch(/#1 \[ADVISORY\] state=usable, verdict=watch/);
    expect(text).toMatch(/#2 \[READY\] state=usable, verdict=stable/);
  });

  it("renders an empty history without crashing", () => {
    const text = renderReleaseDecisionTrend(makeTrend([]), "text");
    expect(text).toContain("(no windows considered)");
    expect(text).toContain("TREND: INSUFFICIENT (exit 2)");
  });
});
