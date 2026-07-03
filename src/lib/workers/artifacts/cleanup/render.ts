/**
 * Human-readable **rendering** of an {@link ArtifactCleanupReport} for the CLI's `--text`
 * mode. Pure string building over the content-free report model: the output contains only
 * bounded verdict/category/severity/action enums, small counts, coarse buckets, the stable
 * policy id/version, and fixed prose — never an object key, bucket, URL, filename, raw
 * instant, size, id, or byte. So it is safe to print, log, or paste into an ops ticket.
 */

import type { ArtifactCleanupReport } from "./evaluate";
import { exitCodeForCleanupVerdict } from "./evaluate";
import { CLEANUP_CATEGORIES, CLEANUP_SEVERITIES } from "./taxonomy";

/** Options controlling which optional sections the text render includes. */
export interface RenderCleanupTextOptions {
  /** Include the reconciliation plan (one line per non-empty category). */
  readonly includePlan?: boolean;
  /** Include the descriptive breakdown tallies (provider/kind/processor/age/size). */
  readonly includeBreakdown?: boolean;
}

/** Render a `label: value` row, right-padding the label to a stable column. */
function row(label: string, value: string | number): string {
  return `  ${label.padEnd(22)} ${value}`;
}

/** Render a bounded count map as `key=count` pairs for the non-zero entries. */
function counts(
  keys: readonly string[],
  map: Readonly<Record<string, number>>,
): string {
  const parts = keys.filter((k) => map[k]! > 0).map((k) => `${k}=${map[k]}`);
  return parts.length > 0 ? parts.join("  ") : "(none)";
}

/**
 * Render an {@link ArtifactCleanupReport} as stable, human-readable text. Deterministic:
 * identical reports render byte-identically. The dry-run posture is stated explicitly so
 * the reader never mistakes the plan for an action taken.
 */
export function renderArtifactCleanupText(
  report: ArtifactCleanupReport,
  options: RenderCleanupTextOptions = {},
): string {
  const lines: string[] = [];
  lines.push("pdf.xyz storage-artifact cleanup verifier (dry-run)");
  lines.push(
    row("verdict", `${report.verdict} (exit ${exitCodeForCleanupVerdict(report.verdict)})`),
  );
  lines.push(row("artifacts evaluated", report.total));
  lines.push(row("cleanup recommended", report.cleanupRecommended));
  lines.push(
    row("policy", `${report.policyId} v${report.policyVersion}`),
  );
  lines.push("");
  lines.push(row("severities", counts(CLEANUP_SEVERITIES, report.severities)));
  lines.push(row("categories", counts(CLEANUP_CATEGORIES, report.categories)));

  if (options.includePlan) {
    lines.push("");
    lines.push("plan (dry-run — this tool never deletes; deletion is operator-owned):");
    if (report.plan.length === 0) {
      lines.push("  (empty)");
    } else {
      for (const item of report.plan) {
        lines.push(
          `  ${item.action.padEnd(12)} ${item.category.padEnd(22)} ${item.severity.padEnd(8)} x${item.count}`,
        );
      }
    }
  }

  if (options.includeBreakdown) {
    const b = report.breakdown;
    lines.push("");
    lines.push("breakdown:");
    lines.push(row("providers", counts(Object.keys(b.providers), b.providers)));
    lines.push(row("kinds", counts(Object.keys(b.kinds), b.kinds)));
    lines.push(row("processors", counts(Object.keys(b.processors), b.processors)));
    lines.push(row("ages", counts(Object.keys(b.ages), b.ages)));
    lines.push(row("sizes", counts(Object.keys(b.sizes), b.sizes)));
  }

  lines.push("");
  lines.push(report.summary);
  return lines.join("\n");
}
