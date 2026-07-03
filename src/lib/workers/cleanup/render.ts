/**
 * Pure, node-free **renderers** for the cleanup-verification CLI (Phase 42), plus the stable
 * structured {@link CleanupCheckResult} contract a monitor parses and the verdict→exit-code map.
 *
 * The result is content-free by construction: every field is a bounded enum, a boolean, a small
 * integer count, or authored prose — never a string copied out of an ingested document. The
 * three formats are all derived from that one object, so they can never disagree:
 *  - `--json`       — the {@link CleanupCheckOutcome} verbatim (a monitor parses it).
 *  - `--prometheus` — content-free gauges for a scrape.
 *  - `--text`       — a short human summary for a terminal / log line.
 */

import { exitCodeForSeverity, OPS_CHECK_EXIT, type AlertSeverity } from "../observability/alerts";
import {
  CLEANUP_OBJECT_STATES,
  type CleanupObjectState,
  type CleanupStateCounts,
  type CleanupVerdict,
  type CleanupVerification,
} from "./types";
import type { RetrievalStorageProvider } from "../artifacts/access";
import type { CleanupCheckSource } from "./args";

/** The schema tag every result carries, so a monitor can pin the shape it parses. */
export const CLEANUP_CHECK_SCHEMA = "pdfxyz.cleanup-check/1" as const;

/** The stable, content-free structured result the CLI emits (and a monitor parses). */
export interface CleanupCheckResult {
  readonly schema: typeof CLEANUP_CHECK_SCHEMA;
  readonly generatedAt: string;
  readonly source: CleanupCheckSource;
  /** True iff the verdict is `verified`. */
  readonly ok: boolean;
  readonly verdict: CleanupVerdict;
  readonly exitCode: number;
  readonly provider: RetrievalStorageProvider;
  /** Objects considered this run. */
  readonly total: number;
  /** Objects confirmed absent (active delete-now + lifecycle backstop). */
  readonly reaped: number;
  /** Objects still present past their reap grace (the drift count). */
  readonly drift: number;
  /** The post-expiry reap grace this run judged with, in hours. */
  readonly graceHours: number;
  /** Per-state counts over every object considered. */
  readonly counts: CleanupStateCounts;
  readonly summary: string;
}

/** The result when the CLI's INPUT was unusable (bad flag handled earlier; bad ingest here). */
export interface CleanupCheckUsageError {
  readonly schema: typeof CLEANUP_CHECK_SCHEMA;
  readonly generatedAt: string;
  readonly source: CleanupCheckSource;
  readonly ok: false;
  readonly error: "usage";
  /** The documented usage/malformed-input exit code (see OPS_CHECK_EXIT.USAGE). */
  readonly exitCode: 1;
  /** Content-free issue codes explaining why the input was rejected. */
  readonly issues: string[];
  readonly detail: string;
}

/** Either a full evaluation or a usage error — both are rendered by {@link renderCleanupCheck}. */
export type CleanupCheckOutcome = CleanupCheckResult | CleanupCheckUsageError;

/** Distinguish the two outcomes without a cast. */
export function isCleanupUsageError(
  outcome: CleanupCheckOutcome,
): outcome is CleanupCheckUsageError {
  return (outcome as CleanupCheckUsageError).error === "usage";
}

/**
 * Fold a cleanup verdict to the shared alert severity ladder — reused so the CLI's exit code
 * comes from the SAME source as the ops-check ladder. `verified` is healthy; `drift` is a
 * recommended fix (a worker can still run and Phase 41 still denies the download); everything
 * else could not prove cleanup and is `unknown` (never escalated over a concrete signal).
 */
export function severityForCleanupVerdict(verdict: CleanupVerdict): AlertSeverity {
  switch (verdict) {
    case "verified":
      return "ok";
    case "drift":
      return "warn";
    case "unknown":
    case "unavailable":
    case "not-configured":
      return "unknown";
  }
}

/** The documented exit code for a verdict (never the usage code). */
export function exitCodeForCleanupVerdict(verdict: CleanupVerdict): number {
  return exitCodeForSeverity(severityForCleanupVerdict(verdict));
}

/** Build the structured result from a verification + run context. */
export function buildCleanupCheckResult(
  verification: CleanupVerification,
  ctx: { source: CleanupCheckSource; generatedAt: string; graceHours: number },
): CleanupCheckResult {
  const exitCode = exitCodeForCleanupVerdict(verification.verdict);
  return {
    schema: CLEANUP_CHECK_SCHEMA,
    generatedAt: ctx.generatedAt,
    source: ctx.source,
    ok: verification.verdict === "verified",
    verdict: verification.verdict,
    exitCode,
    provider: verification.provider,
    total: verification.total,
    reaped: verification.reaped,
    drift: verification.drift,
    graceHours: ctx.graceHours,
    counts: verification.counts,
    summary: verification.summary,
  };
}

/** Build a content-free usage-error outcome (bad ingest input; exit 1). */
export function buildCleanupUsageError(
  source: CleanupCheckSource,
  generatedAt: string,
  issues: string[],
): CleanupCheckUsageError {
  return {
    schema: CLEANUP_CHECK_SCHEMA,
    generatedAt,
    source,
    ok: false,
    error: "usage",
    exitCode: OPS_CHECK_EXIT.USAGE,
    issues,
    detail:
      "The supplied cleanup evidence could not be read or validated. Provide a bare JSON array, or { objects: [...] }, of content-free per-object observations.",
  };
}

/* ------------------------------------------------------------------ *
 *  JSON
 * ------------------------------------------------------------------ */

/** Render the outcome as stable, pretty JSON (a trailing newline for clean piping). */
export function renderCleanupCheckJson(outcome: CleanupCheckOutcome): string {
  return `${JSON.stringify(outcome, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 *  Prometheus
 * ------------------------------------------------------------------ */

/** A scrapeable numeric per verdict — a stable enumeration a dashboard can map. */
const VERDICT_CODE: Record<CleanupVerdict, number> = {
  verified: 0,
  drift: 1,
  unavailable: 2,
  unknown: 3,
  "not-configured": 4,
};

/** Escape a Prometheus label value (bounded enums rarely need it; defensive). */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** `name{k="v",...} value`, labels in given order. */
function line(name: string, labels: Record<string, string>, value: number): string {
  const pairs = Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(",");
  return `${name}${pairs ? `{${pairs}}` : ""} ${value}`;
}

/**
 * Render content-free Prometheus gauges for the cleanup verdict. All labels are bounded enums,
 * so the output can never carry a high-cardinality value. The per-state gauge lets an operator
 * alert directly on `pdfxyz_cleanup_check_objects{state="drift"} > 0`.
 */
export function renderCleanupCheckPrometheus(outcome: CleanupCheckOutcome): string {
  if (isCleanupUsageError(outcome)) {
    return `${line("pdfxyz_cleanup_check_error", { kind: "usage" }, 1)}\n`;
  }
  const lines: string[] = [];
  lines.push(line("pdfxyz_cleanup_check_verdict", {}, VERDICT_CODE[outcome.verdict]));
  lines.push(
    line(
      "pdfxyz_cleanup_check_info",
      { verdict: outcome.verdict, provider: outcome.provider },
      1,
    ),
  );
  lines.push(line("pdfxyz_cleanup_check_total", {}, outcome.total));
  lines.push(line("pdfxyz_cleanup_check_reaped", {}, outcome.reaped));
  lines.push(line("pdfxyz_cleanup_check_drift", {}, outcome.drift));
  for (const state of CLEANUP_OBJECT_STATES) {
    lines.push(
      line("pdfxyz_cleanup_check_objects", { state }, outcome.counts[state as CleanupObjectState]),
    );
  }
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 *  Text
 * ------------------------------------------------------------------ */

/** Render a short, content-free human summary. */
export function renderCleanupCheckText(outcome: CleanupCheckOutcome): string {
  if (isCleanupUsageError(outcome)) {
    return `cleanup-check: usage error (${outcome.issues.join(", ")})\n`;
  }
  const lines: string[] = [];
  lines.push(outcome.summary);
  lines.push(
    `  verdict: ${outcome.verdict}  provider: ${outcome.provider}  source: ${outcome.source}`,
  );
  lines.push(
    `  objects: ${outcome.total}  reaped: ${outcome.reaped}  drift: ${outcome.drift}  grace: ${outcome.graceHours}h`,
  );
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 *  Dispatch
 * ------------------------------------------------------------------ */

/** Render `outcome` in the requested `format`. */
export function renderCleanupCheck(
  outcome: CleanupCheckOutcome,
  format: "json" | "prometheus" | "text",
): string {
  switch (format) {
    case "json":
      return renderCleanupCheckJson(outcome);
    case "prometheus":
      return renderCleanupCheckPrometheus(outcome);
    case "text":
      return renderCleanupCheckText(outcome);
  }
}
