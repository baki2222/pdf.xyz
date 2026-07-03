/**
 * Pure, node-free **renderers** for the operator healthcheck CLI (Phase 31), plus the
 * stable structured {@link OpsCheckResult} contract a monitor parses.
 *
 * The result is content-free by construction: every field is a bounded enum, a
 * boolean, a small integer count, or prose authored by the alert policy / SLO helpers
 * — never a string copied out of an ingested snapshot. The three formats are all
 * derived from that one object, so they can never disagree:
 *  - `--json`       — the `OpsCheckResult` verbatim (a monitor parses it).
 *  - `--prometheus` — content-free gauges for a scrape (reusing the existing
 *    {@link renderPrometheus} for any metric series behind the SLOs).
 *  - `--text`       — a short human summary for a terminal / log line.
 */

import type { OpsCheckSource } from "./args";
import {
  renderPrometheus,
  type WorkerMetricsSnapshot,
} from "../observability/collector";
import type {
  Alert,
  AlertSeverity,
  LivenessAlert,
} from "../observability/alerts";
import type {
  HealthClass,
  ProofAvailability,
  RecommendedAction,
  SnapshotLoopOutcome,
  SnapshotSubsystemId,
  SnapshotVantage,
} from "../observability/snapshot";
import type { SloId, SloStatus } from "../observability/slo";
import type { HeartbeatAgeBucket, HeartbeatSource } from "../heartbeat/types";

/** The schema tag every result carries, so a monitor can pin the shape it parses. */
export const OPS_CHECK_SCHEMA = "pdfxyz.ops-check/1" as const;

/** The liveness headline, enriched with the heartbeat's safe source + coarse age. */
export interface OpsCheckLiveness extends LivenessAlert {
  readonly source: HeartbeatSource;
  readonly lastSeen: HeartbeatAgeBucket | null;
}

/** A content-free digest of the operations snapshot (enums / booleans / counts only). */
export interface OpsCheckSnapshotDigest {
  readonly vantage: SnapshotVantage;
  readonly health: HealthClass;
  readonly drainable: boolean;
  readonly daemonObserved: boolean;
  readonly subsystems: { readonly id: SnapshotSubsystemId; readonly health: HealthClass }[];
  readonly proofs: { readonly compressionDeep: ProofAvailability; readonly ocr: ProofAvailability };
  readonly lastLoop: SnapshotLoopOutcome | null;
}

/** A content-free digest of the SLO report. */
export interface OpsCheckSloDigest {
  readonly worst: SloStatus;
  /** Indicators with enough data to judge (non-`unknown`). */
  readonly evaluated: number;
  /** Total indicators considered. */
  readonly total: number;
  /** Only the warned/breached indicators, with their content-free observed/threshold. */
  readonly issues: {
    readonly id: SloId;
    readonly status: SloStatus;
    readonly observed: string;
    readonly threshold: string;
  }[];
}

/** The stable, content-free structured result the CLI emits (and a monitor parses). */
export interface OpsCheckResult {
  readonly schema: typeof OPS_CHECK_SCHEMA;
  readonly generatedAt: string;
  readonly source: OpsCheckSource;
  /** True iff the overall severity is `ok`. */
  readonly ok: boolean;
  readonly severity: AlertSeverity;
  readonly exitCode: number;
  readonly action: RecommendedAction;
  readonly actionDetail: string;
  readonly summary: string;
  readonly liveness: OpsCheckLiveness;
  readonly snapshot: OpsCheckSnapshotDigest;
  readonly slo: OpsCheckSloDigest | null;
  readonly alerts: Alert[];
}

/** The result when the CLI's INPUT was unusable (bad flag handled earlier; bad ingest here). */
export interface OpsCheckUsageError {
  readonly schema: typeof OPS_CHECK_SCHEMA;
  readonly generatedAt: string;
  readonly source: OpsCheckSource;
  readonly ok: false;
  readonly error: "usage";
  /** The documented usage/malformed-input exit code (see OPS_CHECK_EXIT.USAGE). */
  readonly exitCode: 1;
  /** Content-free issue codes explaining why the input was rejected. */
  readonly issues: string[];
  readonly detail: string;
}

/** Either a full evaluation or a usage error — both are rendered by {@link renderOpsCheck}. */
export type OpsCheckOutcome = OpsCheckResult | OpsCheckUsageError;

/** Distinguish the two outcomes without a cast. */
export function isUsageError(outcome: OpsCheckOutcome): outcome is OpsCheckUsageError {
  return (outcome as OpsCheckUsageError).error === "usage";
}

/* ------------------------------------------------------------------ *
 *  JSON
 * ------------------------------------------------------------------ */

/** Render the outcome as stable, pretty JSON (a trailing newline for clean piping). */
export function renderOpsCheckJson(outcome: OpsCheckOutcome): string {
  return `${JSON.stringify(outcome, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 *  Prometheus
 * ------------------------------------------------------------------ */

/** A scrapeable numeric per severity (distinct from the fold rank: `unknown` is 3 here). */
const SEVERITY_CODE: Record<AlertSeverity, number> = {
  ok: 0,
  warn: 1,
  critical: 2,
  unknown: 3,
};

/** Project a subsystem health class onto the same numeric ladder. */
function healthCode(health: HealthClass): number {
  switch (health) {
    case "ok":
      return 0;
    case "warn":
      return 1;
    case "blocked":
      return 2;
    case "unknown":
      return 3;
  }
}

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
 * Render content-free Prometheus gauges for the ops-check verdict, plus the existing
 * metric-series exposition ({@link renderPrometheus}) when a series is available. All
 * labels are bounded enums, so the output can never carry a high-cardinality value.
 */
export function renderOpsCheckPrometheus(
  outcome: OpsCheckOutcome,
  metrics: WorkerMetricsSnapshot | null = null,
): string {
  if (isUsageError(outcome)) {
    return `${line("pdfxyz_ops_check_error", { kind: "usage" }, 1)}\n`;
  }
  const lines: string[] = [];
  lines.push(line("pdfxyz_ops_check_severity", {}, SEVERITY_CODE[outcome.severity]));
  lines.push(
    line(
      "pdfxyz_ops_check_info",
      {
        severity: outcome.severity,
        vantage: outcome.snapshot.vantage,
        health: outcome.snapshot.health,
        action: outcome.action,
        liveness: outcome.liveness.state,
        source: outcome.liveness.source,
      },
      1,
    ),
  );
  lines.push(
    line("pdfxyz_ops_check_daemon_observed", {}, outcome.snapshot.daemonObserved ? 1 : 0),
  );
  lines.push(line("pdfxyz_ops_check_drainable", {}, outcome.snapshot.drainable ? 1 : 0));
  lines.push(line("pdfxyz_ops_check_alerts", {}, outcome.alerts.length));
  for (const sub of outcome.snapshot.subsystems) {
    lines.push(
      line("pdfxyz_ops_check_subsystem", { subsystem: sub.id, health: sub.health }, healthCode(sub.health)),
    );
  }
  // Reuse the shipped metric-series renderer for any series behind the SLOs.
  const series = metrics ? renderPrometheus(metrics) : "";
  if (series) lines.push(series);
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 *  Text
 * ------------------------------------------------------------------ */

/** Render a short, content-free human summary. */
export function renderOpsCheckText(outcome: OpsCheckOutcome): string {
  if (isUsageError(outcome)) {
    return `ops-check: usage error (${outcome.issues.join(", ")})\n`;
  }
  const lines: string[] = [];
  lines.push(`${outcome.summary}`);
  lines.push(`  source: ${outcome.source}  vantage: ${outcome.snapshot.vantage}  liveness: ${outcome.liveness.state}`);
  lines.push(`  action: ${outcome.action} — ${outcome.actionDetail}`);
  for (const alert of outcome.alerts) {
    const suffix = alert.observed ? ` (${alert.observed} vs ${alert.threshold})` : "";
    lines.push(`  [${alert.severity}] ${alert.source}: ${alert.reason}${suffix}`);
  }
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 *  Dispatch
 * ------------------------------------------------------------------ */

/** Render `outcome` in the requested `format`. */
export function renderOpsCheck(
  outcome: OpsCheckOutcome,
  format: "json" | "prometheus" | "text",
  metrics: WorkerMetricsSnapshot | null = null,
): string {
  switch (format) {
    case "json":
      return renderOpsCheckJson(outcome);
    case "prometheus":
      return renderOpsCheckPrometheus(outcome, metrics);
    case "text":
      return renderOpsCheckText(outcome);
  }
}
