/**
 * Pure, node-free **renderers** for the release decision closeout governance finalize index trend FINALIZATION record
 * result (Phase 79).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult}, both
 * content-free by construction (every field is a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored
 * prose):
 *  - `json`   — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text`   — a governance-review-friendly, CI-summary-ready report: the finalization verdict + reasons, the primary
 *               receipt summary, the source-chain checklist, the coverage, then the reasons, next-action list, guidance,
 *               and honesty caveats;
 *  - `pretty` — an alias the CLI maps to pretty JSON (accepted for explicitness).
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedRecord,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
} from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeJson(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** One source-chain checklist line — a coverage mark + kind + state + signal + verdict. */
function relatedLine(record: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedRecord): string {
  const mark =
    record.state === "usable"
      ? record.signal === "coherent"
        ? "[x]"
        : "[!]"
      : record.state === "absent"
        ? record.required
          ? "[ ]"
          : "[-]"
        : "[!]";
  const tag = record.required ? "required" : "optional";
  return (
    `  ${mark} ${record.kind} (${tag}) — state=${record.state}, signal=${record.signal}, ` +
    `posture=${record.verdict ?? "n/a"}`
  );
}

/** Render the full result as the governance-review-friendly, CI-summary-ready report text. */
function renderFinalizeIndexTrendFinalizeText(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
): string {
  const { finalize, coverage, source, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance finalize index trend FINALIZATION record");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`FINALIZE: ${finalize.verdict.toUpperCase()} (exit ${finalize.exitCode})`);
  lines.push(`  ${finalize.detail}`);
  if (finalize.reasons.length > 0) lines.push(`  reasons: ${finalize.reasons.join(", ")}`);
  lines.push(
    `  counts: ${finalize.invalid} invalid, ${finalize.blocking} blocking, ${finalize.incomplete} incomplete, ` +
      `${finalize.open} open, ${finalize.informational} informational` +
      (finalize.strictOpen ? ` (strict-open${finalize.strictOpenEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("PRIMARY RECEIPT");
  lines.push(
    `  state=${source.state}, verdict=${source.receiptVerdict ?? "n/a"}, ` +
      `class=${source.planClass ?? "n/a"}, receipt-source=${source.receiptSourceState ?? "n/a"}`,
  );
  lines.push(
    `  chain anchors: plan=${source.claimedPlanVerdict ?? "n/a"}, ` +
      `urgency=${source.planUrgency ?? "n/a"}, action=${source.planActionClass ?? "n/a"}, ` +
      `trend=${source.sourceTrendVerdict ?? "n/a"}, latest-index=${source.sourceLatestIndex ?? "n/a"}`,
  );
  lines.push(
    `  acks: ${source.acksSatisfied}/${source.acksRequired} satisfied (${source.acksMissing} missing), ` +
      `receipt-strict-open=${source.receiptStrictOpen}`,
  );
  lines.push("");

  lines.push("SOURCE-CHAIN RECORDS");
  for (const record of result.related) lines.push(relatedLine(record));
  if (finalize.requiredMissing.length > 0) {
    lines.push(`  … missing required records: ${finalize.requiredMissing.join(", ")}`);
  }
  lines.push("");

  lines.push("COVERAGE");
  lines.push(
    `  receipt=${coverage.hasReceipt ? "usable" : coverage.receiptState}; records: ` +
      `${coverage.usableRecords}/${coverage.suppliedRecords} usable/supplied, ` +
      `${coverage.requiredRecords} required, ${coverage.missingRecords} missing, ` +
      `${coverage.tamperedRecords} tampered, ${coverage.unreadableRecords} unreadable, ` +
      `${coverage.coherentRecords} coherent, ${coverage.contradictoryRecords} contradictory`,
  );
  lines.push(
    `  policy: require-plan=${policy.require.plan}, require-trend=${policy.require.trend}, ` +
      `require-index=${policy.require.index}, require-finalization=${policy.require.finalization}, ` +
      `strict-open=${policy.strictOpen}`,
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

  if (result.nextActions.length > 0) {
    lines.push("NEXT ACTIONS");
    for (const a of result.nextActions) lines.push(`  - [${a.id}] ${a.detail}`);
    lines.push("");
  }

  lines.push("GUIDANCE (this record does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeJson(result, pretty)
    : renderFinalizeIndexTrendFinalizeText(result);
}
