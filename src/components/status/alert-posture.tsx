/**
 * The **alert posture** surface for the operator dashboard (Phase 31) — the
 * content-free verdict a cron job / uptime monitor / pager would read, rendered from
 * the `alerts` report the `/api/worker/operations` route now attaches (the SAME report
 * `pnpm worker:ops-check` prints).
 *
 * Like the rest of the operations dashboard, this is **client-canonical**: it reads
 * ONLY the bounded enums off the response (`severity`, each alert's `severity`/`reason`)
 * and maps them to copy authored *here*. It never renders a server-provided string, so
 * a malformed or hostile `alerts` payload — an injected endpoint, key, or secret in any
 * `detail` field — has nowhere to surface. {@link normalizeAlertPosture} is the single
 * choke point; an unrecognized enum is dropped, never rendered.
 */

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
} from "lucide-react";
import {
  ALERT_REASONS,
  ALERT_SEVERITIES,
  type AlertReason,
  type AlertSeverity,
} from "@/lib/workers/observability";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "./status-ui";

/* ------------------------------------------------------------------ *
 *  Safe, normalized posture (the privacy choke point)
 * ------------------------------------------------------------------ */

/** The fully-sanitized alert posture the dashboard renders — bounded enums + counts. */
export interface SafeAlertPosture {
  readonly severity: AlertSeverity;
  /** Count of contributing `critical` alerts. */
  readonly critical: number;
  /** Count of contributing `warn` alerts. */
  readonly warn: number;
  /** Deduped, bounded reasons of the contributing (warn+critical) alerts, in order. */
  readonly reasons: AlertReason[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Return `value` when it is a member of `allowed`, else `null` (no invention). */
function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * Reduce an arbitrary `/api/worker/operations` response (with its attached `alerts`
 * report) to a {@link SafeAlertPosture}, or `null` when no recognizable posture is
 * present. Reads exclusively bounded enums; every string rendered afterwards is authored
 * in this module.
 */
export function normalizeAlertPosture(raw: unknown): SafeAlertPosture | null {
  if (!isObject(raw) || !isObject(raw.alerts)) return null;
  const report = raw.alerts;
  const severity = asEnum(report.severity, ALERT_SEVERITIES);
  if (!severity) return null;

  let critical = 0;
  let warn = 0;
  const reasons: AlertReason[] = [];
  const seen = new Set<AlertReason>();
  const list = Array.isArray(report.alerts) ? report.alerts : [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const sev = asEnum(entry.severity, ALERT_SEVERITIES);
    if (sev === "critical") critical += 1;
    else if (sev === "warn") warn += 1;
    else continue; // ok/unknown alerts do not contribute to the actionable posture
    const reason = asEnum(entry.reason, ALERT_REASONS);
    if (reason && !seen.has(reason)) {
      seen.add(reason);
      reasons.push(reason);
    }
  }
  return { severity, critical, warn, reasons };
}

/* ------------------------------------------------------------------ *
 *  Client-authored copy maps (exhaustive by type)
 * ------------------------------------------------------------------ */

const SEVERITY_META: Record<
  AlertSeverity,
  {
    tone: StatusTone;
    label: string;
    summary: string;
    icon: typeof CheckCircle2;
  }
> = {
  ok: {
    tone: "ok",
    label: "OK",
    summary:
      "Everything a monitor can observe here is healthy — no alert would fire.",
    icon: CheckCircle2,
  },
  warn: {
    tone: "warn",
    label: "Warning",
    summary:
      "A recommended fix is outstanding. A monitor would raise a warning (exit 3).",
    icon: AlertTriangle,
  },
  critical: {
    tone: "danger",
    label: "Critical",
    summary:
      "A worker cannot run correctly here, or a service-level objective breached. A monitor would page (exit 4).",
    icon: AlertOctagon,
  },
  unknown: {
    tone: "muted",
    label: "Unknown",
    summary:
      "Worker health could not be determined from this vantage. A monitor would report unknown (exit 2), never a false OK.",
    icon: MinusCircle,
  },
};

/** One-line, client-authored copy per bounded alert reason. */
const REASON_COPY: Record<AlertReason, string> = {
  healthy: "Healthy",
  "not-drainable": "No worker can run here (queue and/or storage unconfigured)",
  "storage-unconfigured": "Object storage is not configured",
  "queue-unconfigured": "The job queue is not configured",
  "guardrail-error": "A deployment guardrail error blocks startup",
  "guardrail-warning": "A deployment guardrail warning to review",
  "engine-degraded": "Deep compression engine is unavailable (lossless-only)",
  "ocr-unavailable": "OCR is opted in but no engine is installed",
  "scanner-unavailable": "A malware scanner is selected but misconfigured",
  "rate-limit-misconfigured":
    "A rate-limit provider is selected but its store config is incomplete (nothing throttles)",
  "rate-limit-fail-open":
    "The rate limiter's store is failing and the guard is failing open (nothing throttles)",
  "rate-limit-shared-bucket":
    "The rate limiter is enforcing, but counts every caller in one shared bucket (budgets are global, not per visitor)",
  "ai-spend-unenforced":
    "No limiter applies the global AI spend ceiling in this tier (total AI cost is unbounded)",
  "ai-spend-tiers-unproven":
    "The AI spend ceiling is enforcing, but no counter written by the tier that records spend has been read back (the two cannot be shown to share one budget)",
  "ai-spend-ceiling-reached":
    "The global AI spend ceiling is reached for this window, so AI features are degrading deliberately (the cost control working, not a fault)",
  "lifecycle-undeclared": "No retention/lifecycle backstop is declared",
  "lifecycle-unverified": "The retention backstop is declared but unverified",
  "lifecycle-drift":
    "The retention backstop has drifted (objects can outlive the ceiling)",
  "cleanup-evidence-stale": "The cleanup evidence report is stale or missing",
  "cleanup-evidence-drift":
    "A cleanup evidence report shows drift (an artifact lingers past its window)",
  "cleanup-evidence-breach":
    "A cleanup evidence report shows a breach (a should-be-gone object remains)",
  "cleanup-evidence-invalid":
    "The cleanup evidence report is unreadable or not a recognized summary",
  "worker-capability-missing":
    "The running worker image does not carry a capability the product's copy promises",
  "worker-capability-unknown":
    "No worker answered, so what the running image can do is unknown",
  "loop-errors": "The last worker loop hit queue/transient errors",
  "liveness-observed": "A fresh worker heartbeat is visible",
  "liveness-stale": "The worker heartbeat has gone stale",
  "liveness-absent": "No recent worker heartbeat is visible",
  "liveness-disabled": "Worker liveness observation is not enabled here",
  "slo-breach": "A service-level objective has breached its threshold",
  "slo-warn": "A service-level objective is approaching its threshold",
  indeterminate: "Worker health is indeterminate from this evidence",
};

const TILE_TONE: Record<StatusTone, string> = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-err/40 bg-err/10 text-err",
  info: "border-info/40 bg-info/10 text-info",
  muted: "border-line bg-wash text-muted",
};

const CALLOUT_TONE: Record<StatusTone, string> = {
  ok: "border-ok/30 bg-ok/5",
  warn: "border-warn/30 bg-warn/5",
  danger: "border-err/30 bg-err/5",
  info: "border-info/30 bg-info/5",
  muted: "border-line bg-wash",
};

/* ------------------------------------------------------------------ *
 *  Component
 * ------------------------------------------------------------------ */

/**
 * The alert-posture callout — the monitor/pager verdict for this snapshot, aligned with
 * the `worker:ops-check` CLI exit codes. Renders nothing when no recognizable posture is
 * present (an older route without the `alerts` field), so it degrades gracefully.
 */
export function AlertPostureCallout({ snapshot }: { snapshot: unknown }) {
  const posture = normalizeAlertPosture(snapshot);
  if (!posture) return null;
  const meta = SEVERITY_META[posture.severity];
  const Icon = meta.icon;
  const total = posture.critical + posture.warn;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[4px] border p-4",
        CALLOUT_TONE[meta.tone],
      )}
      role="note"
      aria-label="Worker alert posture"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-[3px] border",
              TILE_TONE[meta.tone],
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="text-faint font-mono text-[0.7rem] font-medium tracking-[0.18em] uppercase">
              Alert posture
            </span>
            <span className="text-fg text-sm font-semibold">
              {meta.label}
              {total > 0 && (
                <span className="text-muted ml-1.5 font-normal">
                  · {posture.critical > 0 && `${posture.critical} critical`}
                  {posture.critical > 0 && posture.warn > 0 && ", "}
                  {posture.warn > 0 && `${posture.warn} warning`}
                </span>
              )}
            </span>
          </div>
        </div>
        <StatusBadge tone={meta.tone} label={meta.label} />
      </div>

      <p className="text-muted text-sm leading-relaxed">{meta.summary}</p>

      {posture.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {posture.reasons.map((reason) => (
            <li
              key={reason}
              className="border-line bg-wash text-fg inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]"
            >
              {REASON_COPY[reason]}
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted text-[11px] leading-relaxed">
        This is the verdict a monitor running{" "}
        <code className="text-muted">worker:ops-check</code> would report from
        this snapshot — local evaluation only, never a hosted pager.
      </p>
    </div>
  );
}
