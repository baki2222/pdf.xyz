/**
 * Pure, node-free **renderers** for the release evidence governance bundle result (Phase 54).
 *
 * Two stable formats over the one {@link ReleaseGovernanceResult}, both content-free by construction (every
 * field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a governance-review-friendly, CI-summary-ready report: the governance verdict + reasons, the
 *    evidence coverage + per-source summaries, the archive checklist, the ordered follow-up assignment list,
 *    then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is
 * nowhere for a locator or a byte to enter.
 */

import type { ReleaseGovernanceResult, ReleaseGovernanceSource } from "./types";

/** The output formats the CLI supports. */
export type ReleaseGovernanceFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseGovernanceJson(result: ReleaseGovernanceResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The bounded per-source facts lines (all enums / small ints / booleans — never a locator). */
function sourceFactsLines(source: ReleaseGovernanceSource): string[] {
  if (source.id === "trend") {
    const f = source.facts;
    if (f === null) return [];
    return [
      `      window: verdict=${f.verdict}, stable=${f.stable}, reports=${f.reportsUsable}/${f.reportsConsidered} usable, ` +
        `newest=${f.newest ?? "n/a"}, oldest=${f.oldest ?? "n/a"}, direction=${f.direction}`,
      `      trend-reasons: ${f.blocking} blocking, ${f.insufficiencies} insufficiency, ${f.advisories} advisory`,
    ];
  }
  if (source.id === "report") {
    const f = source.facts;
    if (f === null) return [];
    return [
      `      report: recommendation=${f.recommendation}, ready=${f.ready}, ` +
        `bundle=${f.hasBundle}, audit=${f.hasAudit}, strict=${f.strict}`,
      `      report-reasons: ${f.blocking} blocking, ${f.insufficiencies} insufficiency, ${f.advisories} advisory`,
    ];
  }
  const f = source.facts;
  if (f === null) return [];
  const delta =
    f.postureRankDelta === null ? "n/a" : f.postureRankDelta > 0 ? `+${f.postureRankDelta}` : `${f.postureRankDelta}`;
  const lines = [
    `      audit: verdict=${f.verdict}, mode=${f.mode}, comparable=${f.comparable}, ` +
      `blocking=${f.blockingRegressions}, warning=${f.warningRegressions}, posture-delta=${delta}`,
    `      baseline=${f.baselineVerdict ?? "n/a"} → current=${f.currentVerdict ?? "n/a"}`,
  ];
  if (f.drivers.length > 0) lines.push(`      regressions: ${f.drivers.join(", ")}`);
  return lines;
}

/** One per-source block: the id + state + verdict + severity, then its bounded facts. */
function sourceLines(source: ReleaseGovernanceSource): string[] {
  const sev = source.severity === null ? "—" : source.severity.toUpperCase();
  const head = `  [${sev}] ${source.id} — state=${source.state}, posture=${source.verdict ?? "n/a"}`;
  return [head, ...sourceFactsLines(source)];
}

/** Render the full result as the governance-review-friendly, CI-summary-ready report text. */
function renderGovernanceText(result: ReleaseGovernanceResult): string {
  const { governance, coverage, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence governance bundle");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`GOVERNANCE: ${governance.verdict.toUpperCase()} (exit ${governance.exitCode})`);
  lines.push(`  ${governance.detail}`);
  if (governance.reasons.length > 0) lines.push(`  reasons: ${governance.reasons.join(", ")}`);
  lines.push(
    `  counts: ${governance.blocking} blocking, ${governance.insufficiencies} insufficiency, ` +
      `${governance.advisories} advisory` +
      (governance.strictWatch
        ? ` (strict-watch${governance.strictWatchEscalated ? ", escalated" : ""})`
        : ""),
  );
  lines.push("");

  lines.push("EVIDENCE COVERAGE");
  lines.push(
    `  sources: ${coverage.sourcesUsable}/${coverage.sourcesSupplied} usable/supplied; ` +
      `trend=${coverage.trend}, report=${coverage.report}, audit=${coverage.audit}`,
  );
  lines.push(
    `  policy: require-report=${policy.requireReport}, require-audit=${policy.requireAudit}, ` +
      `strict-watch=${policy.strictWatch}`,
  );
  lines.push("");

  lines.push("SOURCES");
  for (const source of result.sources) {
    for (const line of sourceLines(source)) lines.push(line);
  }
  lines.push("");

  if (result.reasons.length > 0) {
    lines.push("REASONS");
    for (const r of result.reasons) {
      lines.push(`  [${r.severity.toUpperCase()}] ${r.id}`);
      lines.push(`      ${r.detail}`);
    }
    lines.push("");
  }

  lines.push("ARCHIVE (content-free files to keep as the governance record)");
  lines.push(`  items: ${result.archive.items.length > 0 ? result.archive.items.join(", ") : "(none)"}`);
  lines.push(`  ${result.archive.note}`);
  lines.push("");

  lines.push("FOLLOW-UP (assignments)");
  for (const f of result.followUps) {
    lines.push(`  - [${f.id}] ${f.detail}`);
  }
  lines.push("");

  lines.push("GUIDANCE (this bundle does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseGovernance(
  result: ReleaseGovernanceResult,
  format: ReleaseGovernanceFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseGovernanceJson(result, pretty) : renderGovernanceText(result);
}
