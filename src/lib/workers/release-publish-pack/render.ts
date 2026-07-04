/**
 * Pure, node-free **renderers** for the release evidence publish / handoff pack result (Phase 57).
 *
 * Two stable formats over the one {@link ReleasePublishPackResult}, both content-free by construction (every field
 * is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / handoff record / SIEM (pretty by default);
 *  - `text` — a handoff-friendly, CI-summary-ready manifest: the publish verdict + disclosure classification + the
 *    evidence coverage + per-source summaries, the reasons, the handoff checklist, then the guidance and honesty
 *    caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is
 * nowhere for a locator or a byte to enter.
 */

import type { ReleasePublishPackResult, ReleasePublishPackSource } from "./types";

/** The output formats the CLI supports. */
export type ReleasePublishPackFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleasePublishPackJson(result: ReleasePublishPackResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** One per-source block: the id + state + verdict + severity. */
function sourceLine(source: ReleasePublishPackSource): string {
  const sev = source.severity === null ? "—" : source.severity.toUpperCase();
  return `  [${sev}] ${source.id} — state=${source.state}, posture=${source.verdict ?? "n/a"}`;
}

/** Render the full result as the handoff-friendly, CI-summary-ready manifest text. */
function renderPublishPackText(result: ReleasePublishPackResult): string {
  const { pack, coverage, policy, disclosure } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence publish / handoff pack");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`PUBLISH: ${pack.verdict.toUpperCase()} (exit ${pack.exitCode})`);
  lines.push(`DISCLOSURE: ${disclosure.classification.toUpperCase()}`);
  lines.push(`  ${pack.detail}`);
  if (pack.reasons.length > 0) lines.push(`  reasons: ${pack.reasons.join(", ")}`);
  lines.push(
    `  counts: ${pack.blocking} blocking, ${pack.insufficiencies} insufficiency, ` +
      `${pack.advisories} advisory` +
      (pack.strict ? ` (strict${pack.strictEscalated ? `, escalated from ${pack.strictEscalatedFrom}` : ""})` : ""),
  );
  lines.push("");

  lines.push("DISCLOSURE NOTE");
  lines.push(`  ${disclosure.note}`);
  lines.push("");

  lines.push("EVIDENCE COVERAGE");
  lines.push(
    `  sources: ${coverage.sourcesUsable}/${coverage.sourcesSupplied} usable/supplied; ` +
      `governance=${coverage.governance}, archive=${coverage.archive}, restore-drill=${coverage.restoreDrill}, ` +
      `report=${coverage.report}, trend=${coverage.trend}`,
  );
  lines.push(
    `  policy: require-archive=${policy.requireArchive}, require-restore-drill=${policy.requireRestoreDrill}, ` +
      `strict=${policy.strict}`,
  );
  lines.push("");

  lines.push("SOURCES");
  for (const source of result.sources) lines.push(sourceLine(source));
  lines.push("");

  if (result.reasons.length > 0) {
    lines.push("REASONS");
    for (const r of result.reasons) {
      lines.push(`  [${r.severity.toUpperCase()}] ${r.id}`);
      lines.push(`      ${r.detail}`);
    }
    lines.push("");
  }

  lines.push("HANDOFF CHECKLIST");
  for (const c of result.checklist) {
    lines.push(`  - [${c.id}] ${c.detail}`);
  }
  lines.push("");

  lines.push("OUT OF BAND (this pack does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleasePublishPack(
  result: ReleasePublishPackResult,
  format: ReleasePublishPackFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleasePublishPackJson(result, pretty) : renderPublishPackText(result);
}
