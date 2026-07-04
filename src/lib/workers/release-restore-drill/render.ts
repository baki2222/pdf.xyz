import type { ReleaseRestoreDrillRecord, ReleaseRestoreDrillResult } from "./types";

export type ReleaseRestoreDrillFormat = "json" | "text";

export function renderReleaseRestoreDrillJson(result: ReleaseRestoreDrillResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

function recordLine(record: ReleaseRestoreDrillRecord): string {
  const sev = record.severity === null ? "—" : record.severity.toUpperCase();
  const restored = record.restoredVerdict ?? "n/a";
  const archived = record.archivedVerdict ?? (record.archivedState === "usable" ? "n/a" : record.archivedState);
  return `  [${sev}] ${record.id} — ${record.restoreState}; restored=${restored}, archived=${archived}`;
}

function renderReleaseRestoreDrillText(result: ReleaseRestoreDrillResult): string {
  const { drill, coverage, policy, archive, digests } = result;
  const lines: string[] = [];
  lines.push("pdf.xyz release evidence restore drill");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");
  lines.push(`DRILL: ${drill.verdict.toUpperCase()} (exit ${drill.exitCode})`);
  lines.push(`  ${drill.detail}`);
  if (drill.reasons.length > 0) lines.push(`  reasons: ${drill.reasons.join(", ")}`);
  lines.push(
    `  counts: ${drill.blocking} blocking, ${drill.insufficiencies} insufficiency, ${drill.advisories} advisory${
      drill.strictDrift ? (drill.strictDriftEscalated ? " (strict-drift, escalated)" : " (strict-drift)") : ""
    }`,
  );
  lines.push("");
  lines.push("ARCHIVE ANCHOR");
  lines.push(`  [${archive.severity === null ? "—" : archive.severity.toUpperCase()}] state=${archive.state}, posture=${archive.posture ?? "n/a"}`);
  lines.push(`  ${archive.detail}`);
  if (archive.facts) {
    lines.push(`  pack: records ${archive.facts.recordsUsable}/${archive.facts.recordsSupplied} usable/supplied; blocking=${archive.facts.blocking}, insufficiency=${archive.facts.insufficiencies}, advisory=${archive.facts.advisories}`);
  }
  lines.push("");
  lines.push("RESTORE COVERAGE");
  lines.push(`  archive=${coverage.archive}; restored=${coverage.recordsRestored}, matched=${coverage.recordsMatched}, failed=${coverage.recordsFailed}, not-restored=${coverage.recordsNotRestored} (archived usable=${coverage.archivedUsable})`);
  lines.push(`  policy: archive-only=${policy.archiveOnly}, require-full-restore=${policy.requireFullRestore}, strict-drift=${policy.strictDrift}`);
  lines.push("");
  lines.push("RESTORE CHECKS (per record class)");
  for (const record of result.records) lines.push(recordLine(record));
  lines.push("");
  if (result.reasons.length > 0) {
    lines.push("REASONS");
    for (const r of result.reasons) {
      lines.push(`  [${r.severity.toUpperCase()}] ${r.id}`);
      lines.push(`      ${r.detail}`);
    }
    lines.push("");
  }
  lines.push(`DIGESTS (${digests.algorithm}, ${digests.canonicalization}) — opaque content-free fingerprints`);
  lines.push(`  archive=${digests.archive ?? "n/a"}`);
  lines.push(`  governance=${digests.governance ?? "n/a"}, trend=${digests.trend ?? "n/a"}, report=${digests.report ?? "n/a"}, audit=${digests.audit ?? "n/a"}, bundle=${digests.bundle ?? "n/a"}`);
  lines.push("");
  lines.push("FOLLOW-UP (assignments)");
  for (const f of result.followUps) lines.push(`  - [${f.id}] ${f.detail}`);
  lines.push("");
  lines.push("GUIDANCE (this drill does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");
  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);
  return `${lines.join("\n")}\n`;
}

export function renderReleaseRestoreDrill(
  result: ReleaseRestoreDrillResult,
  format: ReleaseRestoreDrillFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseRestoreDrillJson(result, pretty) : renderReleaseRestoreDrillText(result);
}
