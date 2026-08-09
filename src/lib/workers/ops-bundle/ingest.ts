/**
 * Pure, node-free **ingest parser** for the operations evidence bundle CLI (Phase 45).
 *
 * The bundle composes an operator's own content-free tool summaries: the REQUIRED
 * `pdfxyz.ops-check/1` result (from `pnpm worker:ops-check --json`) and an OPTIONAL
 * `pdfxyz.cleanup-pipeline/1` summary (from `pnpm worker:cleanup-pipeline --json`). This module
 * turns that untrusted JSON into the bundle's bounded section shapes.
 *
 * It is the bundle's **trust boundary**, and it is deliberately paranoid about honesty, in the
 * same spirit as the ops-check ingest it composes:
 *  - **No-leak by reconstruction.** It NEVER copies a string field out of the input. Every
 *    load-bearing field is validated against a bounded enum; the sections are rebuilt from those
 *    enums with ALL prose re-authored from the app's own maps. A hand-crafted summary carrying a
 *    filename, endpoint, or secret in a `detail`/`summary` field can never reach the output — the
 *    offending string is simply dropped.
 *  - **No fake liveness.** `daemonObserved` is RECOMPUTED as `liveness.state === "observed"`,
 *    never trusted from the input.
 *  - **Bounded counts.** Counts are coerced to finite, non-negative, safe integers; arrays are
 *    capped, so a pathological input cannot bloat or skew the bundle.
 *
 * Only the required operations input is fatal when unreadable/unrecognized/invalid (there is no
 * bundle to anchor without it); everything else degrades to a safe, honest posture.
 */

import {
  ALERT_ACTIONS,
  ALERT_REASONS,
  ALERT_SEVERITIES,
  reportActionDetail,
  type AlertSource,
} from "../observability/alerts";
import {
  RECOMMENDED_ACTION_DETAIL,
  type HealthClass,
  type ProofAvailability,
  type RecommendedAction,
  type SnapshotSubsystemId,
  type SnapshotVantage,
} from "../observability/snapshot";
import { SLO_IDS, type SloStatus } from "../observability/slo";
import { OPS_CHECK_SCHEMA } from "../ops-check/render";
import {
  CLEANUP_EVIDENCE_DETAIL,
  CLEANUP_EVIDENCE_FRESHNESS,
  CLEANUP_EVIDENCE_PROVIDERS,
  CLEANUP_EVIDENCE_REASONS,
  CLEANUP_EVIDENCE_STATES,
} from "../cleanup-evidence/types";
import {
  PIPELINE_ARMS,
  PIPELINE_SCHEMA,
  PIPELINE_SEVERITIES,
} from "../cleanup/pipeline/types";
import type { DaemonLivenessState, HeartbeatAgeBucket, HeartbeatSource } from "../heartbeat/types";
import {
  OPS_BUNDLE_OPERATIONS_SUMMARY,
  type OpsBundleAlert,
  type OpsBundleCleanupEvidenceSection,
  type OpsBundleIssueCode,
  type OpsBundleLifecycleSection,
  type OpsBundleLifecycleVerdict,
  type OpsBundleOperationsSection,
  type OpsBundlePipelineArm,
  type OpsBundlePipelineSection,
  type OpsBundleSloIssue,
  type OpsBundleSloSection,
} from "./types";

/* ------------------------------------------------------------------ *
 *  Bounded enum allowlists (drift-proof via exhaustiveness guards)
 * ------------------------------------------------------------------ */

/** Compile-time assertion that a tuple covers a whole union (`Extra` must be `never`). */
type AssertNever<Extra> = [Extra] extends [never] ? true : false;

const HEALTH_CLASSES = ["ok", "warn", "blocked", "unknown"] as const satisfies readonly HealthClass[];
const _health: AssertNever<Exclude<HealthClass, (typeof HEALTH_CLASSES)[number]>> = true;

const VANTAGES = ["web", "worker"] as const satisfies readonly SnapshotVantage[];
const _vantage: AssertNever<Exclude<SnapshotVantage, (typeof VANTAGES)[number]>> = true;

const PROOF_STATES = [
  "available",
  "unavailable",
  "unknown",
] as const satisfies readonly ProofAvailability[];
const _proof: AssertNever<Exclude<ProofAvailability, (typeof PROOF_STATES)[number]>> = true;

const LIVENESS_STATES = [
  "observed",
  "stale",
  "unknown",
  "disabled",
] as const satisfies readonly DaemonLivenessState[];
const _liveness: AssertNever<Exclude<DaemonLivenessState, (typeof LIVENESS_STATES)[number]>> = true;

const LIVENESS_SOURCES = [
  "queue-broker",
  "self",
  "none",
] as const satisfies readonly HeartbeatSource[];
const _livenessSrc: AssertNever<Exclude<HeartbeatSource, (typeof LIVENESS_SOURCES)[number]>> = true;

const AGE_BUCKETS = [
  "under-30s",
  "under-2m",
  "under-10m",
  "over-10m",
] as const satisfies readonly HeartbeatAgeBucket[];
const _age: AssertNever<Exclude<HeartbeatAgeBucket, (typeof AGE_BUCKETS)[number]>> = true;

const SUBSYSTEM_IDS = [
  "drainability",
  "storage",
  "queue",
  "compression-engine",
  "ocr",
  "malware-scan",
  "rate-limit",
  "lifecycle",
  "lifecycle-verification",
  "cleanup-evidence",
  "guardrails",
  "daemon-loop",
] as const satisfies readonly SnapshotSubsystemId[];
const _subsystem: AssertNever<Exclude<SnapshotSubsystemId, (typeof SUBSYSTEM_IDS)[number]>> = true;

const SLO_STATUSES = ["ok", "warn", "breach", "unknown"] as const satisfies readonly SloStatus[];
const _sloStatus: AssertNever<Exclude<SloStatus, (typeof SLO_STATUSES)[number]>> = true;

/**
 * The valid `RecommendedAction` set, taken from the app's own detail map so it can never drift
 * from the authored prose (a new action must be added to the map, which grows this allowlist).
 */
const RECOMMENDED_ACTIONS = Object.keys(RECOMMENDED_ACTION_DETAIL) as readonly RecommendedAction[];

// Reference the exhaustiveness consts so lint never flags them as dead.
void _health;
void _vantage;
void _proof;
void _liveness;
void _livenessSrc;
void _age;
void _subsystem;
void _sloStatus;

/* ------------------------------------------------------------------ *
 *  Bounds + small helpers
 * ------------------------------------------------------------------ */

const MAX_SUBSYSTEMS = 32;
const MAX_ALERTS = 64;
const MAX_SLO_ISSUES = 32;
const MAX_ARMS = 8;

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

/** An array, or `[]`. Never throws; a non-array degrades to empty. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Validate an alert source: `"liveness"`, a known subsystem id, or a known SLO id. */
function oneOfAlertSource(value: unknown): AlertSource | undefined {
  if (value === "liveness") return "liveness";
  return oneOf(value, SUBSYSTEM_IDS) ?? oneOf(value, SLO_IDS);
}

/* ------------------------------------------------------------------ *
 *  Operations result ingest (REQUIRED input)
 * ------------------------------------------------------------------ */

/** The bounded sections extracted from a valid ops-check result. */
export interface IngestedOperations {
  readonly operations: OpsBundleOperationsSection;
  readonly slo: OpsBundleSloSection | null;
  readonly cleanupEvidence: OpsBundleCleanupEvidenceSection;
  readonly lifecycle: OpsBundleLifecycleSection;
}

/** Either the extracted sections, or bounded issue codes explaining the rejection. */
export type IngestOperationsResult =
  | { readonly ok: true; readonly value: IngestedOperations }
  | { readonly ok: false; readonly issues: readonly OpsBundleIssueCode[] };

/** Re-author the bounded liveness digest from an ops-check result's `liveness` object. */
function ingestLiveness(raw: unknown): OpsBundleOperationsSection["liveness"] {
  const obj = isObject(raw) ? raw : {};
  return {
    state: oneOf(obj.state, LIVENESS_STATES) ?? "unknown",
    source: oneOf(obj.source, LIVENESS_SOURCES) ?? "none",
    lastSeen: oneOf(obj.lastSeen, AGE_BUCKETS) ?? null,
    severity: oneOf(obj.severity, ALERT_SEVERITIES) ?? "unknown",
    reason: oneOf(obj.reason, ALERT_REASONS) ?? "indeterminate",
    action: oneOf(obj.action, ALERT_ACTIONS) ?? "none",
  };
}

/** Re-author the bounded subsystem list (invalid ids/healths dropped, length capped). */
function ingestSubsystems(raw: unknown): OpsBundleOperationsSection["subsystems"] {
  const out: { id: SnapshotSubsystemId; health: HealthClass }[] = [];
  for (const item of asArray(raw).slice(0, MAX_SUBSYSTEMS)) {
    if (!isObject(item)) continue;
    const id = oneOf(item.id, SUBSYSTEM_IDS);
    const health = oneOf(item.health, HEALTH_CLASSES);
    if (id && health) out.push({ id, health });
  }
  return out;
}

/** Re-author the bounded alert list (invalid enums dropped, length capped, free text discarded). */
function ingestAlerts(raw: unknown): readonly OpsBundleAlert[] {
  const out: OpsBundleAlert[] = [];
  for (const item of asArray(raw).slice(0, MAX_ALERTS)) {
    if (!isObject(item)) continue;
    const source = oneOfAlertSource(item.source);
    const severity = oneOf(item.severity, ALERT_SEVERITIES);
    const reason = oneOf(item.reason, ALERT_REASONS);
    const action = oneOf(item.action, ALERT_ACTIONS);
    if (source && severity && reason && action) out.push({ source, severity, reason, action });
  }
  return out;
}

/** Re-author the SLO digest (bounded id + status only; content-free free-text numbers dropped). */
function ingestSlo(raw: unknown): OpsBundleSloSection | null {
  if (!isObject(raw)) return null;
  const worst = oneOf(raw.worst, SLO_STATUSES) ?? "unknown";
  const issues: OpsBundleSloIssue[] = [];
  for (const item of asArray(raw.issues).slice(0, MAX_SLO_ISSUES)) {
    if (!isObject(item)) continue;
    const id = oneOf(item.id, SLO_IDS);
    const status = oneOf(item.status, SLO_STATUSES);
    if (id && status) issues.push({ id, status });
  }
  const evaluated = safeCount(raw.evaluated);
  const total = safeCount(raw.total);
  return {
    source: "ops-check",
    worst,
    evaluated,
    total,
    issues,
    detail:
      total > 0
        ? `${evaluated} of ${total} SLO indicators had enough data to judge; worst observed status is ${worst}.`
        : "No SLO window was available in the operations result.",
  };
}

/** Re-author the cleanup evidence posture digest from the snapshot's bounded enums. */
function ingestCleanupEvidence(raw: unknown): OpsBundleCleanupEvidenceSection {
  const obj = isObject(raw) ? raw : {};
  const reason = oneOf(obj.reason, CLEANUP_EVIDENCE_REASONS) ?? "no_report_configured";
  return {
    source: "ops-check",
    state: oneOf(obj.state, CLEANUP_EVIDENCE_STATES) ?? "disabled",
    reason,
    provider: oneOf(obj.provider, CLEANUP_EVIDENCE_PROVIDERS) ?? "unknown",
    freshness: oneOf(obj.freshness, CLEANUP_EVIDENCE_FRESHNESS) ?? "unknown",
    detail: CLEANUP_EVIDENCE_DETAIL[reason],
  };
}

/** The authored lifecycle detail per derived verdict. */
const LIFECYCLE_DETAIL: Record<OpsBundleLifecycleVerdict, string> = {
  verified:
    "The lifecycle verification subsystem reports the observed retention policy matches (or is stricter than) the declared one.",
  drift:
    "The lifecycle verification subsystem reports drift: the observed retention policy is missing, weaker, or disabled versus the declared one. Reconcile it out-of-band.",
  unknown:
    "Lifecycle verification is undeclared or was not observed in this operations result, so its verdict cannot be claimed.",
};

/**
 * Derive the bounded lifecycle posture from the operations result's subsystem healths + alerts.
 * The ops-check result does not carry the raw verifier verdict, so `verdict` is derived and never
 * claims a state stronger than the bounded signals support.
 */
function ingestLifecycle(
  subsystems: OpsBundleOperationsSection["subsystems"],
  alerts: readonly OpsBundleAlert[],
): OpsBundleLifecycleSection {
  const verification =
    subsystems.find((s) => s.id === "lifecycle-verification")?.health ?? "unknown";
  const readiness = subsystems.find((s) => s.id === "lifecycle")?.health ?? "unknown";
  const drift = alerts.some((a) => a.reason === "lifecycle-drift");
  const verdict: OpsBundleLifecycleVerdict = drift
    ? "drift"
    : verification === "ok"
      ? "verified"
      : "unknown";
  return { source: "ops-check", verification, readiness, verdict, drift, detail: LIFECYCLE_DETAIL[verdict] };
}

/**
 * Parse + validate an ops-check result. Fatal (usage error) only when the input is unreadable,
 * carries the wrong schema, is itself an ops-check usage error, or lacks a load-bearing
 * `severity`/`snapshot`; otherwise the sections degrade honestly.
 */
export function ingestOpsCheckResult(text: string): IngestOperationsResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["ops-check-input-malformed"] };
  }
  if (!isObject(root)) return { ok: false, issues: ["ops-check-input-malformed"] };
  if (root.schema !== OPS_CHECK_SCHEMA) return { ok: false, issues: ["ops-check-input-unrecognized"] };
  if (root.error === "usage") return { ok: false, issues: ["ops-check-usage-error"] };

  const severity = oneOf(root.severity, ALERT_SEVERITIES);
  const snapshot = root.snapshot;
  if (!severity || !isObject(snapshot)) {
    return { ok: false, issues: ["ops-check-input-invalid"] };
  }

  const liveness = ingestLiveness(root.liveness);
  const subsystems = ingestSubsystems(snapshot.subsystems);
  const alerts = ingestAlerts(root.alerts);
  const action = oneOf(root.action, RECOMMENDED_ACTIONS) ?? "none";
  const proofsRaw = isObject(snapshot.proofs) ? snapshot.proofs : {};

  const operations: OpsBundleOperationsSection = {
    source: "ops-check",
    severity,
    health: oneOf(snapshot.health, HEALTH_CLASSES) ?? "unknown",
    vantage: oneOf(snapshot.vantage, VANTAGES) ?? "worker",
    drainable: snapshot.drainable === true,
    // No fake liveness: recompute from the bounded liveness state, never trust the input flag.
    daemonObserved: liveness.state === "observed",
    action,
    // Re-authored (never echoed), through the same policy helper the alert report
    // uses — so a non-ok bundle never re-introduces "everything is healthy; no
    // action is required" beside the alerts that contradict it.
    actionDetail: reportActionDetail(severity, action, alerts.length),
    liveness,
    subsystems,
    proofs: {
      compressionDeep: oneOf(proofsRaw.compressionDeep, PROOF_STATES) ?? "unknown",
      ocr: oneOf(proofsRaw.ocr, PROOF_STATES) ?? "unknown",
    },
    alerts,
    summary: OPS_BUNDLE_OPERATIONS_SUMMARY[severity],
  };

  return {
    ok: true,
    value: {
      operations,
      slo: ingestSlo(root.slo),
      cleanupEvidence: ingestCleanupEvidence(snapshot.cleanupEvidence),
      lifecycle: ingestLifecycle(subsystems, alerts),
    },
  };
}

/* ------------------------------------------------------------------ *
 *  Cleanup-pipeline summary ingest (OPTIONAL input)
 * ------------------------------------------------------------------ */

/** The authored pipeline detail for the "no valid summary" cases. */
const PIPELINE_NOT_CONFIGURED_DETAIL =
  "No cleanup-pipeline summary was supplied, so pipeline posture is not included. Point it at a " +
  "content-free `pnpm worker:cleanup-pipeline --json` summary to include it.";
const PIPELINE_UNREADABLE_DETAIL =
  "The supplied cleanup-pipeline input is not a recognized content-free `pdfxyz.cleanup-pipeline/1` " +
  "summary (unreadable, malformed, or the wrong shape), so its posture could not be included. The " +
  "offending content is never echoed.";

/** The bounded pipeline section for a not-configured (absent) optional input. */
export const NOT_CONFIGURED_PIPELINE: OpsBundlePipelineSection = {
  source: "not-configured",
  severity: null,
  arms: [],
  detail: PIPELINE_NOT_CONFIGURED_DETAIL,
};

/** The bounded pipeline section for a supplied-but-unreadable optional input (never echoed). */
export function unreadablePipeline(): OpsBundlePipelineSection {
  return { source: "unreadable", severity: null, arms: [], detail: PIPELINE_UNREADABLE_DETAIL };
}

/** Re-author the bounded per-arm digest (invalid enums dropped, length capped). */
function ingestPipelineArms(raw: unknown): OpsBundlePipelineArm[] {
  const out: OpsBundlePipelineArm[] = [];
  for (const item of asArray(raw).slice(0, MAX_ARMS)) {
    if (!isObject(item)) continue;
    const arm = oneOf(item.arm, PIPELINE_ARMS);
    const severity = oneOf(item.severity, PIPELINE_SEVERITIES);
    if (arm && severity) out.push({ arm, severity, projected: item.projected === true });
  }
  return out;
}

/**
 * Parse + validate an OPTIONAL cleanup-pipeline summary. `null` text ⇒ not-configured; anything
 * unreadable/unrecognized ⇒ `unreadable` (never echoed); a valid summary ⇒ `supplied` with a
 * bounded severity + per-arm digest.
 */
export function ingestPipelineSummary(text: string | null): OpsBundlePipelineSection {
  if (text === null) return NOT_CONFIGURED_PIPELINE;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return unreadablePipeline();
  }
  if (!isObject(root) || root.schema !== PIPELINE_SCHEMA) return unreadablePipeline();
  const severity = oneOf(root.severity, PIPELINE_SEVERITIES);
  if (!severity) return unreadablePipeline();
  return {
    source: "supplied",
    severity,
    arms: ingestPipelineArms(root.arms),
    detail: `A cleanup-pipeline summary was supplied; its composite severity is ${severity}.`,
  };
}
