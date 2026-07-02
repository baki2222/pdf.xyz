/**
 * The typed contract for the secure-worker **job-queue provider** — the
 * component *behind* the worker adapter that accepts jobs, reports their status,
 * and cancels/expires them under the state machine in `./state.ts`.
 *
 * Like the storage provider, this is a pure contract with no HTTP knowledge. A
 * real deployment implements {@link QueueProvider} against SQS/PubSub/a broker;
 * this build ships a not-configured provider (honest default) and a
 * developer-only in-process provider. Because every method returns a typed
 * {@link QueueResult}, a disabled queue can only ever return an honest failure —
 * it can never mint a job id or claim a job "completed".
 */

import type { FieldError, Job } from "@/lib/jobs";

/** Which concrete provider produced an outcome — for diagnostics and tests. */
export type QueueProviderId =
  | "disabled" // no queue wired; every op is an honest not_configured
  | "remote-unimplemented" // queue configured but this build ships no client
  | "redis" // configured Redis/Upstash-compatible REST broker (real job state)
  | "local-dev"; // developer-only in-process queue

/**
 * Why a queue operation could not be honored. The adapter maps each to an HTTP
 * status; the provider never speaks HTTP.
 */
export type QueueFailureReason =
  | "not_configured" // no queue provider in this environment
  | "not_implemented" // provider configured, but no client shipped in this build
  | "not_found" // no such job (or it expired out of the queue)
  | "conflict" // illegal state transition (e.g. cancel an already-done job)
  | "unavailable"; // broker reached but errored, or was unreachable — transient

export interface QueueFailure {
  reason: QueueFailureReason;
  /** Client-safe message. Never names a variable or leaks a value. */
  message: string;
  details?: FieldError[];
}

/** A provider operation result: a typed value, or a typed, honest failure. */
export type QueueResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: QueueFailure };

/** The honest, client-safe status of the queue provider in this environment. */
export interface QueueCapability {
  provider: QueueProviderId;
  /** True only when the provider can accept/report/cancel jobs now. */
  ready: boolean;
  /** Infra present in env but no live client shipped (remote-unimplemented). */
  configured: boolean;
  enqueue: boolean;
  status: boolean;
  cancel: boolean;
  /**
   * Presence-only: whether this provider's state transitions
   * (claim/heartbeat/complete/fail/cancel/expire) are atomic and race-safe
   * (server-side compare-and-set), as opposed to a last-writer-wins read→write.
   * `true` for the Redis provider (Lua `EVAL`) and the single-process local-dev
   * provider; `false` when no provider is wired. Client-safe boolean — names no
   * broker, command, or variable.
   */
  atomicTransitions: boolean;
  /** One-line, client-safe explanation. Never names a variable or a value. */
  detail: string;
}

/**
 * The job-queue provider. The adapter builds a {@link Job} in its initial state
 * (a synchronous local worker builds a terminal job; an async broker would build
 * a `queued` one) and hands it to {@link QueueProvider.enqueue}; the provider is
 * the system of record from then on.
 */
export interface QueueProvider {
  readonly id: QueueProviderId;
  /**
   * Readiness gate. `ok` when the queue can serve requests; otherwise the typed
   * not_configured / not_implemented failure the adapter maps to HTTP.
   */
  probe(): QueueResult<void>;
  /** Record a job in its initial state; optionally index it by idempotency key. */
  enqueue(job: Job, idempotencyKey?: string): Promise<QueueResult<Job>>;
  /** Resolve a prior job by idempotency key, or `null` if none is recorded. */
  lookupIdempotent(key: string): Promise<QueueResult<Job | null>>;
  /** Current job state, or a `not_found` failure. */
  status(jobId: string): Promise<QueueResult<Job>>;
  /** Cancel an in-flight job (→ `canceled`). `conflict` if already terminal. */
  cancel(jobId: string): Promise<QueueResult<Job>>;
  /** Expire a completed job's outputs (→ `expired`). `conflict` otherwise. */
  expire(jobId: string): Promise<QueueResult<Job>>;
  capability(): QueueCapability;
}

/**
 * The static capability of the developer-only in-process queue provider. Kept
 * in this node-free leaf so both the provider and the presence-only status
 * reporter can share it without pulling the in-process store's Node built-ins.
 */
export const LOCAL_DEV_QUEUE_CAPABILITY: QueueCapability = {
  provider: "local-dev",
  ready: true,
  configured: false,
  enqueue: true,
  status: true,
  cancel: true,
  // Single process, single thread: transitions cannot interleave, so they are
  // atomic by construction (the honest analogue of the Redis provider's EVAL CAS).
  atomicTransitions: true,
  detail:
    "Local-dev job queue is active: jobs run synchronously in-process on this machine. Not for production — no shared broker, lost on restart.",
};

/** Build a successful queue result. */
export function queueOk<T>(value: T): QueueResult<T> {
  return { ok: true, value };
}

/** Build a failed queue result. */
export function queueFail<T = never>(
  reason: QueueFailureReason,
  message: string,
  details?: FieldError[],
): QueueResult<T> {
  return { ok: false, error: { reason, message, ...(details ? { details } : {}) } };
}
