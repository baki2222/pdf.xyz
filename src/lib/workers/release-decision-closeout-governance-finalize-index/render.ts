/**
 * Pure, node-free **renderers** for the release decision closeout governance finalize index result (Phase 75).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / review record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the index verdict + reasons, the coverage summary + the
 *    finalization-verdict distribution + per-record posture sequence, the ordered next-action checklist, then the
 *    guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexJson(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact finalization-verdict histogram line (bounded counts, never a locator). */
function verdictCountsLine(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexResult): string {
  const c = result.distribution.verdictCounts;
  return (
    `  by finalization: finalized=${c.finalized}, incomplete=${c["finalize-incomplete"]}, ` +
    `open=${c["finalize-open"]}, blocked=${c["finalize-blocked"]}`
  );
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderIndexText(result: ReleaseDecisionCloseoutGovernanceFinalizeIndexResult): string {
  const { finalizeIndex: index, coverage, distribution, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance finalize index");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`INDEX: ${index.verdict.toUpperCase()} (exit ${index.exitCode})`);
  lines.push(`  ${index.detail}`);
  if (index.reasons.length > 0) lines.push(`  reasons: ${index.reasons.join(", ")}`);
  lines.push(
    `  counts: ${index.invalid} invalid, ${index.blocking} blocking, ${index.open} open, ` +
      `${index.incomplete} incomplete, ${index.informational} informational` +
      (index.strictOpen ? ` (strict-open${index.strictOpenEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("COVERAGE");
  lines.push(
    `  bundles: ${coverage.finalizationsUsable}/${coverage.finalizationsConsidered} usable/considered ` +
      `(${coverage.finalizationsSupplied} supplied` +
      (coverage.truncated
        ? `, ${coverage.droppedOldest} older dropped by --max-finalizations=${policy.maxFinalizations}`
        : "") +
      `); unreadable=${coverage.finalizationsUnreadable}, tampered=${coverage.finalizationsTampered}`,
  );
  lines.push(verdictCountsLine(result));
  lines.push(
    `  latest=${index.latest ?? "n/a"}, oldest=${index.oldest ?? "n/a"}, class=${distribution.trendClass}`,
  );
  lines.push(
    `  policy: max-finalizations=${policy.maxFinalizations}, max-open=${policy.maxOpen}, ` +
      `max-incomplete=${policy.maxIncomplete}, require-latest-finalized=${policy.requireLatestFinalized}, ` +
      `strict-open=${policy.strictOpen}`,
  );
  lines.push("");

  lines.push("SEQUENCE (oldest → newest)");
  if (result.points.length === 0) {
    lines.push("  (no bundles considered)");
  } else {
    for (const p of result.points) {
      const sev = p.severity === null ? "—" : p.severity.toUpperCase();
      lines.push(
        `  #${p.position + 1} [${sev}] state=${p.state}, verdict=${p.verdict ?? "n/a"}, ` +
          `receipt=${p.receiptVerdict ?? "n/a"}, plan-class=${p.planClass ?? "n/a"}`,
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

  lines.push("GUIDANCE (this index does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndex(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexResult,
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceFinalizeIndexJson(result, pretty)
    : renderIndexText(result);
}
