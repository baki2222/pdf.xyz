/**
 * The executor-facing extension of the {@link QueueProvider} contract: atomic
 * claim, lease heartbeat, progress, and terminal completion/failure.
 *
 * This is kept as a *separate* interface that extends `QueueProvider` rather than
 * as new required methods on it, so the evolution is fully backward-compatible:
 * the app-server routes (which only enqueue/status/cancel) continue to depend on
 * the base contract and are untouched, while a broker that a worker drains
 * implements the richer {@link ClaimableQueue}. A real broker (SQS/PubSub/Redis)
 * implements these atomically; the local-dev queue implements them in-process and
 * deterministically. Node-free (types only) — see `./local-dev` for the impl.
 */

import type {
  Job,
  JobArtifact,
  JobError,
  JobResults,
  JobStatus,
  JobDeliveryCap,
} from "@/lib/jobs";
import type { QueueProvider, QueueResult } from "./types";

/**
 * The 1-based attempt number a job was claimed under — the **lease-ownership
 * fingerprint** an executor threads back through {@link ClaimableQueue}'s
 * running-state transitions. It is stable across heartbeats and bumps on every
 * (re)claim, so an atomic provider can reject a write from a worker whose lease
 * was stolen (its attempt no longer matches the stored lease) without resurrecting
 * or corrupting the job. Optional on every method for backward compatibility: an
 * omitted fingerprint means "do not check ownership" (the pre-Phase-21 behavior,
 * still atomic on the *status* precondition). See docs/WORKER_ARCHITECTURE.md.
 */
export type AttemptFingerprint = number;

/**
 * A queued job plus everything the executor needs to run it: the input file ids
 * and the raw option bag. Distinct from {@link Job} (the client-facing record),
 * which deliberately never exposes inputs.
 */
export interface JobSubmission {
  /** The initial job record; its status MUST be `queued`. */
  job: Job;
  /** Input `fileId`s the executor reads and processes. */
  inputs: string[];
  /**
   * Optional sanitized display names, positionally aligned with `inputs`. Carried
   * as a spec *value* (never a key) so the executor can name outputs even when the
   * storage layer can't recover a name from object metadata. Display-only.
   */
  inputNames?: string[];
  /** Raw options (validated at submit time; processors re-validate defensively). */
  options: Record<string, unknown>;
  /**
   * What this job may DELIVER, decided by the route when it reserved the
   * caller's allowance. Absent for every non-AI job and for any job submitted
   * before this field existed — absent means unbounded, which is the behaviour
   * those jobs already had.
   */
  delivery?: JobDeliveryCap;
}

/** A job claimed for execution: the record, its inputs/options, and its lease. */
export interface ClaimedJob {
  job: Job;
  inputs: string[];
  /** Sanitized display names aligned with `inputs`, when the submission carried them. */
  inputNames?: string[];
  options: Record<string, unknown>;
  /** The submission's delivery cap, when it carried one. */
  delivery?: JobDeliveryCap;
  /** 1-based attempt number; increments on redelivery or a retryable requeue. */
  attempt: number;
  /** Epoch-ms lease deadline; the executor must finish or heartbeat before it. */
  leaseExpiresAt: number;
}

/** Options for a claim: how long the claimed job is leased to this worker. */
export interface ClaimOptions {
  /** Lease duration in ms. A lease that expires makes the job reclaimable. */
  leaseMs: number;
}

/**
 * How the executor dispositions a running job's failure:
 *  - `{ requeue: false }` → terminal `failed`;
 *  - `{ requeue: true }`  → back to `queued` for another attempt (redelivery);
 *  - `{ requeue: true, delayMs }` → requeued, but **not claimable until
 *    `delayMs` has elapsed**.
 *
 * WHY THE DELAY IS THE QUEUE'S JOB AND NOT THE DAEMON'S. The failure kind that
 * most needs a retry — `rate_limited` — is the one whose whole nature is
 * "wait", and without a delay the executor's three attempts fire back to back
 * inside a few milliseconds: functionally identical to not retrying at all. A
 * daemon-side sleep was considered and rejected, because it blocks the whole
 * worker — one rate-limited job would delay every OTHER job behind it. Held at
 * the queue, the delayed job simply is not visible yet: the daemon claims
 * again immediately (correct — other work may be ready), drains whatever else
 * is runnable, and goes idle only when nothing is.
 *
 * `delayMs` is meaningful only when `requeue` is true; absent or `<= 0` means
 * immediately claimable (the pre-delay behavior, unchanged).
 */
export type FailDisposition = { requeue: boolean; delayMs?: number };

/** A running-state update: advance scan→process and/or move progress forward. */
export interface RunningUpdate {
  status?: Extract<JobStatus, "scanning" | "processing">;
  /** 0–100 progress for long-running work. */
  progress?: number;
}

/**
 * A job-queue provider a worker can claim from. Extends {@link QueueProvider} with
 * the execution-loop operations; the base enqueue/status/cancel/expire semantics
 * are inherited unchanged.
 */
export interface ClaimableQueue extends QueueProvider {
  /**
   * Record a `queued` job together with its inputs/options so the executor can
   * later claim and run it. (The base `enqueue` records an already-terminal job
   * with no inputs; `submit` is its async-execution counterpart.)
   */
  submit(
    submission: JobSubmission,
    idempotencyKey?: string,
  ): Promise<QueueResult<Job>>;

  /**
   * Atomically claim the next runnable job — the oldest `queued` job, or a
   * running job whose lease has expired (redelivery) — move it to `scanning`,
   * lease it, and bump its attempt counter. Resolves to `null` when nothing is
   * claimable.
   */
  claim(options: ClaimOptions): Promise<QueueResult<ClaimedJob | null>>;

  /**
   * Extend a claimed job's lease while it is still being processed. Pass the
   * {@link AttemptFingerprint} from the claim to make an atomic provider reject a
   * heartbeat whose lease was stolen (no resurrection); omit it to skip the
   * ownership check.
   */
  heartbeat(
    jobId: string,
    leaseMs: number,
    expectedAttempt?: AttemptFingerprint,
  ): Promise<QueueResult<Job>>;

  /** Advance a running job's status (scan→process) and/or its progress. */
  advance(
    jobId: string,
    update: RunningUpdate,
    expectedAttempt?: AttemptFingerprint,
  ): Promise<QueueResult<Job>>;

  /**
   * Mark a claimed job `completed` with its produced artifacts, and optionally the
   * safe, structured {@link JobResults} the processor observed (e.g. OCR metadata).
   * The results are re-bounded at this persistence boundary (`sanitizeJobResults`)
   * before they land on the client-facing record, so a caller can never write an
   * unsafe value onto a job; an omitted/empty block simply leaves `results` off the
   * record. Optional and last so the pre-existing 3-arg callers are unchanged.
   */
  complete(
    jobId: string,
    artifacts: JobArtifact[],
    expectedAttempt?: AttemptFingerprint,
    results?: JobResults,
  ): Promise<QueueResult<Job>>;

  /** Fail a claimed job: terminal `failed`, or requeue it for another attempt. */
  fail(
    jobId: string,
    error: JobError,
    disposition: FailDisposition,
    expectedAttempt?: AttemptFingerprint,
  ): Promise<QueueResult<Job>>;
}
