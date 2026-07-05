/**
 * Pure, node-free **renderers** for the release decision closeout action-plan execution receipt result (Phase 68).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutActionReceiptResult}, both content-free by construction
 * (every field is a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready receipt: the receipt verdict + plan class + reasons, the source plan
 *    summary, the acknowledgement checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere
 * for a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutActionReceiptResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutActionReceiptFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutActionReceiptJson(
  result: ReleaseDecisionCloseoutActionReceiptResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the review-friendly, CI-summary-ready receipt text. */
function renderCloseoutActionReceiptText(result: ReleaseDecisionCloseoutActionReceiptResult): string {
  const { closeoutActionReceipt: receipt, source } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout action-plan execution receipt");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`RECEIPT: ${receipt.verdict.toUpperCase()} (exit ${receipt.exitCode})`);
  lines.push(`  plan class: ${receipt.planClass ?? "n/a"}`);
  lines.push(`  ${receipt.detail}`);
  if (receipt.reasons.length > 0) lines.push(`  reasons: ${receipt.reasons.join(", ")}`);
  lines.push(
    `  counts: ${receipt.blocking} blocking, ${receipt.open} open, ` +
      `${receipt.incomplete} incomplete, ${receipt.informational} informational` +
      (receipt.strictOpen ? ` (strict-open${receipt.strictOpenEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("SOURCE PLAN");
  lines.push(
    `  state=${source.state}, verdict=${source.claimedPlanVerdict ?? "n/a"}, ` +
      `class=${source.planClass ?? "n/a"}, urgency=${source.planUrgency ?? "n/a"}, ` +
      `action=${source.planActionClass ?? "n/a"}`,
  );
  lines.push(
    `  source-trend=${source.sourceTrendVerdict ?? "n/a"}, latest-index=${source.sourceLatestIndex ?? "n/a"}, ` +
      `actions: ${source.blockingActions} blocking / ${source.advisoryActions} advisory, ` +
      `plan-strict-watch=${source.planStrictWatch}`,
  );
  lines.push("");

  lines.push("ACKNOWLEDGEMENTS");
  for (const ack of result.acknowledgements) {
    const mark = ack.required ? (ack.supplied ? "[x]" : "[ ]") : ack.supplied ? "[+]" : "[-]";
    const tag = ack.required ? "required" : "optional";
    lines.push(`  ${mark} ${ack.id} (${tag}${ack.supplied ? ", supplied" : ""})`);
  }
  if (receipt.mismatchedAcks.length > 0) {
    lines.push(`  ! contradictory acknowledgements for this class: ${receipt.mismatchedAcks.join(", ")}`);
  }
  if (receipt.missingAcks.length > 0) {
    lines.push(`  … missing required acknowledgements: ${receipt.missingAcks.join(", ")}`);
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

  lines.push("GUIDANCE (this receipt does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutActionReceipt(
  result: ReleaseDecisionCloseoutActionReceiptResult,
  format: ReleaseDecisionCloseoutActionReceiptFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutActionReceiptJson(result, pretty)
    : renderCloseoutActionReceiptText(result);
}
