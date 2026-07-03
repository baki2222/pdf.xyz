/**
 * Pure, node-free **composer** for the operations evidence bundle (Phase 45).
 *
 * It takes the bounded sections the {@link import("./ingest")} trust boundary produced and folds
 * them into one stable {@link OpsBundleResult}: it computes the composite rollup (a single
 * severity + exit code an operator/scheduler acts on) and attaches the honesty caveats.
 *
 * The rollup is deliberately non-double-counting. The operations section's `severity` already
 * folds readiness, liveness, every subsystem (INCLUDING cleanup-evidence and lifecycle-verification),
 * and the SLO window — that is what the ops-check alert policy computes. So the ONLY independent
 * signal the rollup adds is the cleanup pipeline (a separate tool the operations result does not
 * run). Composite exit = worst (numeric max) of the two, on the shared `0 ok / 1 usage / 2 unknown /
 * 3 warn / 4 critical` ladder — an absent optional pipeline contributes `ok` (its absence is not a
 * fault), an unreadable one contributes `unknown` (we could not assess what was supplied).
 */

import { exitCodeForSeverity } from "../observability/alerts";
import type { PipelineSeverity } from "../cleanup/pipeline/types";
import {
  OPS_BUNDLE_CAVEATS,
  OPS_BUNDLE_EXIT,
  OPS_BUNDLE_POLICY_ID,
  OPS_BUNDLE_POLICY_VERSION,
  OPS_BUNDLE_SCHEMA,
  OPS_BUNDLE_SEVERITY_SUMMARY,
  OPS_BUNDLE_USAGE_DETAIL,
  type OpsBundleExitCode,
  type OpsBundlePipelineSection,
  type OpsBundleResult,
  type OpsBundleRollup,
  type OpsBundleSeverity,
  type OpsBundleUsageError,
  type OpsBundleIssueCode,
} from "./types";
import type { IngestedOperations } from "./ingest";

/** The bundle exit code per composite severity — the authoritative severity → code map. */
export const OPS_BUNDLE_EXIT_FOR_SEVERITY: Record<OpsBundleSeverity, OpsBundleExitCode> = {
  ok: OPS_BUNDLE_EXIT.OK,
  usage: OPS_BUNDLE_EXIT.USAGE,
  unknown: OPS_BUNDLE_EXIT.UNKNOWN,
  warn: OPS_BUNDLE_EXIT.WARN,
  critical: OPS_BUNDLE_EXIT.CRITICAL,
};

/** Project a (possibly out-of-range) composite exit code onto the bounded composite severity. */
export function bundleSeverityForExit(code: number): OpsBundleSeverity {
  if (code >= OPS_BUNDLE_EXIT.CRITICAL) return "critical";
  if (code === OPS_BUNDLE_EXIT.WARN) return "warn";
  if (code === OPS_BUNDLE_EXIT.UNKNOWN) return "unknown";
  if (code === OPS_BUNDLE_EXIT.USAGE) return "usage";
  return "ok";
}

/** A supplied pipeline severity projected onto the shared exit ladder. */
const PIPELINE_SEVERITY_EXIT: Record<PipelineSeverity, number> = {
  ok: OPS_BUNDLE_EXIT.OK,
  usage: OPS_BUNDLE_EXIT.USAGE,
  unknown: OPS_BUNDLE_EXIT.UNKNOWN,
  drift: OPS_BUNDLE_EXIT.WARN,
  breach: OPS_BUNDLE_EXIT.CRITICAL,
};

/**
 * The exit code the cleanup-pipeline section contributes to the rollup:
 *  - `not-configured` (absent) ⇒ `ok` — its absence is honestly not a fault;
 *  - `unreadable`             ⇒ `unknown` — we could not assess the supplied input;
 *  - `supplied`               ⇒ the supplied severity mapped onto the shared ladder.
 */
export function pipelineSectionExit(section: OpsBundlePipelineSection): number {
  if (section.source === "not-configured") return OPS_BUNDLE_EXIT.OK;
  if (section.severity === null) return OPS_BUNDLE_EXIT.UNKNOWN;
  return PIPELINE_SEVERITY_EXIT[section.severity];
}

/** Compute the composite rollup from the operations severity + the pipeline section. */
export function computeRollup(
  ingested: IngestedOperations,
  pipeline: OpsBundlePipelineSection,
): OpsBundleRollup {
  const opsExit = exitCodeForSeverity(ingested.operations.severity);
  const pipeExit = pipelineSectionExit(pipeline);
  const worst = Math.max(opsExit, pipeExit);
  const severity = bundleSeverityForExit(worst);
  return {
    severity,
    exitCode: OPS_BUNDLE_EXIT_FOR_SEVERITY[severity],
    ok: severity === "ok",
    detail: OPS_BUNDLE_SEVERITY_SUMMARY[severity],
  };
}

/** Assemble the full, content-free evidence bundle from the ingested sections. */
export function buildOpsBundle(
  generatedAt: string,
  ingested: IngestedOperations,
  pipeline: OpsBundlePipelineSection,
): OpsBundleResult {
  return {
    schema: OPS_BUNDLE_SCHEMA,
    policyId: OPS_BUNDLE_POLICY_ID,
    policyVersion: OPS_BUNDLE_POLICY_VERSION,
    generatedAt,
    rollup: computeRollup(ingested, pipeline),
    sections: {
      operations: ingested.operations,
      slo: ingested.slo,
      cleanupEvidence: ingested.cleanupEvidence,
      lifecycle: ingested.lifecycle,
      pipeline,
    },
    caveats: OPS_BUNDLE_CAVEATS,
  };
}

/** Build the content-free usage-error outcome (bad/unreadable required input; exit 1). */
export function buildUsageError(
  generatedAt: string,
  issues: readonly OpsBundleIssueCode[],
): OpsBundleUsageError {
  return {
    schema: OPS_BUNDLE_SCHEMA,
    generatedAt,
    ok: false,
    error: "usage",
    exitCode: OPS_BUNDLE_EXIT.USAGE,
    issues,
    detail: OPS_BUNDLE_USAGE_DETAIL,
  };
}
