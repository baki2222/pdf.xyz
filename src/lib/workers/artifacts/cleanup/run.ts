/**
 * The node-free **orchestrator** for the artifact cleanup-sweeper CLI
 * (`scripts/worker-artifact-cleanup.ts`). It is the whole of the CLI's behavior expressed
 * over injected values — the already-read inventory text, the validated args, and the
 * clock — so the Node entry is a thin shell (read argv/stdin/file, call this, write the
 * output, exit). That keeps every branch — parse failures, the evaluate + fold, each
 * output format, the optional plan/breakdown/metrics, and the exit-code mapping —
 * unit-testable without a runtime or a filesystem.
 *
 * Everything it returns is content-free by construction: it composes only the bounded
 * evaluator, receipt, renderer, and metric derivations, none of which can carry an object
 * key, bucket, URL, filename, raw instant, size, id, or byte. It is DRY-RUN only — it
 * neither performs nor plans any real deletion; the plan is content-free counts + actions.
 */

import { parseArtifactInventory } from "./inventory";
import {
  evaluateArtifactInventory,
  exitCodeForCleanupVerdict,
  type ArtifactCleanupReport,
} from "./evaluate";
import { buildArtifactCleanupReceipt, type ArtifactCleanupReceipt } from "./receipt";
import { renderArtifactCleanupText } from "./render";
import { deriveArtifactCleanupMetrics } from "../../observability/derive";
import type { WorkerMetricSample } from "../../observability/metrics";
import type { ArtifactCleanupArgs } from "./args";

/** The stable output schema id, so a consumer can pin the shape. */
export const ARTIFACT_CLEANUP_SCHEMA = "pdfxyz.artifact-cleanup/1";

/** The exit code for a usage/input error (a malformed or empty inventory). */
export const ARTIFACT_CLEANUP_EXIT_INPUT_ERROR = 1;

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ArtifactCleanupRun {
  readonly exitCode: number;
  readonly output: string;
  /** The report, or `null` when the input could not be parsed. */
  readonly report: ArtifactCleanupReport | null;
  /** The receipt, or `null` when the input could not be parsed. */
  readonly receipt: ArtifactCleanupReceipt | null;
}

/** Trim the report to the sections the flags requested (plan/breakdown are opt-in). */
function reportForJson(
  report: ArtifactCleanupReport,
  args: ArtifactCleanupArgs,
): Record<string, unknown> {
  const { plan, breakdown, ...core } = report;
  return {
    ...core,
    ...(args.includePlan ? { plan } : {}),
    ...(args.includeBreakdown ? { breakdown } : {}),
  };
}

/** Render the successful result as a stable JSON document. */
function renderJson(
  report: ArtifactCleanupReport,
  receipt: ArtifactCleanupReceipt,
  metrics: readonly WorkerMetricSample[] | undefined,
  args: ArtifactCleanupArgs,
  generatedAt: string,
): string {
  return `${JSON.stringify(
    {
      tool: "worker-artifact-cleanup",
      schema: ARTIFACT_CLEANUP_SCHEMA,
      dryRun: true,
      generatedAt,
      report: reportForJson(report, args),
      receipt,
      ...(metrics ? { metrics } : {}),
    },
    null,
    2,
  )}\n`;
}

/** Render a content-free input-error result (parse failure). Never echoes the input. */
function renderInputError(
  issues: readonly string[],
  format: "json" | "text",
  generatedAt: string,
): string {
  if (format === "text") {
    return [
      "pdf.xyz storage-artifact cleanup verifier (dry-run)",
      "  error                  invalid inventory input",
      `  issues                 ${issues.join(", ") || "(none)"}`,
      "The inventory could not be parsed. Provide a content-free JSON inventory; see --help.",
    ].join("\n");
  }
  return `${JSON.stringify(
    {
      tool: "worker-artifact-cleanup",
      schema: ARTIFACT_CLEANUP_SCHEMA,
      dryRun: true,
      generatedAt,
      error: { reason: "invalid-inventory", issues },
    },
    null,
    2,
  )}\n`;
}

/**
 * Run the cleanup sweep for validated `args` over the already-read inventory `text`,
 * against the injected clock. Total: a parse failure is an input error (exit 1) with a
 * content-free body, never a throw; otherwise the exit code is the report verdict's code
 * (0 ok / 2 unknown / 3 drift / 4 breach). `generatedAt` is the ISO stamp the caller
 * derived from the same clock.
 */
export function runArtifactCleanup(
  text: string,
  args: ArtifactCleanupArgs,
  nowMs: number,
  generatedAt: string,
): ArtifactCleanupRun {
  const parsed = parseArtifactInventory(text);
  if (!parsed.ok) {
    return {
      exitCode: ARTIFACT_CLEANUP_EXIT_INPUT_ERROR,
      output: renderInputError(
        parsed.issues.map((i) => i.code),
        args.format,
        generatedAt,
      ),
      report: null,
      receipt: null,
    };
  }

  const report = evaluateArtifactInventory(parsed.inventory, nowMs);
  const receipt = buildArtifactCleanupReceipt(report, generatedAt);
  const metrics = args.includeMetrics
    ? deriveArtifactCleanupMetrics(report)
    : undefined;

  const output =
    args.format === "text"
      ? `${renderArtifactCleanupText(report, {
          includePlan: args.includePlan,
          includeBreakdown: args.includeBreakdown,
        })}\n`
      : renderJson(report, receipt, metrics, args, generatedAt);

  return {
    exitCode: exitCodeForCleanupVerdict(report.verdict),
    output,
    report,
    receipt,
  };
}
