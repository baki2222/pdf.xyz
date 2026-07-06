/**
 * Pure, node-free **renderers** for the release decision closeout governance finalize index trend finalize index trend result (Phase 81).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the trend verdict + reasons, the coverage summary + the
 *    per-window index-verdict distribution + the aggregate finalization distribution + per-window posture sequence, the
 *    ordered next-action list, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendJson(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact per-window index-verdict histogram line (bounded counts, never a locator). */
function windowVerdictCountsLine(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult): string {
  const c = result.windowDistribution.verdictCounts;
  return (
    `  by window index: indexed=${c.indexed}, open=${c["index-open"]}, ` +
    `incomplete=${c["index-incomplete"]}, blocked=${c["index-blocked"]}, invalid=${c["index-invalid"]}`
  );
}

/** The compact aggregate finalization-verdict histogram line. */
function finalizationVerdictCountsLine(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult): string {
  const c = result.finalizationDistribution.verdictCounts;
  return (
    `  by finalization: finalized=${c.finalized}, incomplete=${c["finalize-incomplete"]}, ` +
    `open=${c["finalize-open"]}, blocked=${c["finalize-blocked"]}`
  );
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderTrendText(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult): string {
  const { coverage, windowDistribution, policy, trend } = result;
  const strictOpenEscalated = result.reasons.some((r) => r.id === "strict-open-escalation");
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance finalize index trend finalize index trend");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`TREND: ${result.verdict.toUpperCase()} (exit ${result.exitCode})`);
  lines.push(`  ${verdictDetail(result)}`);
  if (result.reasons.length > 0) lines.push(`  reasons: ${result.reasons.map((r) => r.id).join(", ")}`);
  lines.push(
    `  latest=${windowDistribution.newest ?? "n/a"}, direction=${trend.direction}, class=${trend.class}` +
      (policy.strictOpen ? ` (strict-open${strictOpenEscalated ? ", escalated" : ""})` : "") +
      (policy.requireLatestIndexed ? " (require-latest-indexed)" : ""),
  );
  lines.push("");

  lines.push("HISTORY");
  lines.push(
    `  windows: ${coverage.windowsUsable}/${coverage.windowsConsidered} usable/considered ` +
      `(${coverage.windowsSupplied} supplied` +
      (coverage.truncated ? `, ${coverage.droppedOldest} older dropped by --max-windows=${policy.maxWindows}` : "") +
      `); unreadable=${coverage.windowsUnreadable}, tampered=${coverage.windowsTampered}`,
  );
  lines.push(windowVerdictCountsLine(result));
  lines.push(finalizationVerdictCountsLine(result));
  lines.push(
    `  finalizations: ${result.finalizationDistribution.totalUsable}/${result.finalizationDistribution.totalConsidered} usable/considered across usable windows`,
  );
  lines.push(`  newest=${windowDistribution.newest ?? "n/a"}, oldest=${windowDistribution.oldest ?? "n/a"}`);
  lines.push(
    `  policy: max-windows=${policy.maxWindows}, strict-open=${policy.strictOpen}, ` +
      `require-latest-indexed=${policy.requireLatestIndexed}`,
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
          `latest-finalization=${p.latestFinalization ?? "n/a"}, finalizations=${p.finalizationsConsidered}`,
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
function verdictDetail(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult): string {
  // The verdict summary text is authored; the receipt carries the disclosure. Fold the trend class into the headline.
  return `${result.verdict} — direction ${result.trend.direction}, class ${result.trend.class}.`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult,
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendJson(result, pretty)
    : renderTrendText(result);
}
