"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  Database,
  Loader2,
  MonitorSmartphone,
  ScanText,
  Server,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { WorkerStatus } from "@/lib/workers/status";
import { track } from "@/lib/telemetry/track";
import {
  AssuranceNote,
  StatusBadge,
  StatusCard,
  RecoverableError,
  type StatusTone,
} from "./status-ui";

/** A live tool the browser can run entirely on-device (name + route slug). */
export interface LocalToolRef {
  slug: string;
  name: string;
}

type Phase = "loading" | "ready" | "error";

/**
 * The card's single verdict, derived from the observed pipeline summary and
 * only from it — never from the web process's in-process facet (`mode`/
 * `enabled`), which is what let a "Not enabled" headline sit above rows
 * reporting a live worker. Local-dev is the one deliberate exception: a
 * dev-only in-process mode, labeled as exactly that.
 */
function workerBadge(status: WorkerStatus): {
  tone: StatusTone;
  label: string;
  pulse: boolean;
} {
  if (status.mode === "local-dev") {
    return { tone: "warn", label: "Local-dev worker", pulse: true };
  }
  switch (status.pipeline.verdict) {
    case "live":
      return { tone: "ok", label: "Live", pulse: true };
    case "configured":
      return { tone: "info", label: "Configured", pulse: false };
    default:
      return { tone: "muted", label: "Not enabled", pulse: false };
  }
}

/**
 * One provider in the production pipeline (object storage, job queue, or the
 * processor). Presence-only: `ready` when it can serve requests now, `configured`
 * when the infrastructure is present but this build ships no client, otherwise
 * not wired. The `detail` never names a variable or a value.
 */
function ProviderRow({
  icon: Icon,
  label,
  ready,
  configured,
  detail,
  readyLabel = "Ready",
}: {
  icon: LucideIcon;
  label: string;
  ready: boolean;
  configured: boolean;
  detail: string;
  /** Badge shown when `ready` (default "Ready"); the daemon uses "Drainable" so
   *  it never implies a worker is actually running. */
  readyLabel?: string;
}) {
  const tone: StatusTone = ready ? "ok" : configured ? "info" : "muted";
  const badge = ready
    ? readyLabel
    : configured
      ? "Configured"
      : "Not configured";
  return (
    <div className="border-line bg-wash flex flex-col gap-1.5 rounded-[3px] border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg inline-flex items-center gap-1.5 text-xs font-medium">
          <Icon className="text-faint size-3.5" aria-hidden />
          {label}
        </span>
        <StatusBadge tone={tone} label={badge} />
      </div>
      <p className="text-muted text-xs leading-relaxed">{detail}</p>
    </div>
  );
}

/**
 * User-facing summary of what pdf.xyz can do right now: which tools run entirely
 * in this browser (always available, never upload) versus whether an optional
 * secure worker is enabled in this environment. The worker half is read live from
 * the honest `/api/worker/status` endpoint — the same presence-only view the tool
 * pages use — so this page can never over-promise a capability that isn't there.
 *
 * Reading the endpoint emits a privacy-safe `worker_status_checked` product event
 * (mode + enabled flag only; no identifiers). A fetch failure is recoverable, not
 * a dead end.
 */
export function SystemStatus({ localTools }: { localTools: LocalToolRef[] }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setPhase("loading");
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<WorkerStatus>)
          : Promise.reject(new Error("unreachable")),
      )
      .then((s) => {
        if (!active) return;
        setStatus(s);
        setPhase("ready");
        track({
          name: "worker_status_checked",
          mode: s.mode,
          enabled: s.enabled,
        });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const badge = status ? workerBadge(status) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Local, in-browser tools: always on, always private. */}
        <StatusCard
          title="In-browser tools"
          icon={MonitorSmartphone}
          badge={<StatusBadge tone="ok" label="Available" />}
        >
          <p className="text-muted text-sm leading-relaxed">
            {localTools.length} tool{localTools.length === 1 ? "" : "s"} run
            entirely on your device, in the browser — your files never leave it.
            The page and its processing engine load over the network, with the
            engine fetched the first time you use a tool; after that the work
            itself runs on your device.
          </p>
          {localTools.length > 0 && (
            <ul
              className="flex flex-wrap gap-1.5"
              aria-label="In-browser tools"
            >
              {localTools.map((tool) => (
                <li
                  key={tool.slug}
                  className="border-line bg-wash text-fg rounded-[2px] border px-2.5 py-1 text-xs"
                >
                  {tool.name}
                </li>
              ))}
            </ul>
          )}
        </StatusCard>

        {/* Secure worker: read live from the honest status endpoint. */}
        <StatusCard
          title="Secure worker"
          icon={Cpu}
          badge={
            badge ? (
              <StatusBadge
                tone={badge.tone}
                label={badge.label}
                pulse={badge.pulse}
              />
            ) : undefined
          }
        >
          {phase === "loading" && (
            <p
              className="text-muted inline-flex items-center gap-2 text-sm"
              role="status"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking worker availability…
            </p>
          )}

          {phase === "error" && (
            <RecoverableError
              title="Couldn't reach the status endpoint"
              message="We couldn't confirm secure-worker availability just now. In-browser tools above are unaffected."
              onRetry={retry}
              retryLabel="Retry"
            />
          )}

          {phase === "ready" && status && (
            <div className="flex flex-col gap-3">
              {/* The lead and the badge share one source — the observed
                  pipeline summary — so this paragraph can never again deny
                  what a row below asserts. Local-dev keeps its in-process
                  detail: that string is about THIS machine, and it is true. */}
              <p className="text-muted text-sm leading-relaxed">
                {status.mode === "local-dev"
                  ? status.detail
                  : status.pipeline.detail}
              </p>
              {/* Per-capability honesty: OCR is called out explicitly so the page
                  never implies a searchable-PDF pipeline that isn't wired up. */}
              <div className="border-line bg-wash flex flex-col gap-1.5 rounded-[3px] border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg inline-flex items-center gap-1.5 text-xs font-medium">
                    <ScanText className="text-faint size-3.5" aria-hidden />
                    OCR
                  </span>
                  <StatusBadge
                    tone={status.ocr.available ? "ok" : "muted"}
                    label={status.ocr.available ? "Available" : "Not enabled"}
                  />
                </div>
                <p className="text-muted text-xs leading-relaxed">
                  {status.ocr.detail}
                </p>
              </div>

              {/* Same honesty for the AI tools: a drainable pipeline says nothing
                  about whether a model is wired, so AI reports its own readiness
                  rather than being implied by the worker's. */}
              <div className="border-line bg-wash flex flex-col gap-1.5 rounded-[3px] border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg inline-flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles className="text-faint size-3.5" aria-hidden />
                    AI tools
                  </span>
                  <StatusBadge
                    tone={status.ai.ready ? "ok" : "muted"}
                    label={status.ai.ready ? "Declared" : "Not enabled"}
                  />
                </div>
                <p className="text-muted text-xs leading-relaxed">
                  {status.ai.detail}
                </p>
              </div>

              {/* The production pipeline, piece by piece: signed upload → queued
                  job → worker processing → signed download → deletion. Each
                  provider reports its own honest readiness so the page can say
                  exactly what a real deployment still needs to wire up. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
                  Production pipeline
                </span>
                <ProviderRow
                  icon={Database}
                  label="Object storage"
                  ready={status.providers.storage.ready}
                  configured={status.providers.storage.configured}
                  detail={status.providers.storage.detail}
                />
                <ProviderRow
                  icon={Workflow}
                  label="Job queue"
                  ready={status.providers.queue.ready}
                  configured={status.providers.queue.configured}
                  detail={status.providers.queue.detail}
                />
                <ProviderRow
                  icon={Server}
                  label="Processor"
                  ready={status.providers.processor.ready}
                  configured={status.providers.processor.configured}
                  detail={status.providers.processor.detail}
                />
                {/* The out-of-band worker daemon (Phase 16). "Drainable" means a
                    separately deployed worker COULD claim + run jobs here — never
                    that one is actually running, which this app can't observe. */}
                <ProviderRow
                  icon={Cpu}
                  label="Worker daemon"
                  ready={status.daemon.drainable}
                  configured={
                    status.daemon.queueConfigured ||
                    status.daemon.storageConfigured
                  }
                  detail={status.daemon.detail}
                  readyLabel="Drainable"
                />
              </div>
            </div>
          )}
        </StatusCard>
      </div>

      <AssuranceNote tone="privacy">
        pdf.xyz is browser-first: whenever a tool can run on your device, it
        does, and nothing is uploaded. A secure worker is only ever used for
        work the browser genuinely can&apos;t do — and only after it&apos;s
        clearly labeled.
      </AssuranceNote>
    </div>
  );
}
