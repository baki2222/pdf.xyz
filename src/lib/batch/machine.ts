/**
 * Pure state machine for the in-browser batch runner. Deterministic and
 * side-effect-free: the React driver (`use-batch-runner.ts`) owns the actual
 * async work and feeds results back in as events, while this reducer owns the
 * truth about phase and per-item status. That split keeps every transition —
 * including the tricky cancel-mid-flight case — unit-testable.
 */

import type { BatchItem, BatchProgress, BatchSeed, BatchState } from "./types";

export type BatchEvent<R> =
  /** Begin processing (only meaningful from `idle` with queued items). */
  | { type: "start" }
  /** Mark a queued item as running. */
  | { type: "item-start"; id: string }
  /** Record a successful item result, with a sentence that is not a failure. */
  | { type: "item-success"; id: string; result: R; note?: string }
  /** Record an item failure with a user-facing message. */
  | { type: "item-error"; id: string; error: string }
  /** Record that a running item was deliberately left out, and why. */
  | { type: "item-skip"; id: string; reason: string }
  /**
   * Queue the named FAILED items again, from a settled batch, keeping every
   * other row (and every finished result) as it is. The batch goes back to
   * `idle`, so a `start` runs exactly the re-queued items.
   */
  | { type: "retry"; ids: readonly string[] }
  /** Take a file out of the list before anything has run. */
  | { type: "remove"; id: string }
  /**
   * A rate limit stopped the running file (batch plan P3): it goes back to
   * the queue — it did not fail, the hour ran out — and the batch waits
   * until `resumeAt`. Only from `running`.
   */
  | { type: "pause"; resumeAt: number }
  /** Carry on after a pause: the queue runs again from the paused file. */
  | { type: "resume" }
  /** Cancel: queued items become `canceled`; an in-flight item finishes. */
  | { type: "cancel" }
  /** Re-seed the batch back to a fresh `idle` state. */
  | { type: "reset"; items: BatchSeed[] };

/** Build a fresh, all-queued batch from seeds. */
export function initBatch<R>(items: BatchSeed[]): BatchState<R> {
  return {
    phase: "idle",
    items: items.map((seed) => ({
      id: seed.id,
      name: seed.name,
      status: "queued",
    })),
  };
}

function mapItem<R>(
  items: BatchItem<R>[],
  id: string,
  fn: (item: BatchItem<R>) => BatchItem<R>,
): { items: BatchItem<R>[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    const updated = fn(item);
    if (updated !== item) changed = true;
    return updated;
  });
  return { items: next, changed };
}

/** True when no item is still queued or running. */
function allSettled<R>(items: BatchItem<R>[]): boolean {
  return items.every(
    (item) => item.status !== "queued" && item.status !== "running",
  );
}

export function batchReducer<R>(
  state: BatchState<R>,
  event: BatchEvent<R>,
): BatchState<R> {
  switch (event.type) {
    case "start": {
      const hasQueued = state.items.some((item) => item.status === "queued");
      if (state.phase !== "idle" || !hasQueued) return state;
      return { ...state, phase: "running" };
    }

    case "item-start": {
      if (state.phase !== "running") return state;
      const { items, changed } = mapItem(state.items, event.id, (item) =>
        item.status === "queued" ? { ...item, status: "running" } : item,
      );
      return changed ? { ...state, items } : state;
    }

    case "item-success": {
      const { items, changed } = mapItem(state.items, event.id, (item) =>
        item.status === "running"
          ? {
              ...item,
              status: "done",
              result: event.result,
              error: undefined,
              ...(event.note ? { note: event.note } : {}),
            }
          : item,
      );
      if (!changed) return state;
      // Only a still-running batch can transition to `done`; a canceled batch
      // stays canceled even as its last in-flight item settles.
      const phase =
        state.phase === "running" && allSettled(items) ? "done" : state.phase;
      return { ...state, items, phase };
    }

    case "item-error": {
      const { items, changed } = mapItem(state.items, event.id, (item) =>
        item.status === "running"
          ? { ...item, status: "error", error: event.error, result: undefined }
          : item,
      );
      if (!changed) return state;
      const phase =
        state.phase === "running" && allSettled(items) ? "done" : state.phase;
      return { ...state, items, phase };
    }

    case "item-skip": {
      const { items, changed } = mapItem(state.items, event.id, (item) =>
        item.status === "running"
          ? { ...item, status: "skipped", reason: event.reason }
          : item,
      );
      if (!changed) return state;
      const phase =
        state.phase === "running" && allSettled(items) ? "done" : state.phase;
      return { ...state, items, phase };
    }

    case "retry": {
      // Only a batch at rest is retried: a running one still owns its queue.
      if (state.phase !== "done" && state.phase !== "canceled") return state;
      const ids = new Set(event.ids);
      let changed = false;
      const items = state.items.map((item) => {
        if (item.status !== "error" || !ids.has(item.id)) return item;
        changed = true;
        const { error: _error, ...rest } = item;
        return { ...rest, status: "queued" as const };
      });
      return changed ? { phase: "idle", items } : state;
    }

    case "remove": {
      // Before Run only: once a file has run, its row is its record.
      if (state.phase !== "idle") return state;
      const items = state.items.filter((item) => item.id !== event.id);
      return items.length === state.items.length ? state : { ...state, items };
    }

    case "pause": {
      if (state.phase !== "running") return state;
      const items = state.items.map((item) =>
        item.status === "running"
          ? { ...item, status: "queued" as const }
          : item,
      );
      return { phase: "paused", items, resumeAt: event.resumeAt };
    }

    case "resume": {
      if (state.phase !== "paused") return state;
      return { phase: "running", items: state.items };
    }

    case "cancel": {
      if (state.phase === "done" || state.phase === "canceled") return state;
      // Queued items never ran → canceled. A running item is left alone so its
      // in-flight result can still be recorded; the phase is canceled regardless.
      const items = state.items.map((item) =>
        item.status === "queued"
          ? { ...item, status: "canceled" as const }
          : item,
      );
      // A pause's `resumeAt` goes with it: nothing will resume.
      return { phase: "canceled", items };
    }

    case "reset":
      return initBatch(event.items);

    default:
      return state;
  }
}

/** Derive display-ready progress counts from a batch state. */
export function batchProgress<R>(state: BatchState<R>): BatchProgress {
  const counts = {
    queued: 0,
    running: 0,
    done: 0,
    error: 0,
    skipped: 0,
    canceled: 0,
  };
  for (const item of state.items) counts[item.status] += 1;
  const total = state.items.length;
  const settled = counts.done + counts.error + counts.skipped + counts.canceled;
  return {
    total,
    ...counts,
    settled,
    pct: total > 0 ? Math.round((settled / total) * 100) : 0,
  };
}

/** True when the batch has reached a terminal phase. */
export function isBatchSettled<R>(state: BatchState<R>): boolean {
  return state.phase === "done" || state.phase === "canceled";
}
