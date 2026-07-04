/**
 * Pure, node-free **renderers** for the release evidence audit result (Phase 51).
 *
 * Two stable formats over the one {@link ReleaseAuditResult}, both content-free by construction (every
 * field is a bounded enum, a small integer/delta, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / release record / SIEM (pretty by default);
 *  - `text` — an operator-friendly audit summary: the rollup, the baseline/current postures, the history
 *    distribution (history mode), the bounded diff deltas, the regression findings, then the next action,
 *    guidance, and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so there
 * is nowhere for a locator or a byte to enter.
 */

import type {
  AuditBundleSummary,
  AuditRegressionFinding,
  ReleaseAuditResult,
} from "./types";

/** The output formats the CLI supports. */
export type ReleaseAuditFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseAuditJson(result: ReleaseAuditResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** One per-bundle block: the slot headline + its bounded posture facts (only when usable). */
function bundleLines(label: string, s: AuditBundleSummary): string[] {
  const head = `  ${label}: ${s.usable ? (s.verdict ?? "n/a") : s.recognized ? "tampered" : s.present ? "unreadable" : "absent"}`;
  const lines = [head, `      ${s.detail}`];
  if (s.usable) {
    lines.push(
      `      stages present: ${s.stagesPresent}/4, chain complete: ${s.chainComplete}, ` +
        `decision stage: ${s.decisionStage ?? "none"}, inconsistencies: ${s.inconsistencies}`,
    );
    lines.push(
      `      warn stages: ${s.warnStages}, warning signals: ${s.warningSignals}, ` +
        `archive: ${s.archiveVerdict ?? "n/a"}`,
    );
  }
  return lines;
}

/** One per-regression line: the status + id (+ severity + authored detail if it fired). */
function regressionLines(f: AuditRegressionFinding): string[] {
  const head = `  [${f.status.toUpperCase()}] ${f.id}${f.status === "regressed" ? ` (${f.severity})` : ""}`;
  return f.status === "regressed" ? [head, `      ${f.detail}`] : [head];
}

/** Render the full result as the operator-friendly audit summary text. */
function renderAuditText(result: ReleaseAuditResult): string {
  const { rollup, comparison: c } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence audit / diff");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}   mode: ${result.mode}`);
  lines.push("");

  lines.push(`ROLLUP: ${rollup.verdict.toUpperCase()} (exit ${rollup.exitCode})`);
  lines.push(`  ${rollup.detail}`);
  if (rollup.drivers.length > 0) lines.push(`  drivers: ${rollup.drivers.join(", ")}`);
  lines.push(
    `  comparable: ${rollup.comparable}, blocking regressions: ${rollup.blockingRegressions}, ` +
      `warning regressions: ${rollup.warningRegressions}`,
  );
  lines.push("");

  lines.push("POLICY");
  lines.push(
    `  allow-warn-regression: ${result.policy.allowWarnRegression}, ` +
      `max-new-warnings: ${result.policy.maxNewWarnings}, fail-on-unknown: ${result.policy.failOnUnknown}`,
  );
  lines.push("");

  lines.push("BUNDLES");
  for (const line of bundleLines("baseline", result.baseline)) lines.push(line);
  for (const line of bundleLines("current", result.current)) lines.push(line);
  lines.push("");

  if (result.history !== null) {
    const v = result.history.verdictCounts;
    lines.push("HISTORY (posture distribution)");
    lines.push(`  bundles: ${result.history.count}, usable: ${result.history.usable}`);
    lines.push(
      `  by posture: pass=${v.pass}, warn=${v.warn}, unknown=${v.unknown}, fail=${v.fail}, ` +
        `unreadable=${v.unreadable}`,
    );
    lines.push("");
  }

  lines.push("DIFF (baseline → current, bounded deltas)");
  lines.push(
    `  posture rank delta: ${c.postureRankDelta ?? "n/a"}, stages delta: ${c.stagesPresentDelta}, ` +
      `inconsistencies delta: ${c.inconsistenciesDelta}`,
  );
  lines.push(
    `  new warnings: ${c.newWarnings}, broken links: ${c.brokenLinks}, ` +
      `weakened links: ${c.weakenedLinks}, dropped stages: ${c.droppedStages}, improved: ${c.improved}`,
  );
  lines.push("");

  lines.push("REGRESSIONS");
  for (const f of result.regressions) {
    for (const line of regressionLines(f)) lines.push(line);
  }
  lines.push("");

  lines.push("NEXT ACTION");
  lines.push(`  ${result.nextAction}`);
  lines.push("");

  lines.push("GUIDANCE (this audit does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c2 of result.caveats) lines.push(`  - ${c2}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseAudit(
  result: ReleaseAuditResult,
  format: ReleaseAuditFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseAuditJson(result, pretty) : renderAuditText(result);
}
