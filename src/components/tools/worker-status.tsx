"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import type { WorkerStatus } from "@/lib/workers/status";
import { track } from "@/lib/telemetry/track";
import { Spinner } from "./runner/runner-kit";

/**
 * Where a worker panel is in finding out whether it can run.
 *
 * - `loading`: the status fetch has not answered. This is what the SERVER
 *   renders, so it is what every crawler, link preview and first paint gets.
 * - `error`: the status endpoint could not be reached. That says nothing about
 *   whether the tool has shipped.
 * - `ready`: the status is known, and the panel can say what it says.
 */
export type WorkerPhase = "loading" | "error" | "ready";

/**
 * The one status fetch every worker panel made with its own copy of the same
 * effect. Shared so the error phase can offer a retry — the copies had no way
 * to run the effect again, so a single dropped request left the page saying
 * "unavailable" until a reload.
 */
export function useWorkerStatus(): {
  phase: WorkerPhase;
  status: WorkerStatus | null;
  retry: () => void;
} {
  const [phase, setPhase] = useState<WorkerPhase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<WorkerStatus>)
          : Promise.reject(new Error("unreachable")),
      )
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setPhase("ready");
        track({
          name: "worker_status_checked",
          mode: next.mode,
          enabled: next.enabled,
        });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setPhase("loading");
    setAttempt((n) => n + 1);
  }, []);

  return { phase, status, retry };
}

/**
 * What a worker panel shows while it does NOT KNOW whether it can run.
 *
 * Every panel used to show its "not available" box here — the reason, the
 * "never pretends" sentence, and a "Notify me when this ships" button —
 * because `phase === "loading"` fell into the same branch as a worker that
 * really was off. The server renders the loading phase, so the HTML of twenty
 * live tool pages, PDF to Word and Word to PDF among them, told search engines
 * the tools had not shipped, and a visitor on a slow connection could file a
 * request for a tool that already worked.
 *
 * Neither phase here makes a claim about the tool. A failed status check gets
 * a retry, not a notify button: an unreachable endpoint is not news that the
 * tool is missing. The min-height keeps the runner's arrival from shoving the
 * page.
 */
export function WorkerStatusPending({
  phase,
  onRetry,
}: {
  phase: Exclude<WorkerPhase, "ready">;
  onRetry: () => void;
}) {
  return (
    <div className="border-line bg-wash flex min-h-32 flex-col justify-center gap-3 rounded-[4px] border p-4">
      {phase === "loading" ? (
        <p
          role="status"
          aria-live="polite"
          className="text-muted inline-flex items-center gap-2 text-sm"
        >
          <Spinner className="size-4" />
          Checking the secure worker…
        </p>
      ) : (
        <>
          <p role="status" className="text-muted text-sm leading-relaxed">
            We couldn&rsquo;t reach the worker status service just now. Nothing
            is uploaded until the worker is confirmed.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="border-line text-fg hover:bg-panel inline-flex items-center gap-1.5 self-start rounded-[3px] border px-3 py-1.5 text-sm font-medium transition"
          >
            <RotateCw className="size-3.5" aria-hidden />
            Check again
          </button>
        </>
      )}
    </div>
  );
}
