/**
 * Pure, node-free **renderers** for the release decision closeout governance index trend action plan result (Phase 72).
 *
 * Two stable formats over the one {@link ReleaseDecisionCloseoutGovernanceActionPlanResult}, both content-free by
 * construction (every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / governance record / SIEM (pretty by default);
 *  - `text` — a review-friendly, CI-summary-ready plan: the plan verdict + urgency + action class + reasons, the source
 *    trend summary, the ordered next-action checklist, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there is nowhere for
 * a locator or a byte to enter.
 */

import type { ReleaseDecisionCloseoutGovernanceActionPlanResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseDecisionCloseoutGovernanceActionPlanFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseDecisionCloseoutGovernanceActionPlanJson(
  result: ReleaseDecisionCloseoutGovernanceActionPlanResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** Render the full result as the review-friendly, CI-summary-ready plan text. */
function renderGovernanceActionPlanText(
  result: ReleaseDecisionCloseoutGovernanceActionPlanResult,
): string {
  const { governanceActionPlan: plan, source } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release decision closeout governance index trend action plan");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`PLAN: ${plan.verdict.toUpperCase()} (exit ${plan.exitCode})`);
  lines.push(`  urgency: ${plan.urgency}   action: ${plan.actionClass}`);
  lines.push(`  ${plan.detail}`);
  if (plan.reasons.length > 0) lines.push(`  reasons: ${plan.reasons.join(", ")}`);
  lines.push(
    `  counts: ${plan.blocking} blocking, ${plan.advisories} advisory, ` +
      `${plan.incompletes} incomplete, ${plan.informationals} informational` +
      (plan.strictWatch ? ` (strict-watch${plan.strictWatchEscalated ? ", escalated" : ""})` : ""),
  );
  lines.push("");

  lines.push("SOURCE TREND");
  lines.push(
    `  state=${source.state}, verdict=${result.sourceTrendVerdict ?? "n/a"}, ` +
      `class=${result.sourceTrendClass ?? "n/a"}, direction=${result.sourceArcDirection ?? "n/a"}, ` +
      `latest-index=${result.sourceLatestIndex ?? "n/a"}`,
  );
  lines.push(
    `  windows: ${source.windowsUsable}/${source.windowsConsidered} usable/considered, ` +
      `governance=${source.totalGovernance}, source-strict-watch=${source.sourceStrictWatch}`,
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
  lines.push("");

  lines.push("GUIDANCE (this plan does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseDecisionCloseoutGovernanceActionPlan(
  result: ReleaseDecisionCloseoutGovernanceActionPlanResult,
  format: ReleaseDecisionCloseoutGovernanceActionPlanFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseDecisionCloseoutGovernanceActionPlanJson(result, pretty)
    : renderGovernanceActionPlanText(result);
}
