/**
 * The developer-only, in-process job-queue provider.
 *
 * It implements the {@link ClaimableQueue} contract against {@link DevWorkerStore}:
 * jobs are recorded, looked up by idempotency key, moved through the state machine
 * in `./state.ts`, and — for the worker executor — claimed, leased, heartbeated,
 * and driven to a terminal state. A production queue is async and broker-backed
 * and performs these atomically; this one is synchronous and per-process, which
 * keeps local-dev deterministic while exercising the identical contract. It never
 * fabricates a status: a job it cannot find is an honest `not_found`, and an
 * illegal transition is a `conflict`.
 */

import type { Job, JobArtifact, JobError, JobResults } from "@/lib/jobs";
import { isTerminalStatus, sanitizeJobResults } from "@/lib/jobs";
import { DevWorkerStore, devWorkerStore } from "../store";
import { canCancel, canExpire, canRedeliver, canTransition } from "./state";
import type {
  AttemptFingerprint,
  ClaimableQueue,
  ClaimOptions,
  ClaimedJob,
  FailDisposition,
  JobSubmission,
  RunningUpdate,
} from "./claim";
import { LOCAL_DEV_QUEUE_CAPABILITY, queueFail, queueOk } from "./types";

/** Injectable seams so the provider is fully unit-testable with a fake clock. */
export interface LocalDevQueueDeps {
  store?: DevWorkerStore;
  now?: () => number;
}

const NOT_FOUND = () =>
  queueFail("not_found", "No such job (it may have expired).", [
    { field: "id", message: "Unknown or expired job id." },
  ]);

/**
 * Build the in-process queue provider. Shares the same {@link DevWorkerStore}
 * instance as the local-dev storage so jobs and their artifacts see one store.
 */
export function createLocalDevQueue(
  deps: LocalDevQueueDeps = {},
): ClaimableQueue {
  const store = deps.store ?? devWorkerStore;
  const now = deps.now ?? (() => Date.now());
  const iso = (ms: number): string => new Date(ms).toISOString();

  /** Move a job to a terminal, output-less state, wiping its artifact list. */
  const toTerminal = (job: Job, status: "canceled" | "expired"): Job => {
    const next: Job = { ...job, status, updatedAt: iso(now()) };
    // Outputs are being deleted alongside this transition, so the record must
    // not keep advertising downloadable artifacts (keeps isDownloadReady honest),
    // nor the result metadata that describes those now-deleted outputs.
    delete next.artifacts;
    delete next.results;
    return next;
  };

  /** Forget a job's execution bookkeeping once it can no longer run. */
  const forgetExecution = (jobId: string): void => {
    store.deleteLease(jobId);
    store.deleteSpec(jobId);
  };

  /**
   * True when a supplied lease-ownership fingerprint does NOT match the stored
   * lease — the in-process analogue of the Redis provider's server-side attempt
   * CAS. When no fingerprint is supplied the check is skipped (the pre-Phase-21
   * behavior). In-process execution is single-threaded, so this is inherently
   * atomic; it exists so both providers honor the identical contract.
   */
  const staleLease = (
    jobId: string,
    expectedAttempt: AttemptFingerprint | undefined,
  ): boolean => {
    if (expectedAttempt === undefined) return false;
    const lease = store.getLease(jobId);
    return !lease || lease.attempts !== expectedAttempt;
  };

  return {
    id: "local-dev",

    probe() {
      return queueOk(undefined);
    },

    async enqueue(job, idempotencyKey) {
      store.putJob(job);
      if (idempotencyKey) store.setIdempotency(idempotencyKey, job.jobId);
      return queueOk(job);
    },

    async submit(submission: JobSubmission, idempotencyKey) {
      store.putJob(submission.job);
      store.putSpec(submission.job.jobId, {
        inputs: submission.inputs,
        ...(submission.inputNames ? { inputNames: submission.inputNames } : {}),
        options: submission.options,
      });
      if (idempotencyKey) {
        store.setIdempotency(idempotencyKey, submission.job.jobId);
      }
      return queueOk(submission.job);
    },

    async lookupIdempotent(key) {
      return queueOk(store.findByIdempotencyKey(key) ?? null);
    },

    async status(jobId) {
      const job = store.getJob(jobId);
      if (!job) return NOT_FOUND();
      return queueOk(job);
    },

    async claim(options: ClaimOptions) {
      const nowMs = now();

      // 1. Redelivery sweep: any running job whose lease has expired goes back
      // to `queued` so it can be re-claimed (at-least-once delivery). Its attempt
      // count is preserved in the lease record for the next claim to read.
      for (const job of store.liveJobs()) {
        if (!canRedeliver(job.status)) continue;
        const lease = store.getLease(job.jobId);
        if (lease && nowMs >= lease.leaseExpiresAt) {
          store.putJob({ ...job, status: "queued", updatedAt: iso(nowMs) });
        }
      }

      // 2. Claim the oldest queued job (ISO timestamps sort chronologically).
      // A job parked by a delayed requeue is skipped — not removed — until its
      // visible-at passes: still `queued`, still cancelable, just not claimable.
      // The park is per job, so it never holds back the runnable job behind it.
      const queued = store
        .liveJobs()
        .filter((job) => job.status === "queued")
        .filter((job) => {
          const visibleAt = store.getVisibleAt(job.jobId);
          return visibleAt === undefined || visibleAt <= nowMs;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const job = queued[0];
      if (!job) return queueOk<ClaimedJob | null>(null);
      store.clearVisibleAt(job.jobId);

      const spec = store.getSpec(job.jobId);
      if (!spec) {
        // A queued job with no recorded spec cannot be run; fail it honestly so
        // it leaves the queue rather than being re-selected forever.
        const failed: Job = {
          ...job,
          status: "failed",
          progress: 0,
          error: {
            code: "internal_error",
            message: "Job is missing its execution spec.",
            retryable: false,
          },
          updatedAt: iso(nowMs),
        };
        store.putJob(failed);
        forgetExecution(job.jobId);
        return queueOk<ClaimedJob | null>(null);
      }

      const attempt = (store.getLease(job.jobId)?.attempts ?? 0) + 1;
      const leaseExpiresAt = nowMs + options.leaseMs;
      const claimed: Job = {
        ...job,
        status: "scanning",
        updatedAt: iso(nowMs),
      };
      store.putJob(claimed);
      store.setLease(job.jobId, { leaseExpiresAt, attempts: attempt });
      return queueOk<ClaimedJob | null>({
        job: claimed,
        inputs: spec.inputs,
        ...(spec.inputNames ? { inputNames: spec.inputNames } : {}),
        options: spec.options,
        attempt,
        leaseExpiresAt,
      });
    },

    async heartbeat(jobId, leaseMs, expectedAttempt) {
      const job = store.getJob(jobId);
      if (!job) return NOT_FOUND();
      const lease = store.getLease(jobId);
      if (
        !lease ||
        isTerminalStatus(job.status) ||
        staleLease(jobId, expectedAttempt)
      ) {
        return queueFail(
          "conflict",
          "Only a claimed, in-flight job can be heartbeated.",
        );
      }
      store.setLease(jobId, {
        ...lease,
        leaseExpiresAt: now() + leaseMs,
      });
      return queueOk(job);
    },

    async advance(jobId, update: RunningUpdate, expectedAttempt) {
      const job = store.getJob(jobId);
      if (!job) return NOT_FOUND();
      if (staleLease(jobId, expectedAttempt)) {
        return queueFail(
          "conflict",
          "This job's lease is no longer held; it was reclaimed or the job already finished.",
        );
      }
      if (update.status && !canTransition(job.status, update.status)) {
        return queueFail(
          "conflict",
          `A ${job.status} job cannot advance to ${update.status}.`,
        );
      }
      const next: Job = {
        ...job,
        status: update.status ?? job.status,
        progress: update.progress ?? job.progress,
        updatedAt: iso(now()),
      };
      store.putJob(next);
      return queueOk(next);
    },

    async complete(
      jobId,
      artifacts: JobArtifact[],
      expectedAttempt,
      results?: JobResults,
    ) {
      const job = store.getJob(jobId);
      if (!job) return NOT_FOUND();
      if (staleLease(jobId, expectedAttempt)) {
        return queueFail(
          "conflict",
          "This job's lease is no longer held; it was reclaimed or the job already finished.",
        );
      }
      if (!canTransition(job.status, "completed")) {
        return queueFail(
          "conflict",
          `A ${job.status} job cannot be completed.`,
        );
      }
      // Re-bound the structured result metadata at the persistence boundary, so the
      // client-facing record can never carry an unsafe value regardless of caller;
      // an empty/absent block leaves `results` off the record entirely.
      const safeResults = sanitizeJobResults(results);
      const next: Job = {
        ...job,
        status: "completed",
        progress: 100,
        artifacts,
        ...(safeResults ? { results: safeResults } : {}),
        updatedAt: iso(now()),
      };
      store.putJob(next);
      forgetExecution(jobId);
      return queueOk(next);
    },

    async fail(
      jobId,
      error: JobError,
      disposition: FailDisposition,
      expectedAttempt,
    ) {
      const job = store.getJob(jobId);
      if (!job) return NOT_FOUND();
      if (staleLease(jobId, expectedAttempt)) {
        return queueFail(
          "conflict",
          "This job's lease is no longer held; it was reclaimed or the job already finished.",
        );
      }

      if (disposition.requeue) {
        if (!canTransition(job.status, "queued")) {
          return queueFail(
            "conflict",
            `A ${job.status} job cannot be requeued.`,
          );
        }
        // Redelivery keeps the spec (inputs are needed for the retry) and the
        // lease record (its attempt count carries forward to the next claim).
        const requeued: Job = {
          ...job,
          status: "queued",
          progress: 0,
          updatedAt: iso(now()),
        };
        store.putJob(requeued);
        // A positive delay parks the job: queued but invisible to claim until
        // visible-at. The park is a store-side visibility fact, so cancel and
        // expiry act on the job record exactly as they would without it.
        if (disposition.delayMs !== undefined && disposition.delayMs > 0) {
          store.setVisibleAt(jobId, now() + disposition.delayMs);
        }
        return queueOk(requeued);
      }

      if (!canTransition(job.status, "failed")) {
        return queueFail("conflict", `A ${job.status} job cannot be failed.`);
      }
      const failed: Job = {
        ...job,
        status: "failed",
        progress: 0,
        error,
        updatedAt: iso(now()),
      };
      store.putJob(failed);
      forgetExecution(jobId);
      return queueOk(failed);
    },

    async cancel(jobId) {
      const job = store.getJob(jobId);
      if (!job) return NOT_FOUND();
      if (!canCancel(job.status)) {
        return queueFail(
          "conflict",
          `A ${job.status} job cannot be canceled; it has already finished.`,
        );
      }
      const canceled = toTerminal(job, "canceled");
      store.putJob(canceled);
      forgetExecution(jobId);
      return queueOk(canceled);
    },

    async expire(jobId) {
      const job = store.getJob(jobId);
      if (!job) return NOT_FOUND();
      if (!canExpire(job.status)) {
        return queueFail(
          "conflict",
          `Only a completed job's outputs can be expired; this job is ${job.status}.`,
        );
      }
      const expired = toTerminal(job, "expired");
      store.putJob(expired);
      forgetExecution(jobId);
      return queueOk(expired);
    },

    capability() {
      return LOCAL_DEV_QUEUE_CAPABILITY;
    },
  };
}
