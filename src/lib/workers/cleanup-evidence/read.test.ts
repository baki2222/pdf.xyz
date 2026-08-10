// @vitest-environment node
/**
 * Node-reader proofs for cleanup evidence monitoring (Phase 44). The fold logic is exercised
 * through injected `readReportFile` + clock deps (deterministic, no filesystem), and a small
 * real-`node:fs` section proves the default reader classifies a missing / oversize / valid file
 * without leaking a path. Disabled config is a pure no-op.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCleanupEvidencePosture,
  MAX_REPORT_BYTES,
  type CleanupEvidenceReadDeps,
  type ReadReportOutcome,
} from "./read";
import { CLEANUP_EVIDENCE_ENV } from "./config";
import { CLEANUP_CHECK_SCHEMA } from "../cleanup/render";

const NOW = Date.parse("2026-07-03T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function checkSummaryText(verdict: string, generatedAt: string): string {
  return JSON.stringify({
    schema: CLEANUP_CHECK_SCHEMA,
    generatedAt,
    verdict,
    provider: "remote-configured",
    total: 1,
    reaped: 1,
    drift: 0,
  });
}

function deps(
  files: Record<string, ReadReportOutcome>,
  now = NOW,
): CleanupEvidenceReadDeps {
  return {
    readReportFile: (p) => files[p] ?? { kind: "missing" },
    now: () => now,
  };
}

describe("readCleanupEvidencePosture (injected deps)", () => {
  it("is a pure no-op returning the disabled posture when nothing is configured", () => {
    let called = false;
    const p = readCleanupEvidencePosture(
      {},
      {
        readReportFile: () => {
          called = true;
          return { kind: "missing" };
        },
        now: () => NOW,
      },
    );
    expect(p.state).toBe("disabled");
    expect(called).toBe(false);
  });

  it("resolves healthy from a fresh valid summary", () => {
    const env = { [CLEANUP_EVIDENCE_ENV.checkReport]: "check.json" };
    const p = readCleanupEvidencePosture(
      env,
      deps({
        "check.json": {
          kind: "ok",
          text: checkSummaryText(
            "verified",
            new Date(NOW - HOUR).toISOString(),
          ),
          mtimeMs: NOW - HOUR,
        },
      }),
    );
    expect(p.state).toBe("healthy");
    expect(p.provider).toBe("remote-configured");
    expect(p.reportKind).toBe("cleanup-check");
  });

  it("maps a missing file to stale/report_missing", () => {
    const env = { [CLEANUP_EVIDENCE_ENV.checkReport]: "check.json" };
    const p = readCleanupEvidencePosture(
      env,
      deps({ "check.json": { kind: "missing" } }),
    );
    expect(p.state).toBe("stale");
    expect(p.reason).toBe("report_missing");
  });

  it("maps an unreadable file to invalid/report_unreadable", () => {
    const env = { [CLEANUP_EVIDENCE_ENV.checkReport]: "check.json" };
    const p = readCleanupEvidencePosture(
      env,
      deps({ "check.json": { kind: "unreadable" } }),
    );
    expect(p.state).toBe("invalid");
    expect(p.reason).toBe("report_unreadable");
  });

  it("maps a raw/garbage body to invalid/report_malformed", () => {
    const env = { [CLEANUP_EVIDENCE_ENV.checkReport]: "check.json" };
    const raw = JSON.stringify({ Contents: [{ Key: "obj", ETag: "x" }] });
    const p = readCleanupEvidencePosture(
      env,
      deps({ "check.json": { kind: "ok", text: raw, mtimeMs: NOW } }),
    );
    expect(p.state).toBe("invalid");
    expect(p.reason).toBe("report_malformed");
  });

  it("folds two configured reports to the worst posture", () => {
    const env = {
      [CLEANUP_EVIDENCE_ENV.checkReport]: "check.json",
      [CLEANUP_EVIDENCE_ENV.sweepReport]: "sweep.json",
    };
    const p = readCleanupEvidencePosture(
      env,
      deps({
        "check.json": {
          kind: "ok",
          text: checkSummaryText(
            "verified",
            new Date(NOW - HOUR).toISOString(),
          ),
          mtimeMs: NOW,
        },
        "sweep.json": { kind: "missing" },
      }),
    );
    expect(p.state).toBe("stale"); // missing (warn) beats healthy
    expect(p.reason).toBe("report_missing");
  });
});

describe("default node:fs reader classifies real files", () => {
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-cleanup-evidence-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("classifies a missing configured path as stale/report_missing", () => {
    const p = readCleanupEvidencePosture({
      [CLEANUP_EVIDENCE_ENV.checkReport]: join(dir, "nope.json"),
    });
    expect(p.state).toBe("stale");
    expect(p.reason).toBe("report_missing");
  });

  it("reads and classifies a fresh valid summary as healthy", () => {
    const path = join(dir, "check.json");
    writeFileSync(path, checkSummaryText("verified", new Date().toISOString()));
    const p = readCleanupEvidencePosture({
      [CLEANUP_EVIDENCE_ENV.checkReport]: path,
    });
    expect(p.state).toBe("healthy");
  });

  it("treats an oversize file as unreadable (a summary is never a megabyte)", () => {
    const path = join(dir, "big.json");
    writeFileSync(path, "x".repeat(MAX_REPORT_BYTES + 1));
    const p = readCleanupEvidencePosture({
      [CLEANUP_EVIDENCE_ENV.checkReport]: path,
    });
    expect(p.state).toBe("invalid");
    expect(p.reason).toBe("report_unreadable");
  });
});
