/**
 * Pure, node-free **renderers** for the release decision closeout governance index result (Phase 70).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceIndexResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / review record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the index verdict + reasons, the ledger summary + the
 *    governance-verdict distribution + per-record posture sequence, the ordered next-action checklist, then the guidance
 *    and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceIndexResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceIndexFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceIndexJson(
  result: ReleaseDecisionCloseoutGovernanceIndexResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact governance-verdict histogram line (bounded counts, never a locator). */
function verdictCountsLine(result: ReleaseDecisionCloseoutGovernanceIndexResult): string {
  const c = result.ledger.verdictCounts;
  return (
    `  by governance: closed=${c.closed}, incomplete=${c["governance-incomplete"]}, ` +
    `open=${c["governance-open"]}, blocked=${c["governance-blocked"]}`
  );
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderIndexText(result: ReleaseDecisionCloseoutGovernanceIndexResult): string {
  const { governanceIndex: index, ledger, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance index");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`INDEX: ${index.verdict.toUpperCase()} (exit ${index.exitCode})`);
  lines.push(`  ${index.detail}`);
  if (index.reasons.length > 0) lines.push(`  reasons: ${index.reasons.join(", ")}`);
  lines.push(
    `  counts: ${index.blocking} blocking, ${index.open} open, ` +
      `${index.incomplete} incomplete, ${index.informational} informational` +
      (index.strictOpen ? ` (strict-open${index.strictOpenEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("LEDGER");
  lines.push(
    `  bundles: ${ledger.governanceUsable}/${ledger.governanceConsidered} usable/considered ` +
      `(${ledger.governanceSupplied} supplied` +
      (ledger.truncated
        ? `, ${ledger.droppedOldest} older dropped by --max-governance=${policy.maxGovernance}`
        : "") +
      `); unreadable=${ledger.governanceUnreadable}, tampered=${ledger.governanceTampered}`,
  );
  lines.push(verdictCountsLine(result));
  lines.push(
    `  latest=${index.latest ?? "n/a"}, oldest=${ledger.oldest ?? "n/a"}, class=${ledger.trendClass}`,
  );
  lines.push(
    `  policy: max-governance=${policy.maxGovernance}, max-open=${policy.maxOpen}, ` +
      `max-incomplete=${policy.maxIncomplete}, max-blocked=${policy.maxBlocked}, strict-open=${policy.strictOpen}`,
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
  for (const item of result.checklist) {
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
export function renderReleaseDecisionCloseoutGovernanceIndex(
  result: ReleaseDecisionCloseoutGovernanceIndexResult,
  format: ReleaseDecisionCloseoutGovernanceIndexFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceIndexJson(result, pretty)
    : renderIndexText(result);
}
