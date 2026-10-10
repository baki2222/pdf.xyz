"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { WorkerStatus } from "@/lib/workers/status";
import { track } from "@/lib/telemetry/track";
import { cn } from "@/lib/utils";
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

/** What the status-dependent part of a panel is showing. */
export type WorkerSlotState = "loading" | "error" | "off" | "run";

/**
 * `run` once the status says this panel can run, `off` once it says it
 * cannot, and the phase itself until it says anything.
 */
export function workerSlotState(
  phase: WorkerPhase,
  available: boolean,
): WorkerSlotState {
  if (available) return "run";
  return phase === "ready" ? "off" : phase;
}

/**
 * The status-dependent part of a worker panel — "Checking the secure
 * worker…", then the run area or the not-enabled box — as ONE reserved box.
 *
 * WHY (WP-06 review, 2026-10-10): the tool page puts the panel straight under
 * the tool's name, so on a phone this part is in the first screen, and it
 * changed height when `/api/worker/status` answered — the checking box was a
 * bare `min-h-32`, the run area several times taller — moving everything
 * under it in view: CLS 0.0582 on Protect PDF at 390 with a ready answer,
 * 0.0324 on Word to PDF, against a bound of 0.01.
 *
 * `reserve` is the panel's own min-height, per breakpoint: at least the
 * tallest state the slot can show — loading, error, not enabled, or the idle
 * run area — at the narrowest width that breakpoint covers, so every state
 * is the same box. The states stretch to fill it (a grid of one row grows to
 * its container's min-height): a checking or not-enabled box is a box the
 * size of the run area it stands in for. A run area that outgrows its
 * reserve fails `e2e/layout-stability.spec.ts`, which measures every worker
 * panel at 390 with this server's answer and a ready one held back 500ms.
 * Growth after the reader acts (a file picked, a result) is input's, and
 * not reserved.
 */
export function WorkerStatusSlot({
  state,
  reserve,
  children,
}: {
  state: WorkerSlotState;
  /** Tailwind min-heights, e.g. `min-h-[31rem] sm:min-h-[26rem]`. */
  reserve: string;
  children: ReactNode;
}) {
  return (
    // One column that never grows past the panel (`grid-cols-1` is
    // `minmax(0, 1fr)`): an auto column would widen to a wide child. A box
    // standing in for the run area centres what it says; the run area keeps
    // its own top, so nothing in it moves as it grows with a file.
    <div
      data-slot="worker-status"
      data-state={state}
      className={cn(
        "grid grid-cols-1",
        state !== "run" && "[&>*]:justify-center",
        reserve,
      )}
    >
      {children}
    </div>
  );
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
 * tool is missing. Its own min-height is only a floor: what keeps the run
 * area's arrival from shoving the page is the panel's {@link
 * WorkerStatusSlot}, which this box fills.
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
