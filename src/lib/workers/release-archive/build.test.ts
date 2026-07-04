import { describe, expect, it } from "vitest";
import { makeGovernance, stableTrend, promoteReadyReport, passAudit, tamperReport } from "../release-governance/fixtures";
import { ingestGovernance, ingestReportRecord, ingestTrendRecord } from "./ingest";
import { buildArchiveResult } from "./build";
import type { IngestedArchiveRecords } from "./ingest";
import type { ReleaseArchivePolicy } from "./types";

const NOW = "2026-07-04T00:00:00.000Z";
const policy: ReleaseArchivePolicy = {
  requireTrend: false,
  requireReport: false,
  requireAudit: false,
  requireBundle: false,
  strictWatch: false,
};

function records(over: Partial<IngestedArchiveRecords> = {}): IngestedArchiveRecords {
  const trend = stableTrend();
  const report = promoteReadyReport();
  const audit = passAudit();
  const governance = makeGovernance({ trend, report, audit });
  return {
    governance: { supplied: true, ingested: ingestGovernance(governance) },
    trend: { supplied: true, ingested: ingestTrendRecord(trend) },
    report: { supplied: true, ingested: ingestReportRecord(report) },
    audit: { supplied: false, ingested: { recognized: false, usable: false, verdict: null, facts: null } },
    bundle: { supplied: false, ingested: { recognized: false, usable: false, facts: null } },
    ...over,
  };
}

describe("release archive pack", () => {
  it("is archivable with a healthy governance bundle and coherent related report", () => {
    const result = buildArchiveResult(NOW, records(), policy);
    expect(result.schema).toBe("pdfxyz.release-archive/1");
    expect(result.archive.posture).toBe("archivable");
    expect(result.archive.exitCode).toBe(0);
    expect(result.checklist.items).toContain("archive-pack");
  });

  it("fails closed on missing primary governance", () => {
    const result = buildArchiveResult(NOW, records({ governance: { supplied: false, ingested: { recognized: false, usable: false, verdict: null, facts: null } } }), policy);
    expect(result.archive.posture).toBe("archive-incomplete");
    expect(result.archive.reasons).toContain("governance-missing");
  });

  it("blocks tampered related records and never echoes hostile input", () => {
    const hostile = tamperReport(promoteReadyReport(), "hold-fail");
    hostile.raw = "/tmp/evil-token-123";
    const result = buildArchiveResult(NOW, records({ report: { supplied: true, ingested: ingestReportRecord(hostile) } }), policy);
    const output = JSON.stringify(result);
    expect(result.archive.posture).toBe("archive-blocked");
    expect(result.archive.reasons).toContain("report-tampered");
    expect(output).not.toContain("evil-token-123");
    expect(output).not.toContain("/tmp/");
  });
});
