/**
 * The bounded, content-free vocabulary for the **operations evidence bundle** (Phase 45).
 *
 * Phases 30–44 gave an operator a family of content-free, offline signals about the secure
 * worker: the operations snapshot / healthcheck (`pnpm worker:ops-check`), the cleanup
 * evidence posture monitor (Phase 44), the lifecycle verification posture, the SLO/metrics
 * windows, and the one-command cleanup pipeline (`pnpm worker:cleanup-pipeline`). Each already
 * emits a stable, content-free JSON **report summary**. This phase closes the incident-handoff
 * loop: it composes those already-safe summaries into ONE stable, bounded artifact an on-call
 * operator can attach to a support ticket, a CI job, or an incident timeline — without
 * re-deriving anything from the cloud and without ever seeing a locator or a byte.
 *
 * This module is the closed vocabulary the bundle produces. It obeys the same honesty
 * contract as the rest of the worker layer:
 *  - it READS only content-free tool summaries an operator's own commands already wrote (the
 *    `pdfxyz.ops-check/1` result and, optionally, the `pdfxyz.cleanup-pipeline/1` summary) —
 *    never a raw provider export, never real bucket data, never a live cloud call;
 *  - every token here is a low-cardinality, redaction-stable enum — never a filename, object
 *    key, bucket, URL, endpoint, region, id, token, size, instant, path, or byte;
 *  - it never fabricates health from a missing or unreadable input: an absent optional signal
 *    is honestly `not-configured`, an unreadable one is `unreadable`, and a bad REQUIRED input
 *    is a usage error — never a false `ok`.
 *
 * It is deliberately NOT a new evidence rung. The bundle proves nothing the composed tools do
 * not already prove; it is an AGGREGATOR. The caveats it carries (see {@link OPS_BUNDLE_CAVEATS})
 * say so out loud: it is not deletion proof, not malware scanning, not authentication, not byte
 * integrity, and not cloud validation.
 */

import type {
  AlertAction,
  AlertReason,
  AlertSeverity,
  AlertSource,
} from "../observability/alerts";
import type {
  HealthClass,
  ProofAvailability,
  RecommendedAction,
  SnapshotSubsystemId,
  SnapshotVantage,
} from "../observability/snapshot";
import type { SloId, SloStatus } from "../observability/slo";
import type {
  DaemonLivenessState,
  HeartbeatAgeBucket,
  HeartbeatSource,
} from "../heartbeat/types";
import type {
  CleanupEvidenceFreshness,
  CleanupEvidenceProvider,
  CleanupEvidenceReason,
  CleanupEvidenceState,
} from "../cleanup-evidence/types";
import type { PipelineArm, PipelineSeverity } from "../cleanup/pipeline/types";

/** The schema tag every bundle carries, so tooling can pin the shape it parses. */
export const OPS_BUNDLE_SCHEMA = "pdfxyz.ops-bundle/1" as const;

/** Stable identity of the evidence-bundle policy — for docs / receipts / audit. */
export const OPS_BUNDLE_POLICY_ID = "pdfxyz-worker-ops-evidence-bundle";
/** Bump when the bundle schema, section set, or rollup semantics change. */
export const OPS_BUNDLE_POLICY_VERSION = 1;

/**
 * The bounded composite severity of a whole bundle — the single value an operator keys on.
 * It is the coarse worst-of the composed signals, aligned 1:1 with {@link OPS_BUNDLE_EXIT}:
 *  - `ok`       — every included section is healthy;
 *  - `usage`    — the REQUIRED operations input could not be read/validated (CLI misuse band);
 *  - `unknown`  — a section is indeterminate (no data / an unreadable optional input);
 *  - `warn`     — a section is degraded (a recommended fix is outstanding, or a drift);
 *  - `critical` — a section is critical (a worker cannot run correctly, or a breach).
 */
export const OPS_BUNDLE_SEVERITIES = [
  "ok",
  "usage",
  "unknown",
  "warn",
  "critical",
] as const;
export type OpsBundleSeverity = (typeof OPS_BUNDLE_SEVERITIES)[number];

/**
 * The exit-code ladder, the union of the composed tools' ladders (ops-check + pipeline), so a
 * scheduler/CI job can route on one number: `0` ok / `1` usage / `2` unknown / `3` warn /
 * `4` critical. Monotonic — higher is always worse.
 */
export const OPS_BUNDLE_EXIT = {
  OK: 0,
  USAGE: 1,
  UNKNOWN: 2,
  WARN: 3,
  CRITICAL: 4,
} as const;
export type OpsBundleExitCode =
  (typeof OPS_BUNDLE_EXIT)[keyof typeof OPS_BUNDLE_EXIT];

/**
 * How a section's underlying signal was sourced — a bounded provenance token so a reader knows
 * whether a posture is present, deliberately off, or could not be read. Never a path.
 *  - `ops-check`      — re-authored from the required `pdfxyz.ops-check/1` result;
 *  - `supplied`       — re-authored from an explicitly-supplied optional summary;
 *  - `not-configured` — the optional input was not supplied (the honest default, not a fault);
 *  - `unreadable`     — the supplied input could not be read or recognized (never echoed).
 */
export const OPS_BUNDLE_SECTION_SOURCES = [
  "ops-check",
  "supplied",
  "not-configured",
  "unreadable",
] as const;
export type OpsBundleSectionSource =
  (typeof OPS_BUNDLE_SECTION_SOURCES)[number];

/** The bounded liveness digest carried by the operations section (never an endpoint/broker). */
export interface OpsBundleLiveness {
  readonly state: DaemonLivenessState;
  readonly source: HeartbeatSource;
  readonly lastSeen: HeartbeatAgeBucket | null;
  readonly severity: AlertSeverity;
  readonly reason: AlertReason;
  readonly action: AlertAction;
}

/** A single content-free alert, reduced to its bounded enums (dropped free-text observed/threshold). */
export interface OpsBundleAlert {
  readonly source: AlertSource;
  readonly severity: AlertSeverity;
  readonly reason: AlertReason;
  readonly action: AlertAction;
}

/**
 * The operations posture — the required core of every bundle, re-authored from a
 * `pdfxyz.ops-check/1` result. Its `severity` already folds readiness, liveness, every
 * subsystem (including cleanup-evidence and lifecycle-verification), and the SLO window, so it
 * is the anchor the rollup keys on.
 */
export interface OpsBundleOperationsSection {
  readonly source: "ops-check";
  readonly severity: AlertSeverity;
  readonly health: HealthClass;
  readonly vantage: SnapshotVantage;
  readonly drainable: boolean;
  readonly daemonObserved: boolean;
  readonly action: RecommendedAction;
  readonly actionDetail: string;
  readonly liveness: OpsBundleLiveness;
  readonly subsystems: readonly {
    readonly id: SnapshotSubsystemId;
    readonly health: HealthClass;
  }[];
  readonly proofs: {
    readonly compressionDeep: ProofAvailability;
    readonly ocr: ProofAvailability;
  };
  readonly alerts: readonly OpsBundleAlert[];
  /** One-line, content-free headline authored from the bounded severity. */
  readonly summary: string;
}

/** A single warned/breached SLO, reduced to its bounded id + status (no free-text numbers). */
export interface OpsBundleSloIssue {
  readonly id: SloId;
  readonly status: SloStatus;
}

/** The SLO window digest, carried when the operations result reported one. */
export interface OpsBundleSloSection {
  readonly source: "ops-check";
  readonly worst: SloStatus;
  /** Indicators with enough data to judge (non-`unknown`). */
  readonly evaluated: number;
  /** Total indicators considered. */
  readonly total: number;
  /** Only the warned/breached indicators, bounded to id + status. */
  readonly issues: readonly OpsBundleSloIssue[];
  readonly detail: string;
}

/**
 * The cleanup evidence posture (Phase 44), surfaced from the operations result's own bounded
 * cleanup-evidence digest. `state`/`reason`/`provider`/`freshness` are the load-bearing enums
 * the ops-check surface carries; `detail` is re-authored from the reason, never echoed.
 */
export interface OpsBundleCleanupEvidenceSection {
  readonly source: "ops-check";
  readonly state: CleanupEvidenceState;
  readonly reason: CleanupEvidenceReason;
  readonly provider: CleanupEvidenceProvider;
  readonly freshness: CleanupEvidenceFreshness;
  readonly detail: string;
}

/** The bounded lifecycle verification verdict the bundle surfaces (widened with `unknown`). */
export const OPS_BUNDLE_LIFECYCLE_VERDICTS = [
  "verified",
  "drift",
  "unknown",
] as const;
export type OpsBundleLifecycleVerdict =
  (typeof OPS_BUNDLE_LIFECYCLE_VERDICTS)[number];

/**
 * The lifecycle verification posture, derived from the operations result's `lifecycle` and
 * `lifecycle-verification` subsystem healths plus any lifecycle alert. The ops-check result does
 * not carry the raw verifier verdict, so `verdict` is DERIVED from those bounded signals and
 * never claims a stronger state than they support.
 */
export interface OpsBundleLifecycleSection {
  readonly source: "ops-check";
  /** Health of the lifecycle-verification subsystem (verified vs drifted/undeclared). */
  readonly verification: HealthClass;
  /** Health of the lifecycle readiness subsystem (declared / validated). */
  readonly readiness: HealthClass;
  readonly verdict: OpsBundleLifecycleVerdict;
  readonly drift: boolean;
  readonly detail: string;
}

/** One composed pipeline arm, reduced to bounded enums (verify / sweep + severity + projected). */
export interface OpsBundlePipelineArm {
  readonly arm: PipelineArm;
  readonly severity: PipelineSeverity;
  readonly projected: boolean;
}

/**
 * The cleanup-pipeline posture — the one composed signal NOT already inside the operations
 * result. Optional: absent ⇒ `not-configured` (honest, not a fault); supplied-but-bad ⇒
 * `unreadable` (never echoes the offending content); supplied-and-valid ⇒ `supplied` with a
 * bounded `severity` and per-arm digest.
 */
export interface OpsBundlePipelineSection {
  readonly source: OpsBundleSectionSource;
  /** The pipeline's composite severity, or `null` unless a valid summary was supplied. */
  readonly severity: PipelineSeverity | null;
  readonly arms: readonly OpsBundlePipelineArm[];
  readonly detail: string;
}

/** The composite rollup — the single verdict + exit code an operator/scheduler acts on. */
export interface OpsBundleRollup {
  readonly severity: OpsBundleSeverity;
  readonly exitCode: OpsBundleExitCode;
  /** True iff `severity === "ok"`. */
  readonly ok: boolean;
  readonly detail: string;
}

/** The bundle's five composed sections. */
export interface OpsBundleSections {
  readonly operations: OpsBundleOperationsSection;
  readonly slo: OpsBundleSloSection | null;
  readonly cleanupEvidence: OpsBundleCleanupEvidenceSection;
  readonly lifecycle: OpsBundleLifecycleSection;
  readonly pipeline: OpsBundlePipelineSection;
}

/** The stable, content-free evidence bundle an operator attaches to a ticket / incident / CI run. */
export interface OpsBundleResult {
  readonly schema: typeof OPS_BUNDLE_SCHEMA;
  readonly policyId: typeof OPS_BUNDLE_POLICY_ID;
  readonly policyVersion: typeof OPS_BUNDLE_POLICY_VERSION;
  readonly generatedAt: string;
  readonly rollup: OpsBundleRollup;
  readonly sections: OpsBundleSections;
  /** Bounded, app-authored honesty caveats. Never derived from input. */
  readonly caveats: readonly string[];
}

/** The outcome when the REQUIRED operations input was unusable (bad flag handled earlier). */
export interface OpsBundleUsageError {
  readonly schema: typeof OPS_BUNDLE_SCHEMA;
  readonly generatedAt: string;
  readonly ok: false;
  readonly error: "usage";
  /** The documented usage/malformed-input exit code (see OPS_BUNDLE_EXIT.USAGE). */
  readonly exitCode: 1;
  /** Content-free issue codes explaining why the input was rejected — never the input itself. */
  readonly issues: readonly string[];
  readonly detail: string;
}

/** Either a full bundle or a usage error — both rendered by `renderOpsBundle`. */
export type OpsBundleOutcome = OpsBundleResult | OpsBundleUsageError;

/** Distinguish the two outcomes without a cast. */
export function isOpsBundleUsageError(
  outcome: OpsBundleOutcome,
): outcome is OpsBundleUsageError {
  return (outcome as OpsBundleUsageError).error === "usage";
}

/** The process exit code for either outcome: a usage error's `1`, or the bundle's composite. */
export function opsBundleExitCode(outcome: OpsBundleOutcome): number {
  return isOpsBundleUsageError(outcome)
    ? outcome.exitCode
    : outcome.rollup.exitCode;
}

/**
 * The content-free issue codes a usage error can carry — a bounded set so a reader can route
 * on them without parsing prose, and so the offending input is never echoed to explain itself.
 */
export const OPS_BUNDLE_ISSUE_CODES = [
  "ops-check-input-unreadable",
  "ops-check-input-malformed",
  "ops-check-input-unrecognized",
  "ops-check-input-invalid",
  "ops-check-usage-error",
] as const;
export type OpsBundleIssueCode = (typeof OPS_BUNDLE_ISSUE_CODES)[number];

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from input)
 * ------------------------------------------------------------------ */

/** The one-line operations headline per alert severity. Authored here, keyed by the enum. */
export const OPS_BUNDLE_OPERATIONS_SUMMARY: Record<AlertSeverity, string> = {
  ok: "Operations are healthy: the worker is runnable and no recommended fix is outstanding.",
  warn: "Operations are degraded: a recommended fix is outstanding.",
  critical: "Operations are critical: a worker cannot run correctly here.",
  unknown:
    "Operations are indeterminate: the stack could not be fully assessed from this input.",
};

/** The one-line rollup headline per composite severity. Authored here, keyed by the enum. */
export const OPS_BUNDLE_SEVERITY_SUMMARY: Record<OpsBundleSeverity, string> = {
  ok: "All composed operations signals are healthy.",
  usage:
    "The operations input could not be read, so no evidence bundle could be assembled.",
  unknown:
    "At least one composed signal is indeterminate; the stack could not be fully assessed.",
  warn: "At least one composed signal is degraded; a recommended fix is outstanding.",
  critical:
    "At least one composed signal is critical; a worker cannot run correctly here.",
};

/** The detail prose for a usage error. Authored, never carries the offending input. */
export const OPS_BUNDLE_USAGE_DETAIL =
  "The required operations result could not be read or validated. Provide the JSON output of " +
  "`pnpm worker:ops-check --json` on stdin or via --ops-check=<file>. The offending content is " +
  "never echoed.";

/**
 * The honesty caveats every bundle carries and every text render prints. The bundle is an
 * AGGREGATOR of existing content-free evidence; it must never be read as more than that.
 */
export const OPS_BUNDLE_CAVEATS: readonly string[] = [
  "This bundle AGGREGATES existing content-free operator signals; it is not itself a new proof.",
  "It is not proof of byte deletion — cleanup evidence attests absence/expiry posture, not that a provider erased bytes.",
  "It is not malware scanning, sanitization, authentication, or authorization of any request.",
  "It does not validate cloud state — it made no network call and read no provider export, secret, bucket, or object.",
  "Every value here is a bounded enum or app-authored prose; it carries no locator, identifier, timestamp, size, or byte.",
];
