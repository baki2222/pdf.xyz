/**
 * Pure, node-free **renderers** for the release decision closeout bundle result (Phase 64).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutResult}, both content-free by construction (every field is
 * a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready closeout: the closeout verdict + plan class + reasons, the primary
 *    receipt summary, the related-record checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for a
 * locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutJson(
  result: ReleaseDecisionCloseoutResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the review-friendly, CI-summary-ready closeout text. */
function renderCloseoutText(result: ReleaseDecisionCloseoutResult): string {
  const { closeout, source } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout bundle");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`CLOSEOUT: ${closeout.verdict.toUpperCase()} (exit ${closeout.exitCode})`);
  lines.push(`  plan class: ${closeout.planClass ?? "n/a"}`);
  lines.push(`  ${closeout.detail}`);
  if (closeout.reasons.length > 0) lines.push(`  reasons: ${closeout.reasons.join(", ")}`);
  lines.push(
    `  counts: ${closeout.blocking} blocking, ${closeout.open} open, ` +
      `${closeout.incomplete} incomplete, ${closeout.informational} informational` +
      (closeout.strictOpen ? ` (strict-open${closeout.strictOpenEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("PRIMARY RECEIPT");
  lines.push(
    `  state=${source.state}, verdict=${source.receiptVerdict ?? "n/a"}, ` +
      `plan-class=${source.planClass ?? "n/a"}, plan-verdict=${source.claimedPlanVerdict ?? "n/a"}`,
  );
  lines.push(
    `  source-trend=${source.sourceTrendVerdict ?? "n/a"}, urgency=${source.planUrgency ?? "n/a"}, ` +
      `action=${source.planActionClass ?? "n/a"}, benign-monitor=${source.benignMonitor}`,
  );
  lines.push(
    `  acks: ${source.acksSatisfied}/${source.acksRequired} satisfied (${source.acksMissing} missing), ` +
      `receipt-strict-open=${source.receiptStrictOpen}`,
  );
  lines.push("");

  lines.push("RELATED RECORDS");
  for (const rec of result.related) {
    const mark =
      rec.state === "usable"
        ? rec.signal === "coherent"
          ? "[x]"
          : rec.signal === "contradictory" || rec.signal === "blocking"
            ? "[!]"
            : rec.signal === "advisory" || rec.signal === "insufficient"
              ? "[~]"
              : "[x]"
        : rec.state === "absent"
          ? rec.required
            ? "[ ]"
            : "[-]"
          : "[!]";
    const tag = rec.required ? "required" : "optional";
    const verdict = rec.verdict ? `, ${rec.verdict}` : "";
    lines.push(`  ${mark} ${rec.kind} (${tag}): ${rec.state}, signal=${rec.signal}${verdict}`);
  }
  lines.push(
    `  summary: ${closeout.relatedSupplied} supplied, ${closeout.relatedCoherent} coherent, ` +
      `${closeout.relatedContradictory} contradictory, ${closeout.relatedBlocking} blocking`,
  );
  if (closeout.requiredMissing.length > 0) {
    lines.push(`  … missing required records: ${closeout.requiredMissing.join(", ")}`);
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

  lines.push("GUIDANCE (this closeout does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseout(
  result: ReleaseDecisionCloseoutResult,
  format: ReleaseDecisionCloseoutFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutJson(result, pretty)
    : renderCloseoutText(result);
}
