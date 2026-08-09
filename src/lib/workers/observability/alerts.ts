/**
 * Pure **alert-policy helpers** (Phase 31) — the deterministic mapping from a
 * content-free {@link WorkerOperationsSnapshot} (plus an optional {@link SloReport})
 * to operator alert **severities**, **reasons**, and **actions**, all drawn from
 * bounded enums. This is the brain of the `pnpm worker:ops-check` healthcheck CLI:
 * it decides what a cron job / uptime monitor / process supervisor should page on,
 * and what the single next action is, WITHOUT any metrics backend, clock, network,
 * or Node built-in.
 *
 * Design + honesty posture (identical to every other worker seam):
 *  - **Content-free by construction.** Every produced field is a fixed enum
 *    ({@link AlertSeverity}, {@link AlertReason}, {@link AlertAction}, {@link AlertSource})
 *    or prose authored *here* from those enums. It never copies a string out of the
 *    snapshot/SLO report, so an alert can never carry a filename, key, endpoint,
 *    value, host, or secret — even if a hand-crafted snapshot were fed in.
 *  - **No fake liveness.** A stale/absent heartbeat is actionable ONLY when liveness
 *    observation is enabled (the snapshot classifies that as `stale`/`unknown`); a
 *    `disabled` seam stays a neutral "confirm a worker out-of-band" (never a page,
 *    never an implication that a worker is down). This mirrors the snapshot's own
 *    Phase 30 rule so the CLI and the dashboard can never disagree.
 *  - **`unknown` never flatters and never over-pages.** An indicator with no data is
 *    `unknown`; it does not escalate the overall severity below a real ok/warn/critical
 *    signal. The overall verdict is `unknown` only when the snapshot's own overall
 *    health class is `unknown` (a genuinely indeterminate check), which a monitor
 *    should surface as UNKNOWN, not silently as OK.
 *
 * Node-free and pure, so it is shared verbatim by the CLI runner, the ingest path
 * (evaluating a monitor-supplied snapshot), and the tests.
 */

import type {
  DaemonLivenessState,
  HealthClass,
  RecommendedAction,
  SnapshotSubsystem,
  SnapshotSubsystemId,
  WorkerOperationsSnapshot,
} from "./snapshot";
import { RECOMMENDED_ACTION_DETAIL } from "./snapshot";
import type { SloEvaluation, SloId, SloReport, SloStatus } from "./slo";

/** `[A] extends [B]` as a compile-time boolean — used for enum-subset assertions. */
type AssertExtends<A, B> = [A] extends [B] ? true : false;

/* ------------------------------------------------------------------ *
 *  Bounded vocabularies
 * ------------------------------------------------------------------ */

/**
 * The alert-oriented severity ladder a pager reads — the coarse projection of the
 * finer snapshot {@link HealthClass} and SLO {@link SloStatus}. `critical` is the
 * union of a startup blocker and an SLO breach; `unknown` means "not determinable
 * here", which never escalates over a concrete signal but is surfaced honestly.
 */
export const ALERT_SEVERITIES = ["ok", "warn", "critical", "unknown"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Rank for folding severities to the worst. `unknown` deliberately ranks with `ok`. */
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  ok: 0,
  unknown: 0,
  warn: 1,
  critical: 2,
};

/**
 * Where an alert came from — a bounded category so a monitor can route without
 * parsing prose. `liveness` is the Phase 30 heartbeat verdict; the remainder are the
 * snapshot subsystem ids (`daemon-loop` included) and the SLO indicator ids.
 */
export type AlertSource = "liveness" | SnapshotSubsystemId | SloId;

/**
 * The operator-meaningful problem category. Bounded and stable, so an alert rule can
 * match on `reason` rather than free text. `healthy` is the no-alert baseline.
 */
export const ALERT_REASONS = [
  "healthy",
  "not-drainable",
  "storage-unconfigured",
  "queue-unconfigured",
  "guardrail-error",
  "guardrail-warning",
  "engine-degraded",
  "ocr-unavailable",
  "scanner-unavailable",
  "rate-limit-misconfigured",
  "rate-limit-fail-open",
  "lifecycle-undeclared",
  "lifecycle-unverified",
  "lifecycle-drift",
  "cleanup-evidence-stale",
  "cleanup-evidence-drift",
  "cleanup-evidence-breach",
  "cleanup-evidence-invalid",
  "loop-errors",
  "liveness-observed",
  "liveness-stale",
  "liveness-absent",
  "liveness-disabled",
  "slo-breach",
  "slo-warn",
  "indeterminate",
] as const;
export type AlertReason = (typeof ALERT_REASONS)[number];

/**
 * The bounded operator action an alert points at. It is a strict SUPERSET of the
 * snapshot's {@link RecommendedAction} (so the single report-level next action always
 * fits) plus a handful of SLO-oriented responses the snapshot has no equivalent for.
 */
export const ALERT_ACTIONS = [
  // ── Mirrors RecommendedAction (see the assertion below) ──
  "none",
  "configure-providers",
  "configure-storage",
  "configure-queue",
  "fix-guardrail",
  "install-deep-engine",
  "install-ocr-engine",
  "fix-scanner",
  "declare-lifecycle",
  "verify-lifecycle",
  "reconcile-lifecycle-drift",
  "investigate-loop-errors",
  "investigate-worker-liveness",
  "confirm-worker-deployment",
  // ── SLO-oriented operator responses (no snapshot RecommendedAction equivalent) ──
  "investigate-backlog", // queue depth/age SLO warn/breach
  "investigate-failures", // job-success / dead-letter SLO warn/breach
  "investigate-latency", // p95/p99 latency SLO warn/breach
  "investigate-retries", // retry-rate SLO warn/breach
  "reconcile-cleanup", // cleanup evidence report shows drift/breach
  "refresh-cleanup-evidence", // cleanup evidence report is stale/missing/unreadable/malformed
  "fix-rate-limit-config", // a remote limiter is selected but its store config is incomplete
  "investigate-rate-limit-store", // a configured limiter's store is erroring; guard failing open
  "monitor", // informational; nothing to fix, keep observing
] as const;
export type AlertAction = (typeof ALERT_ACTIONS)[number];

// Compile-time proof that every snapshot RecommendedAction is a valid AlertAction, so
// `report.action` (taken verbatim from the snapshot) always fits the alert vocabulary.
// If snapshot.ts adds a RecommendedAction, this fails to type-check until it is listed.
const _recommendedIsAlertAction: AssertExtends<RecommendedAction, AlertAction> = true;
void _recommendedIsAlertAction;

/** Content-free detail for the SLO-oriented actions the snapshot has no copy for. */
const EXTRA_ACTION_DETAIL: Record<
  Exclude<AlertAction, RecommendedAction>,
  string
> = {
  "investigate-backlog":
    "The runnable queue is deep or the oldest job is aging past the SLO. Confirm enough workers are draining and that the broker is healthy; scale workers or investigate stuck jobs.",
  "investigate-failures":
    "Terminal job failures (or dead-letters after exhausted retries) are above the SLO. Check the executor logs for the failing tool and whether inputs or a dependency changed.",
  "investigate-latency":
    "Processor wall-clock latency is above the SLO at p95/p99. Check for an overloaded worker, a slow native engine, or oversized inputs; consider more workers or a lower concurrency ceiling.",
  "investigate-retries":
    "The requeue rate is above the SLO, so attempts are bouncing back to the queue. Check for a flapping dependency (storage/scanner/broker) or transient processor errors.",
  "reconcile-cleanup":
    "A cleanup evidence report shows drift or a breach: an artifact is still present past its retention window + reap grace, or a positively should-be-gone object remains. Reconcile it out-of-band and confirm active deletion and the bucket lifecycle backstop are removing objects. This is a monitoring signal from an operator's own content-free report — never a claim the app deleted bytes.",
  "refresh-cleanup-evidence":
    "The configured cleanup evidence report is stale, missing, unreadable, or not a recognized content-free summary. Confirm the generating job (worker:cleanup-check / worker:artifact-cleanup) is running on schedule and that the monitor points at its JSON summary — never a raw provider export.",
  "fix-rate-limit-config":
    "A remote rate-limit provider is selected but its store configuration is missing or incomplete, so nothing is throttling despite the operator opting in. Fix the store configuration (see the rate-limiting runbook) or deliberately disable the provider.",
  "investigate-rate-limit-store":
    "The distributed rate limiter is configured, but the store is unreachable or erroring and the guard is failing OPEN — traffic is passing unthrottled right now. Investigate the store's health and quota; the app itself needs no fix.",
  monitor:
    "No fix is required right now; this is informational. Keep the monitor in place so a change is caught.",
};

/** Full action → content-free detail map (snapshot actions reused verbatim). */
export const ALERT_ACTION_DETAIL: Record<AlertAction, string> = {
  ...RECOMMENDED_ACTION_DETAIL,
  ...EXTRA_ACTION_DETAIL,
};

/* ------------------------------------------------------------------ *
 *  Class → severity projections
 * ------------------------------------------------------------------ */

/** Project a snapshot subsystem {@link HealthClass} onto the alert severity ladder. */
export function severityForHealth(health: HealthClass): AlertSeverity {
  switch (health) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "blocked":
      return "critical";
    case "unknown":
      return "unknown";
  }
}

/** Project an SLO {@link SloStatus} onto the alert severity ladder. */
export function severityForSlo(status: SloStatus): AlertSeverity {
  switch (status) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "breach":
      return "critical";
    case "unknown":
      return "unknown";
  }
}

/** Fold a list of severities to the worst (`unknown` never wins over `ok`). */
export function worstSeverity(severities: readonly AlertSeverity[]): AlertSeverity {
  let worst: AlertSeverity = "ok";
  for (const s of severities) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

/* ------------------------------------------------------------------ *
 *  Alert + report shapes
 * ------------------------------------------------------------------ */

/** One classified alert: a bounded source, severity, reason, action, and prose. */
export interface Alert {
  readonly source: AlertSource;
  readonly severity: AlertSeverity;
  readonly reason: AlertReason;
  readonly action: AlertAction;
  /** One-line, content-free explanation authored from the bounded inputs. */
  readonly detail: string;
  /** SLO alerts only: the content-free observed value (e.g. `"99.30%"`, `"11-50"`). */
  readonly observed?: string;
  /** SLO alerts only: the content-free threshold it was judged against. */
  readonly threshold?: string;
}

/** The always-present liveness headline — the Phase 30 heartbeat verdict. */
export interface LivenessAlert {
  readonly state: DaemonLivenessState;
  readonly severity: AlertSeverity;
  readonly reason: AlertReason;
  readonly action: AlertAction;
  readonly detail: string;
}

/** The composed alert report over a snapshot (+ optional SLO report). */
export interface AlertReport {
  /** The overall severity a monitor exits/pages on. */
  readonly severity: AlertSeverity;
  /** The single, safe next action (verbatim from the snapshot's recommendedAction). */
  readonly action: RecommendedAction;
  /** Content-free detail for {@link AlertReport.action}, authored here. */
  readonly actionDetail: string;
  /** The liveness headline — always present, so a monitor always sees it. */
  readonly liveness: LivenessAlert;
  /** Every actionable/contributing alert (warn+critical), most-severe first. */
  readonly alerts: Alert[];
  /** A one-line, content-free summary. */
  readonly summary: string;
}

/* ------------------------------------------------------------------ *
 *  Liveness (Phase 30 heartbeat) → alert
 * ------------------------------------------------------------------ */

/** Content-free liveness detail per classified state. Authored here — never echoed. */
const LIVENESS_DETAIL: Record<DaemonLivenessState, string> = {
  observed:
    "A worker daemon published a liveness heartbeat within the freshness window, so a worker is observably running and draining.",
  stale:
    "A worker heartbeat is present but older than the freshness window; the worker may have stopped or lost connectivity. Confirm it and check its logs / process supervisor.",
  unknown:
    "Worker liveness observation is enabled, but no recent heartbeat is visible; a worker may not be deployed or beating. Confirm it and check its logs / process supervisor.",
  disabled:
    "Cross-process worker liveness observation is not enabled here, so an absent heartbeat says nothing; confirm a worker is deployed and draining out-of-band.",
};

/**
 * Classify the snapshot's Phase 30 liveness into an alert. Stale/absent liveness is
 * actionable ONLY when observation is enabled (states `stale`/`unknown`); a `disabled`
 * seam is a neutral confirm-out-of-band, never a page.
 */
export function livenessAlert(snapshot: WorkerOperationsSnapshot): LivenessAlert {
  const state = snapshot.daemon.state;
  const base = { state, detail: LIVENESS_DETAIL[state] };
  switch (state) {
    case "observed":
      return { ...base, severity: "ok", reason: "liveness-observed", action: "monitor" };
    case "stale":
      return {
        ...base,
        severity: "warn",
        reason: "liveness-stale",
        action: "investigate-worker-liveness",
      };
    case "unknown":
      return {
        ...base,
        severity: "warn",
        reason: "liveness-absent",
        action: "investigate-worker-liveness",
      };
    case "disabled":
      return {
        ...base,
        severity: "ok",
        reason: "liveness-disabled",
        action: "confirm-worker-deployment",
      };
  }
}

/* ------------------------------------------------------------------ *
 *  Subsystem → alert
 * ------------------------------------------------------------------ */

/**
 * Map a non-healthy subsystem to its operator (reason, action). The subsystem carries
 * only its id + {@link HealthClass}; where a warn could mean two things (a lifecycle
 * backstop that is undeclared vs declared-but-unverified), the snapshot's own
 * recommendedAction disambiguates so the alert and the headline never disagree.
 */
function subsystemReasonAction(
  id: SnapshotSubsystemId,
  health: HealthClass,
  snapshot: WorkerOperationsSnapshot,
): { reason: AlertReason; action: AlertAction } {
  const blocked = health === "blocked";
  switch (id) {
    case "drainability":
      // The specific configure-* action comes from the snapshot's recommendedAction.
      return {
        reason: "not-drainable",
        action:
          snapshot.recommendedAction === "configure-storage" ||
          snapshot.recommendedAction === "configure-queue"
            ? snapshot.recommendedAction
            : "configure-providers",
      };
    case "storage":
      return { reason: "storage-unconfigured", action: "configure-storage" };
    case "queue":
      return { reason: "queue-unconfigured", action: "configure-queue" };
    case "compression-engine":
      return { reason: "engine-degraded", action: "install-deep-engine" };
    case "ocr":
      return { reason: "ocr-unavailable", action: "install-ocr-engine" };
    case "malware-scan":
      return { reason: "scanner-unavailable", action: "fix-scanner" };
    case "rate-limit":
      // Only reachable on a warn health, i.e. one of the two configured-but-NOT-
      // enforcing codes. The posture disambiguates which, so the alert and the
      // posture can never disagree: a failing store is investigated, a missing
      // config is fixed.
      return snapshot.rateLimit.code === "remote-error-fail-open"
        ? { reason: "rate-limit-fail-open", action: "investigate-rate-limit-store" }
        : { reason: "rate-limit-misconfigured", action: "fix-rate-limit-config" };
    case "lifecycle":
      // undeclared (warn, no backstop) vs declared-but-unverified vs invalid (blocked).
      if (snapshot.recommendedAction === "declare-lifecycle") {
        return { reason: "lifecycle-undeclared", action: "declare-lifecycle" };
      }
      return {
        reason: "lifecycle-unverified",
        action: blocked ? "fix-guardrail" : "verify-lifecycle",
      };
    case "lifecycle-verification":
      return { reason: "lifecycle-drift", action: "reconcile-lifecycle-drift" };
    case "cleanup-evidence": {
      // Read the posture's precise state to disambiguate the four alerting cases (only
      // reachable on a warn/blocked health): a concrete drift/breach reconciles; a stale
      // or invalid/refused report is refreshed. The state is a bounded enum, so nothing
      // report-specific reaches the alert.
      const state = snapshot.cleanupEvidence.state;
      if (state === "critical") {
        return { reason: "cleanup-evidence-breach", action: "reconcile-cleanup" };
      }
      if (state === "warning") {
        return { reason: "cleanup-evidence-drift", action: "reconcile-cleanup" };
      }
      if (state === "invalid") {
        return { reason: "cleanup-evidence-invalid", action: "refresh-cleanup-evidence" };
      }
      return { reason: "cleanup-evidence-stale", action: "refresh-cleanup-evidence" };
    }
    case "guardrails":
      return blocked
        ? { reason: "guardrail-error", action: "fix-guardrail" }
        : { reason: "guardrail-warning", action: "monitor" };
    case "daemon-loop":
      return { reason: "loop-errors", action: "investigate-loop-errors" };
  }
}

/**
 * Turn a subsystem into an alert, or `null` when it is `ok`/`unknown` (an `unknown`
 * subsystem is "not observable from here", i.e. no data — not an actionable problem).
 */
function subsystemAlert(
  sub: SnapshotSubsystem,
  snapshot: WorkerOperationsSnapshot,
): Alert | null {
  if (sub.health === "ok" || sub.health === "unknown") return null;
  const { reason, action } = subsystemReasonAction(sub.id, sub.health, snapshot);
  return {
    source: sub.id,
    severity: severityForHealth(sub.health),
    reason,
    action,
    detail: ALERT_ACTION_DETAIL[action],
  };
}

/* ------------------------------------------------------------------ *
 *  SLO → alert
 * ------------------------------------------------------------------ */

/** The operator action an SLO indicator points at when it warns/breaches. */
function sloAction(id: SloId): AlertAction {
  switch (id) {
    case "job_success_rate":
    case "job_success_rate_compress":
    case "job_success_rate_ocr":
    case "dead_letter_rate":
      return "investigate-failures";
    case "processor_latency_p95":
    case "processor_latency_p99":
      return "investigate-latency";
    case "queue_depth":
    case "queue_age":
      return "investigate-backlog";
    case "retry_rate":
      return "investigate-retries";
    case "scanner_unavailable_rate":
      return "fix-scanner";
    case "engine_readiness":
      return "install-deep-engine";
    case "lifecycle_drift":
      return "reconcile-lifecycle-drift";
  }
}

/**
 * Turn an SLO evaluation into an alert, or `null` when it is `ok`/`unknown`. The
 * `observed`/`threshold` prose comes from {@link evaluateSlos}, which authors it
 * itself (a percentage, a bucket label, `"no data"`) — content-free, never ingested.
 */
function sloAlert(slo: SloEvaluation): Alert | null {
  if (slo.status === "ok" || slo.status === "unknown") return null;
  const action = sloAction(slo.id);
  return {
    source: slo.id,
    severity: severityForSlo(slo.status),
    reason: slo.status === "breach" ? "slo-breach" : "slo-warn",
    action,
    detail: slo.detail,
    observed: slo.observed,
    threshold: slo.threshold,
  };
}

/* ------------------------------------------------------------------ *
 *  Composed evaluation
 * ------------------------------------------------------------------ */

/** Content-free one-line summary per severity. */
const SEVERITY_SUMMARY: Record<AlertSeverity, string> = {
  ok: "OK — everything observable here is healthy",
  warn: "WARNING — a recommended fix is outstanding",
  critical: "CRITICAL — a worker cannot run correctly here",
  unknown: "UNKNOWN — worker health could not be determined from this evidence",
};

/**
 * The actions whose canned {@link RECOMMENDED_ACTION_DETAIL} asserts a healthy,
 * nothing-to-do state. On an `ok` report that is exactly right. On a non-ok
 * report it is a false statement of fact printed directly above the alert that
 * contradicts it — "Everything observable here is healthy; no action is
 * required" on a snapshot whose abuse guard has stopped enforcing. An operator
 * scanning at 3am reads the reassuring sentence and stops. The snapshot's
 * ranked next-action ladder deliberately does not rank monitoring subsystems
 * (see the cleanup-evidence precedent), so severity and `recommendedAction`
 * can legitimately disagree — but the PROSE must never reassure.
 */
const HEALTHY_CLAIM_ACTIONS: ReadonlySet<RecommendedAction> = new Set([
  "none",
  "confirm-worker-deployment",
]);

/**
 * The report headline. Verbatim severity + "Next action" when that pairing is
 * honest; when the severity is not `ok` and the ranked action has no fix to
 * offer, it points at the alert rows instead of printing "Next action: none".
 * Pure and content-free; exported so any surface that re-authors a headline
 * from bounded enums (the evidence bundle) says the same thing.
 */
export function reportSummary(
  severity: AlertSeverity,
  action: RecommendedAction,
  alertCount: number,
): string {
  if (severity === "ok" || !HEALTHY_CLAIM_ACTIONS.has(action)) {
    return `${SEVERITY_SUMMARY[severity]}. Next action: ${action}.`;
  }
  if (alertCount > 0) {
    const rows = alertCount === 1 ? "the alert row" : `the ${alertCount} alert rows`;
    return `${SEVERITY_SUMMARY[severity]}. Start with ${rows} below.`;
  }
  return `${SEVERITY_SUMMARY[severity]}. No concrete alert accompanies it — treat this as unconfirmed, never as a pass.`;
}

/**
 * The prose for the report's `action` line. The canned per-action detail when
 * that is honest; on a non-ok report whose ranked action would assert health,
 * authored copy that points at the alert rows (or, with none, refuses the
 * clean bill) — the bounded `action` enum itself is untouched.
 */
export function reportActionDetail(
  severity: AlertSeverity,
  action: RecommendedAction,
  alertCount: number,
): string {
  if (severity === "ok" || !HEALTHY_CLAIM_ACTIONS.has(action)) {
    return RECOMMENDED_ACTION_DETAIL[action];
  }
  return alertCount > 0
    ? "The ranked next-action ladder has no further fix to add here — the outstanding alert rows carry the specific actions to take."
    : "The ranked next-action ladder has no further fix to add here, and worker health could not be determined from this evidence — do not read this as a clean bill.";
}

/**
 * Evaluate the full alert report for a snapshot and an optional SLO report. Pure and
 * deterministic. The overall severity is the worst of the snapshot's own health class,
 * the liveness verdict, every non-healthy subsystem, and every warned/breached SLO —
 * escalated to `unknown` only when the snapshot's overall class is itself `unknown`
 * and nothing concrete outranks it (so an indeterminate check reads as UNKNOWN, not a
 * flattering OK). Alerts are returned most-severe first.
 */
export function evaluateOperationsAlerts(
  snapshot: WorkerOperationsSnapshot,
  slo?: SloReport,
): AlertReport {
  const liveness = livenessAlert(snapshot);

  const alerts: Alert[] = [];
  for (const sub of snapshot.subsystems) {
    const a = subsystemAlert(sub, snapshot);
    if (a) alerts.push(a);
  }
  if (slo) {
    for (const evaluation of slo.slos) {
      const a = sloAlert(evaluation);
      if (a) alerts.push(a);
    }
  }
  // A warn/critical liveness verdict is also an actionable alert; surface it in the
  // list (an `ok`/neutral liveness stays only in the always-present `liveness` field).
  if (liveness.severity === "warn" || liveness.severity === "critical") {
    alerts.unshift({
      source: "liveness",
      severity: liveness.severity,
      reason: liveness.reason,
      action: liveness.action,
      detail: liveness.detail,
    });
  }

  // Sort most-severe first; the sort is stable so within a rank the discovery order
  // (subsystems in snapshot order, then SLOs) is preserved.
  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const concrete = worstSeverity([
    severityForHealth(snapshot.health),
    liveness.severity,
    ...alerts.map((a) => a.severity),
  ]);
  // `unknown` escalation: only when the snapshot's own overall class is indeterminate
  // AND nothing concrete (warn/critical) outranks it.
  const severity: AlertSeverity =
    concrete === "ok" && snapshot.health === "unknown" ? "unknown" : concrete;

  return {
    severity,
    action: snapshot.recommendedAction,
    actionDetail: reportActionDetail(severity, snapshot.recommendedAction, alerts.length),
    liveness,
    alerts,
    summary: reportSummary(severity, snapshot.recommendedAction, alerts.length),
  };
}

/* ------------------------------------------------------------------ *
 *  Exit-code policy
 * ------------------------------------------------------------------ */

/**
 * The stable exit codes the `worker:ops-check` CLI returns — the contract a cron job,
 * uptime monitor, CI gate, or process supervisor keys on. The operational ladder is
 * monotonic in severity (higher = worse): `0` healthy, `2` indeterminate (no data),
 * `3` degraded, `4` a worker cannot run correctly here / an SLO breached. `1` is a
 * distinct "the check itself was misused" band (a bad flag, or unreadable/malformed
 * input), so a misconfigured monitor is never mistaken for a healthy or unhealthy
 * worker. These are the documented Phase 31 codes the docs, examples, and tests pin.
 */
export const OPS_CHECK_EXIT = {
  /** Everything observable is healthy; no action required. */
  OK: 0,
  /** The CLI was used incorrectly, or its input was unreadable/malformed. */
  USAGE: 1,
  /** Worker health could not be determined from the supplied evidence (no data). */
  UNKNOWN: 2,
  /** A recommended fix is outstanding (degraded, but a worker can still run). */
  WARN: 3,
  /** A worker cannot run correctly here, or an SLO breached — page. */
  CRITICAL: 4,
} as const;

export type OpsCheckExitCode = (typeof OPS_CHECK_EXIT)[keyof typeof OPS_CHECK_EXIT];

/** Map an alert severity to its operational exit code (never the usage code). */
export function exitCodeForSeverity(severity: AlertSeverity): OpsCheckExitCode {
  switch (severity) {
    case "ok":
      return OPS_CHECK_EXIT.OK;
    case "warn":
      return OPS_CHECK_EXIT.WARN;
    case "critical":
      return OPS_CHECK_EXIT.CRITICAL;
    case "unknown":
      return OPS_CHECK_EXIT.UNKNOWN;
  }
}
