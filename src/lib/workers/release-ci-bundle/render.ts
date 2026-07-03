/**
 * Pure, node-free **renderers** for the release CI bundle result (Phase 50).
 *
 * Two stable formats over the one {@link ReleaseCiBundleResult}, both content-free by construction (every
 * field is a bounded enum, a small integer, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / release record / SIEM (pretty by default);
 *  - `text` — an operator-friendly bundle summary: the rollup, the per-stage summaries, the consistency
 *    links, the archive guidance + next action, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so
 * there is nowhere for a locator or a byte to enter.
 */

import type {
  ReleaseCiBundleConsistencyCheck,
  ReleaseCiBundleResult,
  ReleaseCiBundleStage,
} from "./types";

/** The output formats the CLI supports. */
export type ReleaseCiBundleFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleaseCiBundleJson(result: ReleaseCiBundleResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The bounded per-stage facts lines (all enums / small ints / booleans — never a locator). */
function stageFactsLines(stage: ReleaseCiBundleStage): string[] {
  switch (stage.stage) {
    case "gate": {
      const f = stage.facts;
      if (f === null) return [];
      return [
        `      checks: included=${f.includedChecks}, passed=${f.passedChecks}, ` +
          `skipped=${f.skippedChecks}, blockers=${f.blockers}`,
      ];
    }
    case "artifact": {
      const f = stage.facts;
      if (f === null) return [];
      return [
        `      digest: ${f.digestStatus}, gate=${f.gateVerdict ?? "none"}, ` +
          `tree=${f.cleanliness ?? "n/a"}, ref=${f.refClass ?? "n/a"}, ` +
          `commit=${f.commitPresent}, label=${f.labelClass}`,
      ];
    }
    case "index": {
      const f = stage.facts;
      if (f === null) return [];
      const v = f.verdictCounts;
      return [
        `      archive: ${f.archiveVerdict}, indexed=${f.indexedArtifacts}, ` +
          `skipped=${f.skippedInputs}, integrity-failures=${f.integrityFailures}, ` +
          `over-retention=${f.overRetentionCount}`,
        `      by verdict: pass=${v.pass}, warn=${v.warn}, fail=${v.fail}, unknown=${v.unknown}; ` +
          `newest=${f.newestAgeBucket}, latest=${f.latestVerdict ?? "none"}`,
      ];
    }
    case "policy": {
      const f = stage.facts;
      if (f === null) return [];
      return [
        `      effective=${f.effectiveVerdict ?? "n/a"}, index-usable=${f.indexUsable}, ` +
          `indexed=${f.indexedArtifacts}, assertions=${f.assertionsEvaluated}, ` +
          `violations: ${f.blockingViolations} blocking, ${f.warningViolations} warning`,
      ];
    }
  }
}

/** One per-stage block: the id + source + verdict + severity, then its bounded facts. */
function stageLines(stage: ReleaseCiBundleStage): string[] {
  const head = `  [${stage.severity.toUpperCase()}] ${stage.stage} — source=${stage.source}, verdict=${stage.verdict ?? "n/a"}`;
  return [head, ...stageFactsLines(stage)];
}

/** One per-consistency-check line: the id + status, then the authored detail if not ok. */
function consistencyLines(c: ReleaseCiBundleConsistencyCheck): string[] {
  const head = `  [${c.status.toUpperCase()}] ${c.id}`;
  return c.status === "ok" ? [head] : [head, `      ${c.detail}`];
}

/** Render the full result as the operator-friendly bundle summary text. */
function renderBundleText(result: ReleaseCiBundleResult): string {
  const { rollup } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence CI bundle");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`ROLLUP: ${rollup.verdict.toUpperCase()} (exit ${rollup.exitCode})`);
  lines.push(`  ${rollup.detail}`);
  if (rollup.drivers.length > 0) lines.push(`  drivers: ${rollup.drivers.join(", ")}`);
  lines.push(
    `  stages present: ${rollup.stagesPresent}/4, chain complete: ${rollup.chainComplete}, ` +
      `decision stage: ${rollup.decisionStage ?? "none"}, inconsistencies: ${rollup.inconsistencies}`,
  );
  lines.push("");

  lines.push("STAGES");
  for (const stage of result.stages) {
    for (const line of stageLines(stage)) lines.push(line);
  }
  lines.push("");

  lines.push("CONSISTENCY (cross-stage + self-consistency links)");
  for (const c of result.consistency) {
    for (const line of consistencyLines(c)) lines.push(line);
  }
  lines.push("");

  lines.push("ARCHIVE (content-free outputs to keep as CI artifacts)");
  lines.push(`  stages: ${result.archive.stages.length > 0 ? result.archive.stages.join(", ") : "(none)"}`);
  lines.push(`  ${result.archive.note}`);
  lines.push("");

  lines.push("NEXT ACTION");
  lines.push(`  ${result.nextAction}`);
  lines.push("");

  lines.push("GUIDANCE (this bundle does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleaseCiBundle(
  result: ReleaseCiBundleResult,
  format: ReleaseCiBundleFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseCiBundleJson(result, pretty) : renderBundleText(result);
}
