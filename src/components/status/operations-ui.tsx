/**
 * Presentational building blocks for the **worker operations dashboard** — the
 * operator counterpart to the user-facing capability summary on `/status`. Where
 * {@link SystemStatus} answers "can the worker do this for me?", these render the
 * `/api/worker/operations` snapshot's answer to "is the stack healthy, and what is
 * the one next action?".
 *
 * Two hard rules shape this module:
 *
 *  1. **RSC-safe.** No hooks, no client state — every component renders from props
 *     alone (like `status-ui.tsx`), so the client dashboard shell can drop them in
 *     and a server component or a test can render them from a fixture.
 *
 *  2. **Client-canonical copy, never server prose.** The snapshot is content-free
 *     by construction, but this UI still refuses to render any server-provided
 *     free-form string. It reads ONLY the bounded enums (`health`,
 *     `recommendedAction`, each subsystem `id`/`health`, the proof tri-states, the
 *     lifecycle verdict) and clamped integer counts, then maps them to copy authored
 *     *here*. A malformed or hostile response — an injected endpoint, object key,
 *     filename, or secret in any `detail` field — therefore has nowhere to surface:
 *     unrecognized enum values degrade to a safe fallback and every rendered word is
 *     ours. {@link normalizeSnapshot} is the single choke point that enforces this.
 */

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleSlash,
  Clock,
  Cpu,
  Database,
  Layers,
  Minimize2,
  MinusCircle,
  RotateCw,
  ScanSearch,
  ScanText,
  ServerCog,
  ShieldCheck,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { WorkerMode } from "@/lib/workers/mode";
import type {
  HealthClass,
  ProofAvailability,
  RecommendedAction,
  SnapshotLoopOutcome,
  SnapshotSubsystemId,
  WorkerOperationsSnapshot,
} from "@/lib/workers/observability";
import { cn } from "@/lib/utils";
import { StatusBadge, StatusCard, type StatusTone } from "./status-ui";

/* ------------------------------------------------------------------ *
 *  Safe, normalized view model (the privacy choke point)
 * ------------------------------------------------------------------ */

type LoopMode = SnapshotLoopOutcome["mode"];
type LoopReason = SnapshotLoopOutcome["reason"];
/** The lifecycle verification verdict, widened to include the not-checked case. */
type Verdict = "verified" | "drift" | "unknown";

/** A subsystem reduced to exactly what we trust to render: an id + a health class. */
export interface SafeSubsystem {
  readonly id: SnapshotSubsystemId;
  readonly health: HealthClass;
}

/** A loop outcome reduced to a bounded mode/reason + clamped non-negative counts. */
export interface SafeLoop {
  readonly mode: LoopMode | null;
  readonly reason: LoopReason | null;
  readonly health: HealthClass;
  readonly ticks: number;
  readonly completed: number;
  readonly failed: number;
  readonly requeued: number;
  readonly canceled: number;
  readonly idle: number;
  readonly errors: number;
}

/**
 * The fully-sanitized projection the dashboard renders. Every field is a bounded
 * enum, a boolean, a clamped integer, or `null` — there is nowhere to put a string
 * the server chose, so nothing the server chose can reach the DOM.
 */
export interface SafeOperationsView {
  readonly vantage: "web" | "worker";
  /** The bounded snapshot schema version (a small integer; 0 when absent/garbage). */
  readonly schemaVersion: number;
  readonly mode: WorkerMode | null;
  readonly drainable: boolean;
  readonly daemonObserved: boolean;
  readonly health: HealthClass;
  readonly recommendedAction: RecommendedAction | null;
  readonly subsystems: SafeSubsystem[];
  readonly proofs: { compressionDeep: ProofAvailability; ocr: ProofAvailability };
  readonly lifecycleVerification: { verdict: Verdict; health: HealthClass };
  readonly lastLoop: SafeLoop | null;
}

/* ------------------------------------------------------------------ *
 *  Copy + presentation maps — the client-authored source of truth. Every
 *  `Record<Enum, …>` is exhaustive by type: adding an enum value to the schema
 *  fails the build here until copy is written, so the UI can never silently render
 *  an unlabeled state.
 * ------------------------------------------------------------------ */

const HEALTH_META: Record<
  HealthClass,
  { tone: StatusTone; label: string; caption: string; icon: LucideIcon }
> = {
  ok: { tone: "ok", label: "Healthy", caption: "Healthy", icon: CheckCircle2 },
  warn: {
    tone: "warn",
    label: "Degraded",
    caption: "Needs attention",
    icon: AlertTriangle,
  },
  blocked: {
    tone: "danger",
    label: "Blocked",
    caption: "Blocked",
    icon: CircleSlash,
  },
  unknown: {
    tone: "muted",
    label: "Unknown",
    caption: "Not observable here",
    icon: MinusCircle,
  },
};

/** One-line overall summary per health class (client-authored, content-free). */
const HEALTH_SUMMARY: Record<HealthClass, string> = {
  ok: "Everything this app can observe is healthy.",
  warn: "Degraded — a recommended fix is outstanding.",
  blocked: "Blocked — a worker cannot run correctly here.",
  unknown: "Worker health is unknown from this vantage.",
};

const MODE_LABEL: Record<WorkerMode, string> = {
  disabled: "Disabled",
  "remote-configured": "Remote configured",
  "local-dev": "Local-dev",
};

const SUBSYSTEM_META: Record<
  SnapshotSubsystemId,
  { label: string; description: string; icon: LucideIcon }
> = {
  drainability: {
    label: "Drainability",
    description:
      "Whether a worker can claim and complete jobs here (queue + storage configured).",
    icon: Workflow,
  },
  storage: {
    label: "Object storage",
    description: "Where a worker reads inputs and writes artifacts.",
    icon: Database,
  },
  queue: {
    label: "Job queue",
    description: "The broker a worker drains jobs from.",
    icon: Layers,
  },
  "compression-engine": {
    label: "Compression engine",
    description:
      "Lossless repack always works; deep compression needs a native engine on the worker.",
    icon: Minimize2,
  },
  ocr: {
    label: "OCR",
    description:
      "The OCR engine + runner on the secure worker — not observable from the web.",
    icon: ScanText,
  },
  "malware-scan": {
    label: "Malware scanning",
    description: "The optional scan gate applied to inputs before processing.",
    icon: ScanSearch,
  },
  lifecycle: {
    label: "Lifecycle backstop",
    description:
      "The bucket retention policy that auto-deletes objects at the privacy ceiling.",
    icon: Clock,
  },
  "lifecycle-verification": {
    label: "Lifecycle verification",
    description:
      "Checked evidence that the retention backstop is enforced as generated.",
    icon: ShieldCheck,
  },
  guardrails: {
    label: "Deployment guardrails",
    description:
      "Production configuration checks the worker runs before it starts.",
    icon: ServerCog,
  },
  "daemon-loop": {
    label: "Daemon loop",
    description:
      "The most recent in-process worker loop outcome — not observable from the web.",
    icon: RotateCw,
  },
};

/** Canonical render order (pipeline order): entry → engine → retention → runtime. */
const SUBSYSTEM_ORDER: SnapshotSubsystemId[] = [
  "drainability",
  "storage",
  "queue",
  "compression-engine",
  "ocr",
  "malware-scan",
  "lifecycle",
  "lifecycle-verification",
  "guardrails",
  "daemon-loop",
];

const RECOMMENDED_ACTION_COPY: Record<
  RecommendedAction,
  { title: string; detail: string }
> = {
  none: {
    title: "No action required",
    detail: "Everything observable from this vantage is healthy.",
  },
  "configure-providers": {
    title: "Configure the queue and storage",
    detail:
      "Neither the job queue nor object storage is configured, so no worker can run here yet. Configure both to make the queue drainable.",
  },
  "configure-storage": {
    title: "Configure object storage",
    detail:
      "Object storage isn't configured, so a worker has nowhere to read inputs from or write artifacts to. Configure it to make the queue drainable.",
  },
  "configure-queue": {
    title: "Configure the job queue",
    detail:
      "The job queue isn't configured, so a worker has nothing to drain. Configure it to make the queue drainable.",
  },
  "fix-guardrail": {
    title: "Fix a deployment guardrail",
    detail:
      "A production guardrail reports an error, so the worker refuses to start. Inspect the guardrail codes (worker:daemon --check) and fix the flagged configuration.",
  },
  "install-deep-engine": {
    title: "Install a deep-compression engine",
    detail:
      "Deep compression is enabled but no native engine is installed on the worker, so deep jobs can't run (lossless still works). Install an engine or disable deep.",
  },
  "install-ocr-engine": {
    title: "Install the OCR engine",
    detail:
      "OCR is opted in but no engine is installed on the worker, so OCR jobs would fail as not-implemented. Install the OCR engine or turn OCR off.",
  },
  "fix-scanner": {
    title: "Fix the malware scanner",
    detail:
      "A malware scanner is selected but its configuration is missing or malformed, so inputs wouldn't be scanned. Fix the scanner configuration.",
  },
  "declare-lifecycle": {
    title: "Declare a retention backstop",
    detail:
      "No retention/lifecycle backstop is declared, so bucket auto-deletion is unknown here. Generate a policy, apply it out-of-band, and declare it.",
  },
  "verify-lifecycle": {
    title: "Verify the retention backstop",
    detail:
      "A retention/lifecycle backstop is declared but not yet asserted valid. Verify it against the bucket and mark it validated so the backstop is trusted.",
  },
  "reconcile-lifecycle-drift": {
    title: "Reconcile retention drift",
    detail:
      "A verified observed configuration shows the retention backstop does not hold as generated, so objects can outlive the privacy ceiling. Reconcile the drift.",
  },
  "investigate-loop-errors": {
    title: "Investigate worker loop errors",
    detail:
      "The last worker loop hit queue or transient errors. Check broker reachability and the executor logs; retryable failures are left for redelivery.",
  },
  "confirm-worker-deployment": {
    title: "Confirm a worker is deployed",
    detail:
      "Everything this app can observe is healthy, but a worker daemon runs out-of-band and its liveness cannot be seen from here. Confirm a worker is deployed and draining.",
  },
};

/** Fallback shown if the server ever reports an action outside the known enum. */
const GENERIC_ACTION_COPY = {
  title: "Review the worker configuration",
  detail:
    "The worker reported a recommended action this dashboard doesn't recognize. Review the worker logs and deployment configuration.",
} as const;

const PROOF_META: Record<
  ProofAvailability,
  { tone: StatusTone; label: string; icon: LucideIcon }
> = {
  available: { tone: "ok", label: "Available", icon: CheckCircle2 },
  unavailable: { tone: "muted", label: "Unavailable", icon: MinusCircle },
  unknown: { tone: "muted", label: "Unknown from here", icon: MinusCircle },
};

const VERDICT_META: Record<
  Verdict,
  { tone: StatusTone; label: string; detail: string }
> = {
  verified: {
    tone: "ok",
    label: "Verified",
    detail:
      "A supplied observed configuration verifies: every generated backstop rule is enforced at least as strongly as generated.",
  },
  drift: {
    tone: "warn",
    label: "Drift detected",
    detail:
      "A supplied observed configuration shows drift: at least one generated backstop rule is missing, weaker, or disabled, so objects can outlive the privacy ceiling.",
  },
  unknown: {
    tone: "muted",
    label: "Not checked",
    detail:
      "No observed bucket configuration was supplied, so the retention backstop has not been checked against evidence here.",
  },
};

const LOOP_MODE_LABEL: Record<LoopMode, string> = {
  once: "Single tick",
  drain: "Drain",
  loop: "Continuous loop",
};

const LOOP_REASON_LABEL: Record<LoopReason, string> = {
  once: "Ran a single tick",
  drained: "Observed an idle queue and stopped",
  max_ticks: "Reached the tick cap",
  stopped: "Cooperative stop signal fired",
  queue_error: "Hit a queue error it will not retry",
};

/* ------------------------------------------------------------------ *
 *  Normalization — coerce an arbitrary response into the safe view.
 * ------------------------------------------------------------------ */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Return `value` when it is a key of `allowed`, else `fallback`. */
function asEnum<T extends string>(
  value: unknown,
  allowed: Record<T, unknown>,
  fallback: T,
): T {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(allowed, value)
    ? (value as T)
    : fallback;
}

/** Return `value` when it is a key of `allowed`, else `null` (no invention). */
function asEnumOrNull<T extends string>(
  value: unknown,
  allowed: Record<T, unknown>,
): T | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(allowed, value)
    ? (value as T)
    : null;
}

/** Clamp to a finite, non-negative integer; anything else becomes 0. */
function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/**
 * Reduce an arbitrary `/api/worker/operations` response to the {@link
 * SafeOperationsView} the dashboard renders. This is the *only* place a raw
 * response is read, and it reads exclusively bounded enums, booleans, and clamped
 * integers — every string a client sees afterwards is authored in this module. An
 * unrecognized enum degrades to a safe fallback (`unknown` health, a `null` action
 * that renders generic copy), never to a rendered server string.
 */
export function normalizeSnapshot(raw: unknown): SafeOperationsView {
  const src = isObject(raw) ? raw : {};

  const subsystems: SafeSubsystem[] = [];
  const seen = new Set<SnapshotSubsystemId>();
  if (Array.isArray(src.subsystems)) {
    for (const entry of src.subsystems) {
      if (!isObject(entry)) continue;
      const id = asEnumOrNull(entry.id, SUBSYSTEM_META);
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      subsystems.push({ id, health: asEnum(entry.health, HEALTH_META, "unknown") });
    }
  }

  const proofsSrc = isObject(src.proofs) ? src.proofs : {};
  const lifecycleSrc = isObject(src.lifecycleVerification)
    ? src.lifecycleVerification
    : {};

  let lastLoop: SafeLoop | null = null;
  if (isObject(src.lastLoop)) {
    const l = src.lastLoop;
    lastLoop = {
      mode: asEnumOrNull(l.mode, LOOP_MODE_LABEL),
      reason: asEnumOrNull(l.reason, LOOP_REASON_LABEL),
      health: asEnum(l.health, HEALTH_META, "unknown"),
      ticks: asCount(l.ticks),
      completed: asCount(l.completed),
      failed: asCount(l.failed),
      requeued: asCount(l.requeued),
      canceled: asCount(l.canceled),
      idle: asCount(l.idle),
      errors: asCount(l.errors),
    };
  }

  return {
    vantage: src.vantage === "worker" ? "worker" : "web",
    schemaVersion: asCount(src.version),
    mode: asEnumOrNull(src.mode, MODE_LABEL),
    drainable: src.drainable === true,
    daemonObserved: src.daemonObserved === true,
    health: asEnum(src.health, HEALTH_META, "unknown"),
    recommendedAction: asEnumOrNull(src.recommendedAction, RECOMMENDED_ACTION_COPY),
    subsystems,
    proofs: {
      compressionDeep: asEnum(proofsSrc.compressionDeep, PROOF_META, "unknown"),
      ocr: asEnum(proofsSrc.ocr, PROOF_META, "unknown"),
    },
    lifecycleVerification: {
      verdict: asEnum(lifecycleSrc.verdict, VERDICT_META, "unknown"),
      health: asEnum(lifecycleSrc.health, HEALTH_META, "unknown"),
    },
    lastLoop,
  };
}

/* ------------------------------------------------------------------ *
 *  Small shared presentational pieces
 * ------------------------------------------------------------------ */

/** A presence-only pill for an SLO {@link HealthClass}. */
export function HealthBadge({ health }: { health: HealthClass }) {
  const meta = HEALTH_META[health];
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}

/** A compact fact pill (e.g. "Vantage · web"). Bounded label + value only. */
function FactPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-slate-300">
      <span className="text-slate-500">{label}</span>
      {value}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 *  Cards
 * ------------------------------------------------------------------ */

/**
 * The overall operations health card: the SLO health class a pager reads, a
 * content-free summary, and the load-bearing honesty facts (vantage, mode,
 * drainability). "Drainable" means a worker *could* run here — never that one is.
 */
export function OperationsHealthCard({ view }: { view: SafeOperationsView }) {
  const meta = HEALTH_META[view.health];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface-2 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-10 place-items-center rounded-xl border",
              TILE_TONE[meta.tone],
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="text-[0.7rem] font-semibold uppercase tracking-widest text-slate-500">
              Worker operations
            </span>
            <span className="text-lg font-semibold text-white">{meta.label}</span>
          </div>
        </div>
        <HealthBadge health={view.health} />
      </div>

      <p className="text-sm leading-relaxed text-slate-400">
        {HEALTH_SUMMARY[view.health]}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <FactPill label="Vantage" value={view.vantage === "worker" ? "worker" : "web"} />
        {view.mode && <FactPill label="Mode" value={MODE_LABEL[view.mode]} />}
        <FactPill label="Drainable" value={view.drainable ? "Yes" : "No"} />
        <FactPill
          label="Worker process"
          value={view.daemonObserved ? "Observed" : "Not observable"}
        />
      </div>
    </div>
  );
}

/** Tone → soft tile background (for the larger health/action tiles). */
const TILE_TONE: Record<StatusTone, string> = {
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  danger: "border-red-400/30 bg-red-400/10 text-red-300",
  info: "border-blue-400/30 bg-blue-400/10 text-blue-300",
  muted: "border-white/10 bg-white/5 text-slate-400",
};

/**
 * The single, safe recommended next action — the highest-priority thing to fix, so
 * an operator is pointed at *one* step rather than a wall of facets. Toned by the
 * overall health: a `blocked` stack shows red, a `warn` shows amber, and the healthy
 * "confirm a worker is deployed" residual shows as a calm informational note.
 */
export function RecommendedActionCallout({ view }: { view: SafeOperationsView }) {
  const copy = view.recommendedAction
    ? RECOMMENDED_ACTION_COPY[view.recommendedAction]
    : GENERIC_ACTION_COPY;

  // The healthy web residual is informational, not a problem to fix.
  const tone: StatusTone =
    view.recommendedAction === "none"
      ? "ok"
      : view.recommendedAction === "confirm-worker-deployment"
        ? "info"
        : view.health === "blocked"
          ? "danger"
          : view.health === "unknown"
            ? "muted"
            : "warn";

  const Icon =
    tone === "ok" ? CheckCircle2 : tone === "info" ? ArrowRight : Wrench;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-4",
        CALLOUT_TONE[tone],
      )}
    >
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border", TILE_TONE[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[0.7rem] font-semibold uppercase tracking-widest text-slate-400">
          Recommended next action
        </span>
        <p className="text-sm font-semibold text-white">{copy.title}</p>
        <p className="text-sm leading-relaxed text-slate-300/90">{copy.detail}</p>
      </div>
    </div>
  );
}

const CALLOUT_TONE: Record<StatusTone, string> = {
  ok: "border-emerald-400/25 bg-emerald-400/[0.06]",
  warn: "border-amber-400/25 bg-amber-400/[0.06]",
  danger: "border-red-400/25 bg-red-400/[0.06]",
  info: "border-blue-400/25 bg-blue-400/[0.06]",
  muted: "border-white/10 bg-white/[0.03]",
};

/**
 * The load-bearing honesty caveat. The web app can never observe a separate worker
 * process, so `daemonObserved` is always `false` here — and that must NOT read as
 * "the worker is down". This card says exactly what it means and where to look
 * instead (the daemon's own logs / the process supervisor).
 */
export function DaemonObservabilityCaveat({
  daemonObserved,
}: {
  daemonObserved: boolean;
}) {
  if (daemonObserved) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4 text-sm text-emerald-100">
        <Cpu className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
        <p className="leading-relaxed">
          A worker process is observable from this vantage — these figures include
          its real host probes and last-loop counters.
        </p>
      </div>
    );
  }
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border border-blue-400/25 bg-blue-400/[0.06] p-4 text-sm text-blue-100"
      role="note"
    >
      <Cpu className="mt-0.5 size-4 shrink-0 text-blue-300" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-blue-50">
          This dashboard can&apos;t see a running worker
        </p>
        <p className="leading-relaxed text-blue-100/90">
          <span className="font-medium">daemonObserved is false</span> because this
          is the web vantage: the app never becomes the worker daemon.{" "}
          <span className="font-medium">False here means &ldquo;this app cannot
          observe a separate worker process&rdquo;</span> — it does{" "}
          <span className="font-medium">not</span> mean the worker is down. To confirm
          a worker is actually deployed and draining, check the daemon&apos;s own logs
          and your process supervisor.
        </p>
      </div>
    </div>
  );
}

/** One subsystem tile: icon + label, an SLO health badge, and a static caption. */
function SubsystemTile({ sub }: { sub: SafeSubsystem }) {
  const meta = SUBSYSTEM_META[sub.id];
  const health = HEALTH_META[sub.health];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200">
          <Icon className="size-3.5 text-slate-400" aria-hidden />
          {meta.label}
        </span>
        <StatusBadge tone={health.tone} label={health.label} />
      </div>
      <p className="text-xs leading-relaxed text-slate-500">{meta.description}</p>
    </div>
  );
}

/** The per-subsystem SLO breakdown, in canonical pipeline order. */
export function SubsystemGrid({ subsystems }: { subsystems: SafeSubsystem[] }) {
  const byId = new Map(subsystems.map((s) => [s.id, s] as const));
  const ordered = SUBSYSTEM_ORDER.map((id) => byId.get(id)).filter(
    (s): s is SafeSubsystem => s !== undefined,
  );
  if (ordered.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[0.7rem] font-semibold uppercase tracking-widest text-slate-500">
        Subsystem health
      </h3>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((sub) => (
          <SubsystemTile key={sub.id} sub={sub} />
        ))}
      </div>
    </section>
  );
}

/**
 * The lifecycle verification rung — checked evidence (when an operator supplied an
 * observed bucket configuration) that the retention backstop is enforced as
 * generated. Usually `Not checked` from the web, which is honest, not a failure.
 */
export function LifecycleVerificationCard({
  verdict,
}: {
  verdict: Verdict;
}) {
  const meta = VERDICT_META[verdict];
  return (
    <StatusCard
      title="Lifecycle verification"
      icon={ShieldCheck}
      badge={<StatusBadge tone={meta.tone} label={meta.label} />}
    >
      <p className="text-sm leading-relaxed text-slate-400">{meta.detail}</p>
    </StatusCard>
  );
}

/** A proof tri-state row (available / unavailable / unknown). */
function ProofRow({
  icon: Icon,
  label,
  proof,
}: {
  icon: LucideIcon;
  label: string;
  proof: ProofAvailability;
}) {
  const meta = PROOF_META[proof];
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200">
        <Icon className="size-3.5 text-slate-400" aria-hidden />
        {label}
      </span>
      <StatusBadge tone={meta.tone} label={meta.label} />
    </div>
  );
}

/**
 * Engine / OCR proof tri-states. From the web these are honestly `Unknown from
 * here` — a separate worker image's installed engines and OCR runner cannot be
 * probed from this process; only a worker-vantage snapshot fills them in.
 */
export function ProofsCard({
  proofs,
  vantage,
}: {
  proofs: SafeOperationsView["proofs"];
  vantage: "web" | "worker";
}) {
  return (
    <StatusCard title="Engine proofs" icon={Boxes}>
      <div className="flex flex-col gap-2">
        <ProofRow icon={Minimize2} label="Deep compression" proof={proofs.compressionDeep} />
        <ProofRow icon={ScanText} label="OCR" proof={proofs.ocr} />
      </div>
      {vantage === "web" && (
        <p className="text-xs leading-relaxed text-slate-500">
          A separate worker image&apos;s installed engines can&apos;t be probed from
          the web, so these stay <span className="text-slate-400">unknown</span> here
          — a worker-vantage snapshot confirms them.
        </p>
      )}
    </StatusCard>
  );
}

/** A single labeled loop counter. */
function LoopStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
      <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
      <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">
        {label}
      </span>
    </div>
  );
}

/**
 * The last in-process worker loop outcome, classified into the same health
 * vocabulary. Only present on a worker-vantage snapshot after a run; from the web it
 * is absent (this app never runs the loop), so the dashboard renders nothing.
 */
export function LoopOutcomeCard({ loop }: { loop: SafeLoop }) {
  const meta = HEALTH_META[loop.health];
  return (
    <StatusCard
      title="Last worker loop"
      icon={RotateCw}
      badge={<StatusBadge tone={meta.tone} label={meta.caption} />}
    >
      <div className="flex flex-col gap-3">
        {(loop.mode || loop.reason) && (
          <p className="text-sm leading-relaxed text-slate-400">
            {loop.mode && (
              <span className="text-slate-300">{LOOP_MODE_LABEL[loop.mode]}</span>
            )}
            {loop.mode && loop.reason && " — "}
            {loop.reason && LOOP_REASON_LABEL[loop.reason]}
            {(loop.mode || loop.reason) && "."}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <LoopStat label="Ticks" value={loop.ticks} />
          <LoopStat label="Done" value={loop.completed} />
          <LoopStat label="Failed" value={loop.failed} />
          <LoopStat label="Requeued" value={loop.requeued} />
          <LoopStat label="Idle" value={loop.idle} />
          <LoopStat label="Errors" value={loop.errors} />
        </div>
      </div>
    </StatusCard>
  );
}

/**
 * A content-free **source / freshness** label: where this snapshot was collected
 * (`vantage`) and the bounded schema version. Like everything else on the dashboard it
 * reads ONLY bounded values (the `vantage` enum + the clamped `schemaVersion` integer),
 * so it can never carry a server-chosen string. It deliberately shows no wall-clock
 * timestamp — the data is read live on mount and on every Refresh, and a fabricated
 * "updated 3s ago" from an unsynced client clock would be less honest than stating
 * plainly that this is a live, point-in-time read.
 */
function SourceFooter({ view }: { view: SafeOperationsView }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
      <ServerCog className="size-3 text-slate-600" aria-hidden />
      <span>
        Source: live, point-in-time{" "}
        <span className="text-slate-400">{view.vantage}-vantage</span> worker operations
        snapshot
      </span>
      {view.schemaVersion > 0 && (
        <span className="text-slate-600">· schema v{view.schemaVersion}</span>
      )}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 *  Composed view
 * ------------------------------------------------------------------ */

/**
 * The full operations dashboard body, composed from a single snapshot. Takes the
 * raw response (typed as {@link WorkerOperationsSnapshot} on the happy path) and
 * normalizes it defensively before rendering, so this same component renders a
 * fixture, a live response, or a hostile/malformed one identically and safely.
 */
export function OperationsSnapshotView({
  snapshot,
  header,
}: {
  snapshot: WorkerOperationsSnapshot;
  /** Optional trailing node in the health-card row (e.g. a refresh control). */
  header?: ReactNode;
}) {
  const view = normalizeSnapshot(snapshot);
  return (
    <div className="flex flex-col gap-5">
      {header}
      <OperationsHealthCard view={view} />
      <RecommendedActionCallout view={view} />
      <DaemonObservabilityCaveat daemonObserved={view.daemonObserved} />
      <SubsystemGrid subsystems={view.subsystems} />
      <div className="grid gap-4 sm:grid-cols-2">
        <LifecycleVerificationCard verdict={view.lifecycleVerification.verdict} />
        <ProofsCard proofs={view.proofs} vantage={view.vantage} />
      </div>
      {view.lastLoop && <LoopOutcomeCard loop={view.lastLoop} />}
      <SourceFooter view={view} />
    </div>
  );
}
