/**
 * Unit proofs for the release-trend rollup (Phase 53): the fail-closed fold of a bounded history + policy into
 * ONE trend verdict, with the NEWEST report authoritative and thresholds tolerating only historical noise.
 *
 * Scenario tests drive the whole build (`makeTrend`) so the fold is exercised end-to-end; a few tests hit
 * `computeTrendRollup` directly for precedence precision.
 */

import { describe, expect, it } from "vitest";
import { computeTrendRollup, deriveTrendReasons } from "./rollup";
import { defaultPolicy, ingestReportsFrom, makeTrend, notAReport, reportFor, tamperedReport } from "./fixtures";
import { reduceTrend } from "./reduce";

/** Reduce a list of report objects to (history, usableRecommendations) for a direct rollup test. */
function reduced(objs: readonly unknown[], maxReports = 20) {
  const r = reduceTrend(ingestReportsFrom(objs), maxReports);
  return { history: r.history, usable: r.usableRecommendations };
}

const pr = () => reportFor("promote-ready");
const hw = () => reportFor("hold-warning");
const ne = () => reportFor("needs-evidence");
const hf = () => reportFor("hold-fail");

describe("computeTrendRollup — verdict precedence (fail-closed)", () => {
  it("a clean window of promote-ready is stable (exit 0)", () => {
    const t = makeTrend([pr(), pr(), pr()]);
    expect(t.trend).toMatchObject({ verdict: "stable", exitCode: 0, stable: true });
    expect(t.trend.reasons).toEqual([]);
  });

  it("a tampered report anywhere holds the trend failing (exit 4), even with a promote-ready tip", () => {
    const t = makeTrend([pr(), tamperedReport(), pr()]);
    expect(t.trend).toMatchObject({ verdict: "failing", exitCode: 4 });
    expect(t.trend.reasons).toContain("report-tampered");
  });

  it("a hold-fail newest is failing (exit 4)", () => {
    expect(makeTrend([pr(), pr(), hf()]).trend.verdict).toBe("failing");
  });

  it("an unreadable report makes the trend unknown (insufficient, exit 2) — not a vacuous stable", () => {
    const t = makeTrend([pr(), notAReport(), pr()]);
    expect(t.trend).toMatchObject({ verdict: "unknown", exitCode: 2 });
    expect(t.trend.reasons).toContain("report-unreadable");
  });

  it("no usable reports is unknown (exit 2)", () => {
    expect(makeTrend([notAReport(), notAReport()]).trend.verdict).toBe("unknown");
    expect(makeTrend([]).trend).toMatchObject({ verdict: "unknown", reasons: ["no-usable-reports"] });
  });

  it("a needs-evidence newest is unknown (exit 2)", () => {
    expect(makeTrend([pr(), ne()]).trend.verdict).toBe("unknown");
  });

  it("a hold-warning newest is a warning (exit 3)", () => {
    expect(makeTrend([pr(), hw()], { maxHoldWarning: 5 }).trend.verdict).toBe("warning");
  });

  it("blocking dominates insufficient dominates advisory", () => {
    // tampered (blocking) + unreadable (insufficient) + warn tip (advisory) all present → failing
    const t = makeTrend([tamperedReport(), notAReport(), hw()], { maxHoldWarning: 5 });
    expect(t.trend.verdict).toBe("failing");
    expect(t.trend.blocking).toBeGreaterThan(0);
    expect(t.trend.insufficiencies).toBeGreaterThan(0);
    expect(t.trend.advisories).toBeGreaterThan(0);
  });
});

describe("computeTrendRollup — thresholds tolerate history, newest stays authoritative", () => {
  it("default max-hold-fail=0: any hold-fail in the window fails, even if recovered by the tip", () => {
    expect(makeTrend([hf(), pr(), pr()]).trend.verdict).toBe("failing"); // repeated-hold-fail
  });

  it("a raised --max-hold-fail tolerates historical hold-fails once recovered", () => {
    const t = makeTrend([hf(), pr(), pr()], { maxHoldFail: 1 });
    expect(t.trend.verdict).toBe("stable");
    expect(t.trend.reasons).not.toContain("repeated-hold-fail");
  });

  it("but a hold-fail TIP always fails, even within a tolerated threshold", () => {
    const t = makeTrend([pr(), pr(), hf()], { maxHoldFail: 9 });
    expect(t.trend.verdict).toBe("failing");
    expect(t.trend.reasons).toContain("latest-hold-fail");
    expect(t.trend.reasons).not.toContain("repeated-hold-fail"); // 1 ≤ 9
  });

  it("--max-hold-warning tolerates advisory history", () => {
    expect(makeTrend([hw(), pr(), pr()]).trend.verdict).toBe("warning"); // default 0 → repeated-hold-warning
    expect(makeTrend([hw(), pr(), pr()], { maxHoldWarning: 1 }).trend.verdict).toBe("stable");
  });
});

describe("computeTrendRollup — --require-latest-ready", () => {
  it("escalates a non-ready tip to failing, flagging readyEscalated", () => {
    const t = makeTrend([pr(), hw()], { requireLatestReady: true, maxHoldWarning: 5 });
    expect(t.trend).toMatchObject({ verdict: "failing", readyEscalated: true });
    expect(t.trend.detail).toMatch(/require-latest-ready/i);
  });

  it("escalates a needs-evidence tip to failing (readyEscalated)", () => {
    const t = makeTrend([pr(), ne()], { requireLatestReady: true });
    expect(t.trend).toMatchObject({ verdict: "failing", readyEscalated: true });
    expect(t.trend.reasons).toContain("latest-not-ready");
  });

  it("does NOT flag readyEscalated when a real blocker is also present", () => {
    const t = makeTrend([pr(), hf()], { requireLatestReady: true, maxHoldFail: 5 });
    expect(t.trend).toMatchObject({ verdict: "failing", readyEscalated: false });
  });

  it("a promote-ready tip satisfies the requirement (stable)", () => {
    expect(makeTrend([pr(), pr()], { requireLatestReady: true }).trend.verdict).toBe("stable");
  });

  it("does NOT fabricate a not-ready blocker when there is no usable tip (stays unknown)", () => {
    const t = makeTrend([notAReport()], { requireLatestReady: true });
    expect(t.trend.verdict).toBe("unknown");
    expect(t.trend.reasons).not.toContain("latest-not-ready");
  });
});

describe("deriveTrendReasons — trend-degraded (warnings increased)", () => {
  it("fires when the newest usable report is worse than the previous usable one", () => {
    const { history, usable } = reduced([pr(), hw()], 20);
    const reasons = deriveTrendReasons(history, usable, defaultPolicy({ maxHoldWarning: 5 }));
    expect(reasons).toContain("trend-degraded");
  });

  it("does NOT fire when posture improves or is flat", () => {
    const improve = reduced([hw(), pr()], 20);
    expect(
      deriveTrendReasons(improve.history, improve.usable, defaultPolicy({ maxHoldWarning: 5 })),
    ).not.toContain("trend-degraded");
    const flat = reduced([pr(), pr()], 20);
    expect(deriveTrendReasons(flat.history, flat.usable, defaultPolicy())).not.toContain("trend-degraded");
  });

  it("emits reasons in canonical order (a superset view)", () => {
    const { rollup } = computeTrendRollup(
      reduced([hf()], 20).history,
      reduced([hf()], 20).usable,
      defaultPolicy(),
    );
    // latest-hold-fail precedes repeated-hold-fail in the canonical order
    expect(rollup.reasons.indexOf("latest-hold-fail")).toBeLessThan(rollup.reasons.indexOf("repeated-hold-fail"));
  });
});
