/**
 * Pure, node-free **renderers** for the release evidence operator report result (Phase 52).
 *
 * Two stable formats over the one {@link ReleaseReportResult}, both content-free by construction (every field
 * is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / release record / SIEM (pretty by default);
 *  - `text` — an operator-friendly, CI-summary-ready report: the recommendation + rationale, the evidence
 *    coverage + per-source summaries, the archive checklist, the ordered next-action checklist, then the
 *    guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is
 * nowhere for a locator or a byte to enter.
 */

import type { ReleaseReportResult, ReleaseReportSource } from "./types";

/** The output formats the CLI supports. */
export type ReleaseReportFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseReportJson(result: ReleaseReportResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The bounded per-source facts lines (all enums / small ints / booleans — never a locator). */
function sourceFactsLines(source: ReleaseReportSource): string[] {
  if (source.id === "bundle") {
    const f = source.facts;
    if (f === null) return [];
    return [
      `      coherence: verdict=${f.verdict}, stages=${f.stagesPresent}, chain-complete=${f.chainComplete}, ` +
        `decision=${f.decisionStage ?? "none"}, inconsistencies=${f.inconsistencies}, ` +
        `archive=${f.archiveVerdict ?? "n/a"}, warnings=${f.warningSignals}`,
    ];
  }
  const f = source.facts;
  if (f === null) return [];
  const delta = f.postureRankDelta === null ? "n/a" : f.postureRankDelta > 0 ? `+${f.postureRankDelta}` : `${f.postureRankDelta}`;
  const lines = [
    `      regression: verdict=${f.verdict}, mode=${f.mode}, comparable=${f.comparable}, ` +
      `blocking=${f.blockingRegressions}, warning=${f.warningRegressions}, posture-delta=${delta}`,
    `      baseline=${f.baselineVerdict ?? "n/a"} → current=${f.currentVerdict ?? "n/a"}`,
  ];
  if (f.drivers.length > 0) lines.push(`      regressions: ${f.drivers.join(", ")}`);
  return lines;
}

/** One per-source block: the id + state + verdict + severity, then its bounded facts. */
function sourceLines(source: ReleaseReportSource): string[] {
  const sev = source.severity === null ? "—" : source.severity.toUpperCase();
  const head = `  [${sev}] ${source.id} — state=${source.state}, verdict=${source.verdict ?? "n/a"}`;
  return [head, ...sourceFactsLines(source)];
}

/** Render the full result as the operator-friendly, CI-summary-ready report text. */
function renderReportText(result: ReleaseReportResult): string {
  const { recommendation, coverage } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence operator report");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`RECOMMENDATION: ${recommendation.recommendation.toUpperCase()} (exit ${recommendation.exitCode})`);
  lines.push(`  ${recommendation.detail}`);
  if (recommendation.rationale.length > 0) lines.push(`  rationale: ${recommendation.rationale.join(", ")}`);
  lines.push(
    `  reasons: ${recommendation.blocking} blocking, ${recommendation.insufficiencies} insufficiency, ` +
      `${recommendation.advisories} advisory` +
      (recommendation.strict ? ` (strict${recommendation.strictEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("EVIDENCE COVERAGE");
  lines.push(
    `  sources: ${coverage.sourcesUsable}/${coverage.sourcesSupplied} usable/supplied; ` +
      `bundle=${coverage.bundle}, audit=${coverage.audit}`,
  );
  lines.push("");

  lines.push("SOURCES");
  for (const source of result.sources) {
    for (const line of sourceLines(source)) lines.push(line);
  }
  lines.push("");

  if (result.rationale.length > 0) {
    lines.push("RATIONALE");
    for (const r of result.rationale) {
      lines.push(`  [${r.severity.toUpperCase()}] ${r.id}`);
      lines.push(`      ${r.detail}`);
    }
    lines.push("");
  }

  lines.push("ARCHIVE (content-free files to keep as the release record)");
  lines.push(`  items: ${result.archive.items.length > 0 ? result.archive.items.join(", ") : "(none)"}`);
  lines.push(`  ${result.archive.note}`);
  lines.push("");

  lines.push("NEXT ACTIONS");
  for (const a of result.nextActions) {
    lines.push(`  - [${a.id}] ${a.detail}`);
  }
  lines.push("");

  lines.push("GUIDANCE (this report does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseReport(
  result: ReleaseReportResult,
  format: ReleaseReportFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseReportJson(result, pretty) : renderReportText(result);
}
