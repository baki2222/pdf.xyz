/**
 * Pure, node-free **renderers** for the release decision closeout governance finalization bundle result (Phase 74).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceFinalizeResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a governance-review-friendly, CI-summary-ready report: the finalization verdict + reasons, the primary
 *    receipt summary, the related-record checklist, the coverage, then the reasons, archive checklist, follow-up
 *    assignment list, guidance, and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type {
  ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord,
  ReleaseDecisionCloseoutGovernanceFinalizeResult,
} from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFinalizeFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceFinalizeJson(
  result: ReleaseDecisionCloseoutGovernanceFinalizeResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** One related-record checklist line — a coverage mark + kind + state + signal + verdict. */
function relatedLine(record: ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord): string {
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
function renderGovernanceFinalizeText(result: ReleaseDecisionCloseoutGovernanceFinalizeResult): string {
  const { governanceFinalize, coverage, source, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance finalization bundle");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`FINALIZE: ${governanceFinalize.verdict.toUpperCase()} (exit ${governanceFinalize.exitCode})`);
  lines.push(`  ${governanceFinalize.detail}`);
  if (governanceFinalize.reasons.length > 0) lines.push(`  reasons: ${governanceFinalize.reasons.join(", ")}`);
  lines.push(
    `  counts: ${governanceFinalize.blocking} blocking, ${governanceFinalize.open} open, ` +
      `${governanceFinalize.incomplete} incomplete, ${governanceFinalize.informational} informational` +
      (governanceFinalize.strictOpen ? ` (strict-open${governanceFinalize.strictOpenEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("PRIMARY RECEIPT");
  lines.push(
    `  state=${source.state}, verdict=${source.receiptVerdict ?? "n/a"}, ` +
      `class=${source.planClass ?? "n/a"}, receipt-source=${source.receiptSourceState ?? "n/a"}`,
  );
  lines.push(
    `  chain anchors: plan=${source.claimedPlanVerdict ?? "n/a"}, ` +
      `trend=${source.sourceTrendVerdict ?? "n/a"}, latest-index=${source.sourceLatestIndex ?? "n/a"}`,
  );
  lines.push(
    `  acks: ${source.acksSatisfied}/${source.acksRequired} satisfied (${source.acksMissing} missing), ` +
      `receipt-strict-open=${source.receiptStrictOpen}`,
  );
  lines.push("");

  lines.push("RELATED RECORDS");
  for (const record of result.related) lines.push(relatedLine(record));
  if (governanceFinalize.requiredMissing.length > 0) {
    lines.push(`  … missing required records: ${governanceFinalize.requiredMissing.join(", ")}`);
  }
  lines.push("");

  lines.push("COVERAGE");
  lines.push(
    `  receipt=${coverage.hasReceipt ? "usable" : "not-usable"}; related: ` +
      `${coverage.relatedUsable}/${coverage.relatedSupplied} usable/supplied, ` +
      `${coverage.relatedCoherent} coherent, ${coverage.relatedContradictory} contradictory, ` +
      `${coverage.relatedBlocking} blocking`,
  );
  lines.push(
    `  policy: require-plan=${policy.require.plan}, require-trend=${policy.require.trend}, ` +
      `require-index=${policy.require.index}, require-governance=${policy.require.governance}, ` +
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

  lines.push("ARCHIVE (content-free records to keep as the FINAL governance record)");
  lines.push(`  items: ${result.archive.items.length > 0 ? result.archive.items.join(", ") : "(none)"}`);
  lines.push(`  ${result.archive.note}`);
  lines.push("");

  lines.push("FOLLOW-UP (assignments)");
  for (const f of result.followUps) lines.push(`  - [${f.id}] ${f.detail}`);
  lines.push("");

  lines.push("GUIDANCE (this bundle does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutGovernanceFinalize(
  result: ReleaseDecisionCloseoutGovernanceFinalizeResult,
  format: ReleaseDecisionCloseoutGovernanceFinalizeFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceFinalizeJson(result, pretty)
    : renderGovernanceFinalizeText(result);
}
