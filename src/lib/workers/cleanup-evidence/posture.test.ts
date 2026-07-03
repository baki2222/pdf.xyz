// @vitest-environment node
/**
 * Fold + freshness proofs for the cleanup evidence posture resolver (Phase 44). The load-bearing
 * honesty rules: a stale/timestamp-less benign verdict degrades to `stale` (never a fabricated
 * healthy); a concrete drift/breach stays a warning/critical even when stale; read failures map to
 * bounded states; and the worst posture wins deterministically across several configured reports.
 */
import { describe, expect, it } from "vitest";
import {
  resolveCleanupEvidencePosture,
  resolveObservationPosture,
  type CleanupEvidenceObservation,
} from "./posture";
import type { CleanupEvidenceConfig } from "./config";
import type { CleanupVerdictClass, ParsedCleanupReport } from "./parse";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-07-03T12:00:00.000Z");

const config = (over: Partial<CleanupEvidenceConfig> = {}): CleanupEvidenceConfig => ({
  enabled: true,
  checkReportPath: "report.json",
  sweepReportPath: null,
  maxAgeMs: 26 * HOUR,
  ...over,
});

function report(
  verdictClass: CleanupVerdictClass,
  over: Partial<ParsedCleanupReport> = {},
): ParsedCleanupReport {
  return {
    reportKind: "cleanup-check",
    verdictClass,
    provider: "remote-configured",
    generatedAtMs: NOW - 30 * 60 * 1000, // fresh, ~30 min old by default
    ...over,
  };
}

const obs = (report: ParsedCleanupReport, mtimeMs: number | null = null): CleanupEvidenceObservation => ({
  kind: "report",
  report,
  mtimeMs,
});

describe("verdict → state, with freshness applied", () => {
  it("a fresh verified report is healthy", () => {
    const p = resolveObservationPosture(obs(report("verified")), config(), NOW);
    expect(p.state).toBe("healthy");
    expect(p.reason).toBe("cleanup_verified");
    expect(p.freshness).toBe("fresh");
    expect(p.age).toBe("under-1h"); // NOW - 1h is at the boundary → under 1h? (exactly 1h)
  });

  it("a stale verified report degrades to stale (an old all-clear is not fresh proof)", () => {
    const p = resolveObservationPosture(obs(report("verified", { generatedAtMs: NOW - 48 * HOUR })), config(), NOW);
    expect(p.state).toBe("stale");
    expect(p.reason).toBe("report_stale");
    expect(p.freshness).toBe("stale");
    expect(p.age).toBe("1-7d");
  });

  it("a verified report with no timestamp at all degrades to stale (never fabricates fresh)", () => {
    const p = resolveObservationPosture(obs(report("verified", { generatedAtMs: null }), null), config(), NOW);
    expect(p.state).toBe("stale");
    expect(p.reason).toBe("report_stale");
    expect(p.freshness).toBe("unknown");
    expect(p.age).toBe("unknown");
  });

  it("falls back to file mtime when the summary carries no generatedAt", () => {
    const fresh = resolveObservationPosture(obs(report("verified", { generatedAtMs: null }), NOW - 2 * HOUR), config(), NOW);
    expect(fresh.state).toBe("healthy");
    expect(fresh.age).toBe("1-24h");
    const stale = resolveObservationPosture(obs(report("verified", { generatedAtMs: null }), NOW - 48 * HOUR), config(), NOW);
    expect(stale.state).toBe("stale");
  });

  it("a fresh drift report is a warning, and stays a warning even when stale", () => {
    expect(resolveObservationPosture(obs(report("drift")), config(), NOW).state).toBe("warning");
    expect(resolveObservationPosture(obs(report("drift")), config(), NOW).reason).toBe("cleanup_drift");
    const stale = resolveObservationPosture(obs(report("drift", { generatedAtMs: NOW - 100 * HOUR })), config(), NOW);
    expect(stale.state).toBe("warning"); // a concrete drift is not softened by staleness
    expect(stale.reason).toBe("cleanup_drift");
  });

  it("a breach report is critical, even when stale", () => {
    const p = resolveObservationPosture(obs(report("breach", { generatedAtMs: NOW - 100 * HOUR })), config(), NOW);
    expect(p.state).toBe("critical");
    expect(p.reason).toBe("cleanup_breach");
  });

  it("a fresh unknown verdict is unknown; a stale unknown degrades to stale", () => {
    expect(resolveObservationPosture(obs(report("unknown")), config(), NOW).state).toBe("unknown");
    expect(resolveObservationPosture(obs(report("unknown", { generatedAtMs: NOW - 48 * HOUR })), config(), NOW).state).toBe("stale");
  });

  it("a not-configured verdict is the neutral not-configured state regardless of freshness", () => {
    const fresh = resolveObservationPosture(obs(report("not-configured")), config(), NOW);
    const stale = resolveObservationPosture(obs(report("not-configured", { generatedAtMs: NOW - 99 * HOUR })), config(), NOW);
    expect(fresh.state).toBe("not-configured");
    expect(stale.state).toBe("not-configured");
    expect(fresh.reason).toBe("no_report_configured");
  });
});

describe("read failures map to bounded states", () => {
  it("missing → stale/report_missing (warn); unreadable/malformed → invalid (critical)", () => {
    const missing = resolveObservationPosture({ kind: "error", reason: "report_missing" }, config(), NOW);
    expect(missing.state).toBe("stale");
    expect(missing.reason).toBe("report_missing");
    expect(missing.reportKind).toBe("none");

    const unreadable = resolveObservationPosture({ kind: "error", reason: "report_unreadable" }, config(), NOW);
    expect(unreadable.state).toBe("invalid");
    expect(unreadable.reason).toBe("report_unreadable");

    const malformed = resolveObservationPosture({ kind: "error", reason: "report_malformed" }, config(), NOW);
    expect(malformed.state).toBe("invalid");
    expect(malformed.reason).toBe("report_malformed");
  });
});

describe("fold across multiple configured reports (worst wins)", () => {
  it("disabled config is the honest disabled posture", () => {
    const p = resolveCleanupEvidencePosture(config({ enabled: false }), [], NOW);
    expect(p.state).toBe("disabled");
    expect(p.reason).toBe("no_report_configured");
  });

  it("enabled but zero observations is stale/report_missing, never a fabricated healthy", () => {
    const p = resolveCleanupEvidencePosture(config(), [], NOW);
    expect(p.state).toBe("stale");
    expect(p.reason).toBe("report_missing");
  });

  it("a healthy report and a drift report resolve to the drift (warning)", () => {
    const p = resolveCleanupEvidencePosture(config(), [obs(report("verified")), obs(report("drift"))], NOW);
    expect(p.state).toBe("warning");
  });

  it("a drift report and a breach report resolve to the breach (critical)", () => {
    const p = resolveCleanupEvidencePosture(config(), [obs(report("drift")), obs(report("breach"))], NOW);
    expect(p.state).toBe("critical");
  });

  it("a missing report and a healthy report resolve to the stale/missing (warn beats healthy)", () => {
    const p = resolveCleanupEvidencePosture(config(), [{ kind: "error", reason: "report_missing" }, obs(report("verified"))], NOW);
    expect(p.state).toBe("stale");
    expect(p.reason).toBe("report_missing");
  });

  it("an invalid report outranks a drift report (critical wins)", () => {
    const p = resolveCleanupEvidencePosture(config(), [obs(report("drift")), { kind: "error", reason: "report_malformed" }], NOW);
    expect(p.state).toBe("invalid");
  });

  it("two healthy fresh reports stay healthy", () => {
    const p = resolveCleanupEvidencePosture(config(), [obs(report("verified")), obs(report("verified", { reportKind: "artifact-cleanup", provider: "unknown" }))], NOW);
    expect(p.state).toBe("healthy");
  });
});
