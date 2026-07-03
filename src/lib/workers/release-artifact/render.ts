/**
 * Pure, node-free **renderers** for the release evidence artifact (Phase 47).
 *
 * Two stable formats over the one {@link ReleaseArtifact}, both content-free by construction (every
 * field is a bounded enum, a small integer, an ISO stamp, a validated label/commit/digest, or
 * app-authored prose):
 *  - `json` — the stable artifact for a CI artifact / release record / SIEM (pretty by default);
 *  - `text` — an operator-friendly evidence summary: the rollup, the release/git provenance, the
 *    archived gate result, the optional ops-bundle context, the integrity anchor, then the guidance
 *    and honesty caveats.
 *
 * A small separate renderer handles the `--verify` outcome (a re-verification of a previously
 * written artifact), so both operations print in either format. The renderers never reach past the
 * artifact/outcome object, which already carries no ingested free text, so there is nowhere for a
 * locator or a byte to enter.
 *
 * IMPORTANT: the `json` render is a human/CI convenience and is pretty-printed — a verifier must NOT
 * hash these bytes. The integrity digest is over the CANONICAL body (`./canonicalize`); recompute it
 * with `--verify`, which re-canonicalizes `body` before hashing.
 */

import type { ReleaseArtifact, ReleaseArtifactVerifyOutcome } from "./types";

/** The output formats the CLI supports. */
export type ReleaseArtifactFormat = "json" | "text";

/** Render the artifact as stable JSON (pretty by default). */
export function renderReleaseArtifactJson(artifact: ReleaseArtifact, pretty = true): string {
  return `${JSON.stringify(artifact, null, pretty ? 2 : 0)}\n`;
}

/** The commit token for the text render: the short hash, or `n/a` when none was recorded. */
function commitToken(commit: string | null): string {
  return commit === null ? "n/a" : commit;
}

/** The label token for the text render: the label, or `(none)` when none was supplied. */
function labelToken(label: string | null): string {
  return label === null ? "(none)" : label;
}

/** Render the full artifact as the operator-friendly evidence summary text. */
function renderArtifactText(artifact: ReleaseArtifact): string {
  const { body, integrity } = artifact;
  const { rollup, metadata, gate, opsBundle } = body;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence artifact");
  lines.push(`generated: ${body.generatedAt}   schema: ${artifact.schema}`);
  lines.push("");

  lines.push(`ROLLUP: ${rollup.verdict.toUpperCase()} (exit ${rollup.exitCode})`);
  lines.push(`  ${rollup.detail}`);
  if (rollup.drivers.length > 0) lines.push(`  drivers: ${rollup.drivers.join(", ")}`);
  lines.push("");

  lines.push("RELEASE METADATA");
  lines.push(`  label:  ${labelToken(metadata.label)}`);
  lines.push(
    `  git:    ${metadata.git.cleanliness}, ref-class=${metadata.git.refClass}, commit=${commitToken(metadata.git.commit)}`,
  );
  lines.push(`  policy: ${metadata.policyId}@${metadata.policyVersion}`);
  lines.push("");

  lines.push(`RELEASE GATE  (source: ${gate.source})`);
  lines.push(
    `  verdict: ${gate.verdict}   checks: ${gate.passedChecks}/${gate.includedChecks} passed` +
      (gate.skippedChecks > 0 ? ` (${gate.skippedChecks} skipped)` : ""),
  );
  lines.push(`  ${gate.detail}`);
  if (gate.blockers.length > 0) lines.push(`  blockers: ${gate.blockers.join(", ")}`);
  lines.push("");

  lines.push(`OPS BUNDLE  (source: ${opsBundle.source})`);
  lines.push(`  ${opsBundle.detail}`);
  lines.push("");

  lines.push("INTEGRITY");
  lines.push(`  ${integrity.algorithm} over canonical body (${integrity.canonicalization})`);
  lines.push(`  ${integrity.digest}`);
  lines.push("");

  lines.push("GUIDANCE (this artifact does NOT perform these — do them separately)");
  for (const g of body.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of body.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `artifact` in the requested format. */
export function renderReleaseArtifact(
  artifact: ReleaseArtifact,
  format: ReleaseArtifactFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseArtifactJson(artifact, pretty) : renderArtifactText(artifact);
}

/* ------------------------------------------------------------------ *
 *  Verify-outcome render (--verify mode)
 * ------------------------------------------------------------------ */

/** Render the verify outcome in the requested format. */
export function renderVerifyOutcome(
  outcome: ReleaseArtifactVerifyOutcome,
  format: ReleaseArtifactFormat,
  pretty = true,
): string {
  if (format === "json") return `${JSON.stringify(outcome, null, pretty ? 2 : 0)}\n`;
  const lines: string[] = [];
  lines.push("pdf.xyz release evidence artifact — integrity verification");
  lines.push(`result: ${outcome.ok ? "VERIFIED" : "FAILED"} (exit ${outcome.exitCode}, reason ${outcome.reason})`);
  lines.push(`  ${outcome.detail}`);
  if (outcome.verdict !== null) lines.push(`  archived rollup verdict: ${outcome.verdict}`);
  if (outcome.claimedDigest !== "") lines.push(`  claimed:  ${outcome.claimedDigest}`);
  if (outcome.computedDigest !== "") lines.push(`  computed: ${outcome.computedDigest}`);
  return `${lines.join("\n")}\n`;
}
