/**
 * Pure, node-free **renderers** for the release decision record ledger (Phase 59).
 *
 * Two stable formats over the one {@link ReleaseDecisionResult}, both content-free by construction (every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable record for a CI artifact / release ledger / SIEM (pretty by default);
 *  - `text` — a ledger-friendly, CI-summary-ready record: the decision + both documents' own postures + the coherence
 *    cross-check, the reasons, the next-action checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere
 * for a locator, a reviewer identity, or a byte to enter.
 */

import type { ReleaseDecisionResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionJson(
  result: ReleaseDecisionResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the ledger-friendly, CI-summary-ready record text. */
function renderDecisionText(result: ReleaseDecisionResult): string {
  const { decision, publishPack, acknowledgement, crossCheck } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision record");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(
    `DECISION: ${decision.decision.toUpperCase()} (exit ${decision.exitCode})`,
  );
  lines.push(`  ${decision.detail}`);
  if (decision.reasons.length > 0)
    lines.push(`  reasons: ${decision.reasons.join(", ")}`);
  lines.push(
    `  counts: ${decision.invalidInputs} invalid-input, ${decision.blocking} blocking, ` +
      `${decision.insufficiencies} insufficiency, ${decision.advisories} advisory` +
      (decision.strict
        ? ` (strict${decision.strictEscalated ? `, escalated from ${decision.strictEscalatedFrom}` : ""})`
        : ""),
  );
  lines.push("");

  lines.push("PUBLISH PACK");
  lines.push(
    `  state=${publishPack.state}, verdict=${publishPack.verdict ?? "n/a"}, ` +
      `disclosure=${publishPack.disclosure ?? "n/a"}, ` +
      `sources=${publishPack.sourcesUsable}/${publishPack.sourcesSupplied} usable/supplied`,
  );
  lines.push(`  ${publishPack.detail}`);
  lines.push("");

  lines.push("ACKNOWLEDGEMENT");
  lines.push(
    `  state=${acknowledgement.state}, verdict=${acknowledgement.ackVerdict ?? "n/a"}, ` +
      `decision=${acknowledgement.decision ?? "n/a"}, reviewer=${acknowledgement.reviewer ?? "n/a"}, ` +
      `note=${acknowledgement.note ?? "n/a"}`,
  );
  lines.push(
    `  recorded pack: posture=${acknowledgement.recordedPackVerdict ?? "n/a"}, ` +
      `disclosure=${acknowledgement.recordedDisclosure ?? "n/a"}, ` +
      `sources=${acknowledgement.recordedSourcesUsable}/${acknowledgement.recordedSourcesSupplied} usable/supplied`,
  );
  lines.push(`  ${acknowledgement.detail}`);
  lines.push("");

  lines.push(`CROSS-CHECK: ${crossCheck.status.toUpperCase()}`);
  lines.push(`  ${crossCheck.detail}`);
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
  for (const c of result.checklist) {
    lines.push(`  - [${c.id}] ${c.detail}`);
  }
  lines.push("");

  lines.push(
    "OUT OF BAND (this record does NOT perform these — do them separately)",
  );
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecision(
  result: ReleaseDecisionResult,
  format: ReleaseDecisionFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionJson(result, pretty)
    : renderDecisionText(result);
}
