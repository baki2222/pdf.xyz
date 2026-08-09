/**
 * The node-free **orchestrator** for the operator healthcheck CLI (Phase 31).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real
 * Node entry (`scripts/worker-ops-check.ts`) is a thin shell: it resolves the runtime,
 * reads the heartbeat, and reads stdin/files, then hands those capabilities here. That
 * keeps every branch — each source, the alert mapping, the exit-code policy, ingest
 * failures, and every output format — unit-testable without a runtime, a broker, a
 * native binary, or a filesystem.
 *
 * Honesty flows straight through: the snapshot it evaluates is either the daemon's own
 * content-free runtime evidence (with heartbeat-driven, never self-asserted liveness)
 * or a validated, re-authored ingested snapshot; the alert policy adds nothing that is
 * not a bounded enum; and the exit code is the documented Phase 31 ladder
 * (0 ok / 1 usage / 2 unknown / 3 warn / 4 critical).
 */

import { evaluateSlos } from "../observability/slo";
import {
  evaluateOperationsAlerts,
  exitCodeForSeverity,
  OPS_CHECK_EXIT,
} from "../observability/alerts";
import type { OpsCheckArgs, OpsCheckSource } from "./args";
import type { CollectedOperations } from "./collect";
import { parseIngestedOperations } from "./ingest";
import {
  OPS_CHECK_SCHEMA,
  renderOpsCheck,
  type OpsCheckOutcome,
  type OpsCheckResult,
  type OpsCheckSloDigest,
  type OpsCheckUsageError,
} from "./render";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 * `collectLive` resolves the live snapshot for `runtime`/`web`; `readInput` reads the
 * raw ingest text for `stdin`/`file`; `now` stamps the result (a wall clock is the one
 * unavoidable side effect, kept behind a seam so tests are deterministic).
 */
export interface OpsCheckProvider {
  collectLive(source: "runtime" | "web"): Promise<CollectedOperations>;
  readInput(source: "stdin" | "file", filePath: string | undefined): Promise<string>;
  now(): string;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface OpsCheckRun {
  readonly exitCode: number;
  readonly output: string;
  readonly outcome: OpsCheckOutcome;
}

/** Build the content-free SLO digest for the result. */
function sloDigest(collected: CollectedOperations): OpsCheckSloDigest | null {
  if (!collected.slo) return null;
  const { slos, worst } = collected.slo;
  return {
    worst,
    evaluated: slos.filter((s) => s.status !== "unknown").length,
    total: slos.length,
    issues: slos
      .filter((s) => s.status === "warn" || s.status === "breach")
      .map((s) => ({
        id: s.id,
        status: s.status,
        observed: s.observed,
        threshold: s.threshold,
      })),
  };
}

/** Assemble the structured, content-free result from a collected snapshot + alert report. */
function buildResult(
  source: OpsCheckSource,
  generatedAt: string,
  collected: CollectedOperations,
): OpsCheckResult {
  const { snapshot, slo } = collected;
  const report = evaluateOperationsAlerts(snapshot, slo ?? undefined);
  const exitCode = exitCodeForSeverity(report.severity);
  return {
    schema: OPS_CHECK_SCHEMA,
    generatedAt,
    source,
    ok: report.severity === "ok",
    severity: report.severity,
    exitCode,
    action: report.action,
    actionDetail: report.actionDetail,
    summary: report.summary,
    liveness: {
      ...report.liveness,
      source: snapshot.daemon.source,
      lastSeen: snapshot.daemon.lastSeen,
    },
    snapshot: {
      vantage: snapshot.vantage,
      health: snapshot.health,
      drainable: snapshot.drainable,
      daemonObserved: snapshot.daemonObserved,
      subsystems: snapshot.subsystems.map((s) => ({ id: s.id, health: s.health })),
      proofs: {
        compressionDeep: snapshot.proofs.compressionDeep,
        ocr: snapshot.proofs.ocr,
      },
      cleanupEvidence: {
        state: snapshot.cleanupEvidence.state,
        reason: snapshot.cleanupEvidence.reason,
        provider: snapshot.cleanupEvidence.provider,
        freshness: snapshot.cleanupEvidence.freshness,
      },
      rateLimit: {
        code: snapshot.rateLimit.code,
        enforced: snapshot.rateLimit.enforced,
        distributed: snapshot.rateLimit.distributed,
      },
      lastLoop: snapshot.lastLoop,
    },
    slo: sloDigest(collected),
    alerts: report.alerts,
  };
}

/** Build a content-free usage-error outcome (bad ingest input; exit 1). */
function usageError(
  source: OpsCheckSource,
  generatedAt: string,
  issues: string[],
): OpsCheckUsageError {
  return {
    schema: OPS_CHECK_SCHEMA,
    generatedAt,
    source,
    ok: false,
    error: "usage",
    exitCode: OPS_CHECK_EXIT.USAGE,
    issues,
    detail:
      "The supplied operations snapshot could not be read or validated. Provide a bare snapshot, the GET /api/worker/operations envelope, or { operations, metrics }.",
  };
}

/**
 * Read + validate an ingested snapshot (stdin/file). A read failure or a validation
 * failure becomes a content-free usage error (exit 1) — never a crash, and never an
 * echo of the offending input. On success, SLOs are computed locally from any supplied
 * (already-sanitized) metric series, so no ingested SLO verdict is ever trusted.
 */
async function ingest(
  source: "stdin" | "file",
  filePath: string | undefined,
  provider: OpsCheckProvider,
  generatedAt: string,
): Promise<{ ok: true; collected: CollectedOperations } | { ok: false; error: OpsCheckUsageError }> {
  let text: string;
  try {
    text = await provider.readInput(source, filePath);
  } catch {
    return { ok: false, error: usageError(source, generatedAt, ["input-unreadable"]) };
  }
  const parsed = parseIngestedOperations(text);
  if (!parsed.ok) {
    return { ok: false, error: usageError(source, generatedAt, parsed.issues) };
  }
  const { snapshot, metrics } = parsed.value;
  return {
    ok: true,
    collected: {
      snapshot,
      slo: metrics ? evaluateSlos(metrics) : null,
      metrics,
    },
  };
}

/**
 * Run the healthcheck for validated `args` using the injected `provider`. Never throws
 * on an operational or input problem — those become a structured outcome + exit code;
 * only a genuine internal fault (a `collectLive` seam crash) propagates, to be caught
 * by the entry's top-level handler exactly like the daemon.
 */
export async function runOpsCheck(
  args: OpsCheckArgs,
  provider: OpsCheckProvider,
): Promise<OpsCheckRun> {
  const generatedAt = provider.now();

  let outcome: OpsCheckOutcome;
  let metricsForRender: CollectedOperations["metrics"] = null;

  if (args.source === "stdin" || args.source === "file") {
    const result = await ingest(args.source, args.filePath, provider, generatedAt);
    if (!result.ok) {
      outcome = result.error;
    } else {
      metricsForRender = result.collected.metrics;
      outcome = buildResult(args.source, generatedAt, result.collected);
    }
  } else {
    const collected = await provider.collectLive(args.source);
    metricsForRender = collected.metrics;
    outcome = buildResult(args.source, generatedAt, collected);
  }

  const output = renderOpsCheck(outcome, args.format, metricsForRender);
  return { exitCode: outcome.exitCode, output, outcome };
}
