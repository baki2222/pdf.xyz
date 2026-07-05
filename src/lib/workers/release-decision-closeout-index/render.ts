/**
 * Pure, node-free **renderers** for the release decision closeout index result (Phase 65).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutIndexResult}, both content-free by construction (every
 * field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / review record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready report: the index verdict + reasons, the ledger summary + the
 *    closeout-verdict distribution + per-record posture sequence, the ordered next-action checklist, then the guidance
 *    and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere
 * for a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutIndexResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutIndexFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutIndexJson(
  result: ReleaseDecisionCloseoutIndexResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The compact closeout-verdict histogram line (bounded counts, never a locator). */
function verdictCountsLine(result: ReleaseDecisionCloseoutIndexResult): string {
  const c = result.ledger.verdictCounts;
  return (
    `  by closeout: closed=${c.closed}, incomplete=${c["closeout-incomplete"]}, ` +
    `open=${c["closeout-open"]}, blocked=${c["closeout-blocked"]}`
  );
}

/** Render the full result as the review-friendly, CI-summary-ready report text. */
function renderIndexText(result: ReleaseDecisionCloseoutIndexResult): string {
  const { closeoutIndex: index, ledger, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout index");
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
    `  closeouts: ${ledger.closeoutsUsable}/${ledger.closeoutsConsidered} usable/considered ` +
      `(${ledger.closeoutsSupplied} supplied` +
      (ledger.truncated
        ? `, ${ledger.droppedOldest} older dropped by --max-closeouts=${policy.maxCloseouts}`
        : "") +
      `); unreadable=${ledger.closeoutsUnreadable}, tampered=${ledger.closeoutsTampered}`,
  );
  lines.push(verdictCountsLine(result));
  lines.push(
    `  latest=${index.latest ?? "n/a"}, oldest=${ledger.oldest ?? "n/a"}, class=${ledger.trendClass}`,
  );
  lines.push(
    `  policy: max-closeouts=${policy.maxCloseouts}, max-open=${policy.maxOpen}, ` +
      `max-incomplete=${policy.maxIncomplete}, max-blocked=${policy.maxBlocked}, strict-open=${policy.strictOpen}`,
  );
  lines.push("");

  lines.push("SEQUENCE (oldest → newest)");
  if (result.points.length === 0) {
    lines.push("  (no closeouts considered)");
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
export function renderReleaseDecisionCloseoutIndex(
  result: ReleaseDecisionCloseoutIndexResult,
  format: ReleaseDecisionCloseoutIndexFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutIndexJson(result, pretty)
    : renderIndexText(result);
}
