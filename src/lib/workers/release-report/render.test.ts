// @vitest-environment node
/**
 * Unit proofs for the release-report renderers (Phase 52): stable JSON + an operator-friendly, CI-summary-ready
 * text. Both are content-free by construction — the renderers reach only the reduced result.
 */

import { describe, expect, it } from "vitest";
import { renderReleaseReport } from "./render";
import { failAudit, makeReport, passAudit, passBundle, warnBundle } from "./fixtures";

describe("release-report render — json", () => {
  it("round-trips to the same result (pretty by default, trailing newline)", () => {
    const result = makeReport({ bundle: passBundle(), audit: passAudit() });
    const json = renderReleaseReport(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(result);
  });

  it("compact json when pretty=false", () => {
    const result = makeReport({ bundle: passBundle() });
    const compact = renderReleaseReport(result, "json", false);
    expect(compact).not.toContain("\n  ");
    expect(JSON.parse(compact).schema).toBe("pdfxyz.release-report/1");
  });
});

describe("release-report render — text", () => {
  it("prints the recommendation, coverage, sources, next actions, and caveats", () => {
    const text = renderReleaseReport(makeReport({ bundle: passBundle(), audit: passAudit() }), "text");
    expect(text).toContain("release evidence operator report");
    expect(text).toMatch(/RECOMMENDATION: PROMOTE-READY \(exit 0\)/);
    expect(text).toContain("EVIDENCE COVERAGE");
    expect(text).toContain("SOURCES");
    expect(text).toContain("NEXT ACTIONS");
    expect(text).toContain("CAVEATS");
  });

  it("prints the fired rationale for a non-promote recommendation", () => {
    const text = renderReleaseReport(makeReport({ bundle: passBundle(), audit: failAudit() }), "text");
    expect(text).toMatch(/RECOMMENDATION: HOLD-FAIL \(exit 4\)/);
    expect(text).toContain("RATIONALE");
    expect(text).toContain("audit-regressed");
  });

  it("marks a strict escalation in the text", () => {
    const text = renderReleaseReport(makeReport({ bundle: warnBundle() }, true), "text");
    expect(text).toMatch(/HOLD-FAIL/);
    expect(text).toContain("(strict, escalated)");
  });

  it("bundle/audit fact lines are bounded (no locator tokens)", () => {
    const text = renderReleaseReport(makeReport({ bundle: passBundle(), audit: passAudit() }), "text");
    expect(text).toMatch(/coherence: verdict=pass/);
    expect(text).toMatch(/regression: verdict=pass/);
    expect(text).not.toContain(".json");
  });
});
