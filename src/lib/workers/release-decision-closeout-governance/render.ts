/**
 * Pure, node-free **renderers** for the release decision closeout governance bundle result (Phase 69).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceResult}, both content-free by construction
 * (every field is a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a governance-review-friendly, CI-summary-ready report: the governance verdict + reasons, the primary
 *    receipt summary, the related-record checklist, the coverage, then the reasons, archive checklist, follow-up
 *    assignment list, guidance, and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type {
  ReleaseDecisionCloseoutGovernanceRelatedRecord,
  ReleaseDecisionCloseoutGovernanceResult,
} from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceJson(
  result: ReleaseDecisionCloseoutGovernanceResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** One related-record checklist line — a coverage mark + kind + state + signal + verdict. */
function relatedLine(record: ReleaseDecisionCloseoutGovernanceRelatedRecord): string {
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
function renderGovernanceText(result: ReleaseDecisionCloseoutGovernanceResult): string {
  const { governance, coverage, source, policy } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance bundle");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`GOVERNANCE: ${governance.verdict.toUpperCase()} (exit ${governance.exitCode})`);
  lines.push(`  ${governance.detail}`);
  if (governance.reasons.length > 0) lines.push(`  reasons: ${governance.reasons.join(", ")}`);
  lines.push(
    `  counts: ${governance.blocking} blocking, ${governance.open} open, ` +
      `${governance.incomplete} incomplete, ${governance.informational} informational` +
      (governance.strictOpen ? ` (strict-open${governance.strictOpenEscalated ? ", escalated" : ""})` : ""),
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
  if (governance.requiredMissing.length > 0) {
    lines.push(`  … missing required records: ${governance.requiredMissing.join(", ")}`);
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
      `require-index=${policy.require.index}, require-closeout=${policy.require.closeout}, ` +
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

  lines.push("ARCHIVE (content-free records to keep as the governance record)");
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
export function renderReleaseDecisionCloseoutGovernance(
  result: ReleaseDecisionCloseoutGovernanceResult,
  format: ReleaseDecisionCloseoutGovernanceFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceJson(result, pretty)
    : renderGovernanceText(result);
}
