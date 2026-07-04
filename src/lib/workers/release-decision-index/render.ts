/**
 * Pure, node-free **renderers** for the release decision ledger index result (Phase 60).
 *
 * Two stable formats over the one {@link ReleaseDecisionIndexResult}, both content-free by construction (every field
 * is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / review record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the index verdict + reasons, the ledger summary + the
 *    decision distribution + per-record posture sequence, the ordered next-action checklist, then the guidance and
 *    honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is
 * nowhere for a locator or a byte to enter.
 */

import type { ReleaseDecisionIndexResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionIndexFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionIndexJson(
  result: ReleaseDecisionIndexResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact decision-count histogram line (bounded counts, never a locator). */
function decisionCountsLine(result: ReleaseDecisionIndexResult): string {
  const c = result.ledger.decisionCounts;
  return (
    `  by decision: proceed=${c.proceed}, proceed-with-followup=${c["proceed-with-followup"]}, ` +
    `hold=${c.hold}, reject=${c.reject}, insufficient=${c.insufficient}, invalid=${c.invalid}`
  );
}

/** The compact cross-check (source-posture) histogram line. */
function crossCheckLine(result: ReleaseDecisionIndexResult): string {
  const c = result.ledger.crossCheckCounts;
  return `  by cross-check: match=${c.match}, mismatch=${c.mismatch}, unknown=${c.unknown}`;
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderIndexText(result: ReleaseDecisionIndexResult): string {
  const { index, ledger, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision ledger index");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`INDEX: ${index.verdict.toUpperCase()} (exit ${index.exitCode})`);
  lines.push(`  ${index.detail}`);
  if (index.reasons.length > 0) lines.push(`  reasons: ${index.reasons.join(", ")}`);
  lines.push(
    `  counts: ${index.invalidInputs} invalid-input, ${index.blocking} blocking, ` +
      `${index.insufficiencies} insufficiency, ${index.advisories} advisory` +
      (index.strict ? ` (strict${index.strictEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("LEDGER");
  lines.push(
    `  records: ${ledger.recordsUsable}/${ledger.recordsConsidered} usable/considered ` +
      `(${ledger.recordsSupplied} supplied` +
      (ledger.truncated ? `, ${ledger.droppedOldest} older dropped by --max-records=${policy.maxRecords}` : "") +
      `); unreadable=${ledger.recordsUnreadable}, tampered=${ledger.recordsTampered}`,
  );
  lines.push(decisionCountsLine(result));
  lines.push(crossCheckLine(result));
  lines.push(
    `  newest=${ledger.newest ?? "n/a"}, oldest=${ledger.oldest ?? "n/a"}, class=${ledger.trendClass}`,
  );
  lines.push(`  policy: max-records=${policy.maxRecords}, strict=${policy.strict}`);
  lines.push("");

  lines.push("SEQUENCE (oldest → newest)");
  if (result.points.length === 0) {
    lines.push("  (no records considered)");
  } else {
    for (const p of result.points) {
      const sev = p.severity === null ? "—" : p.severity.toUpperCase();
      lines.push(
        `  #${p.position + 1} [${sev}] state=${p.state}, decision=${p.decision ?? "n/a"}, ` +
          `cross-check=${p.crossCheck ?? "n/a"}`,
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
export function renderReleaseDecisionIndex(
  result: ReleaseDecisionIndexResult,
  format: ReleaseDecisionIndexFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseDecisionIndexJson(result, pretty) : renderIndexText(result);
}
