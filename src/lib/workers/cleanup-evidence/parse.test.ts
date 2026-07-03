// @vitest-environment node
/**
 * Trust-boundary proofs for the cleanup evidence report parser (Phase 44). The load-bearing
 * guarantee: it accepts ONLY the bounded `pdfxyz.cleanup-check/1` and `pdfxyz.artifact-cleanup/1`
 * report SUMMARIES, reduces each to its bounded verdict/provider/timestamp, and REFUSES every raw
 * evidence / inventory / provider-export / projected-document shape — so a monitor pointed at a
 * raw export by mistake fails closed with a bounded reason, never leaks, and never parses.
 */
import { describe, expect, it } from "vitest";
import { parseCleanupReport, parseCleanupReportText } from "./parse";
import { CLEANUP_CHECK_SCHEMA } from "../cleanup/render";
import { ARTIFACT_CLEANUP_SCHEMA } from "../artifacts/cleanup/run";

/** A representative content-free cleanup-check (absence verifier) summary. */
function checkSummary(over: Record<string, unknown> = {}) {
  return {
    schema: CLEANUP_CHECK_SCHEMA,
    generatedAt: "2026-07-03T00:00:00.000Z",
    source: "file",
    ok: true,
    verdict: "verified",
    exitCode: 0,
    provider: "remote-configured",
    total: 3,
    reaped: 3,
    drift: 0,
    graceHours: 6,
    counts: {},
    summary: "authored elsewhere",
    ...over,
  };
}

/** A representative content-free artifact-cleanup (dry-run sweeper) summary. */
function sweepSummary(over: Record<string, unknown> = {}) {
  return {
    tool: "worker-artifact-cleanup",
    schema: ARTIFACT_CLEANUP_SCHEMA,
    dryRun: true,
    generatedAt: "2026-07-03T00:00:00.000Z",
    report: { verdict: "drift", total: 5, categories: {}, severities: {}, ...(over.report as object) },
    receipt: {},
    ...over,
  };
}

describe("accepts recognized content-free summaries", () => {
  it("parses a cleanup-check summary into its bounded facts", () => {
    const r = parseCleanupReport(checkSummary());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.reportKind).toBe("cleanup-check");
    expect(r.report.verdictClass).toBe("verified");
    expect(r.report.provider).toBe("remote-configured");
    expect(r.report.generatedAtMs).toBe(Date.parse("2026-07-03T00:00:00.000Z"));
  });

  it("folds every cleanup-check verdict to the unified class", () => {
    const cases: Array<[string, string]> = [
      ["verified", "verified"],
      ["drift", "drift"],
      ["unknown", "unknown"],
      ["unavailable", "unknown"],
      ["not-configured", "not-configured"],
    ];
    for (const [verdict, cls] of cases) {
      const r = parseCleanupReport(checkSummary({ verdict }));
      expect(r.ok && r.report.verdictClass).toBe(cls);
    }
  });

  it("parses an artifact-cleanup summary and folds its verdict (ok→verified, breach→breach)", () => {
    expect(
      (() => {
        const r = parseCleanupReport(sweepSummary({ report: { verdict: "ok" } }));
        return r.ok && r.report.verdictClass;
      })(),
    ).toBe("verified");
    const breach = parseCleanupReport(sweepSummary({ report: { verdict: "breach" } }));
    expect(breach.ok).toBe(true);
    if (breach.ok) {
      expect(breach.report.reportKind).toBe("artifact-cleanup");
      expect(breach.report.verdictClass).toBe("breach");
      // The sweeper summary declares no single provider → `unknown`.
      expect(breach.report.provider).toBe("unknown");
    }
  });

  it("defaults provider to unknown when a cleanup-check summary omits it", () => {
    const r = parseCleanupReport(checkSummary({ provider: undefined }));
    expect(r.ok && r.report.provider).toBe("unknown");
  });

  it("returns null timestamp for an absent/garbled generatedAt (no fabrication)", () => {
    expect((parseCleanupReport(checkSummary({ generatedAt: undefined })) as { report: { generatedAtMs: number | null } }).report.generatedAtMs).toBeNull();
    expect((parseCleanupReport(checkSummary({ generatedAt: "not-a-date" })) as { report: { generatedAtMs: number | null } }).report.generatedAtMs).toBeNull();
  });
});

describe("refuses raw inputs, projected documents, and malformed reports", () => {
  it("refuses a bare raw evidence array (the verifier's INPUT)", () => {
    const raw = [{ presence: "present", lifecycle: { expiresAtMs: 1, deleted: false }, activeDelete: false }];
    const r = parseCleanupReport(raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("report_malformed");
  });

  it("refuses an object carrying `objects` (raw evidence set / projector evidence output)", () => {
    const r = parseCleanupReport({ schema: CLEANUP_CHECK_SCHEMA, objects: [{ presence: "present" }] });
    expect(!r.ok && r.reason).toBe("report_malformed");
  });

  it("refuses an object carrying `records` (raw inventory / projector inventory output)", () => {
    const r = parseCleanupReport({ schema: ARTIFACT_CLEANUP_SCHEMA, records: [{ id: "x" }] });
    expect(!r.ok && r.reason).toBe("report_malformed");
  });

  it("refuses a raw AWS provider export (`Contents`)", () => {
    const r = parseCleanupReport({ Contents: [{ Key: "obj", ETag: "abc" }], Name: "bucket" });
    expect(!r.ok && r.reason).toBe("report_malformed");
  });

  it("refuses the projector's projected document (carries raw records)", () => {
    const doc = {
      schema: "pdfxyz.cleanup-projection/1",
      target: "evidence",
      objects: [{ presence: "present", expiresAtMs: 1 }],
      receipt: { verdict: "projected" },
    };
    expect((parseCleanupReport(doc) as { ok: false; reason: string }).reason).toBe("report_malformed");
  });

  it("refuses an unrecognized schema tag and a missing verdict", () => {
    expect((parseCleanupReport({ schema: "pdfxyz.something/9" }) as { ok: false; reason: string }).reason).toBe("report_malformed");
    expect((parseCleanupReport(checkSummary({ verdict: "not-a-verdict" })) as { ok: false; reason: string }).reason).toBe("report_malformed");
    expect((parseCleanupReport(sweepSummary({ report: { verdict: "drift-x" } })) as { ok: false; reason: string }).reason).toBe("report_malformed");
  });

  it("refuses non-objects and scalars", () => {
    for (const v of [null, undefined, 42, "x", true]) {
      expect((parseCleanupReport(v) as { ok: false; reason: string }).reason).toBe("report_malformed");
    }
  });

  it("parseCleanupReportText refuses invalid JSON without throwing", () => {
    const r = parseCleanupReportText("{not json");
    expect(!r.ok && r.reason).toBe("report_malformed");
  });

  it("parseCleanupReportText round-trips a serialized summary", () => {
    const r = parseCleanupReportText(JSON.stringify(checkSummary({ verdict: "drift" })));
    expect(r.ok && r.report.verdictClass).toBe("drift");
  });
});
