/**
 * Pure, node-free **renderers** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend action plan result (Phase 102).
 *
 * Two stable formats over the one
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult}, both
 * content-free by construction (every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready plan: the plan verdict + urgency + action class + reasons, the source
 *    trend summary, the ordered next-action checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanJson(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the review-friendly, CI-summary-ready plan text. */
function renderCloseoutIndexTrendActionPlanText(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
): string {
  const { actionPlan: plan, source } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index trend action plan");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`PLAN: ${plan.verdict.toUpperCase()} (exit ${plan.exitCode})`);
  lines.push(`  urgency: ${plan.urgency}   action: ${plan.actionClass}`);
  lines.push(`  ${plan.detail}`);
  if (plan.reasons.length > 0) lines.push(`  reasons: ${plan.reasons.join(", ")}`);
  lines.push(
    `  counts: ${plan.invalidInputs} invalid-input, ${plan.blocking} blocking, ` +
      `${plan.insufficiencies} insufficient, ${plan.advisories} advisory, ${plan.informationals} informational` +
      (plan.strict ? ` (strict${plan.strictEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("SOURCE TREND");
  lines.push(
    `  state=${source.state}, verdict=${result.sourceTrendVerdict ?? "n/a"}, ` +
      `class=${result.sourceTrendClass ?? "n/a"}, direction=${result.sourceArcDirection ?? "n/a"}, ` +
      `latest-index=${result.sourceLatestIndex ?? "n/a"}`,
  );
  lines.push(
    `  windows: ${source.indexesUsable}/${source.indexesConsidered} usable/considered, ` +
      `closeouts=${source.totalCloseouts}, source-strict-open=${source.sourceStrictOpen}`,
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

  lines.push(
    `NEXT ACTIONS (${result.plan.length}/${result.actionsConsidered} shown, --max-actions=${result.maxActions}` +
      (result.actionsDropped > 0 ? `, ${result.actionsDropped} dropped` : "") +
      ")",
  );
  for (const item of result.plan) {
    const block = item.blocking ? "!" : " ";
    lines.push(`  ${block} [${item.urgency}/${item.expectation}] ${item.id}`);
    lines.push(`      ${item.label}`);
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
export function renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanJson(result, pretty)
    : renderCloseoutIndexTrendActionPlanText(result);
}
