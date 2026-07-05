/**
 * Pure, node-free **renderers** for the release decision closeout governance index trend result (Phase 71).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceIndexTrendResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the trend verdict + reasons, the history summary + the
 *    per-window index-verdict distribution + the aggregate governance distribution + per-window posture sequence, the
 *    ordered next-action checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere
 * for a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceIndexTrendResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceIndexTrendFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceIndexTrendJson(
  result: ReleaseDecisionCloseoutGovernanceIndexTrendResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact per-window index-verdict histogram line (bounded counts, never a locator). */
function indexVerdictCountsLine(result: ReleaseDecisionCloseoutGovernanceIndexTrendResult): string {
  const c = result.summary.indexVerdictCounts;
  return (
    `  by window index: indexed=${c.indexed}, incomplete=${c["index-incomplete"]}, ` +
    `open=${c["index-open"]}, blocked=${c["index-blocked"]}`
  );
}

/** The compact aggregate governance-verdict histogram line. */
function governanceVerdictCountsLine(result: ReleaseDecisionCloseoutGovernanceIndexTrendResult): string {
  const c = result.summary.governanceVerdictCounts;
  return (
    `  by governance: closed=${c.closed}, incomplete=${c["governance-incomplete"]}, ` +
    `open=${c["governance-open"]}, blocked=${c["governance-blocked"]}`
  );
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderTrendText(result: ReleaseDecisionCloseoutGovernanceIndexTrendResult): string {
  const { governanceIndexTrend: trend, summary, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance index trend");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`TREND: ${trend.verdict.toUpperCase()} (exit ${trend.exitCode})`);
  lines.push(`  ${trend.detail}`);
  if (trend.reasons.length > 0) lines.push(`  reasons: ${trend.reasons.join(", ")}`);
  lines.push(
    `  counts: ${trend.blocking} blocking, ${trend.watch} watch, ` +
      `${trend.incomplete} incomplete, ${trend.informational} informational` +
      (trend.strictWatch ? ` (strict-watch${trend.strictWatchEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("HISTORY");
  lines.push(
    `  windows: ${summary.indexesUsable}/${summary.indexesConsidered} usable/considered ` +
      `(${summary.indexesSupplied} supplied` +
      (summary.truncated
        ? `, ${summary.droppedOldest} older dropped by --max-indexes=${policy.maxIndexes}`
        : "") +
      `); unreadable=${summary.indexesUnreadable}, tampered=${summary.indexesTampered}`,
  );
  lines.push(indexVerdictCountsLine(result));
  lines.push(governanceVerdictCountsLine(result));
  lines.push(
    `  governance: ${summary.totalUsableGovernance}/${summary.totalGovernance} usable/considered across usable windows`,
  );
  lines.push(
    `  newest=${summary.newest ?? "n/a"}, oldest=${summary.oldest ?? "n/a"}, ` +
      `direction=${summary.direction}, class=${summary.trendClass}`,
  );
  lines.push(
    `  policy: max-indexes=${policy.maxIndexes}, max-open=${policy.maxOpen}, ` +
      `max-incomplete=${policy.maxIncomplete}, max-blocked=${policy.maxBlocked}, strict-watch=${policy.strictWatch}`,
  );
  lines.push("");

  lines.push("SEQUENCE (oldest → newest)");
  if (result.points.length === 0) {
    lines.push("  (no windows considered)");
  } else {
    for (const p of result.points) {
      const sev = p.severity === null ? "—" : p.severity.toUpperCase();
      lines.push(
        `  #${p.position + 1} [${sev}] state=${p.state}, verdict=${p.verdict ?? "n/a"}, ` +
          `latest-governance=${p.latestGovernance ?? "n/a"}, governance=${p.governanceConsidered}`,
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
export function renderReleaseDecisionCloseoutGovernanceIndexTrend(
  result: ReleaseDecisionCloseoutGovernanceIndexTrendResult,
  format: ReleaseDecisionCloseoutGovernanceIndexTrendFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceIndexTrendJson(result, pretty)
    : renderTrendText(result);
}
