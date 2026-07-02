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
 * for the active lifecycle. `completed → expired` is the one retention-driven
 * edge (an already-terminal status that still auto-deletes its outputs).
 */
export const QUEUE_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["scanning", "processing", "failed", "canceled"],
  scanning: ["processing", "failed", "canceled"],
  processing: ["completed", "failed", "canceled"],
  completed: ["expired"],
  failed: [],
  expired: [],
  canceled: [],
} as const;

/** True when a job may legally move from `from` to `to`. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return QUEUE_TRANSITIONS[from].includes(to);
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
