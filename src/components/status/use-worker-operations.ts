"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkerOperationsSnapshot } from "@/lib/workers/observability";
import { track } from "@/lib/telemetry/track";
import { normalizeSnapshot } from "./operations-ui";

/** The honest operator surface — the content-free worker operations snapshot. */
export const WORKER_OPERATIONS_ENDPOINT = "/api/worker/operations";

export type OperationsPhase = "loading" | "ready" | "error";

export interface WorkerOperationsState {
  readonly phase: OperationsPhase;
  readonly snapshot: WorkerOperationsSnapshot | null;
  readonly retry: () => void;
}

/**
 * Fetch the worker operations snapshot from `/api/worker/operations`. Rejects on a
 * non-2xx response so the caller can render a recoverable error. The body is the
 * snapshot object directly (the route returns `respond(ok(snapshot))`); it is typed
 * on the happy path but never trusted for rendering — {@link normalizeSnapshot}
 * re-validates every field before anything reaches the DOM.
 */
export async function fetchWorkerOperations(
  signal?: AbortSignal,
): Promise<WorkerOperationsSnapshot> {
  const res = await fetch(WORKER_OPERATIONS_ENDPOINT, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error("unreachable");
  return (await res.json()) as WorkerOperationsSnapshot;
}

/**
 * Read the operations snapshot for the dashboard: a `loading` → `ready`/`error`
 * lifecycle with a `retry`. On success it emits a privacy-safe
 * `worker_operations_checked` product event carrying only the *normalized* bounded
 * enums (mode, health class, recommended action) and honesty booleans — never a
 * count, endpoint, or identifier. A malformed response that has no recognizable
 * mode/action simply skips the event (telemetry is best-effort) rather than
 * inventing one.
 */
export function useWorkerOperations(): WorkerOperationsState {
  const [phase, setPhase] = useState<OperationsPhase>("loading");
  const [snapshot, setSnapshot] = useState<WorkerOperationsSnapshot | null>(
    null,
  );
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setPhase("loading");
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    fetchWorkerOperations()
      .then((s) => {
        if (!active) return;
        setSnapshot(s);
        setPhase("ready");
        const view = normalizeSnapshot(s);
        if (view.mode && view.recommendedAction) {
          track({
            name: "worker_operations_checked",
            mode: view.mode,
            health: view.health,
            recommendedAction: view.recommendedAction,
            drainable: view.drainable,
            daemonObserved: view.daemonObserved,
          });
        }
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return { phase, snapshot, retry };
}
