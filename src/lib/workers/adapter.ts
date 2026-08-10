/**
 * Selects the {@link WorkerAdapter} for the current environment. This is the seam
 * the route handlers call: they hand validated contract objects to whatever
 * adapter this returns and serialize the outcome. No branch here can fake success.
 *
 * The non-local-dev path is a single **composed** adapter built from the resolved
 * object-storage provider plus the resolved job-queue provider. The two are wired
 * independently, so a deployment can enable them one at a time:
 *  - when storage is a wired S3/R2 provider, `createUploadSession` mints *real*
 *    signed upload targets;
 *  - when the queue is a wired Redis/Upstash broker, `createJob` records a *real*
 *    server-minted, `queued` job (with its execution spec) that survives restarts
 *    and is visible across replicas, and `getJob`/`cancelJob` read and cancel it.
 * A job is only enqueued when BOTH storage and queue are ready (a job's inputs
 * live in object storage). Crucially, an enqueued job is `queued`, never
 * `completed`: this build ships no worker daemon to drain the queue, so the job
 * stays queued until one is deployed — the status endpoint and docs say so
 * plainly. When a provider is not configured, every operation returns the same
 * honest typed failure as before (`worker_not_configured` / `not_implemented`) —
 * the errors originate from the provider contracts themselves.
 *
 * Layering note: this module is eager (pulled by the route bundle), so it imports
 * only node-free provider leaves plus the opaque-id minter. The local-dev adapter
 * — and with it the in-process store and native compression — is imported lazily,
 * only when that mode is active. The S3 and Redis factories are also imported
 * lazily on the non-local-dev request path, so this barrel stays free of the dev
 * store and the native layer.
 */

import {
  DEFAULT_RETENTION,
  getToolCapability,
  type Job,
  type UploadSlot,
} from "@/lib/jobs";
import type { WorkerMode } from "./mode";
import { resolveWorkerMode } from "./mode";
import { newJobId, newSessionId } from "./ids";
import { createNotConfiguredStorage } from "./storage/not-configured";
import { mapStorageFailure } from "./storage/errors";
import type { StorageProvider } from "./storage/types";
import { createNotConfiguredQueue } from "./queue/not-configured";
import { mapQueueFailure } from "./queue/errors";
import { deletionTarget } from "./queue/state";
import type { ClaimableQueue } from "./queue/claim";
import type { QueueProvider } from "./queue/types";
import type { RedisQueueDeps } from "./queue/redis";
import type { S3StorageDeps } from "./storage/s3";
import { adapterError, adapterOk, type WorkerAdapter } from "./types";

/**
 * Injectable seams for the composed production path — a clock and a network
 * transport (or a whole fake client) for each real provider — so the storage +
 * queue integration is unit-testable without touching S3 or Redis. Type-only
 * imports, so nothing extra reaches the runtime bundle. Ignored in local-dev mode.
 */
export interface WorkerAdapterDeps {
  storage?: S3StorageDeps;
  queue?: RedisQueueDeps;
}

const MINUTE_MS = 60_000;

/** A queue that also stores execution specs can `submit`; the base one cannot. */
function isClaimableQueue(queue: QueueProvider): queue is ClaimableQueue {
  return typeof (queue as Partial<ClaimableQueue>).submit === "function";
}

/**
 * A production-path adapter composed from a storage provider and a queue
 * provider. Upload sessions flow through storage; every job operation flows
 * through the queue. A not-configured provider makes its operations deny with the
 * honest, typed failure — so a disabled/remote-unimplemented deployment behaves
 * exactly as before, while a wired S3 + Redis deployment mints real upload
 * targets and records real queued jobs.
 */
function composedAdapter(
  mode: WorkerMode,
  storage: StorageProvider,
  queue: QueueProvider,
): WorkerAdapter {
  return {
    mode,

    async createUploadSession(request) {
      // A not-configured storage provider fails here (503/501); a wired S3/R2
      // provider is ready and mints real, single-use signed targets below.
      const probe = storage.probe();
      if (!probe.ok) return adapterError(mapStorageFailure(probe.error));

      const sessionId = newSessionId();
      const slots: UploadSlot[] = [];
      let expiresAt: string | undefined;
      for (const file of request.files) {
        const reserved = await storage.reserveUpload({
          sessionId,
          filename: file.filename,
          contentType: file.contentType,
          declaredBytes: file.bytes,
        });
        if (!reserved.ok)
          return adapterError(mapStorageFailure(reserved.error));
        slots.push({
          fileId: reserved.value.fileId,
          filename: reserved.value.filename,
          url: reserved.value.target.url,
          method: reserved.value.target.method,
          headers: reserved.value.target.headers,
        });
        // The session expiry is the earliest slot's signed-URL expiry.
        if (expiresAt === undefined || reserved.value.expiresAt < expiresAt) {
          expiresAt = reserved.value.expiresAt;
        }
      }
      return adapterOk(
        {
          sessionId,
          tool: request.tool,
          slots,
          expiresAt:
            expiresAt ??
            new Date(
              Date.now() + DEFAULT_RETENTION.inputTtlMinutes * MINUTE_MS,
            ).toISOString(),
          retention: DEFAULT_RETENTION,
        },
        201,
      );
    },

    async createJob(request) {
      // The queue is the gate: a not-configured queue (disabled/remote) denies
      // here with the honest typed failure. A ready broker proceeds.
      const queueProbe = queue.probe();
      if (!queueProbe.ok)
        return adapterError(mapQueueFailure(queueProbe.error));

      // A job's inputs live in object storage, so enqueue only when storage is
      // ready too — otherwise there is nowhere the client could have uploaded them.
      const storageProbe = storage.probe();
      if (!storageProbe.ok)
        return adapterError(mapStorageFailure(storageProbe.error));

      // Idempotent replay: return the prior job rather than enqueuing a duplicate.
      if (request.idempotencyKey) {
        const existing = await queue.lookupIdempotent(request.idempotencyKey);
        if (!existing.ok) return adapterError(mapQueueFailure(existing.error));
        if (existing.value) return adapterOk(existing.value, 200);
      }

      // Build the initial job. Its id is server-minted and opaque, and its status
      // is `queued` — NOT completed. No worker has run it; nothing is fabricated.
      const nowMs = Date.now();
      const job: Job = {
        jobId: newJobId(),
        tool: request.tool,
        capability: getToolCapability(request.tool) ?? "secure-worker",
        status: "queued",
        progress: 0,
        createdAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(
          nowMs + DEFAULT_RETENTION.outputTtlMinutes * MINUTE_MS,
        ).toISOString(),
        retention: DEFAULT_RETENTION,
      };

      // Record the job with its execution spec (inputs + options + the sanitized
      // display names) so a deployed worker can later claim, run, and name its
      // outputs. `inputNames` are already validated/sanitized display strings and
      // ride the spec as a value — never a broker key. A claimable broker uses
      // `submit`; the base contract falls back to `enqueue`.
      const recorded = isClaimableQueue(queue)
        ? await queue.submit(
            {
              job,
              inputs: request.inputs,
              ...(request.inputNames ? { inputNames: request.inputNames } : {}),
              options: request.options ?? {},
            },
            request.idempotencyKey,
          )
        : await queue.enqueue(job, request.idempotencyKey);
      if (!recorded.ok) return adapterError(mapQueueFailure(recorded.error));

      // 202 Accepted: the job is queued for async processing, not done. This is
      // the honest status — polling `getJob` returns `queued` until a worker runs it.
      return adapterOk(recorded.value, 202);
    },

    async getJob(jobId) {
      const res = await queue.status(jobId);
      return res.ok
        ? adapterOk(res.value, 200)
        : adapterError(mapQueueFailure(res.error));
    },

    async cancelJob(jobId) {
      const current = await queue.status(jobId);
      if (!current.ok) return adapterError(mapQueueFailure(current.error));
      const job = current.value;

      const target = deletionTarget(job.status);
      if (target === "canceled") {
        const res = await queue.cancel(jobId);
        return res.ok
          ? adapterOk(res.value, 200)
          : adapterError(mapQueueFailure(res.error));
      }
      if (target === "expired") {
        // Delete the produced outputs now (storage delete-now), then move the job
        // record to `expired` so it stops advertising downloads.
        for (const artifact of job.artifacts ?? []) {
          await storage.deleteNow("artifact", artifact.artifactId);
        }
        const res = await queue.expire(jobId);
        return res.ok
          ? adapterOk(res.value, 200)
          : adapterError(mapQueueFailure(res.error));
      }
      // Already terminal with nothing downloadable — idempotent no-op.
      return adapterOk(job, 200);
    },
  };
}

/** The default adapter: no backend, no dev worker. Answers `worker_not_configured`. */
export function createDisabledAdapter(): WorkerAdapter {
  return composedAdapter(
    "disabled",
    createNotConfiguredStorage("disabled"),
    createNotConfiguredQueue("disabled"),
  );
}

/** Backend endpoints present but no pipeline shipped. Answers `not_implemented`. */
export function createRemoteNotImplementedAdapter(): WorkerAdapter {
  return composedAdapter(
    "remote-configured",
    createNotConfiguredStorage("remote-unimplemented"),
    createNotConfiguredQueue("remote-unimplemented"),
  );
}

/**
 * Resolve the active adapter from the environment. The local-dev adapter (and
 * with it every Node built-in it depends on) is imported lazily, so the default
 * and remote paths never pull the native compression code into their bundle.
 * On the non-local-dev path the storage and queue providers are resolved from the
 * environment (a real S3/R2 provider and/or a real Redis broker when configured,
 * else the honest not-configured providers) — independently, so either can be
 * ready without the other.
 */
export async function getWorkerAdapter(
  env: Record<string, string | undefined> = process.env,
  deps: WorkerAdapterDeps = {},
): Promise<WorkerAdapter> {
  const mode = resolveWorkerMode(env);
  if (mode === "local-dev") {
    const { createLocalDevAdapter } = await import("./local-dev");
    return createLocalDevAdapter();
  }
  const [{ createStorageProvider }, { createQueueProvider }] =
    await Promise.all([import("./storage/factory"), import("./queue/factory")]);
  return composedAdapter(
    mode,
    createStorageProvider(env, deps.storage),
    createQueueProvider(env, deps.queue),
  );
}
