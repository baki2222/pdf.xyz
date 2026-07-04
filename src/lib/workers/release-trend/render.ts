/**
 * Pure, node-free **renderers** for the release evidence trend summary result (Phase 53).
 *
 * Two stable formats over the one {@link ReleaseTrendResult}, both content-free by construction (every field is
 * a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a governance-review-friendly, CI-summary-ready report: the trend verdict + reasons, the history
 *    summary + per-report posture sequence, the ordered follow-up checklist, then the guidance and honesty
 *    caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is
 * nowhere for a locator or a byte to enter.
 */

import type { ReleaseTrendResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseTrendFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseTrendJson(result: ReleaseTrendResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact recommendation-count histogram line (bounded counts, never a locator). */
function countsLine(result: ReleaseTrendResult): string {
  const c = result.history.counts;
  return (
    `  by recommendation: promote-ready=${c["promote-ready"]}, hold-warning=${c["hold-warning"]}, ` +
    `needs-evidence=${c["needs-evidence"]}, hold-fail=${c["hold-fail"]}`
  );
}

/** Render the full result as the governance-review-friendly, CI-summary-ready report text. */
function renderTrendText(result: ReleaseTrendResult): string {
  const { trend, history, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence trend summary");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`TREND: ${trend.verdict.toUpperCase()} (exit ${trend.exitCode})`);
  lines.push(`  ${trend.detail}`);
  if (trend.reasons.length > 0) lines.push(`  reasons: ${trend.reasons.join(", ")}`);
  lines.push(
    `  counts: ${trend.blocking} blocking, ${trend.insufficiencies} insufficiency, ` +
      `${trend.advisories} advisory` +
      (trend.requireLatestReady ? ` (require-latest-ready${trend.readyEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("HISTORY");
  lines.push(
    `  reports: ${history.reportsUsable}/${history.reportsConsidered} usable/considered ` +
      `(${history.reportsSupplied} supplied` +
      (history.truncated ? `, ${history.droppedOldest} older dropped by --max-reports=${policy.maxReports}` : "") +
      `); unreadable=${history.reportsUnreadable}, tampered=${history.reportsTampered}`,
  );
  lines.push(countsLine(result));
  lines.push(
    `  newest=${history.newest ?? "n/a"}, oldest=${history.oldest ?? "n/a"}, direction=${history.direction}`,
  );
  lines.push(
    `  policy: max-reports=${policy.maxReports}, max-hold-warning=${policy.maxHoldWarning}, ` +
      `max-hold-fail=${policy.maxHoldFail}, require-latest-ready=${policy.requireLatestReady}`,
  );
  lines.push("");

  lines.push("SEQUENCE (oldest → newest)");
  if (result.points.length === 0) {
    lines.push("  (no reports considered)");
  } else {
    for (const p of result.points) {
      const sev = p.severity === null ? "—" : p.severity.toUpperCase();
      lines.push(`  #${p.position + 1} [${sev}] state=${p.state}, recommendation=${p.recommendation ?? "n/a"}`);
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

  lines.push("FOLLOW-UP");
  for (const f of result.followUps) {
    lines.push(`  - [${f.id}] ${f.detail}`);
  }
  lines.push("");

  lines.push("GUIDANCE (this summary does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseTrend(
  result: ReleaseTrendResult,
  format: ReleaseTrendFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseTrendJson(result, pretty) : renderTrendText(result);
}
