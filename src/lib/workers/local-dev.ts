/**
 * The developer-only local worker (`PDFXYZ_WORKER_MODE=local-dev`).
 *
 * It implements the real job flow for the tools it can honestly run — today,
 * `compress-pdf` and `ocr-pdf` — end to end and IN PROCESS: reserve upload slots,
 * accept bytes, run the engine, and hand back a downloadable artifact. It is the
 * honest opposite of a fake: it only ever reports a `completed` job when it
 * produced real output, and when it cannot (e.g. deep compression or OCR with no
 * native engine installed) it records a `failed` job with a typed, honest error
 * and docs guidance — never a dummy completed file, never invented OCR text.
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
  type ApiError,
  type ApiResult,
  type Job,
  type JobError,
  type ParseResult,
  type UploadSlot,
} from "@/lib/jobs";
import { outputName } from "@/lib/pdf/files";
import {
  parseCompressionOptions,
  runCompression,
  type CompressionDeps,
  type CompressionOptions,
  type CompressionRun,
} from "./compression/engine";
import { nativeCompressionDeps } from "./compression/native";
import {
  ocrInputKindForContentType,
  parseOcrOptions,
  runOcr,
  type OcrDeps,
  type OcrOptions,
  type OcrRun,
} from "./ocr/engine";
import { nativeOcrDeps } from "./ocr/native";
import {
  devWorkerStore,
  newArtifactId,
  newJobId,
  newSessionId,
  DevWorkerStore,
  type StoredSlot,
} from "./store";
import { adapterError, adapterOk, type WorkerAdapter } from "./types";

const MINUTE_MS = 60_000;

/** Tools the local worker can honestly process today. */
export const LOCAL_DEV_SUPPORTED_TOOLS: ReadonlySet<string> = new Set([
  "compress-pdf",
  "ocr-pdf",
]);

/** Injectable seams so the adapter is fully unit-testable without a binary. */
export interface LocalDevDeps {
  store?: DevWorkerStore;
  /** Compression dependencies; defaults to a live PATH probe + native runner. */
  compressionDeps?: CompressionDeps;
  /** OCR dependencies; defaults to a live PATH probe + native runner. */
  ocrDeps?: OcrDeps;
  now?: () => number;
}

/** A single produced, downloadable output — the honest result of a real run. */
type JobProduction =
  | { ok: true; filename: string; contentType: string; bytes: Uint8Array }
  | { ok: false; error: JobError };

/** A slot that has been confirmed to hold uploaded bytes. */
type ReadySlot = StoredSlot & { bytes: Uint8Array };

type CompressionFailure = Extract<CompressionRun, { ok: false }>;
type OcrFailure = Extract<OcrRun, { ok: false }>;

/** Map an honest compression-engine failure to a typed, client-safe job error. */
function toCompressionJobError(run: CompressionFailure): JobError {
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

/** Map an honest OCR-engine failure to a typed, client-safe job error. */
function toOcrJobError(run: OcrFailure): JobError {
  switch (run.kind) {
    case "unsupported":
      return {
        code: "not_implemented",
        message: `${run.message} Install one of: ${run.requires.join(
          ", ",
        )}. See docs/WORKER_ARCHITECTURE.md.`,
        retryable: false,
      };
    case "invalid_input":
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

/** Parse the tool-specific options bag, keeping request errors as 4xx (not jobs). */
function parseToolOptions(
  tool: string,
  raw: Record<string, unknown>,
):
  | { ok: true; tool: "compress-pdf"; options: CompressionOptions }
  | { ok: true; tool: "ocr-pdf"; options: OcrOptions }
  | { ok: false; error: ApiResult<ApiError> } {
  if (tool === "compress-pdf") {
    const parsed = parseCompressionOptions(raw);
    return parsed.ok
      ? { ok: true, tool, options: parsed.value }
      : { ok: false, error: parsed.error };
  }
  if (tool === "ocr-pdf") {
    const parsed = parseOcrOptions(raw);
    return parsed.ok
      ? { ok: true, tool, options: parsed.value }
      : { ok: false, error: parsed.error };
  }
  // Unreachable for supported tools (the caller guards first), but kept honest.
  return { ok: false, error: notImplemented() };
}

/** Resolve the request's inputs to exactly one uploaded, ready slot. */
function resolveSingleInput(
  store: DevWorkerStore,
  inputs: string[],
): ParseResult<ReadySlot> {
  const fileId = inputs[0];
  if (inputs.length !== 1 || fileId === undefined) {
    return {
      ok: false,
      error: apiError(
        "unprocessable_entity",
        "This tool accepts exactly one input file.",
        [{ field: "inputs", message: "Provide exactly one uploaded file id." }],
      ),
    };
  }
  const slot = store.getSlot(fileId);
  if (!slot) {
    return {
      ok: false,
      error: apiError("not_found", "Input file not found (it may have expired).", [
        { field: "inputs", message: "Unknown or expired file id." },
      ]),
    };
  }
  if (!slot.bytes) {
    return {
      ok: false,
      error: apiError(
        "unprocessable_entity",
        "Input file has not been uploaded yet.",
        [
          {
            field: "inputs",
            message: "Upload the file to its slot before creating a job.",
          },
        ],
      ),
    };
  }
  return { ok: true, value: slot as ReadySlot };
}

/** Run a real compression job and package its honest outcome. */
async function compressionProduction(
  options: CompressionOptions,
  slot: ReadySlot,
  deps: CompressionDeps,
): Promise<JobProduction> {
  const run = await runCompression(slot.bytes, options, deps);
  if (run.ok) {
    return {
      ok: true,
      filename: outputName(slot.filename, "compressed"),
      contentType: "application/pdf",
      bytes: run.output,
    };
  }
  return { ok: false, error: toCompressionJobError(run) };
}

/** Run a real OCR job and package its honest outcome. */
async function ocrProduction(
  options: OcrOptions,
  slot: ReadySlot,
  deps: OcrDeps,
): Promise<JobProduction> {
  const inputKind = ocrInputKindForContentType(slot.contentType);
  if (!inputKind) {
    return {
      ok: false,
      error: {
        code: "unprocessable_entity",
        message: "OCR accepts a PDF, JPG, or PNG file.",
        retryable: false,
      },
    };
  }
  const run = await runOcr(slot.bytes, options, { inputKind }, deps);
  if (run.ok) {
    return {
      ok: true,
      filename: outputName(slot.filename, "ocr", run.outputExt),
      contentType: run.contentType,
      bytes: run.output,
    };
  }
  return { ok: false, error: toOcrJobError(run) };
}

export function createLocalDevAdapter(deps: LocalDevDeps = {}): WorkerAdapter {
  const store = deps.store ?? devWorkerStore;
  const now = deps.now ?? (() => Date.now());
  const resolveCompressionDeps = (): CompressionDeps =>
    deps.compressionDeps ?? nativeCompressionDeps();
  const resolveOcrDeps = (): OcrDeps => deps.ocrDeps ?? nativeOcrDeps();

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

      // Tool-specific option validation first — a bad option is a 4xx request
      // error, never a `failed` job record.
      const plan = parseToolOptions(request.tool, request.options ?? {});
      if (!plan.ok) return adapterError(plan.error);

      const resolved = resolveSingleInput(store, request.inputs);
      if (!resolved.ok) return adapterError(resolved.error);
      const slot = resolved.value;

      const production =
        plan.tool === "compress-pdf"
          ? await compressionProduction(
              plan.options,
              slot,
              resolveCompressionDeps(),
            )
          : await ocrProduction(plan.options, slot, resolveOcrDeps());

      // Inputs are wiped as soon as processing finishes — success or failure —
      // so a dev machine never holds a file longer than its use, matching the
      // contract's retention guarantee. A completed output lives on its own TTL.
      store.deleteSlot(slot.fileId);

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
      if (production.ok) {
        const artifactId = newArtifactId();
        store.putArtifact({
          artifactId,
          jobId,
          filename: production.filename,
          contentType: production.contentType,
          bytes: production.bytes,
        });
        job = {
          ...base,
          status: "completed",
          progress: 100,
          artifacts: [
            {
              artifactId,
              filename: production.filename,
              contentType: production.contentType,
              bytes: production.bytes.byteLength,
              url: `/api/artifacts/local/${artifactId}`,
              expiresAt: base.expiresAt,
            },
          ],
        };
      } else {
        // Honest failure: a real job record with a typed error and NO artifact.
        job = { ...base, status: "failed", progress: 0, error: production.error };
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
