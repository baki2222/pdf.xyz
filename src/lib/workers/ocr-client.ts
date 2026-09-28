/**
 * Browser-side driver for the secure-worker OCR flow.
 *
 * This is the OCR counterpart to the compression client in `./client.ts`. It
 * runs the full documented job lifecycle against the same endpoints a production
 * worker exposes — create upload session → direct upload → create job → poll
 * status → download artifact(s) — and returns an honest, typed result. It uses
 * nothing but `fetch` and the shared contract *types*, so it is safe in a client
 * component and fully unit-testable with an injected `fetch`.
 *
 * It never fabricates output. When no OCR processor is wired (every environment
 * this build ships in), the very first call returns the server's honest
 * `worker_not_configured` / `not_implemented` error and this driver surfaces it
 * as a typed failure — never a fake searchable PDF or invented text. A caller
 * should confirm availability via `GET /api/worker/status` (`status.ocr`) before
 * invoking this at all.
 */

// Import from the leaf contract modules (not the "@/lib/jobs" barrel) so this
// browser module never pulls the server-side validators or the tools catalog
// into the client bundle. `isTerminalStatus` is the only runtime value used.
import type { Job, JobArtifact, UploadSession } from "@/lib/jobs/types";
import type { OcrOptions } from "@/lib/jobs/ocr";
import {
  phaseOfJob,
  pollJobToTerminal,
  type WorkerJobPhase,
} from "./job-polling";
import { OCR_JOB_POLL } from "@/lib/jobs/client-wait";
import { markUploadStarted } from "@/lib/uploads/session-uploads";
import { readWorkerError } from "./read-error";
import { withToolOutcome } from "@/lib/telemetry/tool-outcome";

const OCR_TOOL = "ocr-pdf";

/** The file to OCR, and how. */
export interface OcrWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /** MIME type of the input (application/pdf, image/jpeg, or image/png). */
  contentType: string;
  options: OcrOptions;
}

/** One downloaded artifact of a completed OCR job (a searchable PDF or a text sidecar). */
export interface OcrArtifactResult {
  artifact: JobArtifact;
  /** The real, downloaded output bytes. */
  bytes: Uint8Array;
}

export interface OcrWorkerSuccess {
  ok: true;
  job: Job;
  /** Every produced artifact, downloaded — 1 or 2 depending on the output mode. */
  artifacts: OcrArtifactResult[];
}

export interface OcrWorkerFailure {
  ok: false;
  /** A client-safe, honest message (from the server's typed error when present). */
  message: string;
  /** The contract error code or job error code, when one is available. */
  code?: string;
  /** The job this failure is about, once one exists — as data, not prose. */
  jobId?: string;
  /**
   * True when the client stopped WAITING and the job may still finish;
   * {@link resumeWorkerOcr} picks it up by `jobId`. A long scan outlives the
   * browser's wait (the worker allows five minutes a run by default, the
   * browser three), and this is what keeps its result reachable.
   */
  stillRunning?: boolean;
}

export type OcrWorkerResult = OcrWorkerSuccess | OcrWorkerFailure;

/** Minimal `fetch` shape, so tests can inject a stub without the DOM lib. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: ArrayBuffer;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  /** Optional so stubs need not carry it; read for a 429's `Retry-After`. */
  headers?: { get(name: string): string | null };
}>;

export interface OcrWorkerOptions {
  /** Injectable transport (defaults to the global `fetch`). */
  fetchImpl?: FetchLike;
  /** Abort signal wired to every request. */
  signal?: AbortSignal;
  /** Status-poll cadence and ceiling (defaults suit an async production worker). */
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  /** Injectable delay so polling is instant under test. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once the job exists, with its id — what a Cancel button needs. */
  onJobCreated?: (jobId: string) => void;
  /** Called as the run moves between upload, queue, recognition and download. */
  onPhase?: (phase: WorkerJobPhase) => void;
}

const defaultFetch: FetchLike = (input, init) =>
  fetch(input, init as RequestInit);

/** Copy bytes into a standalone ArrayBuffer — a concrete, portable request body. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function jsonBody(value: unknown): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(JSON.stringify(value)));
}

/** Pull an honest message + code out of a non-OK response (see `./read-error`). */
async function readError(
  res: Awaited<ReturnType<FetchLike>>,
  fallback: string,
): Promise<OcrWorkerFailure> {
  return readWorkerError(res, fallback);
}

/**
 * Run an OCR job on the secure worker and return the downloaded result(s) or an
 * honest failure. Assumes the caller has already confirmed the worker is
 * available (see `GET /api/worker/status`); if it is not, this returns the
 * server's honest not-configured / not-implemented error rather than throwing.
 */
export async function runWorkerOcr(
  input: OcrWorkerInput,
  options: OcrWorkerOptions = {},
): Promise<OcrWorkerResult> {
  // The run's outcome is reported here, where every OCR job passes — see
  // `@/lib/telemetry/tool-outcome`.
  return withToolOutcome(OCR_TOOL, () => runWorkerOcrSteps(input, options));
}

async function runWorkerOcrSteps(
  input: OcrWorkerInput,
  options: OcrWorkerOptions,
): Promise<OcrWorkerResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const { signal } = options;
  options.onPhase?.("uploading");

  // 1. Reserve an upload slot for exactly this file.
  const sessionRes = await fetchImpl("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonBody({
      tool: OCR_TOOL,
      files: [
        {
          filename: input.filename,
          contentType: input.contentType,
          bytes: input.bytes.byteLength,
        },
      ],
    }),
    signal,
  });
  if (!sessionRes.ok) {
    return readError(sessionRes, "Could not start an upload session.");
  }
  const session = (await sessionRes.json()) as UploadSession;
  const slot = session.slots[0];
  if (!slot) {
    return { ok: false, message: "The worker did not return an upload slot." };
  }

  // 2. Upload the bytes directly to the slot the worker minted. Flag it before
  //    the request, not after: once bytes are on the wire a crash fallback can
  //    no longer honestly claim the file never left the device.
  markUploadStarted();
  const uploadRes = await fetchImpl(slot.url, {
    method: slot.method,
    headers: slot.headers,
    body: toArrayBuffer(input.bytes),
    signal,
  });
  if (!uploadRes.ok) {
    return readError(uploadRes, "Uploading the file to the worker failed.");
  }

  // 3. Create the job with the validated OCR options.
  const jobRes = await fetchImpl("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonBody({
      tool: OCR_TOOL,
      inputs: [slot.fileId],
      options: {
        languages: input.options.languages,
        outputMode: input.options.outputMode,
        redoOcr: input.options.redoOcr,
      },
    }),
    signal,
  });
  if (!jobRes.ok) {
    return readError(jobRes, "The worker could not create the OCR job.");
  }
  const job = (await jobRes.json()) as Job;
  options.onJobCreated?.(job.jobId);

  // 4–5. Wait for it and download the results — the half a resume re-enters.
  return finishOcrJob(job, options);
}

/** Wait for an OCR job and download every artifact; shared with a resume. */
async function finishOcrJob(
  started: Job,
  options: OcrWorkerOptions,
): Promise<OcrWorkerResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const { signal } = options;
  options.onPhase?.(phaseOfJob(started.status));

  // 4. Poll to a terminal state (a production worker is async).
  const polled = await pollJobToTerminal({
    job: started,
    fetchImpl,
    pollIntervalMs: options.pollIntervalMs ?? OCR_JOB_POLL.intervalMs,
    maxPollAttempts: options.maxPollAttempts ?? OCR_JOB_POLL.maxAttempts,
    onJob: (next) => options.onPhase?.(phaseOfJob(next.status)),
    ...(signal ? { signal } : {}),
    ...(options.sleep ? { sleepImpl: options.sleep } : {}),
  });
  if (!polled.ok) {
    // The id travels as DATA, so the panel can keep waiting on this job
    // instead of telling the user to upload the scan again.
    return {
      ok: false,
      message: polled.message,
      jobId: polled.jobId,
      ...(polled.stillRunning ? { stillRunning: true } : {}),
    };
  }
  const job = polled.job;

  if (job.status !== "completed") {
    return {
      ok: false,
      message:
        job.error?.message ??
        `The job ended as "${job.status}" without producing a result.`,
      code: job.error?.code,
      jobId: job.jobId,
    };
  }

  const artifacts = job.artifacts ?? [];
  if (artifacts.length === 0) {
    return {
      ok: false,
      message: "The job completed but produced no output.",
      jobId: job.jobId,
    };
  }

  // 5. Download every real output (searchable PDF and/or text sidecar).
  options.onPhase?.("downloading");
  const downloaded: OcrArtifactResult[] = [];
  for (const artifact of artifacts) {
    const res = await fetchImpl(artifact.url, { signal });
    if (!res.ok) {
      return readError(res, "Downloading an OCR result failed.");
    }
    downloaded.push({
      artifact,
      bytes: new Uint8Array(await res.arrayBuffer()),
    });
  }

  return { ok: true, job, artifacts: downloaded };
}

/**
 * Pick up an OCR job this browser stopped waiting for — by id, with no new
 * upload and no new job — and download its results when it finishes. It
 * reports how the job ended, as the run that started it does.
 */
export function resumeWorkerOcr(
  jobId: string,
  options: OcrWorkerOptions = {},
): Promise<OcrWorkerResult> {
  return withToolOutcome(OCR_TOOL, () =>
    finishOcrJob({ jobId, status: "processing" } as Job, options),
  );
}
