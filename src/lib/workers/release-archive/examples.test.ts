import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestAuditRecord, ingestBundleRecord, ingestGovernance, ingestReportRecord, ingestTrendRecord } from "./ingest";
import { buildArchiveResult } from "./build";
import type { IngestedArchiveRecords } from "./ingest";
import type { ReleaseArchivePolicy } from "./types";

const ROOT = process.cwd();
const EXAMPLES = join(ROOT, "docs/examples/release-archive");
const NOW = "2026-07-04T00:00:00.000Z";
const policy: ReleaseArchivePolicy = {
  requireTrend: false,
  requireReport: false,
  requireAudit: false,
  requireBundle: false,
  strictWatch: false,
};

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
}

function absentRecords(overrides: Partial<IngestedArchiveRecords>): IngestedArchiveRecords {
  const wrong = { schema: "not-a-release-document/1" };
  return {
    governance: { supplied: false, ingested: ingestGovernance(wrong) },
    trend: { supplied: false, ingested: ingestTrendRecord(wrong) },
    report: { supplied: false, ingested: ingestReportRecord(wrong) },
    audit: { supplied: false, ingested: ingestAuditRecord(wrong) },
    bundle: { supplied: false, ingested: ingestBundleRecord(wrong) },
    ...overrides,
  };
}

describe("release archive examples", () => {
  it("committed healthy fixtures compose to archivable", () => {
    const result = buildArchiveResult(
      NOW,
      absentRecords({
        governance: { supplied: true, ingested: ingestGovernance(load("governance-healthy.json")) },
        trend: { supplied: true, ingested: ingestTrendRecord(load("trend-stable.json")) },
        report: { supplied: true, ingested: ingestReportRecord(load("report-promote-ready.json")) },
        audit: { supplied: true, ingested: ingestAuditRecord(load("audit-pass.json")) },
        bundle: { supplied: true, ingested: ingestBundleRecord(load("bundle-pass.json")) },
      }),
      policy,
    );
    expect(result.schema).toBe("pdfxyz.release-archive/1");
    expect(result.archive.posture).toBe("archivable");
    expect(result.archive.exitCode).toBe(0);
  });

  it("committed advisory fixtures compose to archive-watch", () => {
    const result = buildArchiveResult(
      NOW,
      absentRecords({
        governance: { supplied: true, ingested: ingestGovernance(load("governance-watch.json")) },
        trend: { supplied: true, ingested: ingestTrendRecord(load("trend-warning.json")) },
      }),
      policy,
    );
    expect(result.archive.posture).toBe("archive-watch");
    expect(result.archive.exitCode).toBe(3);
  });

  it("blocked/incomplete/tampered governance fixtures fail closed", () => {
    const blocked = buildArchiveResult(NOW, absentRecords({ governance: { supplied: true, ingested: ingestGovernance(load("governance-blocked.json")) } }), policy);
    const incomplete = buildArchiveResult(NOW, absentRecords({ governance: { supplied: true, ingested: ingestGovernance(load("governance-incomplete.json")) } }), policy);
    const tampered = buildArchiveResult(NOW, absentRecords({ governance: { supplied: true, ingested: ingestGovernance(load("governance-tampered.json")) } }), policy);
    expect(blocked.archive.posture).toBe("archive-blocked");
    expect(incomplete.archive.posture).toBe("archive-incomplete");
    expect(tampered.archive.posture).toBe("archive-blocked");
    expect(tampered.archive.reasons).toContain("governance-tampered");
  });
});
