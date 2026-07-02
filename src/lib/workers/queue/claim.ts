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

import type { Job, JobArtifact, JobError, JobStatus } from "@/lib/jobs";
import type { QueueProvider, QueueResult } from "./types";

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
  /** Raw options (validated at submit time; processors re-validate defensively). */
  options: Record<string, unknown>;
}

/** A job claimed for execution: the record, its inputs/options, and its lease. */
export interface ClaimedJob {
  job: Job;
  inputs: string[];
  options: Record<string, unknown>;
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
 *  - `{ requeue: true }`  → back to `queued` for another attempt (redelivery).
 */
export type FailDisposition = { requeue: boolean };

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

  /** Extend a claimed job's lease while it is still being processed. */
  heartbeat(jobId: string, leaseMs: number): Promise<QueueResult<Job>>;

  /** Advance a running job's status (scan→process) and/or its progress. */
  advance(jobId: string, update: RunningUpdate): Promise<QueueResult<Job>>;

  /** Mark a claimed job `completed` with its produced artifacts. */
  complete(jobId: string, artifacts: JobArtifact[]): Promise<QueueResult<Job>>;

  /** Fail a claimed job: terminal `failed`, or requeue it for another attempt. */
  fail(
    jobId: string,
    error: JobError,
    disposition: FailDisposition,
  ): Promise<QueueResult<Job>>;
}
