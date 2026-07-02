/**
 * The developer-only local worker (`PDFXYZ_WORKER_MODE=local-dev`).
 *
 * It implements the real job flow for the tools it can honestly run — today,
 * `compress-pdf` — end to end and IN PROCESS: reserve upload slots, accept
 * bytes, run the compression engine, and hand back a downloadable artifact. It
 * is the honest opposite of a fake: it only ever reports a `completed` job when
 * it produced real output, and when it cannot (e.g. deep image compression with
 * no native engine installed) it records a `failed` job with a typed, honest
 * error and docs guidance — never a dummy completed file.
 *
 * Design notes:
 *  - Work runs synchronously at job-creation time, so the returned job is
 *    already terminal (`completed` or `failed`) and status polling is
 *    deterministic. A production worker is async/queue-backed; this is dev only.
 *  - Tools this worker does not implement return `not_implemented` honestly,
 *    exactly as the remote-configured path would.
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

  const isoAfter = (minutes: number): string =>
    new Date(now() + minutes * MINUTE_MS).toISOString();

  return {
    mode: "local-dev",

    async createUploadSession(request) {
      if (!LOCAL_DEV_SUPPORTED_TOOLS.has(request.tool)) {
        return adapterError(notImplemented());
      }
      const sessionId = newSessionId();
      const slots: UploadSlot[] = request.files.map((file) => {
        const slot = store.reserveSlot({
          sessionId,
          filename: file.filename,
          contentType: file.contentType,
          declaredBytes: file.bytes,
        });
        return {
          fileId: slot.fileId,
          filename: slot.filename,
          url: `/api/uploads/local/${slot.fileId}`,
          method: "PUT",
          headers: { "content-type": slot.contentType },
        };
      });
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
        const existing = store.findByIdempotencyKey(request.idempotencyKey);
        if (existing) return adapterOk(existing, 200);
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

      const run = await runCompression(slot.bytes, options, resolveCompressionDeps());

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
              url: `/api/artifacts/local/${artifactId}`,
              expiresAt: base.expiresAt,
            },
          ],
        };
      } else {
        // Honest failure: a real job record with a typed error and NO artifact.
        job = { ...base, status: "failed", progress: 0, error: toJobError(run) };
      }

      store.putJob(job);
      if (request.idempotencyKey) {
        store.setIdempotency(request.idempotencyKey, jobId);
      }
      return adapterOk(job, 201);
    },

    async getJob(jobId) {
      const job = store.getJob(jobId);
      if (!job) {
        return adapterError(
          apiError("not_found", "No such job (it may have expired).", [
            { field: "id", message: "Unknown or expired job id." },
          ]),
        );
      }
      return adapterOk(job, 200);
    },
  };
}
