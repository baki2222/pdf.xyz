/**
 * The developer-only local worker (`PDFXYZ_WORKER_MODE=local-dev`).
 *
 * It implements the real job flow for the tools it can honestly run — today,
 * `compress-pdf` — end to end and IN PROCESS, composed from the same typed
 * provider contracts a production deployment will implement:
 *  - a {@link StorageProvider} (local-dev) mints the upload/download targets and
 *    performs delete-now;
 *  - a {@link QueueProvider} (local-dev) records the job and owns its lifecycle
 *    (status/cancel/expire) under the shared state machine;
 *  - the compression engine is the processor that does the actual compute.
 * This makes the providers load-bearing rather than decorative: the local worker
 * exercises the exact seams a real storage/queue backend will slot into.
 *
 * It is the honest opposite of a fake: it only ever reports a `completed` job
 * when it produced real output, and when it cannot (e.g. deep image compression
 * with no native engine installed) it records a `failed` job with a typed,
 * honest error — never a dummy completed file.
 *
 * Design notes:
 *  - Work runs synchronously at job-creation time, so the returned job is already
 *    terminal (`completed` or `failed`) and status polling is deterministic. A
 *    production worker is async/queue-backed; this is dev only.
 *  - Byte movement (accepting an upload, reading input bytes to process, holding
 *    an artifact) uses the in-process {@link DevWorkerStore} directly — the
 *    developer transport that stands in for direct-to-bucket transfer. In
 *    production the app server never touches object bytes.
 *  - Tools this worker does not implement return `not_implemented` honestly.
 */

import {
  DEFAULT_RETENTION,
  apiError,
  getToolCapability,
  notImplemented,
  type Job,
  type JobError,
  type UploadSlot,
} from "@/lib/jobs";
import { outputName } from "@/lib/pdf/files";
import {
  parseCompressionOptions,
  runCompression,
  type CompressionDeps,
  type CompressionRun,
} from "./compression/engine";
import { nativeCompressionDeps } from "./compression/native";
import {
  devWorkerStore,
  newArtifactId,
  newJobId,
  newSessionId,
  DevWorkerStore,
} from "./store";
import { createLocalDevStorage, mapStorageFailure } from "./storage";
import { createLocalDevQueue, deletionTarget, mapQueueFailure } from "./queue";
import { adapterError, adapterOk, type WorkerAdapter } from "./types";

const MINUTE_MS = 60_000;
const OUTPUT_CONTENT_TYPE = "application/pdf";

/** Tools the local worker can honestly process today. */
export const LOCAL_DEV_SUPPORTED_TOOLS: ReadonlySet<string> = new Set([
  "compress-pdf",
]);

/** Injectable seams so the adapter is fully unit-testable without a binary. */
export interface LocalDevDeps {
  store?: DevWorkerStore;
  /** Compression dependencies; defaults to a live PATH probe + native runner. */
  compressionDeps?: CompressionDeps;
  now?: () => number;
}

type CompressionFailure = Extract<CompressionRun, { ok: false }>;

/** Map an honest engine failure to a typed, client-safe job error. */
function toJobError(run: CompressionFailure): JobError {
  switch (run.kind) {
    case "unsupported":
      return {
        code: "not_implemented",
        message: `${run.message} Install one of: ${run.requires.join(
          ", ",
        )}. See docs/WORKER_ARCHITECTURE.md.`,
        retryable: false,
      };
    case "invalid_pdf":
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "failed":
    default:
      return {
        code: "internal_error",
        message: run.message,
        retryable: true,
      };
  }
}

export function createLocalDevAdapter(deps: LocalDevDeps = {}): WorkerAdapter {
  const store = deps.store ?? devWorkerStore;
  const now = deps.now ?? (() => Date.now());
  const injectedCompression = deps.compressionDeps;
  const resolveCompressionDeps = (): CompressionDeps =>
    injectedCompression ?? nativeCompressionDeps();

  // Storage and queue share the one store instance, exactly as a production
  // adapter would share one bucket + one queue behind the same contracts.
  const storage = createLocalDevStorage({ store, now });
  const queue = createLocalDevQueue({ store, now });

  const isoAfter = (minutes: number): string =>
    new Date(now() + minutes * MINUTE_MS).toISOString();

  return {
    mode: "local-dev",

    async createUploadSession(request) {
      if (!LOCAL_DEV_SUPPORTED_TOOLS.has(request.tool)) {
        return adapterError(notImplemented());
      }
      const sessionId = newSessionId();
      const slots: UploadSlot[] = [];
      for (const file of request.files) {
        const reserved = await storage.reserveUpload({
          sessionId,
          filename: file.filename,
          contentType: file.contentType,
          declaredBytes: file.bytes,
        });
        if (!reserved.ok) return adapterError(mapStorageFailure(reserved.error));
        slots.push({
          fileId: reserved.value.fileId,
          filename: reserved.value.filename,
          url: reserved.value.target.url,
          method: reserved.value.target.method,
          headers: reserved.value.target.headers,
        });
      }
      return adapterOk(
        {
          sessionId,
          tool: request.tool,
          slots,
          expiresAt: isoAfter(DEFAULT_RETENTION.inputTtlMinutes),
          retention: DEFAULT_RETENTION,
        },
        201,
      );
    },

    async createJob(request) {
      if (!LOCAL_DEV_SUPPORTED_TOOLS.has(request.tool)) {
        return adapterError(notImplemented());
      }

      // Idempotent replay: return the prior job rather than reprocessing.
      if (request.idempotencyKey) {
        const existing = await queue.lookupIdempotent(request.idempotencyKey);
        if (existing.ok && existing.value) return adapterOk(existing.value, 200);
      }

      const optionsResult = parseCompressionOptions(request.options ?? {});
      if (!optionsResult.ok) return adapterError(optionsResult.error);
      const options = optionsResult.value;

      const fileId = request.inputs[0];
      if (request.inputs.length !== 1 || fileId === undefined) {
        return adapterError(
          apiError(
            "unprocessable_entity",
            "Compression accepts exactly one PDF input.",
            [{ field: "inputs", message: "Provide exactly one uploaded file id." }],
          ),
        );
      }

      // Reading input bytes is dev-only glue (in production the worker reads them
      // from storage itself); slot state distinguishes "unknown" from "not yet
      // uploaded" so both fail honestly.
      const slot = store.getSlot(fileId);
      if (!slot) {
        return adapterError(
          apiError("not_found", "Input file not found (it may have expired).", [
            { field: "inputs", message: "Unknown or expired file id." },
          ]),
        );
      }
      if (!slot.bytes) {
        return adapterError(
          apiError(
            "unprocessable_entity",
            "Input file has not been uploaded yet.",
            [
              {
                field: "inputs",
                message: "Upload the file to its slot before creating a job.",
              },
            ],
          ),
        );
      }

      const run = await runCompression(
        slot.bytes,
        options,
        resolveCompressionDeps(),
      );
      // Inputs are wiped as soon as processing finishes — success or failure —
      // via the storage provider's delete-now, matching the retention contract.
      await storage.deleteNow("input", fileId);

      const nowMs = now();
      const jobId = newJobId();
      const base = {
        jobId,
        tool: request.tool,
        capability: getToolCapability(request.tool) ?? "hybrid",
        createdAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        expiresAt: isoAfter(DEFAULT_RETENTION.outputTtlMinutes),
        retention: DEFAULT_RETENTION,
      } as const;

      let job: Job;
      if (run.ok) {
        const artifactId = newArtifactId();
        const filename = outputName(slot.filename, "compressed");
        store.putArtifact({
          artifactId,
          jobId,
          filename,
          contentType: OUTPUT_CONTENT_TYPE,
          bytes: run.output,
        });
        // Mint the (signed, in production) download target through the storage
        // provider — the same seam a real bucket client implements.
        const download = await storage.reserveDownload({
          artifactId,
          filename,
          contentType: OUTPUT_CONTENT_TYPE,
        });
        if (!download.ok) return adapterError(mapStorageFailure(download.error));
        job = {
          ...base,
          status: "completed",
          progress: 100,
          artifacts: [
            {
              artifactId,
              filename,
              contentType: OUTPUT_CONTENT_TYPE,
              bytes: run.output.byteLength,
              url: download.value.target.url,
              expiresAt: base.expiresAt,
            },
          ],
        };
      } else {
        // Honest failure: a real job record with a typed error and NO artifact.
        job = { ...base, status: "failed", progress: 0, error: toJobError(run) };
      }

      const enqueued = await queue.enqueue(job, request.idempotencyKey);
      if (!enqueued.ok) return adapterError(mapQueueFailure(enqueued.error));
      return adapterOk(job, 201);
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
        // Delete the produced outputs now (storage delete-now), then move the
        // job record to `expired` so it stops advertising downloads.
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
