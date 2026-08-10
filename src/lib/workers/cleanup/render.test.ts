// @vitest-environment node
/**
 * Contract for the cleanup-check renderers + exit-code map: the verdict→severity→exit ladder,
 * the three output formats all derived from one content-free result, and the usage-error shape.
 */
import { describe, expect, it } from "vitest";
import {
  emptyCleanupCounts,
  type CleanupVerdict,
  type CleanupVerification,
} from "./types";
import {
  buildCleanupCheckResult,
  buildCleanupUsageError,
  exitCodeForCleanupVerdict,
  renderCleanupCheck,
  severityForCleanupVerdict,
  CLEANUP_CHECK_SCHEMA,
} from "./render";

function verification(
  partial: Partial<CleanupVerification>,
): CleanupVerification {
  return {
    verdict: partial.verdict ?? "verified",
    provider: partial.provider ?? "remote-configured",
    counts: partial.counts ?? emptyCleanupCounts(),
    total: partial.total ?? 0,
    reaped: partial.reaped ?? 0,
    drift: partial.drift ?? 0,
    summary: partial.summary ?? "ok",
  };
}

const ctx = {
  source: "stdin" as const,
  generatedAt: "2026-07-03T00:00:00.000Z",
  graceHours: 48,
};

describe("exit-code ladder", () => {
  const cases: [CleanupVerdict, string, number][] = [
    ["verified", "ok", 0],
    ["drift", "warn", 3],
    ["unknown", "unknown", 2],
    ["unavailable", "unknown", 2],
    ["not-configured", "unknown", 2],
  ];
  for (const [verdict, severity, exit] of cases) {
    it(`maps ${verdict} → ${severity} → exit ${exit}`, () => {
      expect(severityForCleanupVerdict(verdict)).toBe(severity);
      expect(exitCodeForCleanupVerdict(verdict)).toBe(exit);
    });
  }
});

describe("buildCleanupCheckResult", () => {
  it("marks ok true only for verified and stamps the schema + exit code", () => {
    const ok = buildCleanupCheckResult(
      verification({ verdict: "verified", reaped: 3, total: 3 }),
      ctx,
    );
    expect(ok).toMatchObject({
      schema: CLEANUP_CHECK_SCHEMA,
      ok: true,
      verdict: "verified",
      exitCode: 0,
      graceHours: 48,
      source: "stdin",
    });
    const drift = buildCleanupCheckResult(
      verification({ verdict: "drift", drift: 1, total: 1 }),
      ctx,
    );
    expect(drift.ok).toBe(false);
    expect(drift.exitCode).toBe(3);
  });
});

describe("renderCleanupCheck — json", () => {
  it("emits the result verbatim as parseable JSON with a trailing newline", () => {
    const result = buildCleanupCheckResult(
      verification({ verdict: "drift", drift: 2, total: 5 }),
      ctx,
    );
    const json = renderCleanupCheck(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(result);
  });
});

describe("renderCleanupCheck — prometheus", () => {
  it("emits the verdict gauge, drift gauge, and a per-state series", () => {
    const counts = emptyCleanupCounts();
    counts.drift = 2;
    counts["absent-backstop"] = 3;
    const result = buildCleanupCheckResult(
      verification({ verdict: "drift", counts, drift: 2, reaped: 3, total: 5 }),
      ctx,
    );
    const out = renderCleanupCheck(result, "prometheus");
    expect(out).toMatch(/pdfxyz_cleanup_check_verdict 1/); // drift code = 1
    expect(out).toMatch(
      /pdfxyz_cleanup_check_info\{verdict="drift",provider="remote-configured"\} 1/,
    );
    expect(out).toMatch(/pdfxyz_cleanup_check_drift 2/);
    expect(out).toMatch(/pdfxyz_cleanup_check_objects\{state="drift"\} 2/);
    expect(out).toMatch(
      /pdfxyz_cleanup_check_objects\{state="absent-backstop"\} 3/,
    );
  });
});

describe("renderCleanupCheck — text", () => {
  it("emits a short human summary with verdict, provider, and counts", () => {
    const result = buildCleanupCheckResult(
      verification({
        verdict: "verified",
        reaped: 4,
        total: 4,
        summary: "Verified: all gone.",
      }),
      ctx,
    );
    const out = renderCleanupCheck(result, "text");
    expect(out).toMatch(/Verified: all gone\./);
    expect(out).toMatch(/verdict: verified/);
    expect(out).toMatch(/reaped: 4/);
    expect(out).toMatch(/grace: 48h/);
  });
});

describe("usage error", () => {
  it("carries exit 1 and content-free issue codes", () => {
    const err = buildCleanupUsageError("file", ctx.generatedAt, [
      "input-unreadable",
    ]);
    expect(err).toMatchObject({
      ok: false,
      error: "usage",
      exitCode: 1,
      issues: ["input-unreadable"],
    });
  });

  it("renders in every format without leaking", () => {
    const err = buildCleanupUsageError("stdin", ctx.generatedAt, [
      "malformed-json",
    ]);
    expect(renderCleanupCheck(err, "json")).toMatch(/"error": "usage"/);
    expect(renderCleanupCheck(err, "prometheus")).toMatch(
      /pdfxyz_cleanup_check_error\{kind="usage"\} 1/,
    );
    expect(renderCleanupCheck(err, "text")).toMatch(
      /usage error \(malformed-json\)/,
    );
  });
});
