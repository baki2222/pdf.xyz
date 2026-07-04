import { describe, expect, it } from "vitest";
import { computeGovernanceRollup, deriveGovernanceReasons } from "./rollup";
import { reduceAuditSource, reduceReportSource, reduceTrendSource } from "./reduce";
import { ingestAuditSource, ingestReportSource, ingestTrend } from "./ingest";
import {
  defaultPolicy,
  failAudit,
  failingTrend,
  holdFailReport,
  holdWarningReport,
  makeGovernance,
  needsEvidenceReport,
  notADocument,
  passAudit,
  promoteReadyReport,
  stableTrend,
  tamperTrend,
  tamperReport,
  unknownTrend,
  warnAudit,
  warningTrend,
} from "./fixtures";
import type { GovernanceObjects } from "./fixtures";
import type { ReleaseGovernancePolicy } from "./types";

const verdict = (objs: GovernanceObjects, policy: Partial<ReleaseGovernancePolicy> = {}) =>
  makeGovernance(objs, policy).governance;

describe("governance fold — the four verdicts", () => {
  it("HEALTHY: a stable trend alone, or with clean latest sources (exit 0)", () => {
    expect(verdict({ trend: stableTrend() })).toMatchObject({ verdict: "healthy", exitCode: 0 });
    expect(
      verdict({ trend: stableTrend(), report: promoteReadyReport(), audit: passAudit() }),
    ).toMatchObject({ verdict: "healthy", exitCode: 0, reasons: [] });
  });

  it("WATCH: a warning trend / hold-warning report / audit drift (exit 3)", () => {
    expect(verdict({ trend: warningTrend() })).toMatchObject({ verdict: "watch", exitCode: 3 });
    expect(verdict({ trend: stableTrend(), report: holdWarningReport() }).verdict).toBe("watch");
    expect(verdict({ trend: stableTrend(), audit: warnAudit() }).verdict).toBe("watch");
  });

  it("INCOMPLETE: an absent / unreadable / unknown trend, or an indeterminate latest (exit 2)", () => {
    expect(verdict({ report: promoteReadyReport() })).toMatchObject({ verdict: "incomplete", exitCode: 2 });
    expect(verdict({ trend: notADocument() }).verdict).toBe("incomplete");
    expect(verdict({ trend: unknownTrend() }).verdict).toBe("incomplete");
    expect(verdict({ trend: stableTrend(), report: needsEvidenceReport() }).verdict).toBe("incomplete");
  });

  it("BLOCKED: a failing trend / hold-fail report / regressed audit / any tamper (exit 4)", () => {
    expect(verdict({ trend: failingTrend() })).toMatchObject({ verdict: "blocked", exitCode: 4 });
    expect(verdict({ trend: stableTrend(), report: holdFailReport() }).verdict).toBe("blocked");
    expect(verdict({ trend: stableTrend(), audit: failAudit() }).verdict).toBe("blocked");
    expect(verdict({ trend: tamperTrend(stableTrend()) }).verdict).toBe("blocked");
    expect(verdict({ trend: stableTrend(), report: tamperReport(promoteReadyReport(), "hold-fail") }).verdict).toBe("blocked");
  });
});

describe("governance fold — trend is the PRIMARY (never a vacuous healthy)", () => {
  it("a clean latest report/audit without a trend is incomplete, not healthy", () => {
    const r = verdict({ report: promoteReadyReport(), audit: passAudit() });
    expect(r.verdict).toBe("incomplete");
    expect(r.reasons).toContain("trend-missing");
  });

  it("healthy requires the trend to be stable (a warning trend can never be healthy)", () => {
    expect(verdict({ trend: warningTrend(), report: promoteReadyReport() }).verdict).not.toBe("healthy");
  });
});

describe("governance fold — precedence: blocking > insufficient > advisory > ready", () => {
  it("a blocker masks a co-occurring insufficiency and advisory", () => {
    // failing trend (blocking) + unknown audit (insufficient) + warn... blocking dominates.
    const r = verdict({ trend: failingTrend(), audit: failAudit() });
    expect(r.verdict).toBe("blocked");
    expect(r.blocking).toBeGreaterThan(0);
  });

  it("an insufficiency masks a co-occurring advisory", () => {
    // unknown trend (insufficient) + hold-warning report (advisory) → incomplete.
    const r = verdict({ trend: unknownTrend(), report: holdWarningReport() });
    expect(r.verdict).toBe("incomplete");
  });
});

describe("governance fold — --require-report / --require-audit", () => {
  it("a missing required report/audit is an insufficiency", () => {
    expect(verdict({ trend: stableTrend() }, { requireReport: true }).reasons).toContain("report-missing");
    expect(verdict({ trend: stableTrend() }, { requireAudit: true }).reasons).toContain("audit-missing");
    expect(verdict({ trend: stableTrend() }, { requireReport: true }).verdict).toBe("incomplete");
  });

  it("a required-and-supplied clean document keeps the window healthy", () => {
    expect(
      verdict({ trend: stableTrend(), report: promoteReadyReport(), audit: passAudit() }, { requireReport: true, requireAudit: true }).verdict,
    ).toBe("healthy");
  });
});

describe("governance fold — --strict-watch escalation", () => {
  it("escalates an advisory-only posture to blocked, with the escalation flag + dedicated summary", () => {
    const r = verdict({ trend: warningTrend() }, { strictWatch: true });
    expect(r.verdict).toBe("blocked");
    expect(r.strictWatchEscalated).toBe(true);
    expect(r.detail).toMatch(/--strict-watch/);
  });

  it("does NOT escalate an insufficient or blocking posture (surgical)", () => {
    expect(verdict({ trend: unknownTrend() }, { strictWatch: true }).verdict).toBe("incomplete");
    expect(verdict({ trend: unknownTrend() }, { strictWatch: true }).strictWatchEscalated).toBe(false);
    expect(verdict({ trend: failingTrend() }, { strictWatch: true }).strictWatchEscalated).toBe(false);
  });
});

describe("report-trend-mismatch cross-check", () => {
  it("fires (advisory) when the latest report differs from the trend's newest report", () => {
    // warning trend newest = hold-warning; latest report = promote-ready → they disagree.
    const r = verdict({ trend: warningTrend(), report: promoteReadyReport() });
    expect(r.reasons).toContain("report-trend-mismatch");
    expect(r.verdict).toBe("watch");
  });

  it("does NOT fire when the latest report matches the trend's newest report", () => {
    // stable trend newest = promote-ready; latest report = promote-ready → they agree.
    const r = verdict({ trend: stableTrend(), report: promoteReadyReport() });
    expect(r.reasons).not.toContain("report-trend-mismatch");
    expect(r.verdict).toBe("healthy");
  });

  it("does NOT fire when the trend is not usable (no known newest)", () => {
    const r = verdict({ trend: notADocument(), report: promoteReadyReport() });
    expect(r.reasons).not.toContain("report-trend-mismatch");
  });
});

describe("computeGovernanceRollup / deriveGovernanceReasons — direct", () => {
  const sourcesFrom = (objs: GovernanceObjects) => ({
    trend: reduceTrendSource({ supplied: objs.trend !== undefined, ingested: ingestTrend(objs.trend) }),
    report: reduceReportSource({ supplied: objs.report !== undefined, ingested: ingestReportSource(objs.report) }),
    audit: reduceAuditSource({ supplied: objs.audit !== undefined, ingested: ingestAuditSource(objs.audit) }),
  });

  it("emits reasons in the canonical superset order, deduped", () => {
    const reasons = deriveGovernanceReasons(sourcesFrom({ trend: warningTrend(), audit: warnAudit() }), defaultPolicy());
    // trend-warning comes before audit-drift in the canonical order.
    expect(reasons.indexOf("trend-warning")).toBeLessThan(reasons.indexOf("audit-drift"));
  });

  it("a clean healthy fold fires no reason", () => {
    const { rollup } = computeGovernanceRollup(sourcesFrom({ trend: stableTrend() }), defaultPolicy());
    expect(rollup.reasons).toEqual([]);
    expect(rollup.healthy).toBe(true);
  });
});
