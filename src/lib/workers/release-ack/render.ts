/**
 * Pure, node-free **renderers** for the release evidence handoff acknowledgement receipt (Phase 58).
 *
 * Two stable formats over the one {@link ReleaseAckResult}, both content-free by construction (every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable receipt for a CI artifact / handoff record / SIEM (pretty by default);
 *  - `text` — a handoff-friendly, CI-summary-ready manifest: the acknowledgement verdict + the recorded decision +
 *    reviewer / note classes + the acknowledged pack's own posture, the reasons, the next-action checklist, then the
 *    guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere
 * for a locator, a reviewer identity, or a byte to enter.
 */

import type { ReleaseAckResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseAckFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseAckJson(result: ReleaseAckResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the handoff-friendly, CI-summary-ready manifest text. */
function renderAckText(result: ReleaseAckResult): string {
  const { ack, acknowledgement, source } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence handoff acknowledgement receipt");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`ACKNOWLEDGEMENT: ${ack.verdict.toUpperCase()} (exit ${ack.exitCode})`);
  lines.push(`  ${ack.detail}`);
  if (ack.reasons.length > 0) lines.push(`  reasons: ${ack.reasons.join(", ")}`);
  lines.push(
    `  counts: ${ack.invalidInputs} invalid-input, ${ack.blocking} blocking, ` +
      `${ack.insufficiencies} insufficiency, ${ack.advisories} advisory` +
      (ack.strict
        ? ` (strict${ack.strictEscalated ? `, escalated from ${ack.strictEscalatedFrom}` : ""})`
        : ""),
  );
  lines.push("");

  lines.push("DECISION");
  lines.push(
    `  decision=${acknowledgement.decision}, reviewer=${acknowledgement.reviewer}, ` +
      `note=${acknowledgement.note}, strict=${acknowledgement.strict}, follow-up=${acknowledgement.hasFollowup}`,
  );
  lines.push("");

  lines.push("ACKNOWLEDGED PACK");
  lines.push(
    `  state=${source.state}, posture=${source.packVerdict ?? "n/a"}, ` +
      `disclosure=${source.disclosure ?? "n/a"}, ` +
      `sources=${source.sourcesUsable}/${source.sourcesSupplied} usable/supplied`,
  );
  lines.push(`  ${source.detail}`);
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

  lines.push("OUT OF BAND (this receipt does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseAck(
  result: ReleaseAckResult,
  format: ReleaseAckFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseAckJson(result, pretty) : renderAckText(result);
}
