/**
 * Pure, node-free **renderers** for the operations evidence bundle (Phase 45).
 *
 * Two stable formats over the one {@link OpsBundleOutcome}, both content-free by construction
 * (every field is a bounded enum, boolean, count, or app-authored prose):
 *  - `json` — stable, pretty JSON for tooling / CI artifacts / a SIEM;
 *  - `text` — an operator-friendly incident-handoff runbook: the composite rollup first, then one
 *    labelled block per composed signal, then the honesty caveats.
 *
 * The renderers never reach past the outcome object, so there is nowhere for a locator or a byte
 * to enter: the trust boundary already dropped anything that was not a bounded token.
 */

import {
  isOpsBundleUsageError,
  type OpsBundleOutcome,
  type OpsBundlePipelineSection,
  type OpsBundleResult,
  type OpsBundleSloSection,
} from "./types";

/** The output formats the CLI supports. */
export type OpsBundleFormat = "json" | "text";

/** Render the outcome as stable JSON (pretty by default; compact only if explicitly requested later). */
export function renderOpsBundleJson(
  outcome: OpsBundleOutcome,
  pretty = true,
): string {
  return `${JSON.stringify(outcome, null, pretty ? 2 : 0)}\n`;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** The pipeline block's headline token — the severity when supplied, else the bounded source. */
function pipelineHeadline(pipeline: OpsBundlePipelineSection): string {
  return pipeline.severity ?? pipeline.source;
}

function renderSlo(slo: OpsBundleSloSection | null): string[] {
  if (!slo)
    return [
      "SLO  [not reported]",
      "  No SLO window was included in the operations result.",
    ];
  const issues =
    slo.issues.length > 0
      ? slo.issues.map((i) => `${i.id}=${i.status}`).join(", ")
      : "none warned or breached";
  return [`SLO  [${slo.worst}]`, `  ${slo.detail}`, `  issues: ${issues}`];
}

/** Render a full bundle as the incident-handoff runbook text. */
function renderResultText(result: OpsBundleResult): string {
  const { rollup, sections } = result;
  const {
    operations: ops,
    cleanupEvidence: ce,
    lifecycle: lc,
    pipeline,
  } = sections;

  const lines: string[] = [];
  lines.push("pdf.xyz operations evidence bundle");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");
  lines.push(
    `ROLLUP: ${rollup.severity.toUpperCase()} (exit ${rollup.exitCode})`,
  );
  lines.push(`  ${rollup.detail}`);
  lines.push("");

  lines.push(`OPERATIONS  [${ops.severity}]`);
  lines.push(`  ${ops.summary}`);
  lines.push(
    `  vantage: ${ops.vantage}   health: ${ops.health}   drainable: ${yesNo(ops.drainable)}   daemon observed: ${yesNo(ops.daemonObserved)}`,
  );
  lines.push(
    `  liveness: ${ops.liveness.state} (source ${ops.liveness.source}, last seen ${ops.liveness.lastSeen ?? "n/a"})`,
  );
  lines.push(`  next action: ${ops.action} — ${ops.actionDetail}`);
  lines.push(
    `  subsystems: ${ops.subsystems.length > 0 ? ops.subsystems.map((s) => `${s.id}=${s.health}`).join(", ") : "none reported"}`,
  );
  lines.push(
    `  proofs: compression-deep=${ops.proofs.compressionDeep} ocr=${ops.proofs.ocr}`,
  );
  if (ops.alerts.length > 0) {
    lines.push("  alerts:");
    for (const a of ops.alerts)
      lines.push(
        `    - [${a.severity}] ${a.source}: ${a.reason} → ${a.action}`,
      );
  } else {
    lines.push("  alerts: none");
  }
  lines.push("");

  lines.push(...renderSlo(sections.slo));
  lines.push("");

  lines.push(`CLEANUP EVIDENCE  [${ce.state}]`);
  lines.push(`  ${ce.detail}`);
  lines.push(`  provider: ${ce.provider}   freshness: ${ce.freshness}`);
  lines.push("");

  lines.push(`LIFECYCLE  [${lc.verdict}]`);
  lines.push(`  ${lc.detail}`);
  lines.push(`  verification: ${lc.verification}   readiness: ${lc.readiness}`);
  lines.push("");

  lines.push(`CLEANUP PIPELINE  [${pipelineHeadline(pipeline)}]`);
  lines.push(`  ${pipeline.detail}`);
  if (pipeline.arms.length > 0) {
    lines.push(
      `  arms: ${pipeline.arms.map((a) => `${a.arm}=${a.severity}${a.projected ? "" : " (not projected)"}`).join(", ")}`,
    );
  }
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render a usage error as the same runbook header + a bounded issue list. */
function renderUsageErrorText(
  outcome: Extract<OpsBundleOutcome, { error: "usage" }>,
): string {
  const lines: string[] = [];
  lines.push("pdf.xyz operations evidence bundle");
  lines.push(`generated: ${outcome.generatedAt}   schema: ${outcome.schema}`);
  lines.push("");
  lines.push(`USAGE ERROR (exit ${outcome.exitCode})`);
  lines.push(`  ${outcome.detail}`);
  lines.push(`  issues: ${outcome.issues.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

/** Render `outcome` in the requested format. */
export function renderOpsBundle(
  outcome: OpsBundleOutcome,
  format: OpsBundleFormat,
  pretty = true,
): string {
  if (format === "json") return renderOpsBundleJson(outcome, pretty);
  return isOpsBundleUsageError(outcome)
    ? renderUsageErrorText(outcome)
    : renderResultText(outcome);
}
