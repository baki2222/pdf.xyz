/**
 * Pure, node-free **renderers** for the release decision trend action plan result (Phase 62).
 *
 * Two stable formats over the one {@link ReleaseDecisionActionPlanResult}, both content-free by construction (every
 * field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready plan: the plan verdict + urgency + action class + reasons, the
 *    source trend summary, the ordered next-action checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere
 * for a locator or a byte to enter.
 */

import type { ReleaseDecisionActionPlanResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionActionPlanFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionActionPlanJson(
  result: ReleaseDecisionActionPlanResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the review-friendly, CI-summary-ready plan text. */
function renderActionPlanText(result: ReleaseDecisionActionPlanResult): string {
  const { plan, source } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision trend action plan");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`PLAN: ${plan.verdict.toUpperCase()} (exit ${plan.exitCode})`);
  lines.push(`  urgency: ${plan.urgency}   action: ${plan.actionClass}`);
  lines.push(`  ${plan.detail}`);
  if (plan.reasons.length > 0) lines.push(`  reasons: ${plan.reasons.join(", ")}`);
  lines.push(
    `  counts: ${plan.invalidInputs} invalid-input, ${plan.blocking} blocking, ` +
      `${plan.insufficiencies} insufficiency, ${plan.advisories} advisory` +
      (plan.strict ? ` (strict${plan.strictEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("SOURCE TREND");
  lines.push(
    `  state=${source.state}, verdict=${result.sourceTrendVerdict ?? "n/a"}, ` +
      `class=${result.sourceTrendClass ?? "n/a"}, direction=${result.sourceArcDirection ?? "n/a"}`,
  );
  lines.push(
    `  windows: ${source.windowsUsable}/${source.windowsConsidered} usable/considered, ` +
      `records=${source.totalRecords}, source-strict=${source.sourceStrict}`,
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

  lines.push("NEXT ACTIONS");
  for (const item of result.actions) {
    const block = item.blocking ? "!" : " ";
    lines.push(`  ${block} [${item.urgency}/${item.expectation}] ${item.id}`);
    lines.push(`      ${item.label}`);
  }
  if (result.receipt.actionsDropped > 0) {
    lines.push(
      `  (…${result.receipt.actionsDropped} lower-priority action(s) dropped by --max-actions=${result.policy.maxActions})`,
    );
  }
  lines.push("");

  lines.push("GUIDANCE (this plan does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionActionPlan(
  result: ReleaseDecisionActionPlanResult,
  format: ReleaseDecisionActionPlanFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionActionPlanJson(result, pretty)
    : renderActionPlanText(result);
}
