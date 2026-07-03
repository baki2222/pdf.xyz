/**
 * Pure, node-free **renderers** for the release policy result (Phase 49).
 *
 * Two stable formats over the one {@link ReleasePolicyResult}, both content-free by construction (every
 * field is a bounded enum, a small integer, a coarse age bucket, an ISO stamp, or app-authored prose):
 *  - `json` — the stable result for a CI artifact / release record / SIEM (pretty by default);
 *  - `text` — an operator-friendly policy summary: the rollup, the evaluated policy, the index facts,
 *    the violations with remediation, then the guidance and honesty caveats.
 *
 * The renderers never reach past the result object, which already carries no ingested free text, so
 * there is nowhere for a locator or a byte to enter.
 */

import type {
  ReleasePolicyFacts,
  ReleasePolicyInputs,
  ReleasePolicyResult,
  ReleasePolicyViolation,
} from "./types";

/** The output formats the CLI supports. */
export type ReleasePolicyFormat = "json" | "text";

/** Render the result as stable JSON (pretty by default). */
export function renderReleasePolicyJson(result: ReleasePolicyResult, pretty = true): string {
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** One human line per configured policy bound (only the assertions the operator actually set). */
function policyLines(policy: ReleasePolicyInputs): string[] {
  const out: string[] = [];
  if (policy.requireClean) out.push("require-clean");
  if (policy.requireLatestOk) out.push("require-latest-ok");
  if (policy.maxInvalid !== null) out.push(`max-invalid=${policy.maxInvalid}`);
  if (policy.maxFail !== null) out.push(`max-fail=${policy.maxFail}`);
  if (policy.minArtifacts !== null) out.push(`min-artifacts=${policy.minArtifacts}`);
  if (policy.maxArtifacts !== null) out.push(`max-artifacts=${policy.maxArtifacts}`);
  if (policy.maxAgeBucket !== null) out.push(`max-age-bucket=${policy.maxAgeBucket}`);
  if (policy.maxWarn !== null) out.push(`max-warn=${policy.maxWarn}`);
  if (policy.maxSkipped !== null) out.push(`max-skipped=${policy.maxSkipped}`);
  if (policy.forbidOverRetention) out.push("forbid-over-retention");
  return out;
}

/** The bounded index-facts block (all enums / small ints / buckets — never a locator). */
function factsLines(facts: ReleasePolicyFacts): string[] {
  const v = facts.verdictCounts;
  return [
    `  archive verdict: ${facts.archiveVerdict}`,
    `  artifacts: indexed=${facts.indexedArtifacts}, skipped=${facts.skippedInputs}, total=${facts.totalInputs}`,
    `  by verdict: pass=${v.pass}, warn=${v.warn}, fail=${v.fail}, unknown=${v.unknown}`,
    `  integrity failures: ${facts.integrityFailures}`,
    `  latest artifact verdict: ${facts.latestVerdict ?? "none"}`,
    `  age span: newest=${facts.newestAgeBucket}, oldest=${facts.oldestAgeBucket}`,
    `  retention: over-count=${facts.overCount}, over-age=${facts.overAge}, stale=${facts.stale}, ` +
      `over-retention artifacts=${facts.overRetentionCount}`,
  ];
}

/** One per-violation block: the id + severity + observed/limit, then the authored remediation. */
function violationLines(violation: ReleasePolicyViolation): string[] {
  const bound = violation.limit === null ? "" : `  (observed ${violation.observed}, limit ${violation.limit})`;
  return [
    `  [${violation.severity.toUpperCase()}] ${violation.id}${bound}`,
    `      ${violation.detail}`,
  ];
}

/** Render the full result as the operator-friendly policy summary text. */
function renderPolicyText(result: ReleasePolicyResult): string {
  const { rollup, policy, facts } = result;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence policy assertions");
  lines.push(`generated: ${result.generatedAt}   schema: ${result.schema}`);
  lines.push("");

  lines.push(`ROLLUP: ${rollup.verdict.toUpperCase()} (exit ${rollup.exitCode})`);
  lines.push(`  ${rollup.detail}`);
  if (rollup.drivers.length > 0) lines.push(`  drivers: ${rollup.drivers.join(", ")}`);
  lines.push(
    `  violations: ${rollup.blockingViolations} blocking, ${rollup.warningViolations} warning`,
  );
  lines.push("");

  lines.push(`EVIDENCE (source: ${result.source})`);
  lines.push(
    `  index: recognized=${result.indexRecognized}, usable=${result.indexUsable}, ` +
      `reported=${result.reportedVerdict ?? "n/a"}, effective=${result.effectiveVerdict ?? "n/a"}`,
  );
  if (facts !== null) {
    for (const line of factsLines(facts)) lines.push(line);
  } else {
    lines.push("  (no usable release-index facts — policy could not be evaluated over the index)");
  }
  lines.push("");

  lines.push("POLICY (assertions evaluated)");
  const configured = policyLines(policy);
  if (configured.length === 0) {
    lines.push("  (none configured — only the index's structural integrity was checked)");
  } else {
    for (const line of configured) lines.push(`  - ${line}`);
  }
  lines.push("");

  lines.push(`VIOLATIONS (${result.violations.length})`);
  if (result.violations.length === 0) {
    lines.push("  (none — every configured assertion held)");
  } else {
    for (const violation of result.violations) {
      for (const line of violationLines(violation)) lines.push(line);
    }
  }
  lines.push("");

  lines.push("GUIDANCE (this policy does NOT perform these — do them separately)");
  for (const g of result.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of result.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `result` in the requested format. */
export function renderReleasePolicy(
  result: ReleasePolicyResult,
  format: ReleasePolicyFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleasePolicyJson(result, pretty) : renderPolicyText(result);
}
