/**
 * Pure, node-free **renderers** for the release evidence index / retention manifest (Phase 48).
 *
 * Two stable formats over the one {@link ReleaseIndex}, both content-free by construction (every field
 * is a bounded enum, a small integer, a bounded age bucket, a short hex digest prefix, an ISO stamp,
 * or app-authored prose):
 *  - `json` — the stable manifest for a CI artifact / release record / SIEM (pretty by default);
 *  - `text` — an operator-friendly retention summary: the rollup, the retention posture, the verdict +
 *    digest-status counts, a per-artifact table, then the guidance and honesty caveats.
 *
 * The renderers never reach past the index object, which already carries no ingested free text, so
 * there is nowhere for a locator or a byte to enter.
 */

import type { ReleaseIndex, ReleaseIndexEntry } from "./types";

/** The output formats the CLI supports. */
export type ReleaseIndexFormat = "json" | "text";

/** Render the index as stable JSON (pretty by default). */
export function renderReleaseIndexJson(index: ReleaseIndex, pretty = true): string {
  return `${JSON.stringify(index, null, pretty ? 2 : 0)}\n`;
}

/** A short, fixed-width token for one artifact's digest verification result. */
function digestToken(entry: ReleaseIndexEntry): string {
  if (entry.digestStatus === "unreadable") return "unreadable";
  const prefix = entry.digestPrefix ?? "?";
  return `${entry.digestStatus} ${prefix}`;
}

/** One per-artifact line in the text table (all bounded tokens, never a raw stamp or locator). */
function artifactLine(entry: ReleaseIndexEntry): string {
  if (entry.digestStatus === "unreadable") {
    return `  [${entry.position}] SKIPPED (not a recognized release-artifact) — digest: unreadable`;
  }
  const verdict = entry.verdict ?? "n/a";
  const gate = entry.gateVerdict ?? "n/a";
  const flags: string[] = [];
  if (entry.overRetention) flags.push("over-retention");
  if (entry.opsBundlePresent) flags.push("ops-bundle");
  if (entry.commitPresent) flags.push("commit");
  const flagTail = flags.length > 0 ? `  [${flags.join(", ")}]` : "";
  return (
    `  [${entry.position}] ${verdict.toUpperCase()}  age=${entry.ageBucket}  gate=${gate}  ` +
    `git=${entry.cleanliness ?? "n/a"}/${entry.refClass ?? "n/a"}  label=${entry.labelClass}  ` +
    `digest=${digestToken(entry)}${flagTail}`
  );
}

/** Render the full index as the operator-friendly retention summary text. */
function renderIndexText(index: ReleaseIndex): string {
  const { rollup, retention, verdictCounts, digestCounts, metadata } = index;
  const lines: string[] = [];

  lines.push("pdf.xyz release evidence index / retention manifest");
  lines.push(`generated: ${index.generatedAt}   schema: ${index.schema}`);
  lines.push("");

  lines.push(`ROLLUP: ${rollup.verdict.toUpperCase()} (exit ${rollup.exitCode})`);
  lines.push(`  ${rollup.detail}`);
  if (rollup.drivers.length > 0) lines.push(`  drivers: ${rollup.drivers.join(", ")}`);
  lines.push("");

  lines.push("RETENTION");
  lines.push(
    `  indexed: ${retention.indexedArtifacts}   skipped: ${retention.skippedInputs}   ` +
      `total inputs: ${retention.totalInputs}`,
  );
  lines.push(
    `  bounds: max-artifacts=${retention.maxArtifacts ?? "none"}, max-age-days=${retention.maxAgeDays ?? "none"}`,
  );
  lines.push(
    `  posture: over-count=${retention.overCount}, over-age=${retention.overAge}, stale=${retention.stale}, ` +
      `over-retention artifacts=${retention.overRetentionCount}`,
  );
  lines.push(`  age span: newest=${retention.newestAgeBucket}, oldest=${retention.oldestAgeBucket}`);
  lines.push("");

  lines.push("COUNTS");
  lines.push(
    `  by artifact verdict: pass=${verdictCounts.pass}, warn=${verdictCounts.warn}, ` +
      `fail=${verdictCounts.fail}, unknown=${verdictCounts.unknown}`,
  );
  lines.push(
    `  by digest status:   verified=${digestCounts.verified}, mismatch=${digestCounts.mismatch}, ` +
      `malformed=${digestCounts.malformed}, unreadable=${digestCounts.unreadable}`,
  );
  lines.push("");

  lines.push(`ARTIFACTS (${index.artifacts.length}, newest first)`);
  if (index.artifacts.length === 0) {
    lines.push("  (none — no usable release-artifact was indexed)");
  } else {
    for (const entry of index.artifacts) lines.push(artifactLine(entry));
  }
  lines.push(`  pinned artifact schema: ${metadata.artifactSchema}`);
  lines.push("");

  lines.push("GUIDANCE (this index does NOT perform these — do them separately)");
  for (const g of index.guidance) lines.push(`  - ${g}`);
  lines.push("");

  lines.push("CAVEATS");
  for (const c of index.caveats) lines.push(`  - ${c}`);

  return `${lines.join("\n")}\n`;
}

/** Render `index` in the requested format. */
export function renderReleaseIndex(
  index: ReleaseIndex,
  format: ReleaseIndexFormat,
  pretty = true,
): string {
  return format === "json" ? renderReleaseIndexJson(index, pretty) : renderIndexText(index);
}
