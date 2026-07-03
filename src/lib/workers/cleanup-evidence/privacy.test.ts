// @vitest-environment node
/**
 * The **no-leak contract** for cleanup evidence monitoring (Phase 44). A monitor is pointed at an
 * operator's own report file; a hostile or careless report (or a hostile configured PATH) must
 * never smuggle an object key, bucket, URL, filename, env-like string, OCR text, byte snippet,
 * raw metadata, or provider error into the resolved posture or its derived metric. The parser
 * reads ONLY a bounded allowlist of fields, so every extra field is unreadable by construction —
 * these tests prove it end-to-end through parse → posture → metric.
 */
import { describe, expect, it } from "vitest";
import { parseCleanupReport } from "./parse";
import { resolveObservationPosture } from "./posture";
import { readCleanupEvidencePosture } from "./read";
import { deriveCleanupEvidenceMetric } from "./metrics";
import { CLEANUP_EVIDENCE_ENV } from "./config";
import { CLEANUP_CHECK_SCHEMA } from "../cleanup/render";
import { sanitizeMetric } from "../observability/metrics";
import type { CleanupEvidenceConfig } from "./config";

const NOW = Date.parse("2026-07-03T12:00:00.000Z");

/** Every sensitive shape a hostile report / path could try to smuggle. */
const FORBIDDEN = [
  "leaky-bucket",
  "amazonaws",
  "://",
  "http",
  ".pdf",
  "akia",
  "john doe",
  "ssn",
  "deadbeef",
  "accessdenied",
  "h_live",
  "/tmp/",
  "statement",
  "us-east-1",
  "bearer ",
];

function assertContentFree(label: string, value: unknown) {
  const text = JSON.stringify(value).toLowerCase();
  for (const bad of FORBIDDEN) {
    expect(text, `${label} leaked "${bad}"`).not.toContain(bad);
  }
}

/** A cleanup-check summary whose EVERY optional/extra field is hostile. */
const HOSTILE_SUMMARY = {
  schema: CLEANUP_CHECK_SCHEMA,
  generatedAt: "2026-07-03T11:00:00.000Z",
  verdict: "drift",
  provider: "remote-configured",
  // ── hostile extras the parser must never read ──
  objectKey: "s3://leaky-bucket/user/statement.pdf",
  bucket: "leaky-bucket",
  region: "us-east-1",
  endpoint: "https://s3.us-east-1.amazonaws.com",
  url: "https://cdn.example.com/download?handoff=h_liveToken123",
  filename: "Bank Statement.pdf",
  summary: "OCR: John Doe, SSN 123-45-6789; bytes deadbeefcafe",
  error: "AccessDenied: the caller AKIAEXAMPLE is not authorized",
  authorization: "Bearer sk-secret-value",
  accountId: "123456789012",
  nested: { key: "s3://leaky-bucket/x", head: { ETag: "deadbeef" } },
};

const config = (): CleanupEvidenceConfig => ({
  enabled: true,
  checkReportPath: "r.json",
  sweepReportPath: null,
  maxAgeMs: 26 * 60 * 60 * 1000,
});

describe("hostile report bodies never leak into the posture or metric", () => {
  it("reads only bounded fields; the parsed report carries no smuggled substring", () => {
    const parsed = parseCleanupReport(HOSTILE_SUMMARY);
    expect(parsed.ok).toBe(true);
    assertContentFree("parsed report", parsed);
  });

  it("the resolved posture is content-free", () => {
    const parsed = parseCleanupReport(HOSTILE_SUMMARY);
    if (!parsed.ok) throw new Error("expected a parse");
    const posture = resolveObservationPosture({ kind: "report", report: parsed.report, mtimeMs: NOW }, config(), NOW);
    assertContentFree("posture", posture);
    // The load-bearing verdict still survived (drift → warning): honesty preserved.
    expect(posture.state).toBe("warning");
  });

  it("the derived metric is content-free and sanitizes", () => {
    const parsed = parseCleanupReport(HOSTILE_SUMMARY);
    if (!parsed.ok) throw new Error("expected a parse");
    const posture = resolveObservationPosture({ kind: "report", report: parsed.report, mtimeMs: NOW }, config(), NOW);
    const metric = deriveCleanupEvidenceMetric(posture);
    assertContentFree("metric", metric);
    expect(sanitizeMetric(metric)).not.toBeNull();
  });

  it("a hostile configured PATH never reaches the posture (reader maps to a bounded reason)", () => {
    const hostilePath = "/tmp/s3://leaky-bucket/statement.pdf?sig=deadbeef";
    // Injected deps return the hostile body for the hostile path; the reader must not echo either.
    const posture = readCleanupEvidencePosture(
      { [CLEANUP_EVIDENCE_ENV.checkReport]: hostilePath },
      {
        readReportFile: (p) =>
          p === hostilePath
            ? { kind: "ok", text: JSON.stringify(HOSTILE_SUMMARY), mtimeMs: NOW }
            : { kind: "missing" },
        now: () => NOW,
      },
    );
    assertContentFree("reader posture", posture);
  });

  it("a hostile path that is missing/unreadable still never leaks", () => {
    const hostilePath = "/tmp/AKIAEXAMPLE/leaky-bucket/statement.pdf";
    for (const kind of ["missing", "unreadable"] as const) {
      const posture = readCleanupEvidencePosture(
        { [CLEANUP_EVIDENCE_ENV.checkReport]: hostilePath },
        { readReportFile: () => ({ kind }), now: () => NOW },
      );
      assertContentFree(`reader ${kind}`, posture);
    }
  });
});
