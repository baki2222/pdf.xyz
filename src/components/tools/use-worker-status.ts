"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { WorkerStatus } from "@/lib/workers/status";
import { track } from "@/lib/telemetry/track";

/**
 * Where a worker panel is in finding out whether it can run.
 *
 * - `loading`: the status fetch has not answered. This is what the SERVER
 *   renders, so it is what every crawler, link preview and first paint gets.
 * - `error`: the status endpoint could not be reached (or asked us to wait).
 *   That says nothing about whether the tool has shipped.
 * - `ready`: the status is known, and the panel can say what it says.
 */
export type WorkerPhase = "loading" | "error" | "ready";

/** How long an answer is reused by a panel that mounts after it. */
export const STATUS_CACHE_MS = 30_000;
/** A 429's `Retry-After` is honoured up to this, and no further. */
const MAX_RETRY_AFTER_MS = 30_000;
/** A 429 that names no wait (or names a date) waits this long. */
const DEFAULT_RETRY_AFTER_MS = 5_000;
/** Retries after the first try, on a network or 5xx failure. */
const RETRIES = 2;
const BACKOFF_MS = [600, 1_800] as const;

interface Snapshot {
  readonly phase: WorkerPhase;
  readonly status: WorkerStatus | null;
  /** The last check was a 429: the page waited, and asks before it tries. */
  readonly limited: boolean;
}

const LOADING: Snapshot = { phase: "loading", status: null, limited: false };

interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/*
 * The page's one check. Module-level on purpose — every panel on a page
 * reads the same answer — and so a `Set` of listeners plus a reset for
 * vitest's `isolate:false` (spec G.5 trap 5), never a single slot.
 */
let clock: Clock = realClock;
let snapshot: Snapshot = LOADING;
let answeredAt = -Infinity;
let inflight: Promise<void> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Seconds, or an HTTP date (not honoured: a clock we do not share). */
function retryAfterMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  const seconds = raw === null ? NaN : Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

async function check(own: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch("/api/worker/status", {
        headers: { accept: "application/json" },
      });
    } catch {
      res = null;
    }
    if (own !== generation) return;
    if (res?.ok) {
      try {
        const status = (await res.json()) as WorkerStatus;
        if (own !== generation) return;
        answeredAt = clock.now();
        publish({ phase: "ready", status, limited: false });
        track({
          name: "worker_status_checked",
          mode: status.mode,
          enabled: status.enabled,
        });
        return;
      } catch {
        res = null; // An unreadable 200 is the same blip as a 502.
      }
    }
    if (res?.status === 429) {
      // The limiter asked for a wait. Asking again at once — or twice more,
      // as a 5xx is — is the storm it is there to stop.
      await clock.sleep(retryAfterMs(res));
      if (own === generation)
        publish({ phase: "error", status: null, limited: true });
      return;
    }
    const retryable = res === null || res.status >= 500;
    if (!retryable || attempt >= RETRIES) {
      publish({ phase: "error", status: null, limited: false });
      return;
    }
    await clock.sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[1]);
    if (own !== generation) return;
  }
}

/** Start a check unless one is running, or a fresh answer is in hand. */
function ensure(force: boolean): void {
  if (inflight) return;
  const fresh =
    snapshot.phase === "ready" && clock.now() - answeredAt < STATUS_CACHE_MS;
  if (fresh && !force) return;
  if (snapshot.phase !== "loading") publish(LOADING);
  const own = generation;
  inflight = check(own).finally(() => {
    if (own === generation) inflight = null;
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;
const getServerSnapshot = () => LOADING;

/**
 * The worker's status for this page: one request however many panels ask,
 * reused for {@link STATUS_CACHE_MS}, retried twice with a backoff on a
 * network or 5xx failure, and on a 429 a wait of `Retry-After` (at most 30s)
 * before the page offers Try again. `worker_status_checked` is sent once per
 * request that answered — not once per panel.
 *
 * The server and the hydrating client both read `loading`, so the HTML
 * never claims the tool is on or off.
 */
export function useWorkerStatus(): {
  phase: WorkerPhase;
  status: WorkerStatus | null;
  limited: boolean;
  retry: () => void;
} {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  useEffect(() => ensure(false), []);
  const retry = useCallback(() => ensure(true), []);
  return { ...current, retry };
}

/** Forget the page's answer, and (optionally) inject time for a test. */
export function resetWorkerStatusForTests(next?: Partial<Clock>): void {
  generation++;
  inflight = null;
  answeredAt = -Infinity;
  snapshot = LOADING;
  clock = { ...realClock, ...next };
}
