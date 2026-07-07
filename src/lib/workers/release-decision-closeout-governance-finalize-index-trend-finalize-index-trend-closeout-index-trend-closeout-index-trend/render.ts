/**
 * Pure, node-free **renderers** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend result (Phase 86).
 *
 * Two stable formats over the one
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the trend verdict + reasons, the coverage summary + the per-window
 *    index-verdict distribution + the aggregate closeout distribution + per-window posture sequence, the ordered next-action
 *    list, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for a
 * locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendJson(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact per-window index-verdict histogram line (bounded counts, never a locator). */
function windowVerdictCountsLine(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
): string {
  const c = result.windowDistribution.verdictCounts;
  return (
    `  by window index: all-closed=${c["all-closed"]}, open=${c["open"]}, ` +
    `incomplete=${c["incomplete"]}, blocked=${c["blocked"]}, invalid=${c["invalid"]}`
  );
}

/** The compact aggregate closeout-verdict histogram line. */
function closeoutVerdictCountsLine(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
): string {
  const c = result.closeoutDistribution.verdictCounts;
  return (
    `  by closeout: closed=${c.closed}, open=${c.open}, incomplete=${c.incomplete}, ` +
    `blocked=${c.blocked}, invalid=${c.invalid}`
  );
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderTrendText(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult): string {
  const { coverage, windowDistribution, policy, trend } = result;
  const strictOpenEscalated = result.reasons.some((r) => r.id === "strict-open-escalation");
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`TREND: ${result.verdict.toUpperCase()} (exit ${result.exitCode})`);
  lines.push(`  ${verdictDetail(result)}`);
  if (result.reasons.length > 0) lines.push(`  reasons: ${result.reasons.map((r) => r.id).join(", ")}`);
  lines.push(
    `  latest=${windowDistribution.newest ?? "n/a"}, direction=${trend.direction}, class=${trend.class}` +
      (policy.strictOpen ? ` (strict-open${strictOpenEscalated ? ", escalated" : ""})` : "") +
      (policy.requireLatestAllClosed ? " (require-latest-all-closed)" : ""),
  );
  lines.push("");

  lines.push("HISTORY");
  lines.push(
    `  windows: ${coverage.indexesUsable}/${coverage.indexesConsidered} usable/considered ` +
      `(${coverage.indexesSupplied} supplied` +
      (coverage.truncated ? `, ${coverage.droppedOldest} older dropped by --max-indexes=${policy.maxIndexes}` : "") +
      `); unreadable=${coverage.indexesUnreadable}, tampered=${coverage.indexesTampered}`,
  );
  lines.push(windowVerdictCountsLine(result));
  lines.push(closeoutVerdictCountsLine(result));
  lines.push(
    `  closeouts: ${result.closeoutDistribution.totalUsable}/${result.closeoutDistribution.totalConsidered} usable/considered across usable windows`,
  );
  lines.push(`  newest=${windowDistribution.newest ?? "n/a"}, oldest=${windowDistribution.oldest ?? "n/a"}`);
  lines.push(
    `  policy: max-indexes=${policy.maxIndexes}, max-open=${policy.maxOpen}, max-incomplete=${policy.maxIncomplete}, ` +
      `max-blocked=${policy.maxBlocked}, strict-open=${policy.strictOpen}, require-latest-all-closed=${policy.requireLatestAllClosed}`,
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
          `latest-closeout=${p.latestCloseout ?? "n/a"}, closeouts=${p.closeoutsConsidered}`,
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
  for (const item of result.nextActions) {
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

/** The verdict headline — the `receipt.disclosure` is separate; this is the verdict's own one-liner. */
function verdictDetail(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult): string {
  // The verdict summary text is authored; the receipt carries the disclosure. Fold the trend class into the headline.
  return `${result.verdict} — direction ${result.trend.direction}, class ${result.trend.class}.`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendJson(result, pretty)
    : renderTrendText(result);
}
