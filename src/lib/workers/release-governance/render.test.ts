import { describe, expect, it } from "vitest";
import { renderReleaseGovernance } from "./render";
import {
  failingTrend,
  makeGovernance,
  passAudit,
  promoteReadyReport,
  stableTrend,
  warningTrend,
} from "./fixtures";

describe("renderReleaseGovernance — json", () => {
  it("emits stable, parseable JSON that round-trips the result", () => {
    const result = makeGovernance({ trend: stableTrend(), report: promoteReadyReport() });
    const json = renderReleaseGovernance(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(result);
  });

  it("honours the pretty flag", () => {
    const result = makeGovernance({ trend: stableTrend() });
    expect(renderReleaseGovernance(result, "json", true)).toContain("\n  ");
    expect(renderReleaseGovernance(result, "json", false)).not.toContain("\n  ");
  });
});

describe("renderReleaseGovernance — text", () => {
  it("renders the governance verdict, coverage, sources, reasons, archive, follow-up, and caveats", () => {
    const text = renderReleaseGovernance(
      makeGovernance({ trend: failingTrend(), report: promoteReadyReport(), audit: passAudit() }),
      "text",
    );
    expect(text).toMatch(/release evidence governance bundle/i);
    expect(text).toMatch(/GOVERNANCE: BLOCKED \(exit 4\)/);
    expect(text).toMatch(/EVIDENCE COVERAGE/);
    expect(text).toMatch(/SOURCES/);
    expect(text).toMatch(/REASONS/);
    expect(text).toMatch(/ARCHIVE/);
    expect(text).toMatch(/FOLLOW-UP \(assignments\)/);
    expect(text).toMatch(/CAVEATS/);
  });

  it("surfaces the strict-watch escalation note", () => {
    const text = renderReleaseGovernance(makeGovernance({ trend: warningTrend() }, { strictWatch: true }), "text");
    expect(text).toMatch(/strict-watch, escalated/);
  });

  it("a healthy window renders a clean, reason-free summary", () => {
    const text = renderReleaseGovernance(makeGovernance({ trend: stableTrend() }), "text");
    expect(text).toMatch(/GOVERNANCE: HEALTHY \(exit 0\)/);
    expect(text).not.toMatch(/\nREASONS\n/);
    expect(text).toMatch(/continue-governance-cadence/);
  });
});
