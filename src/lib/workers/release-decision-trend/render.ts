/**
 * Pure, node-free **renderers** for the release decision index trend summary result (Phase 61).
 *
 * Two stable formats over the one {@link ReleaseDecisionTrendResult}, both content-free by construction (every field
 * is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the trend verdict + reasons, the history summary + the
 *    per-window verdict distribution + the aggregate decision distribution + per-window posture sequence, the ordered
 *    next-action checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere
 * for a locator or a byte to enter.
 */

import type { ReleaseDecisionTrendResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionTrendFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionTrendJson(
  result: ReleaseDecisionTrendResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact per-window index-verdict histogram line (bounded counts, never a locator). */
function verdictCountsLine(result: ReleaseDecisionTrendResult): string {
  const c = result.summary.windowVerdictCounts;
  return (
    `  by window verdict: stable=${c.stable}, watch=${c.watch}, insufficient=${c.insufficient}, ` +
    `blocked=${c.blocked}, invalid=${c.invalid}`
  );
}

/** The compact aggregate decision histogram line. */
function decisionCountsLine(result: ReleaseDecisionTrendResult): string {
  const c = result.summary.decisionCounts;
  return (
    `  by decision: proceed=${c.proceed}, proceed-with-followup=${c["proceed-with-followup"]}, ` +
    `hold=${c.hold}, reject=${c.reject}, insufficient=${c.insufficient}, invalid=${c.invalid}`
  );
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderTrendText(result: ReleaseDecisionTrendResult): string {
  const { trend, summary, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision index trend summary");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`TREND: ${trend.verdict.toUpperCase()} (exit ${trend.exitCode})`);
  lines.push(`  ${trend.detail}`);
  if (trend.reasons.length > 0) lines.push(`  reasons: ${trend.reasons.join(", ")}`);
  lines.push(
    `  counts: ${trend.invalidInputs} invalid-input, ${trend.blocking} blocking, ` +
      `${trend.insufficiencies} insufficiency, ${trend.advisories} advisory` +
      (trend.strict ? ` (strict${trend.strictEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("HISTORY");
  lines.push(
    `  windows: ${summary.windowsUsable}/${summary.windowsConsidered} usable/considered ` +
      `(${summary.windowsSupplied} supplied` +
      (summary.truncated ? `, ${summary.droppedOldest} older dropped by --max-windows=${policy.maxWindows}` : "") +
      `); unreadable=${summary.windowsUnreadable}, tampered=${summary.windowsTampered}`,
  );
  lines.push(verdictCountsLine(result));
  lines.push(decisionCountsLine(result));
  lines.push(
    `  records: ${summary.totalUsableRecords}/${summary.totalRecords} usable/considered across usable windows`,
  );
  lines.push(
    `  newest=${summary.newest ?? "n/a"}, oldest=${summary.oldest ?? "n/a"}, ` +
      `direction=${summary.direction}, class=${summary.trendClass}`,
  );
  lines.push(`  policy: max-windows=${policy.maxWindows}, strict=${policy.strict}`);
  lines.push("");

  lines.push("SEQUENCE (oldest → newest)");
  if (result.points.length === 0) {
    lines.push("  (no windows considered)");
  } else {
    for (const p of result.points) {
      const sev = p.severity === null ? "—" : p.severity.toUpperCase();
      lines.push(
        `  #${p.position + 1} [${sev}] state=${p.state}, verdict=${p.verdict ?? "n/a"}, ` +
          `records=${p.recordsConsidered}`,
      );
    }
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

  lines.push("NEXT ACTIONS");
  for (const item of result.checklist) {
    lines.push(`  - [${item.id}] ${item.detail}`);
  }
  lines.push("");

  lines.push("GUIDANCE (this trend does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionTrend(
  result: ReleaseDecisionTrendResult,
  format: ReleaseDecisionTrendFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseDecisionTrendJson(result, pretty) : renderTrendText(result);
}
