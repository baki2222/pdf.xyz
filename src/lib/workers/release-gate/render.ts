/**
 * Pure, node-free **renderers** for the release readiness gate (Phase 46).
 *
 * Two stable formats over the one {@link ReleaseGateResult}, both content-free by construction (every
 * field is a bounded enum, a small integer, or app-authored prose):
 *  - `json` — stable, pretty JSON for a CI artifact / release record / SIEM;
 *  - `text` — an operator-friendly pre-deploy checklist: the composite rollup first, then one line
 *    per check with its status + expected/observed exit + (when it did not pass) its remediation,
 *    then the operator guidance and the honesty caveats.
 *
 * The renderers never reach past the outcome object, and the outcome already carries no check output
 * (the trust boundary in `./run` dropped every byte), so there is nowhere for a locator or a byte to
 * enter.
 */

import type { ReleaseCheckOutcome, ReleaseGateResult } from "./types";

/** The output formats the CLI supports. */
export type ReleaseGateFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseGateJson(
  result: ReleaseGateResult,
  pretty = true,
): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** A fixed-width status tag for the checklist, e.g. `[ pass ]`. */
function statusTag(status: ReleaseCheckOutcome["status"]): string {
  return `[ ${status.padEnd(5)} ]`;
}

/** The observed-exit token: the code, or `n/a` when the check never returned one. */
function observed(outcome: ReleaseCheckOutcome): string {
  return outcome.observedExit === null ? "n/a" : String(outcome.observedExit);
}

/** Render the full result as the operator-friendly pre-deploy checklist text. */
function renderResultText(result: ReleaseGateResult): string {
  const { rollup } = result;
  const lines: string[] = [];
  lines.push("pdf.xyz worker release readiness gate");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");
  lines.push(
    `ROLLUP: ${rollup.verdict.toUpperCase()} (exit ${rollup.exitCode})`,
  );
  lines.push(`  ${rollup.detail}`);
  lines.push(
    `  checks: ${rollup.passedChecks}/${rollup.includedChecks} passed` +
      (rollup.skippedChecks > 0 ? `, ${rollup.skippedChecks} skipped` : "") +
      (rollup.blockers.length > 0
        ? `   blockers: ${rollup.blockers.join(", ")}`
        : ""),
  );
  lines.push("");

  lines.push("CHECKS");
  for (const c of result.checks) {
    lines.push(
      `  ${statusTag(c.status)} ${c.id}  (expected ${c.expectedExit}, observed ${observed(c)})`,
    );
    lines.push(`      ${c.summary}`);
    // Only surface remediation for checks that did not pass and were not skipped — keep a green run terse.
    if (
      c.status !== "pass" &&
      c.status !== "skip" &&
      c.remediation !== c.summary
    ) {
      lines.push(`      → ${c.remediation}`);
    }
  }
  lines.push("");

  lines.push(
    "GUIDANCE (this gate does NOT perform these — do them separately)",
  );
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseGate(
  result: ReleaseGateResult,
  format: ReleaseGateFormat,
  pretty = true,
): string {
  return format === "json"
    ? renderReleaseGateJson(result, pretty)
    : renderResultText(result);
}
