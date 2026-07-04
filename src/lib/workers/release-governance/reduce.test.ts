import { describe, expect, it } from "vitest";
import {
  computeCoverage,
  reduceAuditSource,
  reduceReportSource,
  reduceTrendSource,
  sourceState,
} from "./reduce";
import { ingestAuditSource, ingestReportSource, ingestTrend } from "./ingest";
import {
  failAudit,
  notADocument,
  passAudit,
  promoteReadyReport,
  stableTrend,
  tamperTrend,
  warningTrend,
} from "./fixtures";

const trendSrc = (obj: unknown | undefined) =>
  reduceTrendSource({ supplied: obj !== undefined, ingested: ingestTrend(obj) });
const reportSrc = (obj: unknown | undefined) =>
  reduceReportSource({ supplied: obj !== undefined, ingested: ingestReportSource(obj) });
const auditSrc = (obj: unknown | undefined) =>
  reduceAuditSource({ supplied: obj !== undefined, ingested: ingestAuditSource(obj) });

describe("sourceState", () => {
  it("maps the supplied / recognized / usable flags to a bounded state", () => {
    expect(sourceState(false, false, false)).toBe("absent");
    expect(sourceState(true, false, false)).toBe("unreadable");
    expect(sourceState(true, true, false)).toBe("tampered");
    expect(sourceState(true, true, true)).toBe("usable");
  });
});

describe("reduceTrendSource", () => {
  it("a usable stable trend maps to ready + carries facts", () => {
    const s = trendSrc(stableTrend());
    expect(s).toMatchObject({ id: "trend", state: "usable", verdict: "stable", severity: "ready" });
    expect(s.facts).not.toBeNull();
  });

  it("a usable warning trend maps to advisory", () => {
    expect(trendSrc(warningTrend()).severity).toBe("advisory");
  });

  it("an absent trend contributes no severity (the rollup handles missing primary)", () => {
    const s = trendSrc(undefined);
    expect(s).toMatchObject({ state: "absent", severity: null, verdict: null, facts: null });
    expect(s.detail).toMatch(/no release trend summary supplied/i);
  });

  it("a tampered trend is blocking + surfaces its untrusted claimed verdict, never its facts", () => {
    const s = trendSrc(tamperTrend(stableTrend()));
    expect(s.state).toBe("tampered");
    expect(s.severity).toBe("blocking");
    expect(s.facts).toBeNull();
    expect(s.detail).toMatch(/tampered \/ corrupt/i);
  });

  it("an unreadable trend is insufficient", () => {
    expect(trendSrc(notADocument()).severity).toBe("insufficient");
  });
});

describe("reduceReportSource / reduceAuditSource", () => {
  it("a usable promote-ready report maps to ready with its recommendation as the posture", () => {
    const s = reportSrc(promoteReadyReport());
    expect(s).toMatchObject({ id: "report", state: "usable", verdict: "promote-ready", severity: "ready" });
    if (s.id !== "report") throw new Error("expected a report source");
    expect(s.facts?.recommendation).toBe("promote-ready");
  });

  it("a usable passing audit maps to ready; a failing audit maps to blocking", () => {
    expect(auditSrc(passAudit())).toMatchObject({ id: "audit", verdict: "pass", severity: "ready" });
    expect(auditSrc(failAudit()).severity).toBe("blocking");
  });
});

describe("computeCoverage", () => {
  it("counts supplied and usable across the three sources", () => {
    const cov = computeCoverage(trendSrc(stableTrend()), reportSrc(promoteReadyReport()), auditSrc(undefined));
    expect(cov).toMatchObject({
      sourcesSupplied: 2,
      sourcesUsable: 2,
      trend: "usable",
      report: "usable",
      audit: "absent",
      hasTrend: true,
      hasReport: true,
      hasAudit: false,
    });
  });

  it("a tampered source counts as supplied but not usable", () => {
    const cov = computeCoverage(trendSrc(tamperTrend(stableTrend())), reportSrc(undefined), auditSrc(undefined));
    expect(cov.sourcesSupplied).toBe(1);
    expect(cov.sourcesUsable).toBe(0);
    expect(cov.hasTrend).toBe(false);
  });
});
