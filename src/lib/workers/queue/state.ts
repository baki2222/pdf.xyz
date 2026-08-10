/**
 * The job state machine for the secure-worker queue.
 *
 * This is the single, pure source of truth for which {@link JobStatus} moves are
 * legal. A queue provider (in-process today, a real broker later) consults it
 * before every transition so a job can never take an impossible path — e.g. a
 * `completed` job cannot be `canceled`, and a `failed` job cannot resume. It is
 * dependency-free and exhaustively unit-tested, so the same rules govern the
 * local-dev worker and any production queue wired behind the adapter.
 *
 * Two distinct notions, kept separate on purpose:
 *  - the *active lifecycle* a job walks while it is being processed
 *    (queued → scanning → processing → completed/failed), plus cancellation; and
 *  - the *retention* transition `completed → expired`, which is driven by the
 *    storage lifecycle (outputs auto-delete), not by processing.
 */

import type { JobStatus } from "@/lib/jobs";
import { isTerminalStatus } from "@/lib/jobs";

/**
 * Legal next states for each status. An empty list means the status is terminal
 * for the active lifecycle. Two non-forward edges are modeled explicitly:
 *  - `completed → expired` is the retention edge (outputs auto-delete); and
 *  - `scanning/processing → queued` is **redelivery** — a broker returning an
 *    un-acked job to the queue when its lease expires or the executor requeues a
 *    retryable failure. A real queue redelivers; the state machine says so rather
 *    than hiding it behind a side channel.
 */
export const QUEUE_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["scanning", "processing", "failed", "canceled"],
  scanning: ["processing", "failed", "canceled", "queued"],
  processing: ["completed", "failed", "canceled", "queued"],
  completed: ["expired"],
  failed: [],
  expired: [],
  canceled: [],
} as const;

/** Every {@link JobStatus}, derived from the transition table's own keys. */
export const ALL_STATUSES = Object.keys(QUEUE_TRANSITIONS) as JobStatus[];

/** The actively-leased statuses a worker may heartbeat/advance from. */
export const RUNNING_STATUSES: readonly JobStatus[] = [
  "scanning",
  "processing",
];

/** True when a job may legally move from `from` to `to`. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return QUEUE_TRANSITIONS[from].includes(to);
}

/**
 * The set of statuses a job may legally be in for a transition *to* `target` to
 * be allowed — the inverse of {@link QUEUE_TRANSITIONS}. The atomic Redis provider
 * passes this set into its compare-and-set scripts so the transition rules stay
 * defined once here and are merely *enforced* server-side, never re-encoded in Lua.
 */
export function sourceStatusesFor(target: JobStatus): JobStatus[] {
  return ALL_STATUSES.filter((from) => canTransition(from, target));
}

/**
 * True when a job can still be canceled — i.e. it has not reached a terminal
 * state. Cancellation is only meaningful for in-flight work.
 */
export function canCancel(status: JobStatus): boolean {
  return !isTerminalStatus(status);
}

/** True when a completed job's outputs can be expired (retention delete-now). */
export function canExpire(status: JobStatus): boolean {
  return status === "completed";
}

/**
 * True when a job is in an active (claimed/running) state that a queue may
 * redeliver to `queued` — either because its lease expired or because a
 * retryable failure requeued it. Terminal and already-queued jobs are never
 * redelivered.
 */
export function canRedeliver(status: JobStatus): boolean {
  return status === "scanning" || status === "processing";
}

/**
 * The terminal state that a "delete now" request maps a job to, given its
 * current state, or `null` when there is nothing to do (already terminal with no
 * downloadable output):
 *  - in-flight  → `canceled` (stop the work),
 *  - completed  → `expired`  (delete the outputs now),
 *  - otherwise  → `null`     (already canceled/failed/expired; idempotent no-op).
 */
export function deletionTarget(status: JobStatus): JobStatus | null {
  if (canCancel(status)) return "canceled";
  if (canExpire(status)) return "expired";
  return null;
}
