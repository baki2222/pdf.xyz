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
import {
  ARTIFACT_LIFECYCLE_STATES,
  type StorageArtifactLifecycle,
} from "../artifacts/lifecycle";
import {
  CLEANUP_VERIFICATION_VERDICTS,
  type CleanupVerdict,
} from "../cleanup/types";
import {
  CLEANUP_CATEGORIES,
  CLEANUP_SEVERITIES,
  type CleanupCategory,
  type CleanupSeverity,
} from "../artifacts/cleanup/taxonomy";
import {
  PROJECTION_TARGETS,
  PROJECTION_VERDICTS,
  type ProjectionTarget,
  type ProjectionVerdict,
} from "../cleanup/project/types";
import {
  PIPELINE_ARMS,
  PIPELINE_SEVERITIES,
  type PipelineArm,
  type PipelineSeverity,
} from "../cleanup/pipeline/types";
import {
  CLEANUP_EVIDENCE_PROVIDERS,
  CLEANUP_EVIDENCE_REASONS,
  CLEANUP_EVIDENCE_STATES,
  type CleanupEvidenceProvider,
  type CleanupEvidenceReason,
  type CleanupEvidenceState,
} from "../cleanup-evidence/types";
import {
  OPS_BUNDLE_SEVERITIES,
  type OpsBundleSeverity,
} from "../ops-bundle/types";
import {
  RELEASE_GATE_VERDICTS,
  type ReleaseGateVerdict,
} from "../release-gate/types";
import {
  RELEASE_ARTIFACT_VERDICTS,
  type ReleaseArtifactVerdict,
} from "../release-artifact/types";
import {
  RELEASE_INDEX_VERDICTS,
  type ReleaseIndexVerdict,
} from "../release-index/types";
import {
  RELEASE_POLICY_VERDICTS,
  type ReleasePolicyVerdict,
} from "../release-policy/types";
import {
  RELEASE_CI_BUNDLE_VERDICTS,
  type ReleaseCiBundleVerdict,
} from "../release-ci-bundle/types";
import {
  RELEASE_AUDIT_VERDICTS,
  type ReleaseAuditVerdict,
} from "../release-audit/types";
import {
  RELEASE_REPORT_RECOMMENDATIONS,
  type ReleaseReportRecommendation,
} from "../release-report/types";
import {
  RELEASE_TREND_VERDICTS,
  type ReleaseTrendVerdict,
} from "../release-trend/types";
import {
  RELEASE_GOVERNANCE_VERDICTS,
  type ReleaseGovernanceVerdict,
} from "../release-governance/types";
import {
  RELEASE_ARCHIVE_POSTURES,
  type ReleaseArchivePosture,
} from "../release-archive/types";
import {
  RELEASE_RESTORE_DRILL_VERDICTS,
  type ReleaseRestoreDrillVerdict,
} from "../release-restore-drill/types";
import {
  RELEASE_PUBLISH_PACK_VERDICTS,
  type ReleasePublishPackVerdict,
} from "../release-publish-pack/types";
import {
  RELEASE_ACK_VERDICTS,
  type ReleaseAckVerdict,
} from "../release-ack/types";
import {
  RELEASE_DECISION_DECISIONS,
  type ReleaseDecisionDecision,
} from "../release-decision/types";
import {
  RELEASE_DECISION_INDEX_VERDICTS,
  type ReleaseDecisionIndexVerdict,
} from "../release-decision-index/types";
import {
  RELEASE_DECISION_TREND_VERDICTS,
  type ReleaseDecisionTrendVerdict,
} from "../release-decision-trend/types";
import {
  RELEASE_DECISION_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionActionPlanVerdict,
} from "../release-decision-action-plan/types";
import {
  RELEASE_DECISION_ACTION_RECEIPT_VERDICTS,
  type ReleaseDecisionActionReceiptVerdict,
} from "../release-decision-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutVerdict,
} from "../release-decision-closeout/types";
import {
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutIndexVerdict,
} from "../release-decision-closeout-index/types";
import {
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS,
  type ReleaseDecisionCloseoutIndexTrendVerdict,
} from "../release-decision-closeout-index-trend/types";
import {
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionCloseoutActionPlanVerdict,
} from "../release-decision-closeout-action-plan/types";
import {
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICTS,
  type ReleaseDecisionCloseoutActionReceiptVerdict,
} from "../release-decision-closeout-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "../release-decision-closeout-governance/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceIndexVerdict,
} from "../release-decision-closeout-governance-index/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
} from "../release-decision-closeout-governance-index-trend/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceActionPlanVerdict,
} from "../release-decision-closeout-governance-action-plan/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
} from "../release-decision-closeout-governance-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-action-plan/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/types";
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
  "worker_artifact_expiry_total",
  "worker_storage_ops_total",
  "worker_queue_depth",
  "worker_queue_age_seconds",
  "worker_readiness",
  "worker_engine_capability",
  "worker_lifecycle_verification_total",
  "worker_lifecycle_drift_rules",
  "worker_cleanup_verification_total",
  "worker_artifact_cleanup_total",
  "worker_cleanup_projection_total",
  "worker_cleanup_pipeline_total",
  "worker_cleanup_evidence_posture",
  "worker_ops_bundle_total",
  "worker_release_gate_total",
  "worker_release_artifact_total",
  "worker_release_index_total",
  "worker_release_policy_total",
  "worker_release_ci_bundle_total",
  "worker_release_audit_total",
  "worker_release_report_total",
  "worker_release_trend_total",
  "worker_release_governance_total",
  "worker_release_archive_total",
  "worker_release_restore_drill_total",
  "worker_release_publish_pack_total",
  "worker_release_ack_total",
  "worker_release_decision_total",
  "worker_release_decision_index_total",
  "worker_release_decision_trend_total",
  "worker_release_decision_action_plan_total",
  "worker_release_decision_action_receipt_total",
  "worker_release_decision_closeout_total",
  "worker_release_decision_closeout_index_total",
  "worker_release_decision_closeout_index_trend_total",
  "worker_release_decision_closeout_action_plan_total",
  "worker_release_decision_closeout_action_receipt_total",
  "worker_release_decision_closeout_governance_total",
  "worker_release_decision_closeout_governance_index_total",
  "worker_release_decision_closeout_governance_index_trend_total",
  "worker_release_decision_closeout_governance_action_plan_total",
  "worker_release_decision_closeout_governance_action_receipt_total",
  "worker_release_decision_closeout_governance_finalize_total",
  "worker_release_decision_closeout_governance_finalize_index_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_action_plan_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_action_receipt_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_plan_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_receipt_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_total",
  "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_action_plan_total",
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
  worker_artifact_expiry_total: {
    kind: "counter",
    labels: {
      state: ARTIFACT_LIFECYCLE_STATES,
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
  worker_cleanup_verification_total: {
    kind: "counter",
    labels: {
      verdict: CLEANUP_VERIFICATION_VERDICTS,
      provider: RETRIEVAL_STORAGE_PROVIDERS,
    },
  },
  worker_artifact_cleanup_total: {
    kind: "counter",
    labels: {
      category: CLEANUP_CATEGORIES,
      severity: CLEANUP_SEVERITIES,
    },
  },
  worker_cleanup_projection_total: {
    kind: "counter",
    labels: {
      target: PROJECTION_TARGETS,
      verdict: PROJECTION_VERDICTS,
    },
  },
  worker_cleanup_pipeline_total: {
    kind: "counter",
    labels: {
      arm: PIPELINE_ARMS,
      severity: PIPELINE_SEVERITIES,
    },
  },
  worker_cleanup_evidence_posture: {
    kind: "gauge",
    labels: {
      state: CLEANUP_EVIDENCE_STATES,
      reason: CLEANUP_EVIDENCE_REASONS,
      provider: CLEANUP_EVIDENCE_PROVIDERS,
    },
  },
  worker_ops_bundle_total: {
    kind: "counter",
    labels: {
      severity: OPS_BUNDLE_SEVERITIES,
    },
  },
  worker_release_gate_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_GATE_VERDICTS,
    },
  },
  worker_release_artifact_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_ARTIFACT_VERDICTS,
    },
  },
  worker_release_index_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_INDEX_VERDICTS,
    },
  },
  worker_release_policy_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_POLICY_VERDICTS,
    },
  },
  worker_release_ci_bundle_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_CI_BUNDLE_VERDICTS,
    },
  },
  worker_release_audit_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_AUDIT_VERDICTS,
    },
  },
  worker_release_report_total: {
    kind: "counter",
    labels: {
      recommendation: RELEASE_REPORT_RECOMMENDATIONS,
    },
  },
  worker_release_trend_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_TREND_VERDICTS,
    },
  },
  worker_release_governance_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_GOVERNANCE_VERDICTS,
    },
  },
  worker_release_archive_total: {
    kind: "counter",
    labels: {
      posture: RELEASE_ARCHIVE_POSTURES,
    },
  },
  worker_release_restore_drill_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_RESTORE_DRILL_VERDICTS,
    },
  },
  worker_release_publish_pack_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_PUBLISH_PACK_VERDICTS,
    },
  },
  worker_release_ack_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_ACK_VERDICTS,
    },
  },
  worker_release_decision_total: {
    kind: "counter",
    labels: {
      decision: RELEASE_DECISION_DECISIONS,
    },
  },
  worker_release_decision_index_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_INDEX_VERDICTS,
    },
  },
  worker_release_decision_trend_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_TREND_VERDICTS,
    },
  },
  worker_release_decision_action_plan_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_ACTION_PLAN_VERDICTS,
    },
  },
  worker_release_decision_action_receipt_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_ACTION_RECEIPT_VERDICTS,
    },
  },
  worker_release_decision_closeout_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_VERDICTS,
    },
  },
  worker_release_decision_closeout_index_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS,
    },
  },
  worker_release_decision_closeout_index_trend_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS,
    },
  },
  worker_release_decision_closeout_action_plan_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICTS,
    },
  },
  worker_release_decision_closeout_action_receipt_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_index_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_index_trend_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_action_plan_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_action_receipt_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_action_plan_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_action_receipt_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_plan_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_receipt_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
    },
  },
  worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_action_plan_total: {
    kind: "counter",
    labels: {
      verdict: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS,
    },
  },
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

/**
 * The storage-backed retrieval boundary evaluated a present object's retention/lifecycle
 * evidence to a bounded {@link StorageArtifactLifecycle} `state`: `live` (evidence records a
 * window that has not passed → served as before), `expired` (the recorded retention window
 * has passed while the object is STILL present in the bucket — the "present after app
 * retention expiry" DRIFT signal, denied 410), `deleted` (an explicit tombstone → denied
 * 410), or `unknown` (the present object carries no usable lifecycle evidence — a legacy
 * object or metadata-stripping storage — so expiry is NOT claimed and the manifest/intrinsic
 * decision governs). `provider` is the bounded storage backend. This is emitted ONLY on a
 * present-object read (a 404/transient read has nothing to evaluate), so `expired`/`deleted`
 * here is by construction lifecycle DRIFT: the bucket still served an object the app no
 * longer considers downloadable. Both labels are closed enums — never a filename, object
 * key, bucket name, handle, signed URL, expiry instant, size, or document content; it is
 * NEITHER proof the bytes were deleted NOR a claim about the bucket lifecycle policy's
 * correctness (which the app cannot verify from inside the process).
 */
export function artifactExpiryMetric(
  state: StorageArtifactLifecycle,
  provider: RetrievalStorageProvider,
): WorkerMetricSample {
  return {
    metric: "worker_artifact_expiry_total",
    kind: "counter",
    labels: { state, provider },
    value: 1,
  };
}

/**
 * The outcome of a storage-artifact **cleanup verification** run (Phase 42), folded to a
 * bounded {@link CleanupVerdict}: `verified` (every should-be-gone artifact is confirmed absent
 * from object storage — active delete-now and/or the bucket lifecycle backstop), `drift` (an
 * artifact is still present past its retention window + reap grace — the backstop has not
 * removed it), `unknown` (cleanup could not be proven: present-but-denied awaiting reap, no
 * evidence, or nothing to verify), `unavailable` (a probe could not complete), or
 * `not-configured` (no object-storage backend is wired). `provider` is the bounded storage
 * backend. This counts a VERIFICATION verdict, NOT a claim the bytes were deleted: an
 * app-level retrieval denial (Phase 41) and a proven object absence are different facts, and
 * only the latter yields `verified`. Both labels are closed enums — never a filename, object
 * key, bucket name, handle, signed URL, expiry instant, size, or document content.
 */
export function cleanupVerificationMetric(
  verdict: CleanupVerdict,
  provider: RetrievalStorageProvider,
): WorkerMetricSample {
  return {
    metric: "worker_cleanup_verification_total",
    kind: "counter",
    labels: { verdict, provider },
    value: 1,
  };
}

/**
 * One present storage object fell into a bounded cleanup {@link CleanupCategory} at the
 * given {@link CleanupSeverity} during a Phase 42 dry-run SWEEP of an offline inventory —
 * the per-category complement to the run-level {@link cleanupVerificationMetric}. `value`
 * is the COUNT of objects in that category (the derivation emits one sample per non-empty
 * category, and the collector sums them into a "total objects observed in category" counter).
 * `severity` is redundant with `category` (a fixed map) but carried so a dashboard can roll
 * up by severity without re-deriving it. This is a SWEEP finding, NOT a deletion — the tool
 * never removes anything. Both labels are closed enums — never a filename, object key,
 * bucket name, handle, signed URL, expiry instant, size, or document content.
 */
export function artifactCleanupMetric(
  category: CleanupCategory,
  severity: CleanupSeverity,
  count = 1,
): WorkerMetricSample {
  const value =
    typeof count === "number" && Number.isFinite(count) && count >= 0
      ? Math.floor(count)
      : 0;
  return {
    metric: "worker_artifact_cleanup_total",
    kind: "counter",
    labels: { category, severity },
    value,
  };
}

/**
 * One Phase 43 cleanup evidence PROJECTION run resolved to a bounded {@link ProjectionVerdict}
 * for output `target`. `target` is the shape it projected into (`evidence` for the absence
 * verifier, `inventory` for the dry-run sweeper); `verdict` is the aggregate outcome: `projected`
 * (usable records emitted, no unsafe signal), `insufficient` (a metadata-thin export — not enough
 * to project), or `unsafe` (a present-but-tombstoned object or a structurally invalid record).
 * This counts a REDACTION/NORMALIZATION run, NOT a verification or a deletion — the projector only
 * reshapes an operator's own out-of-band export, dropping every locator. It is the run-level
 * complement to the per-run {@link ProjectionReceipt} (`../cleanup/project/receipt`). Both labels
 * are closed enums — never a filename, object key, bucket name, handle, signed URL, endpoint,
 * region, expiry instant, size, or document content.
 */
export function cleanupProjectionMetric(
  target: ProjectionTarget,
  verdict: ProjectionVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_cleanup_projection_total",
    kind: "counter",
    labels: { target, verdict },
    value: 1,
  };
}

/**
 * One arm of a Phase 44 cleanup evidence PIPELINE run rolled up to a bounded
 * {@link PipelineSeverity} for the bounded {@link PipelineArm}. `arm` is which lens the composite
 * ran (`verify` = project → absence verifier, `sweep` = project → dry-run sweeper); `severity`
 * is that arm's rolled outcome: `ok` (clean), `usage` (misused/unreadable-export — a non-zero
 * fail-closed band), `unknown` (cleanup unproven), `drift` (present past retention + grace), or
 * `breach` (a tombstoned-but-present object or an unsafe export). This is the run-level composite
 * COMPLEMENT to the per-stage `worker_cleanup_projection_total` / `worker_cleanup_verification_total`
 * counters the arms also emit as they run, and to the per-run {@link import("../cleanup/pipeline/types").PipelineReceipt}.
 * It counts a COMPOSITE EVALUATION, NOT a deletion — the pipeline only reshapes + evaluates an
 * operator's own out-of-band export. Both labels are closed enums — never a filename, object key,
 * bucket name, handle, signed URL, endpoint, region, expiry instant, size, or document content.
 */
export function cleanupPipelineMetric(
  arm: PipelineArm,
  severity: PipelineSeverity,
): WorkerMetricSample {
  return {
    metric: "worker_cleanup_pipeline_total",
    kind: "counter",
    labels: { arm, severity },
    value: 1,
  };
}

/**
 * The resolved **cleanup evidence posture** a monitor read (Phase 44) — the run-level presence
 * gauge for the ops surface's cleanup-evidence check. `state` is the bounded posture
 * ({@link CleanupEvidenceState}: `disabled`/`healthy`/`stale`/`warning`/`critical`/`invalid`/…),
 * `reason` the bounded reason it resolved ({@link CleanupEvidenceReason}), and `provider` the
 * bounded storage backend the driving report concerned ({@link CleanupEvidenceProvider}). This
 * reports whether cleanup evidence MONITORING is configured/fresh/healthy from an operator's own
 * content-free report SUMMARY — NOT a cloud call, a deletion, or a claim about bucket bytes. All
 * three labels are closed, redaction-stable enums — never a filename, path, object key, bucket,
 * URL, endpoint, region, instant, size, or byte.
 */
export function cleanupEvidencePostureMetric(
  state: CleanupEvidenceState,
  reason: CleanupEvidenceReason,
  provider: CleanupEvidenceProvider,
): WorkerMetricSample {
  return {
    metric: "worker_cleanup_evidence_posture",
    kind: "gauge",
    labels: { state, reason, provider },
    value: 1,
  };
}

/**
 * A generated **operations evidence bundle** (Phase 45) resolved to its composite `severity`
 * ({@link OpsBundleSeverity}: `ok`/`usage`/`unknown`/`warn`/`critical`). One bounded label so a
 * scheduled monitor can count bundle outcomes by the single verdict an on-call operator acts on.
 * This counts a COMPOSITION of an operator's own content-free ops-check + cleanup-pipeline
 * summaries — NOT a cloud call, a deletion, or a claim about bucket bytes. The one label is a
 * closed, redaction-stable enum — never a filename, path, object key, bucket, URL, endpoint,
 * region, instant, size, or document content.
 */
export function opsBundleMetric(severity: OpsBundleSeverity): WorkerMetricSample {
  return {
    metric: "worker_ops_bundle_total",
    kind: "counter",
    labels: { severity },
    value: 1,
  };
}

/**
 * A **release readiness gate** run (Phase 46) resolved to its promotion `verdict`
 * ({@link ReleaseGateVerdict}: `pass`/`warn`/`fail`/`unknown`). One bounded label so a release
 * pipeline / dashboard can count gate runs by the single decision an operator acts on (e.g.
 * `worker_release_gate_total{verdict="fail"} > 0`). This counts an offline EVALUATION that RAN the
 * existing content-free worker checks and folded their exit codes — NOT a cloud call, a deletion, a
 * promotion, or a claim about bucket bytes. The one label is a closed, redaction-stable enum — never
 * a filename, path, object key, bucket, URL, endpoint, region, instant, size, or document content.
 */
export function releaseGateMetric(verdict: ReleaseGateVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_gate_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A generated **release evidence artifact** (Phase 47) resolved to its archival `verdict`
 * ({@link ReleaseArtifactVerdict}: `pass`/`warn`/`fail`/`unknown`). One bounded label so a release
 * pipeline / dashboard can count artifacts by the single decision an operator archives (e.g.
 * `worker_release_artifact_total{verdict="fail"} > 0`). This counts an offline AGGREGATION that
 * archived the content-free release-gate result with bounded provenance and hashed the safe aggregate
 * — NOT a cloud call, a deletion, a signature, a promotion, or a claim about bucket bytes. The one
 * label is a closed, redaction-stable enum — never a filename, path, object key, bucket, URL,
 * endpoint, region, instant, size, digest, or document content.
 */
export function releaseArtifactMetric(verdict: ReleaseArtifactVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_artifact_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A built **release evidence index / retention manifest** (Phase 48) resolved to its archive-health
 * `verdict` ({@link ReleaseIndexVerdict}: `ok`/`warn`/`unknown`/`invalid`). One bounded label so a
 * release pipeline / dashboard can count retention reviews by the single decision an operator acts on
 * — e.g. `worker_release_index_total{verdict="invalid"} > 0` catches a tampered artifact entering the
 * archive, `{verdict="warn"} > 0` catches retention drift. This counts an offline RE-VERIFICATION +
 * AGGREGATION that re-hashed each archived artifact's canonical body and folded the integrity +
 * retention posture — NOT a cloud call, a deletion, a prune, a signature, or a claim about bucket
 * bytes. The one label is a closed, redaction-stable enum — never a filename, path, object key,
 * bucket, URL, endpoint, region, instant, size, digest, or document content.
 */
export function releaseIndexMetric(verdict: ReleaseIndexVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_index_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A **release evidence policy** evaluation (Phase 49) resolved to its acceptability `verdict`
 * ({@link ReleasePolicyVerdict}: `pass`/`warn`/`unknown`/`fail`). One bounded label so a release
 * pipeline / dashboard can count policy gates by the single decision an operator acts on — e.g.
 * `worker_release_policy_total{verdict="fail"} > 0` catches an archive that violated a blocking policy
 * threshold or a tampered index, `{verdict="unknown"} > 0` catches a missing/empty archive at the gate.
 * This counts an offline EVALUATION that checked bounded operator thresholds against a content-free
 * `pdfxyz.release-index/1` manifest (re-checking its internal consistency) — NOT a cloud call, a
 * deletion, a signature, a promotion, or a claim about bucket bytes. The one label is a closed,
 * redaction-stable enum — never a filename, path, object key, bucket, URL, endpoint, region, instant,
 * size, digest, or document content.
 */
export function releasePolicyMetric(verdict: ReleasePolicyVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_policy_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release evidence CI bundle** (Phase 50) resolved to its coherence `verdict`
 * ({@link ReleaseCiBundleVerdict}: `pass`/`warn`/`unknown`/`fail`). One bounded label so a release
 * pipeline / dashboard can count bundles by the single decision an operator acts on — e.g.
 * `worker_release_ci_bundle_total{verdict="fail"} > 0` catches a chain that failed or whose stages
 * DISAGREE (a cross-stage inconsistency / tamper), `{verdict="unknown"} > 0` catches an unreadable /
 * decision-less chain at the handoff. This counts an offline COMPOSITION that ingested the content-free
 * release-gate/artifact/index/policy stage outputs, re-verified their internal + cross-stage
 * consistency, and folded them — NOT a cloud call, a deletion, a signature, a promotion, or a claim
 * about bucket bytes. The one label is a closed, redaction-stable enum — never a filename, path, object
 * key, bucket, URL, endpoint, region, instant, size, digest, or document content.
 */
export function releaseCiBundleMetric(verdict: ReleaseCiBundleVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_ci_bundle_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A performed **release evidence audit / diff** (Phase 51) resolved to its regression `verdict`
 * ({@link ReleaseAuditVerdict}: `pass`/`warn`/`unknown`/`fail`). One bounded label so a release pipeline /
 * dashboard can count audits by the single decision an operator acts on — e.g.
 * `worker_release_audit_total{verdict="fail"} > 0` catches a blocking regression or a tampered bundle,
 * `{verdict="warn"} > 0` catches a non-blocking drift, `{verdict="unknown"} > 0` catches an audit that
 * could not run (an unreadable bundle / too little history). This counts an offline DIFF that ingested two
 * (or a history of) content-free `pdfxyz.release-ci-bundle/1` bundles, re-validated each against itself,
 * and compared their postures — NOT a cloud call, a deletion, a signature, a promotion, or a claim about
 * bucket bytes. The one label is a closed, redaction-stable enum — never a filename, path, object key,
 * bucket, URL, endpoint, region, instant, size, digest, or document content.
 */
export function releaseAuditMetric(verdict: ReleaseAuditVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_audit_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release evidence operator report** (Phase 52) resolved to its final `recommendation`
 * ({@link ReleaseReportRecommendation}: `promote-ready`/`hold-warning`/`needs-evidence`/`hold-fail`). One
 * bounded label so a release pipeline / dashboard can count report runs by the single decision an operator
 * acts on — e.g. `worker_release_report_total{recommendation="hold-fail"} > 0` catches a tampered / failed /
 * regressed release held at handoff, `{recommendation="needs-evidence"} > 0` catches an insufficient-evidence
 * (or audit-only) run that could not certify coherence. This counts an offline REPORT that ingested the
 * content-free `pdfxyz.release-ci-bundle/1` and/or `pdfxyz.release-audit/1` composites, re-validated each
 * against itself, and folded them into one operator recommendation — NOT a cloud call, a deletion, a
 * signature, an approval, a promotion, or a claim about bucket bytes. The one label is a closed,
 * redaction-stable enum — never a filename, path, object key, bucket, URL, endpoint, region, instant, size,
 * digest, or document content.
 */
export function releaseReportMetric(recommendation: ReleaseReportRecommendation): WorkerMetricSample {
  return {
    metric: "worker_release_report_total",
    kind: "counter",
    labels: { recommendation },
    value: 1,
  };
}

/**
 * A composed **release evidence trend summary** (Phase 53) resolved to its governance `verdict`
 * ({@link ReleaseTrendVerdict}: `stable`/`warning`/`unknown`/`failing`). One bounded label so a release pipeline /
 * governance dashboard can count trend summaries by the single decision a reviewer acts on — e.g.
 * `worker_release_trend_total{verdict="failing"} > 0` catches a failing recent trend (a tampered report, a
 * hold-fail newest, or a breached threshold), `{verdict="unknown"} > 0` catches an insufficient / unreadable
 * report history. This counts an offline SUMMARY that ingested a bounded history of content-free
 * `pdfxyz.release-report/1` reports, re-validated each against itself, and folded their recommendations into one
 * trend verdict — NOT a cloud call, a deletion, a signature, an approval, a promotion, or a claim about bucket
 * bytes. The one label is a closed, redaction-stable enum — never a filename, path, object key, bucket, URL,
 * endpoint, region, instant, size, digest, or document content.
 */
export function releaseTrendMetric(verdict: ReleaseTrendVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_trend_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release evidence governance bundle** (Phase 54) resolved to its governance `verdict`
 * ({@link ReleaseGovernanceVerdict}: `healthy`/`watch`/`incomplete`/`blocked`). One bounded label so a release
 * pipeline / governance dashboard can count review windows by the single decision a reviewer acts on — e.g.
 * `worker_release_governance_total{verdict="blocked"} > 0` catches a blocked window (a tampered document, a
 * failing trend, a hold-fail report, or a blocking audit regression), `{verdict="incomplete"} > 0` catches an
 * insufficient / trend-absent window. This counts an offline BUNDLE that ingested a content-free
 * `pdfxyz.release-trend/1` window summary plus the latest `pdfxyz.release-report/1` / `pdfxyz.release-audit/1`,
 * re-validated each against itself, and folded them into one governance verdict — NOT a cloud call, a deletion,
 * a signature, an approval, a promotion, or a claim about bucket bytes. The one label is a closed,
 * redaction-stable enum — never a filename, path, object key, bucket, URL, endpoint, region, instant, size,
 * digest, or document content.
 */
export function releaseGovernanceMetric(verdict: ReleaseGovernanceVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_governance_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release evidence archive pack** (Phase 55) resolved to its archive `posture`
 * ({@link ReleaseArchivePosture}: `archivable`/`archive-watch`/`archive-incomplete`/`archive-blocked`). One
 * bounded label so a release pipeline / review dashboard can count archive records by the single decision a
 * reviewer acts on — e.g. `worker_release_archive_total{posture="archive-blocked"} > 0` catches a blocked / tampered
 * / regressed record, `{posture="archive-incomplete"} > 0` catches an insufficient / governance-absent record.
 * This counts an offline INDEX that ingested a content-free `pdfxyz.release-governance/1` bundle plus the related
 * `pdfxyz.release-trend/1` / `pdfxyz.release-report/1` / `pdfxyz.release-audit/1` / `pdfxyz.release-ci-bundle/1`
 * records, re-validated each against itself, cross-checked their coherence, and folded them into one archive
 * posture — NOT a cloud call, a deletion, a signature, an approval, a promotion, immutable storage, a raw-file
 * pack, or a claim about bucket bytes. The one label is a closed, redaction-stable enum — never a filename, path,
 * object key, bucket, URL, endpoint, region, instant, size, digest, or record content.
 */
export function releaseArchiveMetric(posture: ReleaseArchivePosture): WorkerMetricSample {
  return {
    metric: "worker_release_archive_total",
    kind: "counter",
    labels: { posture },
    value: 1,
  };
}

/**
 * A performed **release evidence restore drill** (Phase 56) resolved to its restore `verdict`
 * ({@link ReleaseRestoreDrillVerdict}: `restore-verified`/`restore-drift`/`restore-incomplete`/`restore-failed`).
 * One bounded label so a review / disaster-recovery dashboard can count restore drills by the single decision an
 * operator acts on — e.g. `worker_release_restore_drill_total{verdict="restore-failed"} > 0` catches a tampered /
 * blocked pack or a restored record that no longer matches the archive record, `{verdict="restore-incomplete"} > 0`
 * catches an unreadable pack or a drill that restored nothing. This counts an offline VERIFICATION that ingested a
 * content-free `pdfxyz.release-archive/1` pack plus the underlying records an operator RESTORED out of band,
 * re-validated each against itself, and cross-checked their coherence with the pack — NOT a cloud call, a storage
 * retrieval, a deletion, a signature, a promotion, or a claim about bucket bytes. The one label is a closed,
 * redaction-stable enum — never a filename, path, object key, bucket, URL, endpoint, region, instant, size,
 * digest, or record content.
 */
export function releaseRestoreDrillMetric(verdict: ReleaseRestoreDrillVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_restore_drill_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release evidence publish / handoff pack** (Phase 57) resolved to its publish `verdict`
 * ({@link ReleasePublishPackVerdict}: `publishable`/`review`/`incomplete`/`blocked`). One bounded label so a release
 * / handoff dashboard can count handoff packs by the single decision an operator acts on — e.g.
 * `worker_release_publish_pack_total{verdict="blocked"} > 0` catches a package that must NOT be shared (a tampered /
 * blocked / failed evidence set), `{verdict="incomplete"} > 0` catches an insufficient / governance-absent package.
 * This counts an offline PACKAGING that ingested a content-free `pdfxyz.release-governance/1` bundle plus the related
 * `pdfxyz.release-archive/1` / `pdfxyz.release-restore-drill/1` / `pdfxyz.release-report/1` / `pdfxyz.release-trend/1`
 * records, re-validated each against itself, and folded them into one publish verdict + disclosure classification —
 * NOT actual external publishing, a signature, an approval, a promotion, a cloud call, a deletion, or a claim about
 * bucket bytes. The one label is a closed, redaction-stable enum — never a filename, path, object key, bucket, URL,
 * endpoint, region, instant, size, digest, or document content.
 */
export function releasePublishPackMetric(verdict: ReleasePublishPackVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_publish_pack_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release evidence handoff acknowledgement** (Phase 58) resolved to its acknowledgement `verdict`
 * ({@link ReleaseAckVerdict}: `acknowledged`/`acknowledged-with-followup`/`deferred`/`rejected`/`invalid`). One bounded
 * label so a release / handoff dashboard can count acknowledgements by the single outcome an operator recorded — e.g.
 * `worker_release_ack_total{verdict="rejected"} > 0` catches a rejected package, `{verdict="invalid"} > 0` catches an
 * untrustworthy / tampered input. This counts an offline ACKNOWLEDGEMENT that ingested a content-free
 * `pdfxyz.release-publish-pack/1`, re-validated it against itself, and folded the operator's bounded decision into one
 * verdict — NOT an external signature, an approval, an identity attestation, legal / compliance sign-off, or a release
 * promotion. The one label is a closed, redaction-stable enum — never a reviewer identity, a decision, a filename,
 * path, object key, bucket, URL, size, digest, or document content.
 */
export function releaseAckMetric(verdict: ReleaseAckVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_ack_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision record** (Phase 59) resolved to its final `decision`
 * ({@link ReleaseDecisionDecision}: `proceed`/`proceed-with-followup`/`hold`/`reject`/`insufficient`/`invalid`). One
 * bounded label so a release ledger / dashboard can count decisions by the single outcome an operator filed — e.g.
 * `worker_release_decision_total{decision="reject"} > 0` catches a rejected release, `{decision="invalid"} > 0` catches
 * an untrustworthy / incoherent pair, `{decision="insufficient"} > 0` catches an incomplete pack or a deferred
 * acknowledgement. This counts an offline DECISION that ingested a content-free `pdfxyz.release-publish-pack/1` +
 * `pdfxyz.release-ack/1`, re-validated each against itself, cross-checked their coherence, and folded them into one
 * decision — NOT an external signature, an approval, an identity attestation, legal / compliance sign-off, or an actual
 * deployment / promotion. The one label is a closed, redaction-stable enum — never a reviewer identity, a reason id, a
 * filename, path, object key, bucket, URL, size, digest, or document content.
 */
export function releaseDecisionMetric(decision: ReleaseDecisionDecision): WorkerMetricSample {
  return {
    metric: "worker_release_decision_total",
    kind: "counter",
    labels: { decision },
    value: 1,
  };
}

/**
 * A composed **release decision ledger index** (Phase 60) resolved to its index `verdict`
 * ({@link ReleaseDecisionIndexVerdict}: `stable`/`watch`/`insufficient`/`blocked`/`invalid`). One bounded label so a
 * release ledger / review dashboard can count decision-batch reviews by the single outcome a reviewer acts on — e.g.
 * `worker_release_decision_index_total{verdict="blocked"} > 0` catches a rejected / invalid decision in the batch,
 * `{verdict="invalid"} > 0` catches an unreadable / tampered record, `{verdict="insufficient"} > 0` catches an
 * inconclusive batch. This counts an offline INDEX that ingested a bounded batch of content-free
 * `pdfxyz.release-decision/1` records, re-validated each against itself, and folded their decisions into one index
 * verdict — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, a
 * deployment / promotion ledger, a cloud call, a deletion, or a claim about bucket bytes. The one label is a closed,
 * redaction-stable enum — never a reviewer identity, a reason id, a filename, path, object key, bucket, URL, size,
 * digest, or record content.
 */
export function releaseDecisionIndexMetric(verdict: ReleaseDecisionIndexVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_decision_index_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision index trend summary** (Phase 61) resolved to its trend `verdict`
 * ({@link ReleaseDecisionTrendVerdict}: `improving`/`stable`/`watch`/`degrading`/`insufficient`/`blocked`/`invalid`).
 * One bounded label so a release governance / review dashboard can count decision-index trends by the single outcome a
 * reviewer acts on — e.g. `worker_release_decision_trend_total{verdict="blocked"} > 0` catches a blocked / invalid
 * window in the recent history, `{verdict="degrading"} > 0` catches a worsening arc, `{verdict="invalid"} > 0` catches
 * an unreadable / tampered window, `{verdict="insufficient"} > 0` catches an inconclusive history. This counts an
 * offline TREND that ingested a bounded history of content-free `pdfxyz.release-decision-index/1` windows, re-validated
 * each against itself, and folded their index verdicts into one trend verdict — NOT a legal audit log, a compliance
 * attestation, an external approval / signature, an identity proof, a deployment / promotion ledger, a cloud call, a
 * deletion, or a claim about bucket bytes. The one label is a closed, redaction-stable enum — never a reviewer
 * identity, a reason id, a filename, path, object key, bucket, URL, size, digest, or window content.
 */
export function releaseDecisionTrendMetric(verdict: ReleaseDecisionTrendVerdict): WorkerMetricSample {
  return {
    metric: "worker_release_decision_trend_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision trend action plan** (Phase 62) resolved to its plan `verdict`
 * ({@link ReleaseDecisionActionPlanVerdict}: `clear`/`monitor`/`investigate`/`block-release`/`invalid`). One bounded
 * label so a release governance / review dashboard can count decision-trend action plans by the single outcome a
 * reviewer acts on — e.g. `worker_release_decision_action_plan_total{verdict="block-release"} > 0` catches a blocked /
 * invalid / `--strict`-escalated trend, `{verdict="invalid"} > 0` catches an untrustworthy (unreadable / tampered)
 * trend input, `{verdict="investigate"} > 0` catches an inconclusive trend, `{verdict="monitor"} > 0` catches a
 * follow-up (watch / degrading / improving) trend. This counts an offline PLAN that ingested ONE content-free
 * `pdfxyz.release-decision-trend/1` summary, re-validated it against itself, and translated its verdict into one
 * operator follow-up plan — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a
 * deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The one
 * label is a closed, redaction-stable enum — never a reviewer identity, a reason id, an action id, a filename, path,
 * object key, bucket, URL, size, digest, or trend content.
 */
export function releaseDecisionActionPlanMetric(
  verdict: ReleaseDecisionActionPlanVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_action_plan_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision action-plan execution receipt** (Phase 63) resolved to its receipt `verdict`
 * ({@link ReleaseDecisionActionReceiptVerdict}: `completed`/`incomplete`/`followup-open`/`blocked`). One bounded label
 * so a release governance / review dashboard can count decision action-plan receipts by the single outcome a reviewer
 * acts on — e.g. `worker_release_decision_action_receipt_total{verdict="blocked"} > 0` catches a tampered plan, a
 * block plan not acknowledged as held-blocked, a `--strict-open` escalation, or a contradictory acknowledgement;
 * `{verdict="incomplete"} > 0` catches a missing / unusable plan or a missing required acknowledgement;
 * `{verdict="followup-open"} > 0` catches an advisory follow-up still open for a monitor / investigate plan. This
 * counts an offline RECEIPT that ingested ONE content-free `pdfxyz.release-decision-action-plan/1` follow-up plan plus
 * bounded operator acknowledgement flags, re-validated the plan against itself, and recorded whether its required
 * follow-ups were acknowledged — NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a
 * deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The one
 * label is a closed, redaction-stable enum — never a reviewer identity, a reason id, an ack id, a plan class, a count,
 * a filename, path, object key, bucket, URL, size, digest, or plan content.
 */
export function releaseDecisionActionReceiptMetric(
  verdict: ReleaseDecisionActionReceiptVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_action_receipt_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout bundle** (Phase 64) resolved to its closeout `verdict`
 * ({@link ReleaseDecisionCloseoutVerdict}: `closed`/`closeout-incomplete`/`closeout-open`/`closeout-blocked`). One bounded
 * label so a release governance / review dashboard can count decision closeouts by the single outcome a reviewer acts on
 * — e.g. `worker_release_decision_closeout_total{verdict="closeout-blocked"} > 0` catches a tampered / blocked primary
 * receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open` escalation;
 * `{verdict="closeout-incomplete"} > 0` catches a missing / unusable primary receipt or a missing required related record;
 * `{verdict="closeout-open"} > 0` catches a followup-open receipt or an advisory decision / index record. This counts an
 * offline COMPOSITION that ingested ONE content-free `pdfxyz.release-decision-action-receipt/1` receipt plus optional
 * related records, re-validated the receipt against itself, and cross-checked the chain — NOT a legal/compliance sign-off,
 * an external approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record,
 * an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a reviewer
 * identity, a reason id, a record kind, a plan class, a count, a filename, path, object key, bucket, URL, size, digest, or
 * record content.
 */
export function releaseDecisionCloseoutMetric(
  verdict: ReleaseDecisionCloseoutVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout index** (Phase 65) resolved to its index `verdict`
 * ({@link ReleaseDecisionCloseoutIndexVerdict}: `indexed`/`index-incomplete`/`index-open`/`index-blocked`). One bounded
 * label so a release governance / review dashboard can count closeout-history reviews by the single outcome a reviewer
 * acts on — e.g. `worker_release_decision_closeout_index_total{verdict="index-blocked"} > 0` catches a tampered / blocked
 * closeout history or a `--strict-open` escalation, `{verdict="index-incomplete"} > 0` catches a coverage gap (an
 * unreadable closeout, an incomplete latest, or zero usable closeouts), `{verdict="index-open"} > 0` catches an open
 * follow-up posture. This counts an offline INDEX that ingested a bounded history of content-free
 * `pdfxyz.release-decision-closeout/1` records, re-validated each against itself, and folded their closeout verdicts
 * into one index verdict — NOT a legal audit log, a compliance attestation, an external approval / signature, an
 * identity proof, a deployment / promotion ledger, a cloud call, a deletion, or a claim about bucket bytes. The one
 * label is a closed, redaction-stable enum — never a reviewer identity, a reason id, a filename, path, object key,
 * bucket, URL, size, digest, or record content.
 */
export function releaseDecisionCloseoutIndexMetric(
  verdict: ReleaseDecisionCloseoutIndexVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_index_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout index trend** (Phase 66) resolved to its trend `verdict`
 * ({@link ReleaseDecisionCloseoutIndexTrendVerdict}: `trend-stable`/`trend-incomplete`/`trend-watch`/`trend-blocked`).
 * One bounded label so a release governance / review dashboard can count closeout-index-history trends by the single
 * outcome a reviewer acts on — e.g. `worker_release_decision_closeout_index_trend_total{verdict="trend-blocked"} > 0`
 * catches a tampered / blocked closeout-index history or a `--strict-watch` escalation, `{verdict="trend-watch"} > 0`
 * catches an open latest / threshold breach or a worsening arc, `{verdict="trend-incomplete"} > 0` catches a coverage
 * gap (an unreadable window, an incomplete latest, or zero usable windows). This counts an offline TREND that ingested
 * a bounded history of content-free `pdfxyz.release-decision-closeout-index/1` windows, re-validated each against
 * itself, and folded their index verdicts into one trend verdict — NOT a legal audit log, a compliance attestation, an
 * external approval / signature, an identity proof, a deployment / promotion ledger, a cloud call, a deletion, or a
 * claim about bucket bytes. The one label is a closed, redaction-stable enum — never a reviewer identity, a reason id, a
 * filename, path, object key, bucket, URL, size, digest, or window content.
 */
export function releaseDecisionCloseoutIndexTrendMetric(
  verdict: ReleaseDecisionCloseoutIndexTrendVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_index_trend_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout index trend action plan** (Phase 67) resolved to its plan `verdict`
 * ({@link ReleaseDecisionCloseoutActionPlanVerdict}: `clear`/`investigate`/`monitor`/`block-release`). One bounded label
 * so a release governance / review dashboard can count closeout-trend follow-up plans by the single posture the release
 * team acts on — e.g. `worker_release_decision_closeout_action_plan_total{verdict="block-release"} > 0` catches a
 * blocked / tampered / strict-escalated closeout-index trend, `{verdict="investigate"} > 0` catches an inconclusive
 * (trend-incomplete) history, `{verdict="monitor"} > 0` catches a watch / degrading history. This counts an offline PLAN
 * that ingested ONE content-free `pdfxyz.release-decision-closeout-index-trend/1` summary, re-validated it against
 * itself, and translated its verdict into one operator follow-up plan — NOT a legal / compliance sign-off, an external
 * approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, an audit
 * log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a reviewer identity, a
 * reason id, an action id, a count, a filename, path, object key, bucket, URL, size, digest, or trend content.
 */
export function releaseDecisionCloseoutActionPlanMetric(
  verdict: ReleaseDecisionCloseoutActionPlanVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_action_plan_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision closeout action-plan execution receipt** (Phase 68) resolved to its receipt `verdict`
 * ({@link ReleaseDecisionCloseoutActionReceiptVerdict}: `completed`/`incomplete`/`followup-open`/`blocked`). One bounded
 * label so a release governance / review dashboard can count decision closeout action-plan receipts by the single
 * outcome a reviewer acts on — e.g. `worker_release_decision_closeout_action_receipt_total{verdict="blocked"} > 0`
 * catches a missing / unreadable / tampered plan, a block plan not acknowledged as held-blocked, a `--strict-open`
 * escalation, or a contradictory acknowledgement; `{verdict="incomplete"} > 0` catches a missing required
 * acknowledgement for a clear / investigate plan; `{verdict="followup-open"} > 0` catches a monitor plan reviewed but its
 * follow-up still open / not executed. This counts an offline RECEIPT that ingested ONE content-free
 * `pdfxyz.release-decision-closeout-action-plan/1` follow-up plan plus bounded operator acknowledgement flags,
 * re-validated the plan against itself, and recorded whether its required follow-ups were acknowledged / executed — NOT a
 * legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion
 * ledger, an incident record, an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable
 * enum — never a reviewer identity, a reason id, an ack id, a plan class, a count, a filename, path, object key, bucket,
 * URL, size, digest, or plan content.
 */
export function releaseDecisionCloseoutActionReceiptMetric(
  verdict: ReleaseDecisionCloseoutActionReceiptVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_action_receipt_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision closeout governance bundle** (Phase 69) resolved to its governance `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceVerdict}: `closed`/`governance-incomplete`/`governance-open`/
 * `governance-blocked`). One bounded label so a release governance / review dashboard can count decision closeout
 * governance bundles by the single outcome a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_total{verdict="governance-blocked"} > 0` catches a tampered / blocked
 * primary receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open` escalation;
 * `{verdict="governance-incomplete"} > 0` catches a missing / unreadable / incomplete primary receipt, a
 * required-but-missing related record, or an inconclusive source chain; `{verdict="governance-open"} > 0` catches a
 * followup-open receipt or an advisory / open source-chain record. This counts an offline BUNDLE that ingested ONE
 * content-free `pdfxyz.release-decision-closeout-action-receipt/1` primary receipt plus optional related closeout-chain
 * records, re-validated each against itself, cross-checked the chain, and rolled it into ONE governance verdict — NOT a
 * legal/compliance sign-off, an external approval/signature, an identity proof, a deployment authorization, a promotion
 * ledger, an incident record, an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable
 * enum — never a reviewer identity, a reason id, a record kind, a count, a filename, path, object key, bucket, URL, size,
 * digest, or record content.
 */
export function releaseDecisionCloseoutGovernanceMetric(
  verdict: ReleaseDecisionCloseoutGovernanceVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision closeout governance index** (Phase 70) resolved to its index `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceIndexVerdict}: `indexed`/`index-incomplete`/`index-open`/`index-blocked`).
 * One bounded label so a release governance / review dashboard can count decision closeout governance indexes by the
 * single outcome a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_index_total{verdict="index-blocked"} > 0` catches a tampered governance
 * bundle in the history, a `governance-blocked` latest bundle, a blocked-count threshold breach, or a `--strict-open`
 * escalation; `{verdict="index-incomplete"} > 0` catches an unreadable bundle, a `governance-incomplete` latest, an
 * incomplete-count breach, or zero usable bundles; `{verdict="index-open"} > 0` catches a `governance-open` latest or an
 * open-count breach. This counts an offline INDEX that ingested a bounded history of content-free
 * `pdfxyz.release-decision-closeout-governance/1` records, re-validated each against itself, and folded their governance
 * verdicts into ONE index verdict — NOT a legal/compliance sign-off, an external approval/signature, an identity proof,
 * a deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The one
 * label is a closed, redaction-stable enum — never a reviewer identity, a reason id, the per-record governance verdict,
 * the trend class, the latest verdict, a count, a filename, path, object key, bucket, URL, size, digest, or record
 * content.
 */
export function releaseDecisionCloseoutGovernanceIndexMetric(
  verdict: ReleaseDecisionCloseoutGovernanceIndexVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_index_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance index trend** (Phase 71) resolved to its trend `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceIndexTrendVerdict}: `trend-stable`/`trend-incomplete`/`trend-watch`/
 * `trend-blocked`). One bounded label so a release governance / review dashboard can count governance-index-history
 * trends by the single outcome a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_index_trend_total{verdict="trend-blocked"} > 0` catches a tampered /
 * blocked governance-index history or a `--strict-watch` escalation, `{verdict="trend-watch"} > 0` catches an open latest
 * / threshold breach or a worsening arc, `{verdict="trend-incomplete"} > 0` catches a coverage gap (an unreadable window,
 * an incomplete latest, or zero usable windows). This counts an offline TREND that ingested a bounded history of
 * content-free `pdfxyz.release-decision-closeout-governance-index/1` windows, re-validated each against itself, and
 * folded their index verdicts into one trend verdict — NOT a legal audit log, a compliance attestation, an external
 * approval / signature, an identity proof, a deployment / promotion ledger, a cloud call, a deletion, or a claim about
 * bucket bytes. The one label is a closed, redaction-stable enum — never a reviewer identity, a reason id, a filename,
 * path, object key, bucket, URL, size, digest, or window content.
 */
export function releaseDecisionCloseoutGovernanceIndexTrendMetric(
  verdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_index_trend_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance index trend action plan** (Phase 72) resolved to its plan `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceActionPlanVerdict}: `clear`/`investigate`/`monitor`/`block-release`). One
 * bounded label so a release governance / review dashboard can count governance-index-trend follow-up plans by the single
 * posture the release team acts on — e.g.
 * `worker_release_decision_closeout_governance_action_plan_total{verdict="block-release"} > 0` catches a blocked /
 * tampered / strict-escalated governance-index trend, `{verdict="investigate"} > 0` catches an inconclusive
 * (trend-incomplete) history, `{verdict="monitor"} > 0` catches a watch / degrading history. This counts an offline PLAN
 * that ingested ONE content-free `pdfxyz.release-decision-closeout-governance-index-trend/1` summary, re-validated it
 * against itself, and translated its verdict into one operator follow-up plan — NOT a legal / compliance sign-off, an
 * external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record,
 * an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a reviewer
 * identity, a reason id, an action id, a count, a filename, path, object key, bucket, URL, size, digest, or trend
 * content.
 */
export function releaseDecisionCloseoutGovernanceActionPlanMetric(
  verdict: ReleaseDecisionCloseoutGovernanceActionPlanVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_action_plan_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance action-plan execution receipt** (Phase 73) resolved to its receipt
 * `verdict` ({@link ReleaseDecisionCloseoutGovernanceActionReceiptVerdict}: `completed`/`incomplete`/`followup-open`/
 * `blocked`). One bounded label so a release governance / review dashboard can count governance follow-up plan receipts by
 * the single outcome a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_action_receipt_total{verdict="blocked"} > 0` catches a missing / unreadable
 * / tampered plan, a block plan not acknowledged as held-blocked, a `--strict-open` escalation, or a contradictory
 * acknowledgement; `{verdict="incomplete"} > 0` catches a missing required acknowledgement for a clear / investigate plan;
 * `{verdict="followup-open"} > 0` catches a monitor plan reviewed but its follow-up still open / not executed. This counts
 * an offline RECEIPT that ingested ONE content-free `pdfxyz.release-decision-closeout-governance-action-plan/1` follow-up
 * plan plus bounded operator acknowledgement flags, re-validated the plan against itself, and recorded whether its
 * required follow-ups were acknowledged / executed — NOT a legal/compliance sign-off, an external approval/signature, an
 * identity proof, a deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a
 * deletion. The one label is a closed, redaction-stable enum — never a reviewer identity, a reason id, an ack id, a plan
 * class, a count, a filename, path, object key, bucket, URL, size, digest, or plan content.
 */
export function releaseDecisionCloseoutGovernanceActionReceiptMetric(
  verdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_action_receipt_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A release-decision-closeout-governance-FINALIZE run resolved to one bounded `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceFinalizeVerdict}: `finalized`/`finalize-incomplete`/`finalize-open`/
 * `finalize-blocked`). One bounded label so a release governance / review dashboard can count closeout-governance
 * finalizations by the single outcome a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_total{verdict="finalize-blocked"} > 0` catches a tampered /
 * `blocked` primary receipt, a supplied plan / trend that contradicts what the receipt recorded, a tampered related
 * record, a blocked source chain, or a `--strict-open` escalation; `{verdict="finalize-incomplete"} > 0` catches a
 * missing / unreadable / `incomplete` primary receipt, a required-but-missing related record, or an inconclusive source
 * chain; `{verdict="finalize-open"} > 0` catches a `followup-open` receipt or an advisory / open source-chain record.
 * This counts an offline FINALIZATION BUNDLE that ingested ONE content-free
 * `pdfxyz.release-decision-closeout-governance-action-receipt/1` primary receipt plus optional related
 * closeout-governance-chain records, re-validated each against itself, cross-checked the chain, and rolled it into one
 * finalization verdict — NOT a legal/compliance sign-off, an external approval/signature, an identity proof, a
 * deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The one
 * label is a closed, redaction-stable enum — never a reviewer identity, a reason id, a record kind, a per-record
 * verdict, a count, a filename, path, object key, bucket, URL, size, digest, or record content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision closeout governance finalize index** (Phase 75) resolved to its index `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict}: `indexed`/`index-open`/`index-incomplete`/
 * `index-blocked`/`index-invalid`). One bounded label so a release governance / review dashboard can count
 * closeout-governance finalization indexes by the single outcome a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_total{verdict="index-invalid"} > 0` catches a tampered
 * (does-not-re-derive) or unreadable finalization bundle in the history; `{verdict="index-blocked"} > 0` catches a
 * `finalize-blocked` latest bundle, any blocked bundle in the window, or a `--strict-open` escalation;
 * `{verdict="index-incomplete"} > 0` catches a `finalize-incomplete` latest, an incomplete-count breach, a
 * `--require-latest-finalized` miss, or zero usable bundles; `{verdict="index-open"} > 0` catches a `finalize-open`
 * latest or an open-count breach. This counts an offline INDEX that ingested a bounded history of content-free
 * `pdfxyz.release-decision-closeout-governance-finalize/1` records, re-validated each against itself, and folded their
 * finalization verdicts into ONE index verdict — NOT a legal/compliance sign-off, an external approval/signature, an
 * identity proof, a deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a
 * deletion. The one label is a closed, redaction-stable enum — never a reviewer identity, a reason id, the per-record
 * finalization verdict, the trend class, the latest verdict, a count, a filename, path, object key, bucket, URL, size,
 * digest, or record content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision closeout governance finalize index trend** (Phase 76) resolved to its trend `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict}: `improving`/`stable`/`watch`/`degrading`/
 * `insufficient`/`blocked`/`invalid`). One bounded label so a release governance / review dashboard can count
 * closeout-governance finalization TRENDS by the single outcome a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_total{verdict="invalid"} > 0` catches a tampered
 * (does-not-re-derive) or unreadable finalize-index window in the history; `{verdict="blocked"} > 0` catches an
 * `index-blocked` / `index-invalid` usable window or a `--strict-open` escalation; `{verdict="insufficient"} > 0`
 * catches zero usable windows, an `index-incomplete` latest, or an only-incomplete history; `{verdict="degrading"} > 0`
 * catches an `index-open` latest or a degrading arc; `{verdict="watch"} > 0` catches an older open / incomplete window
 * under a clean latest. This counts an offline TREND that ingested a bounded history of content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index/1` windows, re-validated each against itself, and folded
 * their index verdicts into ONE trend verdict — NOT a legal/compliance sign-off, an external approval/signature, an
 * identity proof, a deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a
 * deletion. The one label is a closed, redaction-stable enum — never a reviewer identity, a reason id, the per-window
 * index verdict, the trend class, the latest verdict, a count, a filename, path, object key, bucket, URL, size, digest,
 * or window content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance finalize index trend action plan** (Phase 77) resolved to its plan
 * `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict}:
 * `clear`/`monitor`/`investigate`/`block-release`/`invalid`). One bounded label so a release governance / review
 * dashboard can count finalize-index-trend follow-up plans by the single posture the release team acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_action_plan_total{verdict="block-release"} > 0`
 * catches a blocked / invalid-history / escalated trend, `{verdict="invalid"} > 0` catches an unreadable / tampered trend
 * input, `{verdict="investigate"} > 0` catches an inconclusive (insufficient) history, `{verdict="monitor"} > 0` catches
 * a watch / degrading history. This counts an offline PLAN that ingested ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` summary, re-validated it against itself, and
 * translated its verdict into one operator follow-up plan — NOT a legal / compliance sign-off, an external approval /
 * signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, an audit log, a
 * cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a reviewer identity, a reason id,
 * an action id, a count, a filename, path, object key, bucket, URL, size, digest, or trend content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_action_plan_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance finalize index trend action-plan execution receipt** (Phase 78)
 * resolved to its receipt `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict}:
 * `completed`/`incomplete`/`blocked`/`invalid`). One bounded label so a release governance / review dashboard can count
 * finalize-index-trend action-plan close-outs by the single posture a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_action_receipt_total{verdict="invalid"} > 0` catches
 * a missing / unreadable / tampered plan or a plan whose own verdict is invalid; `{verdict="blocked"} > 0` catches a
 * block-release plan (release held), a contradictory acknowledgement, or a `--strict-open` escalation;
 * `{verdict="incomplete"} > 0` catches a missing required acknowledgement for a clear / monitor / investigate plan. This
 * counts an offline RECEIPT that ingested ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` follow-up plan plus bounded operator
 * acknowledgement flags, re-validated the plan against itself, and recorded whether its required acknowledgements were
 * supplied — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment
 * authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The one label is a
 * closed, redaction-stable enum — never a reviewer identity, a reason id, an ack id, a plan class, a count, a filename,
 * path, object key, bucket, URL, size, digest, or plan content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_action_receipt_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance finalize index trend FINALIZATION record** (Phase 79) resolved to its
 * finalization `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict}:
 * `finalized`/`finalize-open`/`finalize-incomplete`/`finalize-blocked`/`finalize-invalid`). One bounded label so a release
 * governance / review dashboard can count finalize-index-trend follow-up loops by the single posture a reviewer acts on —
 * e.g. `worker_release_decision_closeout_governance_finalize_index_trend_finalize_total{verdict="finalize-invalid"} > 0`
 * catches an unreadable / tampered / wrong-schema primary receipt or a tampered supplied source;
 * `{verdict="finalize-blocked"} > 0` catches a `blocked` / `invalid` receipt verdict, a contradictory source-chain record,
 * a blocked source chain, or a `--strict-open` escalation; `{verdict="finalize-incomplete"} > 0` catches an `incomplete`
 * receipt, a required-but-missing record, or an inconclusive source chain. This counts an offline FINALIZATION that
 * ingested ONE content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` primary
 * receipt plus optional source-chain records, re-validated each against itself, cross-checked the loop, and folded them
 * into one finalization verdict — NOT a legal / compliance sign-off, an external approval / signature, an identity proof,
 * a deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The one
 * label is a closed, redaction-stable enum — never a reviewer identity, a reason id, a record kind, a count, a filename,
 * path, object key, bucket, URL, size, digest, or record content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance finalize index trend finalize INDEX** (Phase 80) resolved to its
 * composite index `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict}:
 * `indexed`/`index-open`/`index-incomplete`/`index-blocked`/`index-invalid`). One bounded label so a release governance
 * / review dashboard can count finalization-history indexes by the single posture a reviewer acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_total{verdict="index-invalid"} > 0`
 * catches a tampered / unreadable record in the indexed history; `{verdict="index-blocked"} > 0` catches a blocked
 * latest / any blocked record / a `--strict-open` escalation; `{verdict="index-incomplete"} > 0` catches a coverage gap;
 * `{verdict="index-open"} > 0` catches an open follow-up posture. This counts an offline INDEX that ingested a bounded
 * history of content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` records,
 * re-validated each against itself, and folded them into one index verdict — NOT a legal / compliance sign-off, an
 * external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record,
 * an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a reviewer
 * identity, a reason id, a count, a filename, path, object key, bucket, URL, size, digest, or record content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A recorded **release decision closeout governance finalize index trend finalize index trend** (Phase 81) resolved to
 * its trend `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict}:
 * `improving`/`stable`/`watch`/`degrading`/`insufficient`/`blocked`/`invalid`). One bounded label so a release
 * governance / review dashboard can count closeout-governance finalization-index TRENDS by the single outcome a reviewer
 * acts on — e.g. `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_total{verdict="invalid"} > 0`
 * catches a tampered (does-not-re-derive) or unreadable finalization-index window in the history; `{verdict="blocked"} > 0`
 * catches an `index-blocked` / `index-invalid` usable window or a `--strict-open` escalation; `{verdict="insufficient"} > 0`
 * catches zero usable windows, an `index-incomplete` latest, or an only-incomplete history; `{verdict="degrading"} > 0`
 * catches an `index-open` latest or a degrading arc; `{verdict="watch"} > 0` catches an older open / incomplete window
 * under a clean latest. This counts an offline TREND that ingested a bounded history of content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` windows, re-validated each against
 * itself, and folded their index verdicts into ONE trend verdict — NOT a legal/compliance sign-off, an external
 * approval/signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, an audit
 * log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a reviewer identity, a
 * reason id, the per-window index verdict, the trend class, the latest verdict, a count, a filename, path, object key,
 * bucket, URL, size, digest, or window content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance finalize index trend finalize index trend action plan** (Phase 82)
 * resolved to its plan `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict}:
 * `clear`/`monitor`/`investigate`/`block-release`/`invalid`). One bounded label so a release governance / review
 * dashboard can count finalize-index-trend-finalize-index-trend follow-up plans by the single posture the release team
 * acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_plan_total{verdict="block-release"} > 0`
 * catches a blocked / invalid-history / escalated trend, `{verdict="invalid"} > 0` catches an unreadable / tampered trend
 * input, `{verdict="investigate"} > 0` catches an inconclusive (insufficient) history, `{verdict="monitor"} > 0` catches
 * a watch / degrading history. This counts an offline PLAN that ingested ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1` summary, re-validated it
 * against itself, and translated its verdict into one operator follow-up plan — NOT a legal / compliance sign-off, an
 * external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record,
 * an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a reviewer
 * identity, a reason id, an action id, a count, a filename, path, object key, bucket, URL, size, digest, or trend content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_plan_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * One release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt run, resolved to its
 * receipt `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict}:
 * `completed`/`incomplete`/`followup-open`/`blocked`/`invalid`). One bounded label so a release governance / review
 * dashboard can count finalize-index-trend-finalize-index-trend action-plan execution receipts by the single posture the
 * release team acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_receipt_total{verdict="invalid"} > 0`
 * catches a missing / unreadable / tampered plan, `{verdict="blocked"} > 0` catches an unacknowledged block plan, a
 * contradictory acknowledgement, or a `--strict-open` escalation, `{verdict="followup-open"} > 0` catches an open advisory
 * follow-up, `{verdict="incomplete"} > 0` catches a missing required acknowledgement. This counts an offline RECEIPT that
 * ingested ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` plan plus bounded
 * acknowledgement flags, re-validated it against itself, and recorded whether the plan was closed out — NOT a legal /
 * compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion
 * ledger, an incident record, an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum
 * — never a reviewer identity, a reason id, an ack id, a count, a filename, path, object key, bucket, URL, size, digest, or
 * plan content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_receipt_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * One release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout run, resolved to its
 * closeout `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict}:
 * `closed`/`open`/`incomplete`/`blocked`/`invalid`). One bounded label so a release governance / review dashboard can
 * count finalization-index-trend follow-up-loop closeouts by the single posture the release team acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_total{verdict="invalid"} > 0`
 * catches a missing / unreadable / tampered receipt, `{verdict="blocked"} > 0` catches a blocked receipt, a contradictory
 * related record, a blocked source chain, or a `--strict-open` escalation, `{verdict="open"} > 0` catches an open advisory
 * follow-up, `{verdict="incomplete"} > 0` catches an incomplete receipt or a missing required related record. This counts
 * an offline CLOSEOUT that ingested ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/1` receipt plus
 * optional related records, re-validated it against itself, and recorded whether the follow-up loop reads as closed out —
 * NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a
 * promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The one label is a closed,
 * redaction-stable enum — never a reviewer identity, a reason id, a record kind, a count, a filename, path, object key,
 * bucket, URL, size, digest, or record content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * One release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-INDEX run, resolved to its
 * composite index `verdict` ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict}:
 * `indexed`/`index-open`/`index-incomplete`/`index-blocked`/`index-invalid`). One bounded label so a release governance /
 * review dashboard can count finalization-index-trend follow-up-loop closeout INDEXES by the single posture the release
 * team acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_total{verdict="index-invalid"} > 0`
 * catches a tampered / unreadable closeout record in the history, `{verdict="index-blocked"} > 0` catches a blocked /
 * invalid latest / any blocked-or-invalid record or a `--strict-open` escalation, `{verdict="index-incomplete"} > 0`
 * catches a coverage gap (zero usable records, an incomplete latest / breach, a require-latest miss), `{verdict="index-open"} > 0`
 * catches an open follow-up posture. This counts an offline INDEX that ingested a bounded history of content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout/1` records, re-validated
 * each against itself, and recorded whether the recent history reads as consistently closed — NOT a legal / compliance
 * sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an
 * incident record, an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a
 * reviewer identity, a reason id, a record kind, a count, a filename, path, object key, bucket, URL, size, digest, or
 * record content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * One release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-TREND run, resolved to
 * its composite trend `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendVerdict}:
 * `improving`/`stable`/`watch`/`degrading`/`insufficient`/`blocked`/`invalid`). One bounded label so a release governance /
 * review dashboard can count closeout-INDEX-TREND summaries by the single posture the release team acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_total{verdict="invalid"} > 0`
 * catches a tampered / unreadable closeout-index window in the history, `{verdict="blocked"} > 0` catches a blocked /
 * invalid-posture window over threshold / as latest or a `--strict-watch` escalation, `{verdict="insufficient"} > 0` catches
 * a coverage gap, `{verdict="degrading"} > 0` a worsening arc. This counts an offline TREND that ingested a bounded history
 * of content-free `…-closeout-index/1` windows, re-validated each against itself, and recorded whether the recent closeout
 * indexing trended consistently closed — NOT a legal / compliance sign-off, an external approval / signature, an identity
 * proof, a deployment authorization, a promotion ledger, an incident record, an audit log, a cloud call, or a deletion. The
 * one label is a closed, redaction-stable enum — never a reviewer identity, a reason id, a count, a filename, path, object
 * key, bucket, URL, size, digest, or window content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_total",
    kind: "counter",
    labels: { verdict },
    value: 1,
  };
}

/**
 * A composed **release decision closeout governance finalize index trend finalize index trend closeout index trend action
 * plan** (Phase 87) resolved to its plan `verdict`
 * ({@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict}:
 * `clear`/`monitor`/`investigate`/`block-release`/`invalid`). One bounded label so a release governance / review
 * dashboard can count closeout-index-trend follow-up plans by the single posture the release team acts on — e.g.
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_action_plan_total{verdict="block-release"} > 0`
 * catches a blocked / invalid-history / escalated trend, `{verdict="invalid"} > 0` catches an unreadable / tampered trend
 * input, `{verdict="investigate"} > 0` catches an inconclusive (insufficient) history, `{verdict="monitor"} > 0` catches
 * a watch / degrading history. This counts an offline PLAN that ingested ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1` summary,
 * re-validated it against itself, and translated its verdict into one operator follow-up plan — NOT a legal / compliance
 * sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an
 * incident record, an audit log, a cloud call, or a deletion. The one label is a closed, redaction-stable enum — never a
 * reviewer identity, a reason id, an action id, a count, a filename, path, object key, bucket, URL, size, digest, or trend content.
 */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanMetric(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict,
): WorkerMetricSample {
  return {
    metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_action_plan_total",
    kind: "counter",
    labels: { verdict },
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
