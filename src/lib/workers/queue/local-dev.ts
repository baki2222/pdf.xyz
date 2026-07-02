/**
 * The developer-only, in-process job-queue provider.
 *
 * It implements the {@link QueueProvider} contract against {@link DevWorkerStore}:
 * jobs are recorded, looked up by idempotency key, and moved through the state
 * machine in `./state.ts` for cancel/expire. A production queue is async and
 * broker-backed; this one is synchronous and per-process (the adapter builds an
 * already-terminal job and enqueues it), which keeps local-dev deterministic
 * while exercising the identical contract. It never fabricates a status: a job
 * it cannot find is an honest `not_found`, and an illegal transition is a
 * `conflict`.
 */

import type { Job } from "@/lib/jobs";
import { DevWorkerStore, devWorkerStore } from "../store";
import { canCancel, canExpire } from "./state";
import type { QueueProvider } from "./types";
import { LOCAL_DEV_QUEUE_CAPABILITY, queueFail, queueOk } from "./types";

/** Injectable seams so the provider is fully unit-testable with a fake clock. */
export interface LocalDevQueueDeps {
  store?: DevWorkerStore;
  now?: () => number;
}

/**
 * Build the in-process queue provider. Shares the same {@link DevWorkerStore}
 * instance as the local-dev storage so jobs and their artifacts see one store.
 */
export function createLocalDevQueue(
  deps: LocalDevQueueDeps = {},
): QueueProvider {
  const store = deps.store ?? devWorkerStore;
  const now = deps.now ?? (() => Date.now());

  /** Move a job to a terminal, output-less state, wiping its artifact list. */
  const toTerminal = (job: Job, status: "canceled" | "expired"): Job => {
    const next: Job = {
      ...job,
      status,
      updatedAt: new Date(now()).toISOString(),
    };
    // Outputs are being deleted alongside this transition, so the record must
    // not keep advertising downloadable artifacts (keeps isDownloadReady honest).
    delete next.artifacts;
    return next;
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

    async lookupIdempotent(key) {
      return queueOk(store.findByIdempotencyKey(key) ?? null);
    },

    async status(jobId) {
      const job = store.getJob(jobId);
      if (!job) {
        return queueFail("not_found", "No such job (it may have expired).", [
          { field: "id", message: "Unknown or expired job id." },
        ]);
      }
      return queueOk(job);
    },

    async cancel(jobId) {
      const job = store.getJob(jobId);
      if (!job) {
        return queueFail("not_found", "No such job (it may have expired).", [
          { field: "id", message: "Unknown or expired job id." },
        ]);
      }
      if (!canCancel(job.status)) {
        return queueFail(
          "conflict",
          `A ${job.status} job cannot be canceled; it has already finished.`,
        );
      }
      const canceled = toTerminal(job, "canceled");
      store.putJob(canceled);
      return queueOk(canceled);
    },

    async expire(jobId) {
      const job = store.getJob(jobId);
      if (!job) {
        return queueFail("not_found", "No such job (it may have expired).", [
          { field: "id", message: "Unknown or expired job id." },
        ]);
      }
      if (!canExpire(job.status)) {
        return queueFail(
          "conflict",
          `Only a completed job's outputs can be expired; this job is ${job.status}.`,
        );
      }
      const expired = toTerminal(job, "expired");
      store.putJob(expired);
      return queueOk(expired);
    },

    capability() {
      return LOCAL_DEV_QUEUE_CAPABILITY;
    },
  };
}
