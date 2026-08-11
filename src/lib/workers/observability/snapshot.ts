/**
 * The **worker operations snapshot** — a single, content-free SLO/health projection
 * an operator (or a dashboard/alert rule) can read to see, at a glance, whether the
 * worker stack is healthy and what the *one* next action is.
 *
 * It is deliberately a **projection**, not a re-derivation: the worker layer already
 * resolves provider readiness ({@link DaemonReadiness}), the composed deployment
 * picture ({@link WorkerDeploymentReadiness}), the production guardrails
 * ({@link GuardrailReport}), the lifecycle verification verdict
 * ({@link LifecycleVerdict}), and the last daemon loop outcome
 * ({@link DaemonRunSummary}). Each answers a narrow question. This module folds them
 * into one alert-oriented view that adds exactly four things none of them have:
 *
 *  1. an SLO **health class** per subsystem (`ok`/`warn`/`blocked`/`unknown`) — the
 *     green/yellow/red/grey a pager cares about, distinct from the finer facet states;
 *  2. **vantage honesty** — a snapshot collected from the *web* app cannot observe a
 *     separate worker image's installed engines, its OCR runner, or whether a daemon
 *     is actually draining; those are reported `unknown`, never guessed. The same
 *     snapshot collected *on the worker* fills them in from real probes;
 *  3. a single, safe **recommended next action** enum — the highest-priority thing to
 *     fix, so an operator is never left to rank ten facets themselves;
 *  4. optional **evidence** — the lifecycle verification verdict (when an operator
 *     supplied an observed document) and the last in-process loop outcome (when a run
 *     just completed), each classified into the same health vocabulary.
 *
 * Honesty & privacy posture (identical to every other worker seam):
 *  - **Node-free.** It composes only the node-free readiness/guardrail parsers, so it
 *    is safe to import from the `/api/worker/operations` route and any status bundle,
 *    and it is reused verbatim by the Node-only daemon CLI. The one host-dependent
 *    input (native-engine availability) is *injected* — never probed here.
 *  - **Content-free by construction.** Every field is a boolean, a fixed enum, a
 *    small integer count, or generic prose. It never carries — and has nowhere to put
 *    — a variable name, secret, value, path, object key, endpoint, signed URL, bucket
 *    name, filename, recognized OCR text, or scanner signature.
 *  - **No fake liveness.** `daemonObserved` is `true` from the worker vantage (a
 *    worker demonstrably runs there) and, from the web, ONLY when a recent
 *    liveness heartbeat is visible (Phase 30 — an out-of-band daemon publishes a
 *    bounded heartbeat to the shared broker, and this snapshot folds in the
 *    classified {@link HeartbeatLiveness}). A stale or absent heartbeat never
 *    upgrades to observed, and with the feature disabled the web keeps its honest
 *    "confirm a worker out-of-band" residual — it never implies a worker is down.
 */

import type { WorkerMode } from "../mode";
import type { DaemonReadiness } from "../daemon/readiness";
import { resolveDaemonReadiness } from "../daemon/readiness";
import type {
  DaemonRunMode,
  DaemonRunSummary,
  DaemonStopReason,
} from "../daemon/daemon";
import type { LifecycleVerdict } from "../lifecycle";
import {
  DEEP_COMPRESSION_TOOLS,
  type CompressionTool,
  type ToolAvailability,
} from "../compression/engine";
import {
  evaluateGuardrails,
  resolveDeploymentReadiness,
  type EngineHealthInput,
  type FacetId,
  type FacetState,
  type GuardrailReport,
  type OperationalFacet,
  type WorkerDeploymentReadiness,
} from "../deploy";
import type {
  DaemonLivenessState,
  HeartbeatAgeBucket,
  HeartbeatLiveness,
  HeartbeatMode,
  HeartbeatSource,
} from "../heartbeat/types";
import {
  DISABLED_CLEANUP_EVIDENCE_POSTURE,
  type CleanupEvidencePosture,
  type CleanupEvidenceState,
} from "../cleanup-evidence/types";
import { resolveRateLimitStatus } from "@/lib/ratelimit/status";
import type { RateLimitStatusCode } from "@/lib/ratelimit/status";
import type {
  AiSpendProbeState,
  AiSpendStatusCode,
} from "@/lib/ratelimit/spend-status";

// Re-export the bounded liveness enums the snapshot surfaces, so the UI (and any
// consumer) can import them alongside the snapshot types from this barrel.
export type {
  DaemonLivenessState,
  HeartbeatAgeBucket,
  HeartbeatMode,
  HeartbeatSource,
} from "../heartbeat/types";

// Re-export the cleanup evidence posture vocabulary (Phase 44) so a consumer — the ops-check
// ingest path, the dashboard, a monitor — can import it alongside the snapshot types.
export type {
  CleanupEvidencePosture,
  CleanupEvidenceState,
  CleanupEvidenceReason,
  CleanupEvidenceProvider,
  CleanupEvidenceFreshness,
  CleanupEvidenceAge,
  CleanupEvidenceReportKind,
} from "../cleanup-evidence/types";

type EnvSource = Record<string, string | undefined>;

/** The bump-on-change schema version, so a metrics/log consumer can evolve safely. */
export const OPERATIONS_SNAPSHOT_VERSION = 2 as const;

/**
 * Where a snapshot was collected — the load-bearing input for honesty. The `web`
 * app can resolve provider configuration but can never observe the *separate* worker
 * image's installed engines, OCR runner, or a running daemon (those are `unknown`);
 * the `worker` vantage fills them in from real probes and, after a run, real loop
 * counters.
 */
export type SnapshotVantage = "web" | "worker";

/**
 * An SLO health class — the alert-oriented projection of the finer facet/verdict
 * states. `unknown` is first-class: it means "not observable from this vantage / not
 * declared", which a dashboard should render as grey, never as green.
 */
export type HealthClass = "ok" | "warn" | "blocked" | "unknown";

/** Whether an engine/proof could be confirmed here (never a path, version, or value). */
export type ProofAvailability = "available" | "unavailable" | "unknown";

/** A subsystem the snapshot classifies into an SLO health class. */
export type SnapshotSubsystemId =
  | "drainability"
  | "storage"
  | "queue"
  | "compression-engine"
  | "ocr"
  | "malware-scan"
  | "rate-limit"
  /**
   * The GLOBAL AI token ceiling — a cost control, not a fairness device, and a
   * different subsystem from `rate-limit` on purpose. Conflating the two is
   * what let the ceiling's absence sit unnoticed while the abuse guard
   * reported healthy.
   */
  | "ai-spend"
  | "lifecycle"
  | "lifecycle-verification"
  | "cleanup-evidence"
  | "guardrails"
  | "daemon-loop";

/* ------------------------------------------------------------------ *
 *  Abuse-guard rate-limit posture
 * ------------------------------------------------------------------ */

/**
 * The bounded rate-limit posture codes the snapshot can carry: the five
 * operationally-distinct states the abuse guard's own status layer reports
 * (`src/lib/ratelimit/status.ts`), plus `unknown` for a vantage that cannot
 * observe the web tier's guard at all (the worker/probe collectors — the limiter
 * runs in the web app, so a worker-side snapshot must not claim it is "disabled"
 * when the truth is "not observable from here").
 */
export const SNAPSHOT_RATE_LIMIT_CODES = [
  "disabled",
  "local-memory",
  "remote-missing-config",
  "remote-configured",
  "remote-configured-shared",
  "remote-error-fail-open",
  "unknown",
] as const;
export type SnapshotRateLimitCode = (typeof SNAPSHOT_RATE_LIMIT_CODES)[number];

/** `[A] extends [B]` as a compile-time boolean — used for enum-subset assertions. */
type AssertExtends<A, B> = [A] extends [B] ? true : false;

// Compile-time proof that every status code the ratelimit layer can produce fits this
// vocabulary, so `rateLimitPostureForCode(status.code)` can never receive a code it
// does not know. If status.ts adds a code, this fails to type-check until it is listed.
//
// This is the pattern to follow when adding a posture state, and it is worth the
// extra file: adding `remote-configured-shared` broke the build until the code
// list, the detail map, the health map, the posture builder, the alert evaluator
// AND a UI copy map in src/components/status all learned it. Nobody would have
// found that last one by reading. A boolean bolted onto an existing posture
// gets none of that, which is why a new CODE is the safe shape.
//
// And read the observer's own output ONCE, on the deployment, in the change
// that adds it. `remote-configured-shared` made a hidden state visible and
// shipped three contradictions in the same breath — `enforced: false` beside a
// detail reading "configured and enforcing", and an `ok` headline above the
// warn it had just created. None of them was visible in the diff; all three
// were obvious in one `curl` of the payload. A change that adds an observer is
// exactly when the observer is least likely to have been observed.
const _statusCodesAreSnapshotCodes: AssertExtends<
  RateLimitStatusCode,
  SnapshotRateLimitCode
> = true;
void _statusCodesAreSnapshotCodes;

/**
 * The abuse guard's posture as the snapshot carries it — a strict content-free
 * REDUCTION of the ratelimit layer's `RateLimitStatus`. It deliberately does NOT
 * carry that type's `envVars` field: this snapshot promises to never name an
 * environment variable, and the runbook — not an unauthenticated endpoint — is
 * where the variable names belong. `enforced`/`distributed` are pure functions of
 * `code`; they are carried so a monitor can key on them without a code table.
 */
export interface SnapshotRateLimitPosture {
  readonly code: SnapshotRateLimitCode;
  /** True only when this state actually throttles requests. */
  readonly enforced: boolean;
  /** True only when enforcement is shared across processes (a remote store). */
  readonly distributed: boolean;
  /** One-line, content-free explanation authored here. Never an env value or name. */
  readonly detail: string;
}

/** Fixed, content-free detail per posture code. Exported so ingest re-authors from it. */
export const RATE_LIMIT_DETAIL: Record<SnapshotRateLimitCode, string> = {
  disabled:
    "Rate limiting is deliberately off (the default): every request is allowed and nothing is throttled. Select a provider to enable it.",
  "local-memory":
    "The per-process in-memory limiter is enforcing. It really throttles, but each instance counts independently — a dev/single-process backend, not a distributed production limiter.",
  "remote-missing-config":
    "A remote rate-limit provider is selected but its store configuration is missing or incomplete, so nothing is being enforced despite the operator opting in. Fix the store configuration.",
  "remote-configured":
    "A distributed rate-limit store is configured and enforcing: fixed-window budgets are shared atomically across every instance.",
  "remote-configured-shared":
    "A distributed rate-limit store is configured and enforcing, but every caller is counted in ONE shared bucket: client identity is not trusted, so the published per-policy budgets apply to all traffic combined rather than per visitor.",
  "remote-error-fail-open":
    "The distributed limiter is configured, but the most recent request was not enforced — the store is unreachable or erroring and the guard is failing OPEN (allowing traffic). Investigate the store.",
  unknown:
    "The abuse guard runs in the web tier and is not observable from this vantage.",
};

/**
 * Map a posture code to its SLO health class — the projection the subsystem grid and
 * the alert fold read. The deliberate off-state and both genuinely-enforcing states
 * are `ok` (a quiet default must stay quiet; `local-memory` really throttles, per
 * process); the two configured-but-NOT-enforcing states are `warn` — the operator
 * opted into throttling and is not getting it, which is the alertable condition the
 * runbook documents. `unknown` is "not observable from this vantage", never a page.
 * Exported so the ingest path reuses it verbatim.
 */
export function rateLimitHealth(code: SnapshotRateLimitCode): HealthClass {
  switch (code) {
    case "disabled":
    case "local-memory":
    case "remote-configured":
      return "ok";
    case "remote-missing-config":
    case "remote-error-fail-open":
    // Enforcing, but on one global counter. `warn` because the operator opted
    // into per-visitor budgets and is not getting them — the same "configured
    // but not doing what you think" shape as the two above.
    case "remote-configured-shared":
      return "warn";
    case "unknown":
      return "unknown";
  }
}

/**
 * Build the full posture for a code — the single place `enforced`/`distributed`/
 * `detail` are derived, shared by the web collector, the operations route (which
 * refines the code against its live decision first), and the ingest path (which
 * re-authors an untrusted posture from the validated code alone), so no surface can
 * drift from another.
 */
export function rateLimitPostureForCode(
  code: SnapshotRateLimitCode,
): SnapshotRateLimitPosture {
  return {
    code,
    // `enforced` and `distributed` describe THE MECHANISM, not whether it is
    // per client: `remote-configured-shared` really does throttle, and really
    // does share one counter across instances — it just counts everyone into a
    // single bucket. The code carries the per-client distinction; conflating it
    // into these booleans is what made the payload contradict its own detail
    // string, which said "configured and enforcing" beside `enforced: false`.
    enforced:
      code === "local-memory" ||
      code === "remote-configured" ||
      code === "remote-configured-shared",
    distributed:
      code === "remote-configured" ||
      code === "remote-configured-shared" ||
      code === "remote-error-fail-open",
    detail: RATE_LIMIT_DETAIL[code],
  };
}

/** The honest posture for a vantage that cannot observe the web tier's guard. */
export const UNOBSERVED_RATE_LIMIT_POSTURE: SnapshotRateLimitPosture =
  rateLimitPostureForCode("unknown");

/* ------------------------------------------------------------------ *
 *  Global AI spend-ceiling posture
 * ------------------------------------------------------------------ */

/**
 * The bounded AI spend-ceiling codes the snapshot can carry: the four states a
 * reading tier can be in (`src/lib/ratelimit/spend-status.ts`), plus `unknown`
 * for a vantage that did not read the store at all.
 *
 * `unknown` is the DEFAULT, and that is load-bearing. Resolving this posture
 * takes two store reads, so unlike the abuse guard's it cannot be derived inside
 * this pure collector — a caller has to supply it. A caller that forgets
 * therefore gets "not observed", never a green "bounded"; the reachability guard
 * in `spend-probe-reachability.test.ts` is what makes forgetting visible.
 */
export const SNAPSHOT_AI_SPEND_CODES = [
  "unenforced",
  "tiers-unproven",
  "shared",
  "ceiling-reached",
  "unknown",
] as const;
export type SnapshotAiSpendCode = (typeof SNAPSHOT_AI_SPEND_CODES)[number];

// Compile-time proof that every code the spend-status layer can produce fits this
// vocabulary — the same brace the rate-limit codes get, for the same reason: if
// spend-status.ts adds a state, this fails to type-check until the code list, the
// detail map, the health map, the alert fold AND the UI copy map have learned it.
const _spendCodesAreSnapshotCodes: AssertExtends<
  AiSpendStatusCode,
  SnapshotAiSpendCode
> = true;
void _spendCodesAreSnapshotCodes;

/** The probe reading as the snapshot carries it — its own bounded vocabulary. */
export const SNAPSHOT_AI_SPEND_PROBE_STATES = [
  "shared",
  "no-probe-visible",
  "unenforced",
  "unknown",
] as const;
export type SnapshotAiSpendProbeState =
  (typeof SNAPSHOT_AI_SPEND_PROBE_STATES)[number];

const _probeStatesAreSnapshotStates: AssertExtends<
  AiSpendProbeState,
  SnapshotAiSpendProbeState
> = true;
void _probeStatesAreSnapshotStates;

/**
 * The AI spend ceiling's posture as the snapshot carries it.
 *
 * **It carries no token count, and that is a security property, not tidiness.**
 * `/api/worker/operations` is unauthenticated. The spent total tells an abuser
 * exactly how much room is left before AI degrades, and the ceiling figure is a
 * number nobody outside can act on — so neither is in this type at all, rather
 * than merely omitted by today's caller. A field that does not exist cannot be
 * added back by a well-meaning diff that only saw a gap.
 */
export interface SnapshotAiSpendPosture {
  readonly code: SnapshotAiSpendCode;
  /** True only when a limiter really applies the ceiling in the reading tier. */
  readonly enforced: boolean;
  /**
   * The probe reading, carried BESIDE the code and never folded into it: a
   * reached ceiling and an unproven pair of tiers are independent observations,
   * and either collapsing the other is how this feature stayed invisible.
   */
  readonly probe: SnapshotAiSpendProbeState;
  /** One-line, content-free explanation authored here. Never a variable or value. */
  readonly detail: string;
}

/** Fixed, content-free detail per code. Exported so ingest re-authors from it. */
export const AI_SPEND_DETAIL: Record<SnapshotAiSpendCode, string> = {
  unenforced:
    "No limiter resolves in this tier, so the global AI spend ceiling is not bounding anything here: AI runs are limited only by the per-visitor allowance, which does not cap total cost.",
  "tiers-unproven":
    "The AI spend ceiling is enforcing here, but no counter written by the tier that records spend has been read back, so the two tiers cannot be shown to share one budget. Either the recording tier has not written yet, or the two are counting into different places.",
  shared:
    "The global AI spend ceiling is enforcing, and a counter written by the tier that records spend was read back here — the two tiers are sharing one budget.",
  "ceiling-reached":
    "The global AI spend ceiling has been reached for the current window, so AI features are degrading deliberately. This is the cost control doing its job, not a fault; other tools are unaffected.",
  unknown:
    "The global AI spend ceiling was not read from this vantage, so nothing is claimed about whether total AI cost is bounded.",
};

/**
 * Map a code to its SLO health class.
 *
 * `shared` is the only `ok`. Both `unenforced` and `tiers-unproven` are `warn`
 * — **absent must not read as agreement.** The state production shipped in was
 * "the reading tier looks perfectly healthy and every write silently does
 * nothing", and a posture that showed green on it would have certified the
 * broken deployment as working, which is worse than having no posture at all.
 *
 * `ceiling-reached` is `warn` too, but it keeps its own CODE and its own alert
 * reason, because "the ceiling did its job" and "something is broken" need
 * different responses and one shared class would give them the same one.
 */
export function aiSpendHealth(code: SnapshotAiSpendCode): HealthClass {
  switch (code) {
    case "shared":
      return "ok";
    case "unenforced":
    case "tiers-unproven":
    case "ceiling-reached":
      return "warn";
    case "unknown":
      return "unknown";
  }
}

/**
 * Build the full posture for a code — the single place `enforced`/`detail` are
 * derived, shared by the route, the ingest path and the tests.
 *
 * The probe state defaults to the one each code implies, so a caller with only a
 * code (the ingest path re-authoring an untrusted payload) still gets a coherent
 * posture. `ceiling-reached` is the exception and takes `unknown`, because a
 * reached ceiling genuinely does not tell you whether the tiers were ever proven
 * to share a bucket — inventing `shared` there would be the collapse this type
 * is shaped to prevent.
 */
export function aiSpendPostureForCode(
  code: SnapshotAiSpendCode,
  probe: SnapshotAiSpendProbeState = defaultProbeFor(code),
): SnapshotAiSpendPosture {
  return {
    code,
    // `enforced` describes THE MECHANISM: whether a limiter applies the ceiling
    // in this process. `tiers-unproven` really is enforcing — we simply cannot
    // say it is the same budget the recording tier writes into, which is what
    // the code carries.
    enforced:
      code === "shared" ||
      code === "ceiling-reached" ||
      code === "tiers-unproven",
    probe,
    detail: AI_SPEND_DETAIL[code],
  };
}

/** The probe reading each code implies on its own. See the note above. */
function defaultProbeFor(code: SnapshotAiSpendCode): SnapshotAiSpendProbeState {
  switch (code) {
    case "shared":
      return "shared";
    case "tiers-unproven":
      return "no-probe-visible";
    case "unenforced":
      return "unenforced";
    case "ceiling-reached":
    case "unknown":
      return "unknown";
  }
}

/** The honest posture for a vantage that did not read the spend ceiling. */
export const UNOBSERVED_AI_SPEND_POSTURE: SnapshotAiSpendPosture =
  aiSpendPostureForCode("unknown");

/** One subsystem's SLO classification. Content-free (label + class + generic prose). */
export interface SnapshotSubsystem {
  readonly id: SnapshotSubsystemId;
  /** Short human label. */
  readonly label: string;
  /** The SLO health class a pager/dashboard reads. */
  readonly health: HealthClass;
  /** One-line, content-free explanation. Never names a variable, path, or value. */
  readonly detail: string;
}

/**
 * The single, safe next action an operator should take — the highest-priority issue,
 * so a snapshot always points at *one* thing rather than a wall of facets. Every
 * value is a fixed enum with a fixed, content-free message (see
 * {@link RECOMMENDED_ACTION_DETAIL}).
 */
export type RecommendedAction =
  | "none" // everything observable here is healthy (worker vantage)
  | "configure-providers" // neither queue nor storage is configured
  | "configure-storage" // object storage is not configured
  | "configure-queue" // the job queue is not configured
  | "fix-guardrail" // a guardrail error would stop the worker from starting
  | "install-deep-engine" // deep compression is wanted but no native engine is installed
  | "install-ocr-engine" // OCR is opted into but no engine is installed on the worker
  | "fix-scanner" // a malware scanner is selected but misconfigured
  | "enable-per-client-identity" // the limiter enforces, but on ONE bucket for all callers
  | "verify-ai-spend-ceiling" // total AI spend is unbounded here, or the two tiers are unproven
  | "declare-lifecycle" // no retention/lifecycle backstop is declared
  | "verify-lifecycle" // a backstop is declared but not asserted validated
  | "reconcile-lifecycle-drift" // an observed config shows the backstop does not hold
  | "investigate-loop-errors" // the last daemon loop hit queue/transient errors
  | "investigate-worker-liveness" // liveness observation is on, but no fresh heartbeat is visible
  | "confirm-worker-deployment"; // web vantage: everything observable is green, but a
// separate worker daemon must be deployed and its liveness cannot be seen from here

/** Engine/proof availability, honest about the web's blindness to the worker image. */
export interface SnapshotProofs {
  /** Deep image compression — a native engine installed on the worker. */
  readonly compressionDeep: ProofAvailability;
  /** OCR — a real engine + runner wired on the worker. */
  readonly ocr: ProofAvailability;
}

/** The lifecycle verification rung — checked evidence, when an operator supplied it. */
export interface SnapshotLifecycleVerification {
  /** True only when an observed document was supplied and parsed to a verdict. */
  readonly known: boolean;
  /** `verified`/`drift` when known; `unknown` when nothing was verified against. */
  readonly verdict: LifecycleVerdict | "unknown";
  /** The SLO class of the verification. */
  readonly health: HealthClass;
  /** One-line, content-free explanation. */
  readonly detail: string;
}

/** The last in-process daemon loop outcome, classified into the health vocabulary. */
export interface SnapshotLoopOutcome {
  readonly mode: DaemonRunMode;
  readonly reason: DaemonStopReason;
  readonly ticks: number;
  readonly completed: number;
  readonly failed: number;
  readonly requeued: number;
  readonly canceled: number;
  readonly idle: number;
  readonly errors: number;
  /** The SLO class of the run (`warn` on any queue/transient error, else `ok`). */
  readonly health: HealthClass;
}

/**
 * The classified worker **liveness** the snapshot surfaces (Phase 30) — the
 * content-free projection of a {@link HeartbeatLiveness}. Every field is a bounded
 * enum, a coarse age bucket, or a client-safe detail line (the UI re-authors all
 * copy). It never carries an endpoint, key, worker id, or timestamp.
 */
export interface SnapshotDaemonLiveness {
  /** observed / stale / unknown / disabled. */
  readonly state: DaemonLivenessState;
  /** Where the liveness came from: the shared broker, the worker itself, or none. */
  readonly source: HeartbeatSource;
  /** Coarse age bucket of the last heartbeat, or `null` when none is visible. */
  readonly lastSeen: HeartbeatAgeBucket | null;
  /** Coarse mode from the last heartbeat, or `null` when none is visible. */
  readonly mode: HeartbeatMode | null;
  /** One-line, content-free explanation. */
  readonly detail: string;
}

/** The full, content-free worker operations snapshot. */
export interface WorkerOperationsSnapshot {
  readonly version: typeof OPERATIONS_SNAPSHOT_VERSION;
  readonly vantage: SnapshotVantage;
  /** The resolved web-app worker mode, for context. */
  readonly mode: WorkerMode;
  /** True only when queue AND storage are configured (a worker CAN run here). */
  readonly drainable: boolean;
  /**
   * Whether this snapshot can observe an actual worker process. `true` from the
   * worker vantage (a worker demonstrably runs here) and, from the web, ONLY when a
   * recent liveness heartbeat is visible (Phase 30) — never on stale/absent evidence.
   * `false` otherwise, so the snapshot never implies a deployed, running worker it
   * cannot see. Equivalent to `daemon.state === "observed"`.
   */
  readonly daemonObserved: boolean;
  /**
   * The classified worker liveness (Phase 30): observed / stale / unknown / disabled,
   * with a coarse last-seen bucket and the safe source category. Content-free.
   */
  readonly daemon: SnapshotDaemonLiveness;
  /** The overall SLO health class. */
  readonly health: HealthClass;
  /** One-line, content-free summary of the overall health + recommended action. */
  readonly detail: string;
  /** The single, safe recommended next action. */
  readonly recommendedAction: RecommendedAction;
  /** One-line, content-free explanation of the recommended action. */
  readonly recommendedActionDetail: string;
  /** Per-subsystem SLO classification (diagnostic breakdown). */
  readonly subsystems: SnapshotSubsystem[];
  /** Engine/proof availability tri-states (honest `unknown` from the web). */
  readonly proofs: SnapshotProofs;
  /** The lifecycle verification rung (usually `unknown` unless a doc was supplied). */
  readonly lifecycleVerification: SnapshotLifecycleVerification;
  /**
   * The cleanup evidence posture (Phase 44) — whether cleanup-evidence MONITORING is configured
   * and, if so, whether a fresh content-free cleanup-check / artifact-cleanup report SUMMARY shows
   * cleanup is healthy / stale / drifting / breached. `disabled` by default (no report configured).
   * It reads only an operator's own content-free report summary — never the cloud, never a bucket.
   * This is distinct from retrieval-time expiry ENFORCEMENT (Phase 41) and the lifecycle backstop
   * verifier; it monitors the OUTPUT of the Phase 42/43 cleanup tools.
   */
  readonly cleanupEvidence: CleanupEvidencePosture;
  /**
   * The abuse guard's posture — whether request rate limiting is deliberately off,
   * genuinely enforcing, or (the alertable pair) configured-but-NOT-enforcing
   * (`remote-missing-config` statically, `remote-error-fail-open` against a live
   * decision). The web collector resolves it from its own environment (the guard
   * runs in that very process); the route refines it with the decision it already
   * made; a worker/probe vantage carries the honest `unknown`. Content-free — it
   * never names an environment variable (unlike the ratelimit layer's own status).
   */
  readonly rateLimit: SnapshotRateLimitPosture;
  /**
   * The GLOBAL AI spend ceiling's posture — whether total AI cost is bounded at
   * all, and whether the tier reading the counter is reading the one the
   * recording tier writes. A different question from the abuse guard above, and
   * the one that had no answer until this field existed. Carries no token count:
   * this payload is unauthenticated.
   */
  readonly aiSpend: SnapshotAiSpendPosture;
  /** The last in-process loop outcome, when a run just completed; else `null`. */
  readonly lastLoop: SnapshotLoopOutcome | null;
}

/** The lifecycle verification input a caller supplies when it has a verdict. */
export interface LifecycleVerificationInput {
  readonly verdict: LifecycleVerdict;
}

/** Everything the pure builder needs. The extras are optional and injectable. */
export interface OperationsSnapshotInput {
  readonly vantage: SnapshotVantage;
  readonly readiness: DaemonReadiness;
  readonly deployment: WorkerDeploymentReadiness;
  /**
   * Whether OCR is opted into via config (from the worker runtime's `OcrRuntimeHealth`
   * — `PDFXYZ_OCR` enabled). Lets the snapshot tell "OCR is off" (fine) from "OCR is
   * on but its engine is missing" (a caveat). Omit ⇒ the web vantage, which can't
   * observe the worker's OCR at all, so the OCR subsystem stays `unknown`.
   */
  readonly ocrEnabled?: boolean;
  /** The evaluated production guardrails, when known. Omit ⇒ guardrails `unknown`. */
  readonly guardrails?: GuardrailReport;
  /** A supplied lifecycle verification verdict (checked evidence). Omit ⇒ `unknown`. */
  readonly lifecycleVerification?: LifecycleVerificationInput;
  /**
   * A resolved cleanup evidence posture (Phase 44), read from the operator-configured content-free
   * report summaries by the Node reader (`../cleanup-evidence/read`). Omit ⇒ the `disabled` default
   * (monitoring off). Content-free; the builder folds it into the snapshot and a subsystem verbatim.
   */
  readonly cleanupEvidence?: CleanupEvidencePosture;
  /**
   * The abuse guard's resolved posture. Supplied by the web collector (which resolves
   * it from the environment the guard itself reads) and by the operations route
   * (which refines it against the live decision it already made). Omit ⇒ the honest
   * `unknown` — the worker/probe vantage cannot observe the web tier's guard, and
   * must not claim "disabled" (a deliberate operator choice) on no evidence.
   */
  readonly rateLimit?: SnapshotRateLimitPosture;
  /**
   * The AI spend ceiling's posture, when the caller has read it.
   *
   * UNLIKE `rateLimit`, THIS CANNOT BE RESOLVED HERE. The abuse guard's posture
   * is a pure function of configuration, so the collector resolves it rather
   * than trusting callers to remember; this one takes two round trips to the
   * store, and this function is pure and synchronous. Omit ⇒ the honest
   * `unknown`, never a green default — and `spend-probe-reachability.test.ts`
   * walks the import graph so that a tier which SHOULD be reading it cannot
   * quietly stop.
   */
  readonly aiSpend?: SnapshotAiSpendPosture;
  /** The last in-process daemon loop outcome, when a run completed. Omit ⇒ `null`. */
  readonly lastLoop?: DaemonRunSummary;
  /**
   * Classified cross-process worker liveness from a heartbeat reader (Phase 30).
   * Only meaningful on the `web` vantage: when present and `observed`, `daemonObserved`
   * becomes `true`; when `stale`/`unknown`, the verdict becomes a `warn`. Omit (or
   * `disabled`) ⇒ the honest web residual (`confirm-worker-deployment`). Ignored on
   * the worker vantage, which observes its own liveness directly.
   */
  readonly daemonLiveness?: HeartbeatLiveness;
}

/** Fixed, content-free message for each recommended action. */
export const RECOMMENDED_ACTION_DETAIL: Record<RecommendedAction, string> = {
  none: "Everything observable here is healthy; no action is required.",
  "configure-providers":
    "Neither the job queue nor object storage is configured, so no worker can run here. Configure both to make the queue drainable.",
  "configure-storage":
    "Object storage is not configured, so a worker has nowhere to read inputs from or write artifacts to. Configure it to make the queue drainable.",
  "configure-queue":
    "The job queue is not configured, so a worker has nothing to drain. Configure it to make the queue drainable.",
  "fix-guardrail":
    "A production guardrail reports an error, so the worker refuses to start. Inspect the guardrail codes (run --check) and fix the flagged configuration.",
  "install-deep-engine":
    "Deep compression is enabled but no native engine is installed on this worker, so deep jobs cannot run (lossless still works). Install an engine or disable deep.",
  "install-ocr-engine":
    "OCR is opted into but no engine is installed on this worker, so OCR jobs would fail as not-implemented. Install the OCR engine or turn OCR off.",
  "fix-scanner":
    "A malware scanner is selected but its endpoint configuration is missing or malformed, so inputs would not be scanned. Fix the scanner configuration.",
  "enable-per-client-identity":
    "The rate limiter is configured and enforcing, but it counts every caller in one shared bucket, so the published per-policy budgets apply to all traffic combined rather than per visitor. Per-client accounting needs BOTH trusted client identity and a key salt that is identical on every instance — see the rate-limiting runbook.",
  "verify-ai-spend-ceiling":
    "Total AI spend is not demonstrably bounded here: either no limiter applies the global ceiling in this tier, or no counter written by the tier that records spend has been read back, so the two cannot be shown to share one budget. The per-visitor AI allowance is a fairness device and does not cap total cost — see the rate-limiting runbook.",
  "declare-lifecycle":
    "No retention/lifecycle backstop is declared, so bucket auto-deletion is unknown here. Generate a policy, apply it out-of-band, and declare it.",
  "verify-lifecycle":
    "A retention/lifecycle backstop is declared but not asserted validated. Verify it against the bucket and mark it validated so the backstop is trusted.",
  "reconcile-lifecycle-drift":
    "A verified observed configuration shows the retention backstop does not hold as generated, so objects can outlive the privacy ceiling. Reconcile the drift.",
  "investigate-loop-errors":
    "The last worker loop hit queue or transient errors. Check broker reachability and the executor logs; retryable failures are left for redelivery.",
  "investigate-worker-liveness":
    "Worker liveness observation is enabled, but no recent heartbeat is visible (it is stale or absent). Confirm a worker daemon is deployed and beating; check its logs and your process supervisor.",
  "confirm-worker-deployment":
    "Everything this app can observe is healthy, but a worker daemon runs out-of-band and its liveness cannot be seen from here. Confirm a worker is deployed and draining.",
};

/** Human labels for each subsystem. Exported so the ingest path can re-author prose. */
export const SUBSYSTEM_LABEL: Record<SnapshotSubsystemId, string> = {
  drainability: "Drainability",
  storage: "Object storage",
  queue: "Job queue",
  "compression-engine": "Compression engine",
  ocr: "OCR",
  "malware-scan": "Malware scanning",
  "rate-limit": "Rate limiting",
  "ai-spend": "AI spend ceiling",
  lifecycle: "Lifecycle backstop",
  "lifecycle-verification": "Lifecycle verification",
  "cleanup-evidence": "Cleanup evidence",
  guardrails: "Deployment guardrails",
  "daemon-loop": "Daemon loop",
};

/** Look up a deployment facet by id (facets are a fixed, small set). */
function facetOf(
  deployment: WorkerDeploymentReadiness,
  id: FacetId,
): OperationalFacet | undefined {
  return deployment.facets.find((f) => f.id === id);
}

/** Map the compression-engine facet state to its deep-compression proof tri-state. */
function compressionProof(state: FacetState | undefined): ProofAvailability {
  if (state === "ready") return "available"; // a native (deep) engine is installed
  if (state === "degraded") return "unavailable"; // lossless-only; no deep engine
  return "unknown"; // not probed here (the web can't see the worker image)
}

/** Map the OCR facet state to its proof tri-state. */
function ocrProof(state: FacetState | undefined): ProofAvailability {
  if (state === "ready") return "available"; // a real engine + runner are wired
  if (state === "not-configured") return "unavailable"; // probed: not enabled/installed
  return "unknown"; // not-implemented/unknown: not observable from this vantage
}

/** Classify the guardrail report into an SLO health class. */
function guardrailHealth(report: GuardrailReport | undefined): HealthClass {
  if (!report) return "unknown";
  if (!report.ok) return "blocked"; // an error-severity violation stops startup
  return report.violations.length > 0 ? "warn" : "ok"; // warnings only, or clean
}

/** Classify a completed loop run into an SLO health class. */
function loopHealth(summary: DaemonRunSummary): HealthClass {
  // A queue error (broker unreachable) or any caught/transient tick error is worth a
  // look; terminal job failures likewise (a spike is the docs' alerting signal).
  if (summary.reason === "queue_error") return "warn";
  if (summary.errors > 0 || summary.failed > 0) return "warn";
  return "ok";
}

/** Classify the lifecycle readiness state into an SLO health class. */
function lifecycleHealth(
  state: WorkerDeploymentReadiness["lifecycle"]["state"],
): HealthClass {
  switch (state) {
    case "validated":
      return "ok";
    case "declared":
    case "unknown":
      return "warn"; // a recommended backstop is missing or unverified
    case "invalid":
      return "blocked"; // a malformed declaration (also a guardrail error)
  }
}

/**
 * Map a {@link CleanupEvidenceState} to its SLO health class (Phase 44) — the projection the
 * subsystem grid and the alert fold read. Neutral states (`disabled`/`not-configured`/`unknown`)
 * are `unknown`, so an unmonitored, storage-less, or inconclusive posture never pages; a fresh
 * healthy report is `ok`; a stale/missing report or a drift is `warn`; a breach or an
 * invalid/refused report is `blocked` (critical). Exported so the ingest path reuses it verbatim.
 */
export function cleanupEvidenceHealth(
  state: CleanupEvidenceState,
): HealthClass {
  switch (state) {
    case "healthy":
      return "ok";
    case "stale":
    case "warning":
      return "warn";
    case "critical":
    case "invalid":
      return "blocked";
    case "disabled":
    case "not-configured":
    case "unknown":
      return "unknown";
  }
}

/** Build the per-subsystem SLO breakdown. Pure; reuses the facets' own prose. */
function buildSubsystems(
  input: OperationsSnapshotInput,
  lifecycleVerification: SnapshotLifecycleVerification,
  cleanupEvidence: CleanupEvidencePosture,
  rateLimit: SnapshotRateLimitPosture,
  aiSpend: SnapshotAiSpendPosture,
): SnapshotSubsystem[] {
  const { readiness, deployment } = input;
  const engineState = facetOf(deployment, "engine")?.state;
  const ocrState = facetOf(deployment, "ocr")?.state;
  const scan = deployment.malwareScan;

  const sub = (
    id: SnapshotSubsystemId,
    health: HealthClass,
    detail: string,
  ): SnapshotSubsystem => ({ id, label: SUBSYSTEM_LABEL[id], health, detail });

  // OCR: `ready` is healthy; `not-configured` means probed-and-absent — a caveat only
  // when OCR is actually opted into (else "off" is a fine choice); not observable from
  // the web (no runtime health) ⇒ `unknown`.
  const ocrHealth: HealthClass =
    ocrState === "ready"
      ? "ok"
      : ocrState === "not-configured"
        ? input.ocrEnabled
          ? "warn"
          : "ok"
        : "unknown";

  return [
    sub(
      "drainability",
      readiness.drainable ? "ok" : "blocked",
      readiness.drainable
        ? "A worker can claim and complete jobs here (queue + storage configured)."
        : "No worker can run here: the queue and/or object storage are not configured.",
    ),
    sub(
      "storage",
      readiness.storageConfigured ? "ok" : "warn",
      facetOf(deployment, "storage")?.detail ??
        "Object storage configuration is unknown.",
    ),
    sub(
      "queue",
      readiness.queueConfigured ? "ok" : "warn",
      facetOf(deployment, "queue")?.detail ??
        "Job queue configuration is unknown.",
    ),
    sub(
      "compression-engine",
      engineState === "ready"
        ? "ok"
        : engineState === "degraded"
          ? "warn"
          : "unknown",
      facetOf(deployment, "engine")?.detail ??
        "Compression-engine availability is not observable from here.",
    ),
    sub(
      "ocr",
      ocrHealth,
      ocrState === "not-implemented" || ocrState === undefined
        ? "OCR runs out-of-band on the secure worker; whether an engine is installed there is not observable from here."
        : (facetOf(deployment, "ocr")?.detail ??
            "OCR availability is unknown."),
    ),
    sub(
      "malware-scan",
      scan.state === "ready"
        ? "ok"
        : scan.state === "unavailable"
          ? "warn"
          : "ok",
      scan.detail,
    ),
    // Same shape as malware-scan one line up: an optional request gate where
    // "not selected" is a fine choice (ok) and "selected but not doing its job"
    // is the caveat (warn). The posture's own code disambiguates why.
    sub("rate-limit", rateLimitHealth(rateLimit.code), rateLimit.detail),
    // The COST control, deliberately its own row beside the fairness device one
    // line up. They answer different questions — "is any one caller throttled"
    // versus "is total spend bounded at all" — and the second went unasked for
    // months precisely because the first was green.
    sub("ai-spend", aiSpendHealth(aiSpend.code), aiSpend.detail),
    sub(
      "lifecycle",
      lifecycleHealth(deployment.lifecycle.state),
      deployment.lifecycle.detail,
    ),
    sub(
      "lifecycle-verification",
      lifecycleVerification.health,
      lifecycleVerification.detail,
    ),
    sub(
      "cleanup-evidence",
      cleanupEvidenceHealth(cleanupEvidence.state),
      cleanupEvidence.detail,
    ),
    sub(
      "guardrails",
      guardrailHealth(input.guardrails),
      input.guardrails
        ? input.guardrails.ok
          ? input.guardrails.violations.length > 0
            ? "Deployment guardrails pass with warnings; review them before production."
            : "Deployment guardrails pass with no violations."
          : "A deployment guardrail reports an error; the worker refuses to start until it is fixed."
        : "Deployment guardrails were not evaluated in this context.",
    ),
    sub(
      "daemon-loop",
      input.lastLoop ? loopHealth(input.lastLoop) : "unknown",
      input.lastLoop
        ? "The last in-process loop outcome is reported; a queue/transient error is worth a look."
        : "No worker loop outcome is observable from here (this snapshot did not run the loop).",
    ),
  ];
}

/** Resolve the lifecycle verification rung from an optionally-supplied verdict. */
function resolveLifecycleVerification(
  supplied: LifecycleVerificationInput | undefined,
): SnapshotLifecycleVerification {
  if (!supplied) {
    return {
      known: false,
      verdict: "unknown",
      health: "unknown",
      detail:
        "No observed bucket configuration was supplied, so the retention backstop has not been checked against evidence here. Export it out-of-band and verify it.",
    };
  }
  if (supplied.verdict === "verified") {
    return {
      known: true,
      verdict: "verified",
      health: "ok",
      detail:
        "A supplied observed configuration verifies: every generated backstop rule is enforced at least as strongly as generated.",
    };
  }
  return {
    known: true,
    verdict: "drift",
    health: "warn",
    detail:
      "A supplied observed configuration shows drift: at least one generated backstop rule is missing, weaker, or disabled, so objects can outlive the privacy ceiling.",
  };
}

/**
 * Resolve the surfaced {@link SnapshotDaemonLiveness} for a vantage. The worker
 * vantage observes its own liveness directly (`observed`/`self`). The web vantage
 * folds in the classified heartbeat reader result; with none supplied or a disabled
 * seam, it is the honest, neutral `disabled` (absence says nothing here).
 */
function resolveDaemonLiveness(
  vantage: SnapshotVantage,
  liveness: HeartbeatLiveness | undefined,
): SnapshotDaemonLiveness {
  if (vantage === "worker") {
    return {
      state: "observed",
      source: "self",
      lastSeen: null,
      mode: null,
      detail:
        "This snapshot was collected on the worker process itself, so its liveness is directly observed.",
    };
  }
  if (!liveness || liveness.state === "disabled") {
    return {
      state: "disabled",
      source: liveness?.source ?? "none",
      lastSeen: null,
      mode: null,
      detail:
        "Cross-process worker liveness observation is not enabled here, so an absent heartbeat says nothing; confirm a worker out-of-band.",
    };
  }
  // Author the detail here rather than passing the reader's through — defense in
  // depth, so the surfaced field is snapshot-authored copy even if a reader ever
  // returned an unexpected string. Only observed/stale/unknown reach this point.
  const detail =
    liveness.state === "observed"
      ? "A worker daemon published a liveness heartbeat within the freshness window, so a worker is observably running and draining out-of-band."
      : liveness.state === "stale"
        ? "A worker heartbeat is present but older than the freshness window; the worker may have stopped or lost connectivity. Confirm it out-of-band."
        : "Liveness observation is enabled, but no recent heartbeat is visible; a worker may not be deployed or beating. Confirm it out-of-band.";
  return {
    state: liveness.state,
    source: liveness.source,
    lastSeen: liveness.lastSeen,
    mode: liveness.mode,
    detail,
  };
}

/**
 * Derive the single overall health + recommended action from the resolved inputs.
 * The order is a strict priority: the worst, most-actionable issue wins, so a snapshot
 * always points at exactly one next step. Startup blockers (guardrail errors, an
 * unrunnable environment) rank above caveats (an unverified backstop, a lossless-only
 * engine), which rank above the honest web-vantage residual ("confirm a worker is
 * deployed", or — when liveness observation is on — the observed/stale verdict). On
 * the worker vantage a fully-green stack resolves to `none`.
 */
function deriveVerdict(
  input: OperationsSnapshotInput,
  lifecycleVerification: SnapshotLifecycleVerification,
): { health: HealthClass; action: RecommendedAction } {
  const { readiness, deployment, vantage } = input;

  // 1. A guardrail error stops the worker from starting — the hardest failure.
  if (input.guardrails && !input.guardrails.ok) {
    return { health: "blocked", action: "fix-guardrail" };
  }

  // 2. Not drainable: no worker can run here at all.
  if (!readiness.drainable) {
    if (!readiness.storageConfigured && !readiness.queueConfigured) {
      return { health: "blocked", action: "configure-providers" };
    }
    if (!readiness.storageConfigured) {
      return { health: "blocked", action: "configure-storage" };
    }
    return { health: "blocked", action: "configure-queue" };
  }

  // 3. Verified drift: checked evidence that the retention backstop does not hold.
  if (lifecycleVerification.verdict === "drift") {
    return { health: "warn", action: "reconcile-lifecycle-drift" };
  }

  // 4. The last loop hit queue/transient/terminal errors worth investigating.
  if (
    input.lastLoop &&
    (input.lastLoop.reason === "queue_error" ||
      input.lastLoop.errors > 0 ||
      input.lastLoop.failed > 0)
  ) {
    return { health: "warn", action: "investigate-loop-errors" };
  }

  // 5. A scanner is selected but misconfigured (would silently not scan).
  if (deployment.malwareScan.state === "unavailable") {
    return { health: "warn", action: "fix-scanner" };
  }

  // 6. OCR is opted into but its engine is missing on this worker.
  if (
    input.ocrEnabled &&
    facetOf(deployment, "ocr")?.state === "not-configured"
  ) {
    return { health: "warn", action: "install-ocr-engine" };
  }

  // 7. Deep compression is wanted but no native engine is installed (guardrail warn).
  if (
    input.guardrails?.violations.some(
      (v) => v.code === "deep_compression_without_engine",
    )
  ) {
    return { health: "warn", action: "install-deep-engine" };
  }

  // 8. A recommended retention/lifecycle backstop is missing or unverified.
  if (deployment.lifecycle.state === "unknown") {
    return { health: "warn", action: "declare-lifecycle" };
  }
  if (
    deployment.lifecycle.state === "declared" ||
    deployment.lifecycle.state === "invalid"
  ) {
    return { health: "warn", action: "verify-lifecycle" };
  }

  // 9. Everything observable is green. On the worker vantage that is `none`.
  if (vantage !== "web") {
    return { health: "ok", action: "none" };
  }
  // From the web, the residual depends on liveness observation (Phase 30):
  const liveness = input.daemonLiveness;
  //  - a fresh heartbeat is visible ⇒ we can SEE a live worker ⇒ nothing to confirm;
  if (liveness?.state === "observed") {
    return { health: "ok", action: "none" };
  }
  //  - observation is ON but the heartbeat is stale/absent ⇒ it should be beating but
  //    isn't — a real, actionable warning (not merely the unobservable residual);
  if (
    liveness &&
    (liveness.state === "stale" || liveness.state === "unknown")
  ) {
    return { health: "warn", action: "investigate-worker-liveness" };
  }
  //  - observation is off/not configured ⇒ the honest residual: a worker must be
  //    deployed out-of-band and its liveness is not observable here.
  return { health: "ok", action: "confirm-worker-deployment" };
}

/** Fixed, content-free one-line summary for the overall health. Exported for re-authoring. */
export const HEALTH_SUMMARY: Record<HealthClass, string> = {
  ok: "Healthy",
  warn: "Degraded — a recommended fix is outstanding",
  blocked: "Blocked — a worker cannot run correctly here",
  unknown: "Unknown",
};

/**
 * Build a {@link WorkerOperationsSnapshot} from already-resolved readiness inputs.
 * Pure, deterministic, and content-free — the same function backs both the web route
 * and the worker daemon; the vantage and the optional evidence are all it needs.
 */
export function buildWorkerOperationsSnapshot(
  input: OperationsSnapshotInput,
): WorkerOperationsSnapshot {
  const lifecycleVerification = resolveLifecycleVerification(
    input.lifecycleVerification,
  );
  const cleanupEvidence =
    input.cleanupEvidence ?? DISABLED_CLEANUP_EVIDENCE_POSTURE;
  const rateLimit = input.rateLimit ?? UNOBSERVED_RATE_LIMIT_POSTURE;
  const aiSpend = input.aiSpend ?? UNOBSERVED_AI_SPEND_POSTURE;
  const subsystems = buildSubsystems(
    input,
    lifecycleVerification,
    cleanupEvidence,
    rateLimit,
    aiSpend,
  );
  let { health, action } = deriveVerdict(input, lifecycleVerification);
  // Fold the abuse guard into the HEADLINE, not just into a row.
  //
  // `deriveVerdict` answers "can a worker run correctly here", which the
  // limiter's posture does not affect — so a limiter counting the whole world
  // into one bucket produced `health: ok` and "no action is required" directly
  // above a `warn` subsystem saying exactly that. A warn that leaves the
  // headline healthy is not an alert, it is a footnote, and it is the /status
  // headline-denies-the-row defect in a second payload.
  //
  // Only ESCALATES: a real blocker keeps its own action, and nothing here can
  // make a degraded system look healthier.
  if (rateLimitHealth(rateLimit.code) === "warn" && health === "ok") {
    health = "warn";
    // Only the shared-bucket state gets a new headline action; the other
    // rate-limit warns already carry their own alert reason and action, and
    // inventing a second vocabulary for them here would let the two disagree.
    if (rateLimit.code === "remote-configured-shared") {
      action = "enable-per-client-identity";
    }
  }
  // Fold the COST control into the headline on the same terms, and for the same
  // reason: a warn row under an `ok` headline is a footnote, not an alert. An
  // unbounded or unproven spend ceiling is exactly the condition that reads as
  // working right up until the bill arrives.
  //
  // Only ESCALATES — a real blocker keeps its own action, and nothing here can
  // make a degraded system look healthier.
  if (aiSpendHealth(aiSpend.code) === "warn" && health === "ok") {
    health = "warn";
    // `ceiling-reached` is the ceiling working as designed, so it does NOT
    // claim the headline action: there is nothing for an operator to fix, and
    // telling them to fix something would send them looking for a fault that
    // does not exist. The other two are real configuration gaps and get one.
    if (aiSpend.code !== "ceiling-reached" && action === "none") {
      action = "verify-ai-spend-ceiling";
    }
  }
  const daemon = resolveDaemonLiveness(input.vantage, input.daemonLiveness);

  const engineState = facetOf(input.deployment, "engine")?.state;
  const ocrState = facetOf(input.deployment, "ocr")?.state;

  const lastLoop: SnapshotLoopOutcome | null = input.lastLoop
    ? {
        mode: input.lastLoop.mode,
        reason: input.lastLoop.reason,
        ticks: input.lastLoop.ticks,
        completed: input.lastLoop.completed,
        failed: input.lastLoop.failed,
        requeued: input.lastLoop.requeued,
        canceled: input.lastLoop.canceled,
        idle: input.lastLoop.idle,
        errors: input.lastLoop.errors,
        health: loopHealth(input.lastLoop),
      }
    : null;

  return {
    version: OPERATIONS_SNAPSHOT_VERSION,
    vantage: input.vantage,
    mode: input.readiness.mode,
    drainable: input.readiness.drainable,
    // Observed on the worker vantage (a worker runs here) or, from the web, only when
    // a recent heartbeat is visible (Phase 30) — never on stale/absent evidence.
    daemonObserved: daemon.state === "observed",
    daemon,
    health,
    detail: `${HEALTH_SUMMARY[health]}. ${RECOMMENDED_ACTION_DETAIL[action]}`,
    recommendedAction: action,
    recommendedActionDetail: RECOMMENDED_ACTION_DETAIL[action],
    subsystems,
    proofs: {
      compressionDeep: compressionProof(engineState),
      ocr: ocrProof(ocrState),
    },
    lifecycleVerification,
    cleanupEvidence,
    rateLimit,
    aiSpend,
    lastLoop,
  };
}

/**
 * Derive the injected {@link EngineHealthInput} from probed native tools — the lean,
 * node-free counterpart of the runtime's `deriveCompressionHealth`. Lossless repack is
 * always available (pure-JS); deep requires a native engine. Names engines by binary
 * name only. Returns `undefined` when nothing was probed, so the engine facet stays
 * honestly `unknown` (the web can't see a separate worker image's engines).
 */
export function engineHealthFromTools(
  tools: ToolAvailability | undefined,
): EngineHealthInput | undefined {
  if (!tools) return undefined;
  const engines: CompressionTool[] = DEEP_COMPRESSION_TOOLS.filter(
    (t) => tools[t],
  );
  return { lossless: true, deep: engines.length > 0, engines };
}

/**
 * Collect the **web-vantage** snapshot from an environment. Presence-only and
 * node-free: it resolves the daemon readiness, composes the deployment readiness, and
 * evaluates the guardrails, all from config. The one host-dependent input — native
 * engine availability — is only meaningful in `local-dev` (where the web app *is* the
 * in-process worker, so its own PATH probe is honest); in every other mode `tools` is
 * omitted, so the engine/OCR proofs are honestly `unknown` (a separate worker image
 * cannot be probed from here). `daemonObserved` is `false` unless a recent liveness
 * heartbeat is supplied via `opts.daemonLiveness` (Phase 30 — the route reads it from
 * the shared broker when the feature is enabled); with none, the web keeps its honest
 * "confirm a worker out-of-band" residual. `env` is injectable.
 */
export function collectWebOperationsSnapshot(
  env: EnvSource = process.env,
  opts: {
    tools?: ToolAvailability;
    daemonLiveness?: HeartbeatLiveness;
    cleanupEvidence?: CleanupEvidencePosture;
    /**
     * A decision-refined rate-limit posture, when the caller has one (the operations
     * route folds the decision its own guard call already made, which is the only
     * place `remote-error-fail-open` can be observed). Omit ⇒ the static posture is
     * resolved HERE from the same `env` the guard reads — resolved at the collector,
     * not left for callers to remember, so a web-vantage snapshot can never silently
     * omit it. Costs nothing: the resolver reads configuration, never the store.
     */
    rateLimit?: SnapshotRateLimitPosture;
    /**
     * The AI spend ceiling's posture, read by the caller. Cannot be resolved
     * here — it takes two store round trips and this function is pure. Omit ⇒
     * the honest `unknown`; see the input type's note and the reachability
     * guard that keeps a tier from silently ceasing to read it.
     */
    aiSpend?: SnapshotAiSpendPosture;
  } = {},
): WorkerOperationsSnapshot {
  const readiness = resolveDaemonReadiness(env);
  const engine = engineHealthFromTools(opts.tools);
  const deployment = resolveDeploymentReadiness(
    readiness,
    env,
    engine ? { engine } : {},
  );
  const guardrails = evaluateGuardrails(env, engine ? { engine } : {});
  const rateLimit =
    opts.rateLimit ?? rateLimitPostureForCode(resolveRateLimitStatus(env).code);
  return buildWorkerOperationsSnapshot({
    vantage: "web",
    readiness,
    deployment,
    guardrails,
    rateLimit,
    ...(opts.aiSpend ? { aiSpend: opts.aiSpend } : {}),
    ...(opts.daemonLiveness ? { daemonLiveness: opts.daemonLiveness } : {}),
    ...(opts.cleanupEvidence ? { cleanupEvidence: opts.cleanupEvidence } : {}),
    // No `ocrEnabled`: the web can't observe the worker's OCR, so OCR stays `unknown`.
  });
}

/**
 * The structural subset of the worker runtime this collector reads — the already-
 * resolved readiness, composed deployment, wired OCR health, and evaluated guardrails.
 * Declared locally so this node-free module never imports the Node-only runtime; the
 * daemon passes its `WorkerRuntime`, which is structurally compatible.
 */
export interface RuntimeSnapshotSource {
  readonly readiness: DaemonReadiness;
  readonly deployment: WorkerDeploymentReadiness;
  readonly ocr: { readonly enabled: boolean };
  readonly guardrails: GuardrailReport;
}

/**
 * Collect the **worker-vantage** snapshot from an already-resolved runtime. Unlike the
 * web collector, this fills in the engine/OCR proofs and guardrails from the worker's
 * real probes, and `daemonObserved` is `true` (a worker demonstrably runs here). The
 * optional extras attach checked evidence: a lifecycle verification verdict (when an
 * operator supplied an observed document) and the last in-process loop outcome (after
 * a run). Pure — it only reads already-computed structural data.
 */
export function collectRuntimeOperationsSnapshot(
  runtime: RuntimeSnapshotSource,
  extras: {
    lifecycleVerification?: LifecycleVerificationInput;
    lastLoop?: DaemonRunSummary;
    cleanupEvidence?: CleanupEvidencePosture;
  } = {},
): WorkerOperationsSnapshot {
  return buildWorkerOperationsSnapshot({
    vantage: "worker",
    readiness: runtime.readiness,
    deployment: runtime.deployment,
    ocrEnabled: runtime.ocr.enabled,
    guardrails: runtime.guardrails,
    ...(extras.lifecycleVerification
      ? { lifecycleVerification: extras.lifecycleVerification }
      : {}),
    ...(extras.lastLoop ? { lastLoop: extras.lastLoop } : {}),
    ...(extras.cleanupEvidence
      ? { cleanupEvidence: extras.cleanupEvidence }
      : {}),
  });
}

/**
 * Collect an **operator-probe** snapshot (Phase 31) — the vantage of a short-lived
 * healthcheck process (`pnpm worker:ops-check`) that runs on (or beside) the worker
 * image but is NOT the draining daemon. It combines the daemon's rich, real evidence
 * (probed engine/OCR/scanner health, the composed deployment readiness, evaluated
 * guardrails) with **heartbeat-driven liveness** — deliberately NOT self-asserted.
 *
 * This distinction is load-bearing for honesty: {@link collectRuntimeOperationsSnapshot}
 * sets `vantage: "worker"` because the *daemon* legitimately IS a running worker, so
 * `daemonObserved` is `true`. A healthcheck probe merely resolved configuration and
 * probed the host — it must NOT claim a worker is draining just because it executed.
 * So this stays the `web`-liveness vantage: `daemonObserved` is `true` ONLY when a
 * recent Phase 30 heartbeat is visible; a stale/absent beat (with observation enabled)
 * is an actionable `investigate-worker-liveness`, and a disabled seam is the neutral
 * `confirm-worker-deployment` residual. The rich subsystem/proof/guardrail fields are
 * unaffected — they reflect what the probe genuinely observed on this host.
 *
 * Pure: it only reads already-resolved structural runtime data plus a classified
 * heartbeat liveness; the caller resolves the (Node-only) runtime and reads the
 * (node-free) heartbeat, then hands both here.
 */
export function collectOperatorProbeSnapshot(
  runtime: RuntimeSnapshotSource,
  opts: {
    daemonLiveness?: HeartbeatLiveness;
    cleanupEvidence?: CleanupEvidencePosture;
  } = {},
): WorkerOperationsSnapshot {
  return buildWorkerOperationsSnapshot({
    vantage: "web",
    readiness: runtime.readiness,
    deployment: runtime.deployment,
    ocrEnabled: runtime.ocr.enabled,
    guardrails: runtime.guardrails,
    ...(opts.daemonLiveness ? { daemonLiveness: opts.daemonLiveness } : {}),
    ...(opts.cleanupEvidence ? { cleanupEvidence: opts.cleanupEvidence } : {}),
  });
}
