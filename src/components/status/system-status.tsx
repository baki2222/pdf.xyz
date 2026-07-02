"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, Loader2, MonitorSmartphone } from "lucide-react";
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

/** Presence-only badge describing the secure worker's current availability. */
function workerBadge(status: WorkerStatus): {
  tone: StatusTone;
  label: string;
  pulse: boolean;
} {
  if (status.mode === "local-dev") {
    return { tone: "warn", label: "Local-dev worker", pulse: true };
  }
  if (status.mode === "remote-configured") {
    return { tone: "info", label: "Configured", pulse: false };
  }
  return { tone: "muted", label: "Not enabled", pulse: false };
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
        r.ok ? (r.json() as Promise<WorkerStatus>) : Promise.reject(new Error("unreachable")),
      )
      .then((s) => {
        if (!active) return;
        setStatus(s);
        setPhase("ready");
        track({ name: "worker_status_checked", mode: s.mode, enabled: s.enabled });
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
          <p className="text-sm leading-relaxed text-slate-400">
            {localTools.length} tool{localTools.length === 1 ? "" : "s"} run
            entirely on your device with WebAssembly and browser APIs. They work
            offline once loaded, and your files never leave the browser.
          </p>
          {localTools.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="In-browser tools">
              {localTools.map((tool) => (
                <li
                  key={tool.slug}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300"
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
              <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
            ) : undefined
          }
        >
          {phase === "loading" && (
            <p
              className="inline-flex items-center gap-2 text-sm text-slate-400"
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
            <p className="text-sm leading-relaxed text-slate-400">{status.detail}</p>
          )}
        </StatusCard>
      </div>

      <AssuranceNote tone="privacy">
        pdf.xyz is browser-first: whenever a tool can run on your device, it does,
        and nothing is uploaded. A secure worker is only ever used for work the
        browser genuinely can&apos;t do — and only after it&apos;s clearly labeled.
      </AssuranceNote>
    </div>
  );
}
