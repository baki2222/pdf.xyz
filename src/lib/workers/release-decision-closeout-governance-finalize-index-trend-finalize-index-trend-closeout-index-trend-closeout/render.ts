/**
 * Pure, node-free **renderers** for the release decision closeout governance finalize index trend finalize index trend
 * closeout bundle result (Phase 84).
 *
 * Two stable formats over the one
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready closeout: the closeout verdict + reasons, the primary receipt summary,
 *    the related-record checklist, the source-chain posture, then the next actions and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for a
 * locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutJson(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the review-friendly, CI-summary-ready closeout text. */
function renderCloseoutText(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult,
): string {
  const { coverage, primaryReceipt, sourceChain } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance finalize-index-trend finalize-index-trend closeout-index-trend closeout bundle");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`CLOSEOUT: ${coverage.verdict.toUpperCase()} (exit ${coverage.exitCode})`);
  lines.push(`  plan class: ${coverage.planClass ?? "n/a"}`);
  lines.push(`  ${coverage.detail}`);
  if (coverage.reasons.length > 0) lines.push(`  reasons: ${coverage.reasons.join(", ")}`);
  lines.push(
    `  counts: ${coverage.invalid} invalid, ${coverage.blocking} blocking, ${coverage.open} open, ` +
      `${coverage.incomplete} incomplete, ${coverage.informational} informational` +
      (coverage.strictOpen ? ` (strict-open${coverage.strictOpenEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("PRIMARY RECEIPT");
  lines.push(
    `  state=${primaryReceipt.state}, verdict=${primaryReceipt.receiptVerdict ?? "n/a"}, ` +
      `plan-class=${primaryReceipt.planClass ?? "n/a"}, plan-verdict=${primaryReceipt.claimedPlanVerdict ?? "n/a"}`,
  );
  lines.push(
    `  source-trend=${primaryReceipt.sourceTrendVerdict ?? "n/a"}, latest-index=${primaryReceipt.sourceLatestIndex ?? "n/a"}, ` +
      `urgency=${primaryReceipt.planUrgency ?? "n/a"}, action=${primaryReceipt.planActionClass ?? "n/a"}`,
  );
  lines.push(
    `  acks: ${primaryReceipt.acksSatisfied}/${primaryReceipt.acksRequired} satisfied (${primaryReceipt.acksMissing} missing), ` +
      `receipt-strict-open=${primaryReceipt.receiptStrictOpen}`,
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
    `  summary: ${coverage.relatedSupplied} supplied, ${coverage.relatedCoherent} coherent, ` +
      `${coverage.relatedContradictory} contradictory, ${coverage.relatedBlocking} blocking`,
  );
  if (coverage.requiredMissing.length > 0) {
    lines.push(`  … missing required records: ${coverage.requiredMissing.join(", ")}`);
  }
  lines.push("");

  lines.push("SOURCE CHAIN");
  lines.push(
    `  receipt-trend=${sourceChain.receiptTrendVerdict ?? "n/a"}, receipt-latest-index=${sourceChain.receiptLatestIndex ?? "n/a"}`,
  );
  lines.push(
    `  supplied-index: state=${sourceChain.indexState}, verdict=${sourceChain.indexVerdict ?? "n/a"}, posture=${sourceChain.posture}`,
  );
  lines.push("");

  if (result.reasons.length > 0) {
    lines.push("REASONS");
    for (const r of result.reasons) {
      lines.push(`  [${r.severity.toUpperCase()}] ${r.id}`);
      lines.push(`      ${r.detail}`);
    }
    lines.push("");
  }

  lines.push("NEXT ACTIONS (this closeout does NOT perform these — do them separately)");
  for (const item of result.nextActions) lines.push(`  - [${item.id}] ${item.detail}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseout(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult,
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutJson(result, pretty)
    : renderCloseoutText(result);
}
