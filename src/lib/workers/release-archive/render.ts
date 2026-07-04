import type {
  ArchiveAuditFacts,
  ArchiveBundleFacts,
  ArchiveGovernanceFacts,
  ArchiveReportFacts,
  ArchiveTrendFacts,
  ReleaseArchiveRecord,
  ReleaseArchiveResult,
} from "./types";

export type ReleaseArchiveFormat = "json" | "text";

export function renderReleaseArchiveJson(result: ReleaseArchiveResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

function factsLines(record: ReleaseArchiveRecord): string[] {
  if (record.id === "governance") {
    const f = record.facts as ArchiveGovernanceFacts | null;
    if (f === null) return [];
    return [
      `      governance: verdict=${f.verdict}, healthy=${f.healthy}, sources=${f.sourcesUsable}/${f.sourcesSupplied} usable`,
      `      related: trend=${f.trendVerdict ?? "n/a"}, report=${f.reportVerdict ?? "n/a"}, audit=${f.auditVerdict ?? "n/a"}`,
    ];
  }
  if (record.id === "trend") {
    const f = record.facts as ArchiveTrendFacts | null;
    if (f === null) return [];
    return [`      trend: verdict=${f.verdict}, stable=${f.stable}, reports=${f.reportsUsable}/${f.reportsConsidered}, newest=${f.newest ?? "n/a"}`];
  }
  if (record.id === "report") {
    const f = record.facts as ArchiveReportFacts | null;
    if (f === null) return [];
    return [`      report: recommendation=${f.recommendation}, ready=${f.ready}, bundle=${f.hasBundle}, audit=${f.hasAudit}`];
  }
  if (record.id === "audit") {
    const f = record.facts as ArchiveAuditFacts | null;
    if (f === null) return [];
    return [`      audit: verdict=${f.verdict}, comparable=${f.comparable}, blocking=${f.blockingRegressions}, warning=${f.warningRegressions}`];
  }
  const f = record.facts as ArchiveBundleFacts | null;
  if (f === null) return [];
  return [`      bundle: verdict=${f.verdict ?? "n/a"}, stages=${f.stagesPresent}, complete=${f.chainComplete}, inconsistencies=${f.inconsistencies}`];
}

function recordLines(record: ReleaseArchiveRecord): string[] {
  const sev = record.severity === null ? "—" : record.severity.toUpperCase();
  return [`  [${sev}] ${record.id} — state=${record.state}, posture=${record.verdict ?? "n/a"}`, ...factsLines(record)];
}

function renderReleaseArchiveText(result: ReleaseArchiveResult): string {
  const { archive, coverage, policy } = result;
  const lines: string[] = [];
  lines.push("pdf.xyz release evidence archive pack");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");
  lines.push(`ARCHIVE: ${archive.posture.toUpperCase()} (exit ${archive.exitCode})`);
  lines.push(`  ${archive.detail}`);
  if (archive.reasons.length > 0) lines.push(`  reasons: ${archive.reasons.join(", ")}`);
  lines.push(`  counts: ${archive.blocking} blocking, ${archive.insufficiencies} insufficiency, ${archive.advisories} advisory${archive.strictWatch ? archive.strictWatchEscalated ? " (strict-watch, escalated)" : " (strict-watch)" : ""}`);
  lines.push("");
  lines.push("EVIDENCE COVERAGE");
  lines.push(`  records: ${coverage.recordsUsable}/${coverage.recordsSupplied} usable/supplied; governance=${coverage.governance}, trend=${coverage.trend}, report=${coverage.report}, audit=${coverage.audit}, bundle=${coverage.bundle}`);
  lines.push(`  policy: require-trend=${policy.requireTrend}, require-report=${policy.requireReport}, require-audit=${policy.requireAudit}, require-bundle=${policy.requireBundle}, strict-watch=${policy.strictWatch}`);
  lines.push("");
  lines.push("RECORDS");
  for (const record of result.records) for (const line of recordLines(record)) lines.push(line);
  lines.push("");
  if (result.reasons.length > 0) {
    lines.push("REASONS");
    for (const r of result.reasons) {
      lines.push(`  [${r.severity.toUpperCase()}] ${r.id}`);
      lines.push(`      ${r.detail}`);
    }
    lines.push("");
  }
  lines.push("ARCHIVE CHECKLIST (content-free record classes to keep together)");
  lines.push(`  items: ${result.checklist.items.join(", ")}`);
  lines.push(`  ${result.checklist.note}`);
  lines.push("");
  lines.push("FOLLOW-UP (assignments)");
  for (const f of result.followUps) lines.push(`  - [${f.id}] ${f.detail}`);
  lines.push("");
  lines.push("GUIDANCE (this pack does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");
  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);
  return `${lines.join("\n")}\n`;
}

export function renderReleaseArchive(
  result: ReleaseArchiveResult,
  format: ReleaseArchiveFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseArchiveJson(result, pretty) : renderReleaseArchiveText(result);
}
