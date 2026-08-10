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
  sanitizeDisplayFilename,
  sanitizeJobResults,
  type Job,
  type JobArtifact,
  type UploadSlot,
} from "@/lib/jobs";
import {
  parseCompressionOptions,
  type CompressionDeps,
} from "./compression/engine";
import { nativeCompressionDeps } from "./compression/native";
import {
  parseProtectPdfOptions,
  parseUnlockPdfOptions,
} from "@/lib/jobs/pdf-security";
import {
  PROTECT_TOOL,
  UNLOCK_TOOL,
  type PdfSecurityDeps,
} from "./pdf-security/engine";
import { nativePdfSecurityDeps } from "./pdf-security/native";
import {
  REPAIR_TOOL,
  OPTIMIZE_WEB_TOOL,
  type PdfStructureDeps,
} from "./pdf-structure/engine";
import { nativePdfStructureDeps } from "./pdf-structure/native";
import { createProcessorRegistry } from "./processor";
import { processorFail } from "./processor/types";
import { resolveWorkerSoundness, type SoundnessGate } from "./soundness";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "./artifacts";
import {
  MALFORMED_ARTIFACT_ERROR,
  UNSOUND_INPUT_ERROR,
} from "./executor/executor";
import { processorKindForId } from "./observability/metrics";
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

/** Tools the local worker can honestly process today. */
export const LOCAL_DEV_SUPPORTED_TOOLS: ReadonlySet<string> = new Set([
  "compress-pdf",
  PROTECT_TOOL,
  UNLOCK_TOOL,
  REPAIR_TOOL,
  OPTIMIZE_WEB_TOOL,
]);

/** Injectable seams so the adapter is fully unit-testable without a binary. */
export interface LocalDevDeps {
  store?: DevWorkerStore;
  /** Compression dependencies; defaults to a live PATH probe + native runner. */
  compressionDeps?: CompressionDeps;
  /** PDF security (protect/unlock) dependencies; defaults to a live qpdf probe + runner. */
  pdfSecurityDeps?: PdfSecurityDeps;
  /** PDF structure (repair/linearize) dependencies; defaults to a live qpdf probe + runner. */
  pdfStructureDeps?: PdfStructureDeps;
  /**
   * The file-soundness gate (Phase 36). Defaults to the env-resolved gate (enabled),
   * so this synchronous dev path runs the SAME bounded preflight the async executor
   * does before the processor. Tests inject a disabled/custom gate to steer it.
   */
  soundness?: SoundnessGate;
  /**
   * The artifact-manifest / provenance gate (Phase 37). Defaults to the env-resolved
   * gate (enabled), so this synchronous dev path validates a produced output through
   * the SAME bounded structural check the async executor runs before it is stored or a
   * download minted. Tests inject a disabled/custom gate to steer it.
   */
  artifactManifest?: ArtifactManifestGate;
  now?: () => number;
}

export function createLocalDevAdapter(deps: LocalDevDeps = {}): WorkerAdapter {
  const store = deps.store ?? devWorkerStore;
  const now = deps.now ?? (() => Date.now());
  const injectedCompression = deps.compressionDeps;
  const resolveCompressionDeps = (): CompressionDeps =>
    injectedCompression ?? nativeCompressionDeps();
  const injectedPdfSecurity = deps.pdfSecurityDeps;
  const resolvePdfSecurityDeps = (): PdfSecurityDeps =>
    injectedPdfSecurity ?? nativePdfSecurityDeps();
  const injectedPdfStructure = deps.pdfStructureDeps;
  const resolvePdfStructureDeps = (): PdfStructureDeps =>
    injectedPdfStructure ?? nativePdfStructureDeps();
  // The same gate the async executor runs, so the dev path cannot drift on which
  // inputs are structurally sound. Enabled by default; injectable for tests.
  const soundness = deps.soundness ?? resolveWorkerSoundness();
  // The same artifact-manifest / provenance gate the async executor runs, so the dev
  // path cannot publish an output the executor would reject before storing it.
  // Enabled by default; injectable for tests.
  const artifactManifest =
    deps.artifactManifest ?? resolveWorkerArtifactManifest();

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
        if (!reserved.ok)
          return adapterError(mapStorageFailure(reserved.error));
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
        if (existing.ok && existing.value)
          return adapterOk(existing.value, 200);
      }

      // Early request-shape validation so bad options are a 4xx rejection
      // (no job created), not a failed job. Tool-aware: each tool's own validator
      // runs here, exactly as its processor re-validates the raw bag defensively.
      // For protect/unlock this validates the password too (missing/invalid → 400);
      // like every option it is only ever validated, never logged.
      const optionsResult =
        request.tool === PROTECT_TOOL
          ? parseProtectPdfOptions(request.options ?? {})
          : request.tool === UNLOCK_TOOL
            ? parseUnlockPdfOptions(request.options ?? {})
            : request.tool === REPAIR_TOOL || request.tool === OPTIMIZE_WEB_TOOL
              ? ({ ok: true, value: {} } as const)
              : parseCompressionOptions(request.options ?? {});
      if (!optionsResult.ok) return adapterError(optionsResult.error);

      const fileId = request.inputs[0];
      if (request.inputs.length !== 1 || fileId === undefined) {
        return adapterError(
          apiError(
            "unprocessable_entity",
            "This tool accepts exactly one PDF input.",
            [
              {
                field: "inputs",
                message: "Provide exactly one uploaded file id.",
              },
            ],
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

      // Dispatch through the shared processor registry — the exact processor the
      // async executor runs — so the synchronous adapter and the executor cannot
      // drift in how a tool is executed or how failures are classified.
      const registry = createProcessorRegistry({
        compression: resolveCompressionDeps(),
        pdfSecurity: resolvePdfSecurityDeps(),
        pdfStructure: resolvePdfStructureDeps(),
      });
      const processor = registry.resolve(request.tool);
      if (!processor) return adapterError(notImplemented());
      // Prefer the client-supplied display name (already validated + sanitized in
      // the request) so this synchronous path names outputs identically to the
      // async worker path; otherwise use the reserved slot's name. Either is a
      // safe display string and never touches a key or path.
      const displayName = sanitizeDisplayFilename(
        request.inputNames?.[0] ?? slot.filename,
      );
      const inputFile = {
        fileId,
        filename: displayName,
        contentType: slot.contentType,
        bytes: slot.bytes,
        // Carry the reservation's declared size so the gate can verify it (the store
        // already enforced the match on upload; this is a defense-in-depth re-check).
        declaredBytes: slot.declaredBytes,
      };
      // File-soundness gate: the SAME bounded preflight the async executor runs,
      // BEFORE the processor. An `unsound` verdict short-circuits to a typed,
      // content-free `unsound_input` failure (no engine run, no artifact); a
      // `sound`/`skipped` verdict proceeds to the real processor. The specific
      // reason is deliberately not surfaced to the client.
      const soundnessResult = soundness.check({
        tool: request.tool,
        inputs: [inputFile],
      });
      const result =
        soundnessResult.verdict === "unsound"
          ? processorFail(UNSOUND_INPUT_ERROR)
          : await processor.process({
              tool: request.tool,
              options: request.options ?? {},
              inputs: [inputFile],
            });
      // Inputs are wiped as soon as the gate/processor finishes — success or failure —
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

      // Artifact-manifest / provenance gate (Phase 37): the SAME bounded structural
      // validation the async executor runs, over the produced outputs and BEFORE any
      // artifact is stored or a download minted. An `invalid` verdict makes the job
      // fail honestly (typed, content-free error, NO artifact); `valid`/`skipped`
      // proceeds to publish. Compression (the only tool this dev worker runs today)
      // produces a valid PDF, so the default path is unaffected.
      const validation = result.ok
        ? artifactManifest.validate({
            tool: request.tool,
            processor: processorKindForId(processor.id),
            retention: DEFAULT_RETENTION,
            artifacts: result.artifacts,
          })
        : null;
      const publishOk = validation !== null && validation.verdict !== "invalid";

      let job: Job;
      if (result.ok && publishOk) {
        const artifacts: JobArtifact[] = [];
        for (const [index, produced] of result.artifacts.entries()) {
          const artifactId = newArtifactId();
          // Record the content-free provenance manifest (when the gate produced one)
          // alongside the bytes, so the retrieval boundary can re-validate provenance
          // on download. Empty for a `skipped` gate ⇒ stored without a manifest.
          const manifest = validation?.checks[index]?.manifest;
          store.putArtifact({
            artifactId,
            jobId,
            filename: produced.filename,
            contentType: produced.contentType,
            bytes: produced.bytes,
            ...(manifest ? { manifest } : {}),
          });
          // Mint the (signed, in production) download target through the storage
          // provider — the same seam a real bucket client implements.
          const download = await storage.reserveDownload({
            artifactId,
            filename: produced.filename,
            contentType: produced.contentType,
          });
          if (!download.ok) {
            return adapterError(mapStorageFailure(download.error));
          }
          artifacts.push({
            artifactId,
            filename: produced.filename,
            contentType: produced.contentType,
            bytes: produced.bytes.byteLength,
            url: download.value.target.url,
            expiresAt: base.expiresAt,
          });
        }
        // Thread any safe, structured result metadata the processor reported onto
        // the completed record — identical to the async executor path, and through
        // the same redaction boundary. Compression (the only tool this dev worker
        // runs today) reports none, so its records honestly carry no `results`.
        const safeResults = sanitizeJobResults(result.results);
        job = {
          ...base,
          status: "completed",
          progress: 100,
          artifacts,
          ...(safeResults ? { results: safeResults } : {}),
        };
      } else {
        // Honest failure: a real job record with a typed error and NO artifact. A
        // processor failure carries its own error; a manifest rejection of an
        // otherwise-successful run carries the fixed, content-free artifact error.
        const error = result.ok ? MALFORMED_ARTIFACT_ERROR : result.error;
        job = { ...base, status: "failed", progress: 0, error };
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
