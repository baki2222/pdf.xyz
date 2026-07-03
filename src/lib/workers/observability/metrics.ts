/**
 * The content-free **worker metric/event schema** for the secure-worker system —
 * the observability counterpart to the client-side product-event schema in
 * `@/lib/telemetry/events`, but for the out-of-band worker path (queue, executor,
 * scanner, engines, lifecycle) rather than the browser.
 *
 * This layer exists so a deployment can answer operational questions — "what is
 * the job success rate?", "is the queue backing up?", "how often is the scanner
 * unavailable?", "did the lifecycle backstop drift?" — while upholding the SAME
 * no-document-content promise the rest of the worker layer does. It is privacy-safe
 * **by construction**, exactly like the product-event schema:
 *
 *  - Every metric is one of a fixed, low-cardinality set of names ({@link WorkerMetricName}).
 *  - Every label is a **bounded enum** — a run mode, an outcome, a verdict, a facet
 *    id, a coarse bucket. Never a filename, object key, Redis key, signed URL, env
 *    name/value, host, port, temp/binary path, malware signature, recognized text,
 *    or any user/device/job identifier.
 *  - Every numeric dimension (latency, queue depth, queue age) is **coarse-bucketed
 *    at the point of construction** — the raw measurement becomes a bucket *label*
 *    and is then discarded, so a raw duration/size can never even become a field
 *    (mirroring `@/lib/telemetry/buckets`). Metric *values* are only counts (`1` for
 *    a counter/histogram observation) or a presence flag (`1` for a gauge), never a
 *    raw measurement.
 *  - {@link sanitizeMetric} still scrubs every label through the shared telemetry
 *    redactor as defense in depth, so a careless future label can never leak.
 *
 * The module is a pure, node-free leaf (data + tiny functions, no I/O, no clock, no
 * Node built-in), so it composes into the executor, daemon, CLI, and any status
 * surface, and every rule is deterministically unit-testable. Builders construct
 * samples with type-checked bounded params; {@link METRIC_SCHEMA} is the machine-
 * readable allowlist the collector, the SLO helpers, the dashboard/alert example
 * validators, and the schema tests all share as the single source of truth.
 */

import { redactText } from "@/lib/telemetry/redact";
import type { DaemonRunMode, DaemonStopReason } from "../daemon/daemon";
import type { ExecutorOutcome } from "../executor/types";
import type { MalwareScanVerdict } from "../scanner/types";
import {
  SOUNDNESS_REASONS,
  SOUNDNESS_VERDICTS,
  type SoundnessReason,
  type SoundnessVerdict,
} from "../soundness/types";
import {
  ARTIFACT_OUTPUT_KINDS,
  ARTIFACT_REASONS,
  ARTIFACT_VERDICTS,
  type ArtifactOutputKind,
  type ArtifactReason,
  type ArtifactVerdict,
} from "../artifacts/types";
import {
  ARTIFACT_ACCESS_REASONS,
  ARTIFACT_RETRIEVAL_OUTCOMES,
  RETRIEVAL_STORAGE_PROVIDERS,
  type ArtifactAccessReason,
  type ArtifactRetrievalOutcome,
  type RetrievalStorageProvider,
} from "../artifacts/access";
import {
  ARTIFACT_DELIVERY_OUTCOMES,
  ARTIFACT_DELIVERY_REASONS,
  type ArtifactDeliveryOutcome,
  type ArtifactDeliveryReason,
} from "../artifacts/delivery";
import type { FacetId, FacetState } from "../deploy/readiness";

/* ------------------------------------------------------------------ *
 *  Bounded label vocabularies
 *
 *  Locally-owned enums are declared as `const` tuples so both the type and the
 *  runtime allowlist come from one place. Enums that are OWNED by another worker
 *  module (executor outcome, scan verdict, daemon run mode, facet id/state) are
 *  re-declared here as tuples pinned to the upstream union with `satisfies` PLUS an
 *  exhaustiveness guard, so if the upstream union gains or drops a member this file
 *  fails to type-check rather than silently emitting an unlisted label.
 * ------------------------------------------------------------------ */

/** Compile-time assertion that `Extra` is empty — i.e. a tuple covers a whole union. */
type AssertNever<Extra> = [Extra] extends [never] ? true : false;

/** The coarse kind of a metric, mirroring the OpenTelemetry/Prometheus split. */
export type MetricKind = "counter" | "gauge" | "histogram";

/** The processor family a job ran on. `other` keeps the label bounded as tools grow. */
export const PROCESSOR_KINDS = ["compress", "ocr", "other"] as const;
export type ProcessorKind = (typeof PROCESSOR_KINDS)[number];

/** A processor run's terminal disposition (the executor's view at the processor boundary). */
export const PROCESSOR_OUTCOMES = [
  "completed",
  "failed",
  "requeued",
  "canceled",
] as const;
export type ProcessorOutcome = (typeof PROCESSOR_OUTCOMES)[number];

/** The result of a single queue claim attempt. */
export const CLAIM_RESULTS = ["claimed", "empty", "error"] as const;
export type ClaimResult = (typeof CLAIM_RESULTS)[number];

/** A worker-side storage operation kind. */
export const STORAGE_OPS = ["read", "write", "delete"] as const;
export type StorageOp = (typeof STORAGE_OPS)[number];

/** The outcome of a storage operation. `missing` is a read that found nothing (expired object). */
export const STORAGE_RESULTS = ["success", "failure", "missing"] as const;
export type StorageResult = (typeof STORAGE_RESULTS)[number];

/** A job's terminal outcome category. */
export const TERMINAL_OUTCOMES = ["completed", "failed", "canceled"] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

/**
 * A coarse, bounded failure class for a terminal job failure — derived from the
 * typed {@link import("@/lib/jobs").JobError} code, never the raw message. `none`
 * is used for non-failure terminal outcomes so the label space stays closed.
 */
export const FAILURE_CLASSES = [
  "none",
  "blocked", // malware_detected / scan_invalid — blocked before processing
  "unsound", // unsound_input — the file-soundness preflight rejected it before processing
  "artifact", // artifact_invalid — the artifact-manifest gate rejected the output before publication
  "scan_unavailable", // the scan could not complete (retryable, then exhausted)
  "input_missing", // an input object was gone (not_found)
  "unsupported", // no processor / not_implemented for the tool
  "processing_error", // the processor failed on valid input
  "other", // any other typed code
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** The engine/gate capability a readiness gauge reports presence for. */
export const ENGINE_CAPABILITIES = [
  "compression_lossless",
  "compression_deep",
  "ocr",
  "scanner",
] as const;
export type EngineCapability = (typeof ENGINE_CAPABILITIES)[number];

/** A stringified boolean label (metric labels are always strings). */
export const BOOL_LABELS = ["true", "false"] as const;
export type BoolLabel = (typeof BOOL_LABELS)[number];

/** The lifecycle-verification verdict, extended with the daemon's honest non-run states. */
export const LIFECYCLE_VERDICTS = [
  "verified",
  "drift",
  "unknown", // no observed document supplied — nothing to verify
  "malformed", // the observed document could not be parsed
] as const;
export type LifecycleMetricVerdict = (typeof LIFECYCLE_VERDICTS)[number];

// ── Enums owned elsewhere: pinned tuples + exhaustiveness guards ──

/** Daemon run modes ({@link DaemonRunMode}). */
export const RUN_MODES = ["once", "drain", "loop"] as const satisfies readonly DaemonRunMode[];
const _runModesExhaustive: AssertNever<
  Exclude<DaemonRunMode, (typeof RUN_MODES)[number]>
> = true;

/** Daemon stop reasons ({@link DaemonStopReason}). */
export const RUN_REASONS = [
  "once",
  "drained",
  "max_ticks",
  "stopped",
  "queue_error",
] as const satisfies readonly DaemonStopReason[];
const _runReasonsExhaustive: AssertNever<
  Exclude<DaemonStopReason, (typeof RUN_REASONS)[number]>
> = true;

/** Executor per-tick outcomes ({@link ExecutorOutcome}). */
export const TICK_OUTCOMES = [
  "idle",
  "completed",
  "failed",
  "requeued",
  "canceled",
  "error",
] as const satisfies readonly ExecutorOutcome[];
const _tickOutcomesExhaustive: AssertNever<
  Exclude<ExecutorOutcome, (typeof TICK_OUTCOMES)[number]>
> = true;

/** Malware-scan verdicts ({@link MalwareScanVerdict}). */
export const SCAN_VERDICTS = [
  "clean",
  "infected",
  "error",
  "invalid",
  "skipped",
] as const satisfies readonly MalwareScanVerdict[];
const _scanVerdictsExhaustive: AssertNever<
  Exclude<MalwareScanVerdict, (typeof SCAN_VERDICTS)[number]>
> = true;

/** Deployment facet ids ({@link FacetId}). */
export const READINESS_FACETS = [
  "storage",
  "queue",
  "engine",
  "lifecycle",
  "malware-scan",
  "ocr",
] as const satisfies readonly FacetId[];
const _facetsExhaustive: AssertNever<
  Exclude<FacetId, (typeof READINESS_FACETS)[number]>
> = true;

/** Deployment facet states ({@link FacetState}). */
export const READINESS_STATES = [
  "ready",
  "degraded",
  "not-configured",
  "not-implemented",
  "unknown",
] as const satisfies readonly FacetState[];
const _statesExhaustive: AssertNever<
  Exclude<FacetState, (typeof READINESS_STATES)[number]>
> = true;

// The exhaustiveness consts exist only to force a type error if an upstream union
// grows; reference them so `noUnusedLocals`-style lint never flags them as dead.
void _runModesExhaustive;
void _runReasonsExhaustive;
void _tickOutcomesExhaustive;
void _scanVerdictsExhaustive;
void _facetsExhaustive;
void _statesExhaustive;

/* ------------------------------------------------------------------ *
 *  Coarse bucketing for numeric dimensions
 *
 *  Same philosophy as `@/lib/telemetry/buckets`: a raw latency/depth/age can, in
 *  aggregate, fingerprint work, so it is turned into a coarse bucket LABEL at
 *  construction and the raw number is discarded. Latency uses Prometheus-style `le`
 *  (upper-bound) buckets so a histogram supports p95/p99 estimation directly.
 * ------------------------------------------------------------------ */

/**
 * Latency histogram upper bounds, in **seconds** (Prometheus `le` convention). A
 * processor-latency observation is placed in the smallest bucket whose bound it does
 * not exceed; anything slower (or an unmeasurable/non-finite latency) falls in the
 * `+Inf` overflow — the conservative direction for a latency SLO, since an unknown
 * is treated as slow, never as fast.
 */
export const LATENCY_LE_SECONDS = [
  0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
] as const;

/**
 * The `le` label set, including the mandatory `+Inf` overflow. Declared as an
 * explicit literal tuple (not derived via `.map(String)`, which would widen the
 * element type to `string` and lose the bounded union). Kept index-aligned with
 * {@link LATENCY_LE_SECONDS}; a test pins the two together so they cannot drift.
 */
export const LATENCY_LE_LABELS = [
  "0.1",
  "0.25",
  "0.5",
  "1",
  "2.5",
  "5",
  "10",
  "30",
  "60",
  "120",
  "+Inf",
] as const;
export type LatencyLeLabel = (typeof LATENCY_LE_LABELS)[number];

/** Map a raw latency in milliseconds to its `le` bucket label. */
export function latencyLeLabel(ms: number): LatencyLeLabel {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "+Inf";
  const seconds = ms / 1000;
  for (const bound of LATENCY_LE_SECONDS) {
    if (seconds <= bound) return String(bound) as LatencyLeLabel;
  }
  return "+Inf";
}

/** Coarse queue-depth buckets — enough to see "backing up" without a raw count. */
export const QUEUE_DEPTH_BUCKETS = [
  "0",
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
  "unknown",
] as const;
export type QueueDepthBucket = (typeof QUEUE_DEPTH_BUCKETS)[number];

/** Bucket a queue depth (number of runnable jobs). */
export function queueDepthBucket(depth: number): QueueDepthBucket {
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return "unknown";
  }
  const d = Math.floor(depth);
  if (d === 0) return "0";
  if (d <= 10) return "1-10";
  if (d <= 50) return "11-50";
  if (d <= 200) return "51-200";
  if (d <= 1000) return "201-1000";
  return "1000+";
}

/** Coarse queue-age buckets (age of the oldest runnable job), in human units. */
export const QUEUE_AGE_BUCKETS = [
  "<5s",
  "5-30s",
  "30-120s",
  "2-10m",
  "10-60m",
  "60m+",
  "unknown",
] as const;
export type QueueAgeBucket = (typeof QUEUE_AGE_BUCKETS)[number];

/** Bucket a queue age in milliseconds. */
export function queueAgeBucket(ms: number): QueueAgeBucket {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "unknown";
  const s = ms / 1000;
  if (s < 5) return "<5s";
  if (s < 30) return "5-30s";
  if (s < 120) return "30-120s";
  if (s < 600) return "2-10m";
  if (s < 3600) return "10-60m";
  return "60m+";
}

/* ------------------------------------------------------------------ *
 *  The metric sample + the machine-readable schema
 * ------------------------------------------------------------------ */

/** Every canonical metric name. Provider-neutral, snake_case, `worker_` prefixed. */
export const METRIC_NAMES = [
  "worker_run_total",
  "worker_tick_total",
  "worker_claim_total",
  "worker_redelivery_total",
  "worker_dead_letter_total",
  "worker_retry_total",
  "worker_processor_total",
  "worker_processor_latency_seconds",
  "worker_scan_total",
  "worker_soundness_total",
  "worker_artifact_manifest_total",
  "worker_artifact_retrieval_total",
  "worker_artifact_delivery_total",
  "worker_storage_ops_total",
  "worker_queue_depth",
  "worker_queue_age_seconds",
  "worker_readiness",
  "worker_engine_capability",
  "worker_lifecycle_verification_total",
  "worker_lifecycle_drift_rules",
  "worker_job_terminal_total",
] as const;
export type WorkerMetricName = (typeof METRIC_NAMES)[number];

const METRIC_NAME_SET: ReadonlySet<string> = new Set(METRIC_NAMES);

/** True when `name` is a recognized worker metric name. */
export function isKnownMetricName(name: unknown): name is WorkerMetricName {
  return typeof name === "string" && METRIC_NAME_SET.has(name);
}

/**
 * One emitted metric observation: a bounded name, a bounded set of string labels,
 * a coarse `kind`, and a numeric `value` that is only ever a count (`1` for a
 * counter/histogram observation) or a presence flag / bounded operational count for
 * a gauge — never a raw latency, size, or duration.
 */
export interface WorkerMetricSample {
  metric: WorkerMetricName;
  kind: MetricKind;
  labels: Readonly<Record<string, string>>;
  value: number;
}

/** The allowed labels for one metric: each key maps to its closed set of values. */
export interface MetricLabelSchema {
  readonly kind: MetricKind;
  readonly labels: Readonly<Record<string, readonly string[]>>;
}

/**
 * The machine-readable schema: for every metric, its kind and the closed set of
 * label keys → allowed values. This is the single source of truth shared by the
 * collector, the SLO helpers, the dashboard/alert example validators, and the
 * schema tests. A dashboard or alert may only reference a metric and label values
 * that appear here; a builder may only construct a sample that satisfies it.
 */
export const METRIC_SCHEMA: Readonly<Record<WorkerMetricName, MetricLabelSchema>> = {
  worker_run_total: {
    kind: "counter",
    labels: { mode: RUN_MODES, reason: RUN_REASONS },
  },
  worker_tick_total: {
    kind: "counter",
    labels: { mode: RUN_MODES, outcome: TICK_OUTCOMES },
  },
  worker_claim_total: {
    kind: "counter",
    labels: { result: CLAIM_RESULTS },
  },
  worker_redelivery_total: { kind: "counter", labels: {} },
  worker_dead_letter_total: { kind: "counter", labels: {} },
  worker_retry_total: { kind: "counter", labels: {} },
  worker_processor_total: {
    kind: "counter",
    labels: { processor: PROCESSOR_KINDS, outcome: PROCESSOR_OUTCOMES },
  },
  worker_processor_latency_seconds: {
    kind: "histogram",
    labels: { processor: PROCESSOR_KINDS, le: LATENCY_LE_LABELS },
  },
  worker_scan_total: {
    kind: "counter",
    labels: { verdict: SCAN_VERDICTS, scanned: BOOL_LABELS },
  },
  worker_soundness_total: {
    kind: "counter",
    labels: { verdict: SOUNDNESS_VERDICTS, reason: SOUNDNESS_REASONS },
  },
  worker_artifact_manifest_total: {
    kind: "counter",
    labels: {
      verdict: ARTIFACT_VERDICTS,
      reason: ARTIFACT_REASONS,
      kind: ARTIFACT_OUTPUT_KINDS,
      processor: PROCESSOR_KINDS,
    },
  },
  worker_artifact_retrieval_total: {
    kind: "counter",
    labels: {
      outcome: ARTIFACT_RETRIEVAL_OUTCOMES,
      reason: ARTIFACT_ACCESS_REASONS,
      kind: ARTIFACT_OUTPUT_KINDS,
      provider: RETRIEVAL_STORAGE_PROVIDERS,
    },
  },
  worker_artifact_delivery_total: {
    kind: "counter",
    labels: {
      outcome: ARTIFACT_DELIVERY_OUTCOMES,
      reason: ARTIFACT_DELIVERY_REASONS,
      kind: ARTIFACT_OUTPUT_KINDS,
      provider: RETRIEVAL_STORAGE_PROVIDERS,
    },
  },
  worker_storage_ops_total: {
    kind: "counter",
    labels: { op: STORAGE_OPS, result: STORAGE_RESULTS },
  },
  worker_queue_depth: {
    kind: "gauge",
    labels: { bucket: QUEUE_DEPTH_BUCKETS },
  },
  worker_queue_age_seconds: {
    kind: "gauge",
    labels: { bucket: QUEUE_AGE_BUCKETS },
  },
  worker_readiness: {
    kind: "gauge",
    labels: { facet: READINESS_FACETS, state: READINESS_STATES },
  },
  worker_engine_capability: {
    kind: "gauge",
    labels: { capability: ENGINE_CAPABILITIES, available: BOOL_LABELS },
  },
  worker_lifecycle_verification_total: {
    kind: "counter",
    labels: { verdict: LIFECYCLE_VERDICTS },
  },
  worker_lifecycle_drift_rules: { kind: "gauge", labels: {} },
  worker_job_terminal_total: {
    kind: "counter",
    labels: { outcome: TERMINAL_OUTCOMES, failure_class: FAILURE_CLASSES },
  },
};

/* ------------------------------------------------------------------ *
 *  Builders — construct a sample with type-checked, bounded labels
 * ------------------------------------------------------------------ */

const bool = (b: boolean): BoolLabel => (b ? "true" : "false");

/** A daemon run finished in `mode`, stopping for `reason`. */
export function runMetric(
  mode: DaemonRunMode,
  reason: DaemonStopReason,
): WorkerMetricSample {
  return {
    metric: "worker_run_total",
    kind: "counter",
    labels: { mode, reason },
    value: 1,
  };
}

/** One executor tick in `mode` produced `outcome`. */
export function tickMetric(
  mode: DaemonRunMode,
  outcome: ExecutorOutcome,
): WorkerMetricSample {
  return {
    metric: "worker_tick_total",
    kind: "counter",
    labels: { mode, outcome },
    value: 1,
  };
}

/** A queue claim attempt resolved to `result`. */
export function claimMetric(result: ClaimResult): WorkerMetricSample {
  return {
    metric: "worker_claim_total",
    kind: "counter",
    labels: { result },
    value: 1,
  };
}

/** A claimed job was a redelivery (a prior lease expired or a retryable requeue). */
export function redeliveryMetric(): WorkerMetricSample {
  return { metric: "worker_redelivery_total", kind: "counter", labels: {}, value: 1 };
}

/** A job failed terminally only because its retries were exhausted (a dead letter). */
export function deadLetterMetric(): WorkerMetricSample {
  return { metric: "worker_dead_letter_total", kind: "counter", labels: {}, value: 1 };
}

/** A retryable failure was requeued for another attempt. */
export function retryMetric(): WorkerMetricSample {
  return { metric: "worker_retry_total", kind: "counter", labels: {}, value: 1 };
}

/** A processor run of `processor` kind reached `outcome`. */
export function processorMetric(
  processor: ProcessorKind,
  outcome: ProcessorOutcome,
): WorkerMetricSample {
  return {
    metric: "worker_processor_total",
    kind: "counter",
    labels: { processor, outcome },
    value: 1,
  };
}

/**
 * A processor-latency observation: the raw `latencyMs` is bucketed to its `le`
 * label here and discarded, so no raw duration is ever carried. The value is a
 * single observation (`1`) in that bucket.
 */
export function processorLatencyMetric(
  processor: ProcessorKind,
  latencyMs: number,
): WorkerMetricSample {
  return {
    metric: "worker_processor_latency_seconds",
    kind: "histogram",
    labels: { processor, le: latencyLeLabel(latencyMs) },
    value: 1,
  };
}

/** The malware-scan gate reached `verdict` (`scanned` is the honesty bit). */
export function scanMetric(
  verdict: MalwareScanVerdict,
  scanned: boolean,
): WorkerMetricSample {
  return {
    metric: "worker_scan_total",
    kind: "counter",
    labels: { verdict, scanned: bool(scanned) },
    value: 1,
  };
}

/**
 * The file-soundness gate reached `verdict` for the bounded `reason` (e.g. `ok` for
 * a pass, `pdf_header_missing` for a reject, `not_checked` when disabled). Both
 * labels are closed enums — never a filename, size, or document content.
 */
export function soundnessMetric(
  verdict: SoundnessVerdict,
  reason: SoundnessReason,
): WorkerMetricSample {
  return {
    metric: "worker_soundness_total",
    kind: "counter",
    labels: { verdict, reason },
    value: 1,
  };
}

/**
 * The artifact-manifest gate reached `verdict` for the bounded `reason` on one
 * produced output of `kind` from the `processor` family (e.g. `valid`/`ok` for a
 * published output, `invalid`/`empty_artifact` for a rejected one). All four labels
 * are closed enums — never a filename, object key, size, or document content.
 */
export function artifactManifestMetric(
  verdict: ArtifactVerdict,
  reason: ArtifactReason,
  kind: ArtifactOutputKind,
  processor: ProcessorKind,
): WorkerMetricSample {
  return {
    metric: "worker_artifact_manifest_total",
    kind: "counter",
    labels: { verdict, reason, kind, processor },
    value: 1,
  };
}

/**
 * The client-facing artifact-retrieval boundary reached `outcome` (`served`/`denied`)
 * for the bounded `reason` on an output of `kind`, served from the bounded storage
 * `provider` (`local-dev` in-process store vs a `remote-configured` object bucket, or
 * `not-configured` when no backend can serve). E.g. `served`/`ok`/`local-dev` for a
 * developer download, `denied`/`storage_error`/`remote-configured` for a transient
 * bucket failure, `denied`/`not_found`/`remote-configured` for a missing object;
 * `unknown` kind when no valid manifest resolved. All four labels are closed enums —
 * never a filename, object key, bucket name, handle, signed URL, size, or document
 * content.
 */
export function artifactRetrievalMetric(
  outcome: ArtifactRetrievalOutcome,
  reason: ArtifactAccessReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
): WorkerMetricSample {
  return {
    metric: "worker_artifact_retrieval_total",
    kind: "counter",
    labels: { outcome, reason, kind, provider },
    value: 1,
  };
}

/**
 * The client-facing artifact-download **delivery** boundary reached `outcome`
 * (`delivered`/`denied`) for the bounded `reason` on an output of `kind`, from the
 * bounded storage `provider`. This is the SECOND gate over a download: it fires only
 * after the access layer (`artifactRetrievalMetric`) has already granted the handle,
 * and it measures whether the bytes were then safely delivered — e.g. `delivered`/`ok`
 * for a served body, `denied`/`size_mismatch` when the length could not be verified
 * against the stored bytes, `denied`/`oversize` past the delivery ceiling, or
 * `denied`/`stream_error` for an unexpected serve failure. All four labels are closed
 * enums — never a filename, object key, bucket name, handle, signed URL, byte range,
 * size, or document content.
 */
export function artifactDeliveryMetric(
  outcome: ArtifactDeliveryOutcome,
  reason: ArtifactDeliveryReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
): WorkerMetricSample {
  return {
    metric: "worker_artifact_delivery_total",
    kind: "counter",
    labels: { outcome, reason, kind, provider },
    value: 1,
  };
}

/** A worker-side storage `op` resolved to `result`. */
export function storageMetric(
  op: StorageOp,
  result: StorageResult,
): WorkerMetricSample {
  return {
    metric: "worker_storage_ops_total",
    kind: "counter",
    labels: { op, result },
    value: 1,
  };
}

/** An observed queue depth, bucketed. Presence gauge (value `1` for the bucket). */
export function queueDepthMetric(depth: number): WorkerMetricSample {
  return {
    metric: "worker_queue_depth",
    kind: "gauge",
    labels: { bucket: queueDepthBucket(depth) },
    value: 1,
  };
}

/** An observed queue age (oldest runnable job), bucketed. Presence gauge. */
export function queueAgeMetric(ageMs: number): WorkerMetricSample {
  return {
    metric: "worker_queue_age_seconds",
    kind: "gauge",
    labels: { bucket: queueAgeBucket(ageMs) },
    value: 1,
  };
}

/** A deployment facet is present in `state`. Presence gauge. */
export function readinessMetric(
  facet: FacetId,
  state: FacetState,
): WorkerMetricSample {
  return {
    metric: "worker_readiness",
    kind: "gauge",
    labels: { facet, state },
    value: 1,
  };
}

/** Presence-only availability of an engine/gate `capability`. */
export function engineCapabilityMetric(
  capability: EngineCapability,
  available: boolean,
): WorkerMetricSample {
  return {
    metric: "worker_engine_capability",
    kind: "gauge",
    labels: { capability, available: bool(available) },
    value: 1,
  };
}

/** A lifecycle verification reached `verdict`. */
export function lifecycleVerificationMetric(
  verdict: LifecycleMetricVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_lifecycle_verification_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * The number of the app's OWN backstop rules found drifted (a small, bounded
 * operational count of `pdfxyz-*` rules — never an observed rule id or value).
 */
export function lifecycleDriftMetric(driftedRules: number): WorkerMetricSample {
  const value =
    typeof driftedRules === "number" && Number.isFinite(driftedRules) && driftedRules >= 0
      ? Math.floor(driftedRules)
      : 0;
  return { metric: "worker_lifecycle_drift_rules", kind: "gauge", labels: {}, value };
}

/** A job reached a terminal `outcome` with the given coarse `failureClass`. */
export function jobTerminalMetric(
  outcome: TerminalOutcome,
  failureClass: FailureClass = "none",
): WorkerMetricSample {
  return {
    metric: "worker_job_terminal_total",
    kind: "counter",
    labels: { outcome, failure_class: failureClass },
    value: 1,
  };
}

/**
 * Map a typed job-error code to a coarse, bounded {@link FailureClass}. Never
 * echoes the raw code as a label; classifies known codes and folds everything else
 * into `other`, so the label space stays closed as new error codes appear.
 */
export function failureClassForCode(code: string | undefined): FailureClass {
  switch (code) {
    case "malware_detected":
    case "scan_invalid":
      return "blocked";
    case "unsound_input":
      return "unsound";
    case "artifact_invalid":
      return "artifact";
    case "scan_unavailable":
      return "scan_unavailable";
    case "not_found":
      return "input_missing";
    case "not_implemented":
      return "unsupported";
    case "processing_error":
    case "invalid_input":
    case "invalid_options":
    case "invalid_request":
      return "processing_error";
    default:
      return code ? "other" : "none";
  }
}

/**
 * Map a processor's registry id (e.g. `"compression"`, `"ocr"`) to a bounded
 * {@link ProcessorKind}. Unknown ids fold into `other`, so a new processor cannot
 * introduce an unbounded label.
 */
export function processorKindForId(id: string | undefined): ProcessorKind {
  if (id === "compression") return "compress";
  if (id === "ocr") return "ocr";
  return "other";
}

/* ------------------------------------------------------------------ *
 *  Defense-in-depth sanitizer + validator
 * ------------------------------------------------------------------ */

/** Cap on label count/length so a pathological sample can never balloon a payload. */
const MAX_LABELS = 16;
const MAX_LABEL_LEN = 64;

/**
 * Validate + scrub a sample into a schema-conformant, content-free payload, or
 * `null` if it is malformed or off-schema. Mirrors `sanitizeEvent` in the client
 * telemetry layer: the metric name must be on the allowlist, each label key/value
 * must be one the schema permits, and every label value is still run through the
 * shared {@link redactText} redactor as defense in depth. Unknown metrics, unknown
 * label keys, or out-of-enum label values are rejected rather than emitted, so a
 * high-cardinality or content-bearing label can never reach a sink.
 */
export function sanitizeMetric(
  sample: WorkerMetricSample,
): WorkerMetricSample | null {
  if (!sample || !isKnownMetricName(sample.metric)) return null;
  const schema = METRIC_SCHEMA[sample.metric];
  if (sample.kind !== schema.kind) return null;
  if (typeof sample.value !== "number" || !Number.isFinite(sample.value)) {
    return null;
  }

  const labels = sample.labels ?? {};
  const keys = Object.keys(labels);
  if (keys.length > MAX_LABELS) return null;

  const allowedKeys = Object.keys(schema.labels);
  // Every schema-required key must be present, and no extra keys are allowed.
  if (keys.length !== allowedKeys.length) return null;

  const clean: Record<string, string> = {};
  for (const key of allowedKeys) {
    const raw = labels[key];
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LABEL_LEN) {
      return null;
    }
    const allowed = schema.labels[key]!;
    if (!allowed.includes(raw)) return null;
    // The value is already an enum member; redact anyway as defense in depth. If
    // redaction changes it, the label was not the pristine enum we expect — reject.
    if (redactText(raw) !== raw) return null;
    clean[key] = raw;
  }

  return { metric: sample.metric, kind: sample.kind, labels: clean, value: sample.value };
}
