/**
 * Pure, node-free **ingest parser** for the operator healthcheck CLI (Phase 31).
 *
 * A monitor rarely runs on the worker host; more often it already HAS a snapshot —
 * scraped from `GET /api/worker/operations` (`{ ok, data: <snapshot> }`), captured
 * from the daemon's content-free `operations` log line, or assembled as
 * `{ operations, metrics }`. This module turns that untrusted JSON into a normalized
 * {@link WorkerOperationsSnapshot} (+ an optional sanitized {@link WorkerMetricsSnapshot}
 * for SLOs) that the alert policy can evaluate.
 *
 * It is the CLI's **trust boundary**, and it is deliberately paranoid about honesty:
 *  - **No-leak by reconstruction.** It NEVER copies a string field out of the input.
 *    Every load-bearing field is validated against a bounded enum; a fresh snapshot is
 *    built from those enums with ALL prose re-authored from the app's own maps. So a
 *    hand-crafted snapshot carrying a filename, endpoint, or secret in a `detail`
 *    field can never reach the CLI's output — the offending string is simply dropped.
 *  - **No fake liveness.** `daemonObserved` is RECOMPUTED as `daemon.state === "observed"`,
 *    never trusted from the input, so a forged `daemonObserved: true` on a `stale`
 *    record cannot survive ingestion.
 *  - **Bounded counts.** Loop counters are coerced to finite, non-negative, safe
 *    integers; anything else is clamped, so a pathological number cannot skew output.
 *
 * Only a handful of fields are load-bearing enough to be fatal when missing/invalid
 * (a snapshot with no `health`, `recommendedAction`, or `daemon.state` cannot be
 * evaluated); everything else degrades to a safe, honest default so the tool stays
 * useful on a minimal snapshot.
 */

import {
  cleanupEvidenceHealth,
  HEALTH_SUMMARY,
  OPERATIONS_SNAPSHOT_VERSION,
  RECOMMENDED_ACTION_DETAIL,
  SUBSYSTEM_LABEL,
  type HealthClass,
  type ProofAvailability,
  type RecommendedAction,
  type SnapshotDaemonLiveness,
  type SnapshotLifecycleVerification,
  type SnapshotLoopOutcome,
  type SnapshotSubsystem,
  type SnapshotSubsystemId,
  type SnapshotVantage,
  type WorkerOperationsSnapshot,
} from "../observability/snapshot";
import {
  CLEANUP_EVIDENCE_AGE_BUCKETS,
  CLEANUP_EVIDENCE_DETAIL,
  CLEANUP_EVIDENCE_FRESHNESS,
  CLEANUP_EVIDENCE_PROVIDERS,
  CLEANUP_EVIDENCE_REASONS,
  CLEANUP_EVIDENCE_REPORT_KINDS,
  CLEANUP_EVIDENCE_STATES,
  DISABLED_CLEANUP_EVIDENCE_POSTURE,
  type CleanupEvidencePosture,
} from "../cleanup-evidence/types";
import {
  createWorkerMetricsCollector,
  type WorkerMetricsSnapshot,
} from "../observability/collector";
import {
  isKnownMetricName,
  sanitizeMetric,
  type MetricKind,
  type WorkerMetricSample,
} from "../observability/metrics";
import type {
  DaemonLivenessState,
  HeartbeatAgeBucket,
  HeartbeatMode,
  HeartbeatSource,
} from "../heartbeat/types";
import type { WorkerMode } from "../mode";
import type { DaemonRunMode, DaemonStopReason } from "../daemon/daemon";
import type { LifecycleVerdict } from "../lifecycle";

/* ------------------------------------------------------------------ *
 *  Bounded enum allowlists (drift-proof via exhaustiveness guards)
 * ------------------------------------------------------------------ */

/** Compile-time assertion that a tuple covers a whole union (`Extra` must be `never`). */
type AssertNever<Extra> = [Extra] extends [never] ? true : false;

const HEALTH_CLASSES = [
  "ok",
  "warn",
  "blocked",
  "unknown",
] as const satisfies readonly HealthClass[];
const _healthExhaustive: AssertNever<
  Exclude<HealthClass, (typeof HEALTH_CLASSES)[number]>
> = true;

const VANTAGES = ["web", "worker"] as const satisfies readonly SnapshotVantage[];
const _vantageExhaustive: AssertNever<
  Exclude<SnapshotVantage, (typeof VANTAGES)[number]>
> = true;

const WORKER_MODES = [
  "disabled",
  "remote-configured",
  "local-dev",
] as const satisfies readonly WorkerMode[];
const _workerModeExhaustive: AssertNever<
  Exclude<WorkerMode, (typeof WORKER_MODES)[number]>
> = true;

const LIVENESS_STATES = [
  "observed",
  "stale",
  "unknown",
  "disabled",
] as const satisfies readonly DaemonLivenessState[];
const _livenessExhaustive: AssertNever<
  Exclude<DaemonLivenessState, (typeof LIVENESS_STATES)[number]>
> = true;

const LIVENESS_SOURCES = [
  "queue-broker",
  "self",
  "none",
] as const satisfies readonly HeartbeatSource[];
const _sourceExhaustive: AssertNever<
  Exclude<HeartbeatSource, (typeof LIVENESS_SOURCES)[number]>
> = true;

const AGE_BUCKETS = [
  "under-30s",
  "under-2m",
  "under-10m",
  "over-10m",
] as const satisfies readonly HeartbeatAgeBucket[];
const _ageExhaustive: AssertNever<
  Exclude<HeartbeatAgeBucket, (typeof AGE_BUCKETS)[number]>
> = true;

const HEARTBEAT_MODES = [
  "starting",
  "loop",
  "drain",
  "once",
  "check",
  "dry-run",
] as const satisfies readonly HeartbeatMode[];
const _heartbeatModeExhaustive: AssertNever<
  Exclude<HeartbeatMode, (typeof HEARTBEAT_MODES)[number]>
> = true;

const SUBSYSTEM_IDS = [
  "drainability",
  "storage",
  "queue",
  "compression-engine",
  "ocr",
  "malware-scan",
  "lifecycle",
  "lifecycle-verification",
  "cleanup-evidence",
  "guardrails",
  "daemon-loop",
] as const satisfies readonly SnapshotSubsystemId[];
const _subsystemExhaustive: AssertNever<
  Exclude<SnapshotSubsystemId, (typeof SUBSYSTEM_IDS)[number]>
> = true;

const PROOF_STATES = [
  "available",
  "unavailable",
  "unknown",
] as const satisfies readonly ProofAvailability[];
const _proofExhaustive: AssertNever<
  Exclude<ProofAvailability, (typeof PROOF_STATES)[number]>
> = true;

const RUN_MODES = ["once", "drain", "loop"] as const satisfies readonly DaemonRunMode[];
const _runModeExhaustive: AssertNever<
  Exclude<DaemonRunMode, (typeof RUN_MODES)[number]>
> = true;

const STOP_REASONS = [
  "once",
  "drained",
  "max_ticks",
  "stopped",
  "queue_error",
] as const satisfies readonly DaemonStopReason[];
const _stopReasonExhaustive: AssertNever<
  Exclude<DaemonStopReason, (typeof STOP_REASONS)[number]>
> = true;

/** Verdict values a lifecycle-verification rung can carry (`verified`/`drift`/`unknown`). */
const LIFECYCLE_VERDICTS = ["verified", "drift", "unknown"] as const satisfies readonly (
  | LifecycleVerdict
  | "unknown"
)[];
const _verdictExhaustive: AssertNever<
  Exclude<LifecycleVerdict | "unknown", (typeof LIFECYCLE_VERDICTS)[number]>
> = true;

// Reference the exhaustiveness guards so lint never flags them as unused; they exist
// only to fail the build if an upstream enum grows a member this validator would then
// silently reject.
void _healthExhaustive;
void _vantageExhaustive;
void _workerModeExhaustive;
void _livenessExhaustive;
void _sourceExhaustive;
void _ageExhaustive;
void _heartbeatModeExhaustive;
void _subsystemExhaustive;
void _proofExhaustive;
void _runModeExhaustive;
void _stopReasonExhaustive;
void _verdictExhaustive;

/** RecommendedAction values, derived from the detail map so this can never drift. */
const RECOMMENDED_ACTIONS = new Set<string>(Object.keys(RECOMMENDED_ACTION_DETAIL));

/* ------------------------------------------------------------------ *
 *  Small typed readers over untrusted `unknown`
 * ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A finite, non-negative, safe integer, or `0`. Bounds a pathological ingested count. */
function safeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const n = Math.floor(value);
  if (n < 0) return 0;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

/* ------------------------------------------------------------------ *
 *  Result type
 * ------------------------------------------------------------------ */

/** The normalized ingest result: a safe snapshot and (optionally) metrics for SLOs. */
export interface IngestedOperations {
  readonly snapshot: WorkerOperationsSnapshot;
  /** A sanitized metrics snapshot for SLO evaluation, or `null` when none was supplied. */
  readonly metrics: WorkerMetricsSnapshot | null;
}

/** The outcome of parsing ingest text. Issue codes are content-free and bounded. */
export type ParseIngestResult =
  | { readonly ok: true; readonly value: IngestedOperations }
  | { readonly ok: false; readonly issues: string[] };

/* ------------------------------------------------------------------ *
 *  Prose re-authoring (never echoes ingested strings)
 * ------------------------------------------------------------------ */

const LIVENESS_DETAIL: Record<DaemonLivenessState, string> = {
  observed:
    "A worker daemon published a liveness heartbeat within the freshness window.",
  stale: "A worker heartbeat is present but older than the freshness window.",
  unknown: "Liveness observation is enabled, but no recent heartbeat is visible.",
  disabled:
    "Cross-process worker liveness observation is not enabled here, so absence says nothing.",
};

function subsystemDetail(id: SnapshotSubsystemId, health: HealthClass): string {
  const word =
    health === "ok"
      ? "is healthy"
      : health === "warn"
        ? "is degraded"
        : health === "blocked"
          ? "is blocking"
          : "is not observable here";
  return `${SUBSYSTEM_LABEL[id]} ${word}.`;
}

/* ------------------------------------------------------------------ *
 *  Field-level normalizers
 * ------------------------------------------------------------------ */

function normalizeDaemon(raw: unknown): SnapshotDaemonLiveness | undefined {
  if (!isObject(raw)) return undefined;
  const state = oneOf(raw.state, LIVENESS_STATES);
  if (!state) return undefined; // load-bearing: cannot classify liveness without it
  return {
    state,
    source: oneOf(raw.source, LIVENESS_SOURCES) ?? "none",
    lastSeen: oneOf(raw.lastSeen, AGE_BUCKETS) ?? null,
    mode: oneOf(raw.mode, HEARTBEAT_MODES) ?? null,
    detail: LIVENESS_DETAIL[state],
  };
}

function normalizeSubsystems(raw: unknown): SnapshotSubsystem[] {
  if (!Array.isArray(raw)) return [];
  const out: SnapshotSubsystem[] = [];
  const seen = new Set<SnapshotSubsystemId>();
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const id = oneOf(entry.id, SUBSYSTEM_IDS);
    const health = oneOf(entry.health, HEALTH_CLASSES);
    if (!id || !health || seen.has(id)) continue; // drop unknown / duplicate ids
    seen.add(id);
    out.push({ id, label: SUBSYSTEM_LABEL[id], health, detail: subsystemDetail(id, health) });
  }
  return out;
}

function normalizeLifecycleVerification(raw: unknown): SnapshotLifecycleVerification {
  const verdict = isObject(raw)
    ? (oneOf(raw.verdict, LIFECYCLE_VERDICTS) ?? "unknown")
    : "unknown";
  const health = isObject(raw)
    ? (oneOf(raw.health, HEALTH_CLASSES) ?? "unknown")
    : "unknown";
  const known = verdict !== "unknown";
  return {
    known,
    verdict,
    health,
    detail: known
      ? verdict === "verified"
        ? "A supplied observed configuration verifies the retention backstop."
        : "A supplied observed configuration shows retention-backstop drift."
      : "The retention backstop has not been checked against observed evidence here.",
  };
}

function normalizeLastLoop(raw: unknown): SnapshotLoopOutcome | null {
  if (!isObject(raw)) return null;
  const mode = oneOf(raw.mode, RUN_MODES);
  const reason = oneOf(raw.reason, STOP_REASONS);
  const health = oneOf(raw.health, HEALTH_CLASSES);
  if (!mode || !reason || !health) return null; // malformed loop → drop, never guess
  return {
    mode,
    reason,
    ticks: safeCount(raw.ticks),
    completed: safeCount(raw.completed),
    failed: safeCount(raw.failed),
    requeued: safeCount(raw.requeued),
    canceled: safeCount(raw.canceled),
    idle: safeCount(raw.idle),
    errors: safeCount(raw.errors),
    health,
  };
}

function normalizeProofs(raw: unknown): { compressionDeep: ProofAvailability; ocr: ProofAvailability } {
  const obj = isObject(raw) ? raw : {};
  return {
    compressionDeep: oneOf(obj.compressionDeep, PROOF_STATES) ?? "unknown",
    ocr: oneOf(obj.ocr, PROOF_STATES) ?? "unknown",
  };
}

/**
 * Rebuild a content-free {@link CleanupEvidencePosture} from an untrusted value (Phase 44). Each
 * field is validated against its bounded enum and defaulted safely; the detail is RE-AUTHORED from
 * {@link CLEANUP_EVIDENCE_DETAIL} by the resolved reason — never copied from the input — so a
 * hand-crafted posture carrying a path, key, or secret in its `detail` cannot survive ingestion.
 * A missing/garbage field yields the honest `disabled` default rather than a fabricated posture.
 */
function normalizeCleanupEvidence(raw: unknown): CleanupEvidencePosture {
  if (!isObject(raw)) return DISABLED_CLEANUP_EVIDENCE_POSTURE;
  const reason = oneOf(raw.reason, CLEANUP_EVIDENCE_REASONS) ?? "no_report_configured";
  return {
    state: oneOf(raw.state, CLEANUP_EVIDENCE_STATES) ?? "disabled",
    reason,
    provider: oneOf(raw.provider, CLEANUP_EVIDENCE_PROVIDERS) ?? "unknown",
    freshness: oneOf(raw.freshness, CLEANUP_EVIDENCE_FRESHNESS) ?? "unknown",
    age: oneOf(raw.age, CLEANUP_EVIDENCE_AGE_BUCKETS) ?? "unknown",
    reportKind: oneOf(raw.reportKind, CLEANUP_EVIDENCE_REPORT_KINDS) ?? "none",
    detail: CLEANUP_EVIDENCE_DETAIL[reason],
  };
}

/* ------------------------------------------------------------------ *
 *  Snapshot + metrics ingestion
 * ------------------------------------------------------------------ */

/**
 * Validate + normalize an untrusted value into a {@link WorkerOperationsSnapshot}, or
 * a list of content-free issue codes. All prose is re-authored; `daemonObserved` is
 * recomputed. Fatal only when a field the alert policy cannot work without is
 * missing/invalid.
 */
export function normalizeOperationsSnapshot(
  raw: unknown,
): { ok: true; snapshot: WorkerOperationsSnapshot } | { ok: false; issues: string[] } {
  if (!isObject(raw)) return { ok: false, issues: ["snapshot-not-an-object"] };

  const issues: string[] = [];
  const health = oneOf(raw.health, HEALTH_CLASSES);
  if (!health) issues.push("invalid-or-missing-health");

  const action =
    typeof raw.recommendedAction === "string" &&
    RECOMMENDED_ACTIONS.has(raw.recommendedAction)
      ? (raw.recommendedAction as RecommendedAction)
      : undefined;
  if (!action) issues.push("invalid-or-missing-recommended-action");

  const daemon = normalizeDaemon(raw.daemon);
  if (!daemon) issues.push("invalid-or-missing-daemon-liveness");

  if (!health || !action || !daemon) return { ok: false, issues };

  const lifecycleVerification = normalizeLifecycleVerification(raw.lifecycleVerification);
  const cleanupEvidence = normalizeCleanupEvidence(raw.cleanupEvidence);
  // Derive the cleanup-evidence subsystem from the normalized posture (health from state) and
  // ensure it is present regardless of what the input's `subsystems` array carried — so a
  // monitor-supplied snapshot's alert severity / exit code always reflects cleanup evidence,
  // even if the input omitted or forged the subsystem entry.
  const cleanupEvidenceHealthClass = cleanupEvidenceHealth(cleanupEvidence.state);
  const subsystems = normalizeSubsystems(raw.subsystems).filter(
    (s) => s.id !== "cleanup-evidence",
  );
  subsystems.push({
    id: "cleanup-evidence",
    label: SUBSYSTEM_LABEL["cleanup-evidence"],
    health: cleanupEvidenceHealthClass,
    detail: subsystemDetail("cleanup-evidence", cleanupEvidenceHealthClass),
  });

  const snapshot: WorkerOperationsSnapshot = {
    version: OPERATIONS_SNAPSHOT_VERSION,
    vantage: oneOf(raw.vantage, VANTAGES) ?? "web",
    mode: oneOf(raw.mode, WORKER_MODES) ?? "remote-configured",
    drainable: raw.drainable === true,
    // Recomputed, never trusted: liveness is observed iff the heartbeat state says so.
    daemonObserved: daemon.state === "observed",
    daemon,
    health,
    detail: `${HEALTH_SUMMARY[health]}. ${RECOMMENDED_ACTION_DETAIL[action]}`,
    recommendedAction: action,
    recommendedActionDetail: RECOMMENDED_ACTION_DETAIL[action],
    subsystems,
    proofs: normalizeProofs(raw.proofs),
    lifecycleVerification,
    cleanupEvidence,
    lastLoop: normalizeLastLoop(raw.lastLoop),
  };
  return { ok: true, snapshot };
}

/**
 * Sanitize an untrusted `metrics.series` array into a content-free
 * {@link WorkerMetricsSnapshot}, or `null` when none/empty. Every entry is coerced to
 * a {@link WorkerMetricSample} shape and passed through {@link sanitizeMetric}, so an
 * off-schema, high-cardinality, or content-bearing series is dropped — never
 * aggregated. Re-folding through the collector re-sorts deterministically.
 */
export function normalizeMetrics(raw: unknown): WorkerMetricsSnapshot | null {
  if (!isObject(raw)) return null;
  const series = raw.series;
  if (!Array.isArray(series) || series.length === 0) return null;
  const collector = createWorkerMetricsCollector();
  let accepted = 0;
  for (const entry of series) {
    if (!isObject(entry)) continue;
    const { metric, kind, labels, value } = entry;
    if (!isKnownMetricName(metric)) continue;
    if (typeof kind !== "string") continue;
    if (typeof value !== "number") continue;
    if (!isObject(labels)) continue;
    // Only string→string labels; sanitizeMetric enforces the closed enum sets.
    const stringLabels: Record<string, string> = {};
    for (const [k, v] of Object.entries(labels)) {
      if (typeof v === "string") stringLabels[k] = v;
    }
    const sample: WorkerMetricSample = {
      metric,
      kind: kind as MetricKind,
      labels: stringLabels,
      value,
    };
    const clean = sanitizeMetric(sample);
    if (clean) {
      collector.record(clean);
      accepted += 1;
    }
  }
  return accepted > 0 ? collector.snapshot() : null;
}

/** Unwrap the snapshot from a bare object, an API `{ data }`, or an `{ operations }` envelope. */
function unwrapSnapshotSource(root: Obj): unknown {
  if (isObject(root.data)) return root.data; // GET /api/worker/operations envelope
  if (isObject(root.operations)) return root.operations; // { operations, metrics }
  if (isObject(root.snapshot)) return root.snapshot; // { snapshot, metrics }
  return root; // a bare snapshot
}

/**
 * Parse ingest text (file or stdin) into a normalized snapshot (+ optional metrics).
 * Accepts a bare snapshot, the `GET /api/worker/operations` envelope (`{ data }`), or
 * an assembled `{ operations|snapshot, metrics }` object. Never throws; a JSON or
 * validation failure returns content-free issue codes for a clean usage-error exit.
 */
export function parseIngestedOperations(text: string): ParseIngestResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["invalid-json"] };
  }
  if (!isObject(root)) return { ok: false, issues: ["input-not-an-object"] };

  const snapshotResult = normalizeOperationsSnapshot(unwrapSnapshotSource(root));
  if (!snapshotResult.ok) return snapshotResult;

  // Metrics may sit at the envelope root; a bare snapshot carries none.
  const metrics = normalizeMetrics(root.metrics);
  return { ok: true, value: { snapshot: snapshotResult.snapshot, metrics } };
}
