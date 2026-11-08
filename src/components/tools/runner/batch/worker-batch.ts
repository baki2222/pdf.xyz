import type {
  FetchLike,
  PdfSecurityWorkerOptions,
  PdfSecurityWorkerResult,
  PdfSecurityWorkerSuccess,
} from "@/lib/workers/pdf-security-client";
import type { WorkerJobPhase } from "@/lib/workers/job-polling";

/**
 * The worker batch's adapter (batch plan P3, "Worker design"): one file of
 * a batch is TODAY'S exact single job — one upload, one `POST /api/jobs`
 * with one input, the same poll, the same download — through the tool's own
 * client (`run`). No worker change, no batch id on the server.
 *
 * What it adds around that one job:
 *
 *   - The file's bytes are read only when its turn comes, so a queued file
 *     is never read, never uploaded.
 *   - A failed job THROWS a {@link BatchItemError} carrying the client's
 *     code and the 429's typed wait, so the driver can pause on a rate
 *     limit ({@link workerBatchPause}) instead of failing the file.
 *   - A job the client stopped WAITING for is picked up again by its id
 *     (`resume`), at most {@link WORKER_BATCH_MAX_RESUMES} times — never
 *     uploaded again. Past that the job is stopped (DELETE) and the row
 *     fails in words ({@link workerStillRunningMessage}).
 *   - Cancel stops the job on our server: DELETE `/api/jobs/:id`, once, for
 *     the job in flight. A cancel that lands after the upload but before
 *     the job exists does not abort the job request: it waits for the id,
 *     then stops that job — an aborted request can still create a job the
 *     page would never hear of, and so could never stop.
 *   - It never touches `useWorkerJob`'s sessionStorage resume key: a batch
 *     is not resumable after a reload, and its rows say what happened.
 *
 * One in flight is the driver's (`useBatchRunner` runs files strictly in
 * turn); `worker-batch.test.ts` pins it at the wire, and says why.
 */

/** How many times one file's job is waited for again once a wait runs out. */
export const WORKER_BATCH_MAX_RESUMES = 2;

/** One file's job, as the tool's client runs it. */
export type WorkerRun = (
  input: { filename: string; bytes: Uint8Array },
  controls: PdfSecurityWorkerOptions,
) => Promise<PdfSecurityWorkerResult>;

/** Wait again for a job by its id (`resumeSecurityJob`, with the tool). */
export type WorkerResume = (
  jobId: string,
  controls: PdfSecurityWorkerOptions,
) => Promise<PdfSecurityWorkerResult>;

/** A file's job failed: the client's own message, code, and a 429's wait. */
export class BatchItemError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "BatchItemError";
  }
}

/** The row of a file whose job outlived every wait. */
export function workerStillRunningMessage(): string {
  return `Our server was still working on this file after the batch had waited for it ${1 + WORKER_BATCH_MAX_RESUMES} times, so the batch stopped that job and moved on. Retry failed sends it again, as a new job.`;
}

/**
 * `useBatchRunner`'s `pauseOn` for a worker batch: a rate limit that said
 * how long to wait is a pause until then; anything else is not.
 */
export function workerBatchPause(error: unknown): number | null {
  if (
    error instanceof BatchItemError &&
    error.code === "rate_limited" &&
    error.retryAfterSeconds !== undefined
  )
    return Date.now() + error.retryAfterSeconds * 1000;
  return null;
}

export interface WorkerProcessOptions {
  /** Transport for every request, the DELETE included (tests). */
  fetchImpl?: FetchLike;
  /** The phase of the file in flight: uploading, queued, working… */
  onPhase?: (phase: WorkerJobPhase) => void;
  /** Passed to the client (tests): instant waits. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  /**
   * A look at the file's bytes before anything is uploaded; throw a
   * `BatchSkip` to leave it out (a signed PDF that the single-file panel
   * would ask about first).
   */
  preflight?: (file: File, bytes: Uint8Array) => void;
}

function canceled(): DOMException {
  return new DOMException("Canceled.", "AbortError");
}

/** One file of a worker batch, as `useBatchRunner` runs it. */
export function workerProcess(
  run: WorkerRun,
  resume: WorkerResume,
  options: WorkerProcessOptions = {},
): (file: File, signal: AbortSignal) => Promise<PdfSecurityWorkerSuccess> {
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit));
  return async (file, signal) => {
    if (signal.aborted) throw canceled();
    const inner = new AbortController();
    let jobId: string | null = null;
    let uploaded = false;
    let cancelWhenCreated = false;
    // Reached once per file at most: the abort listener fires once, and the
    // still-running path runs only when no cancel came (the test pins it).
    const stopJob = () => {
      if (!jobId) return;
      void fetchImpl(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(
        () => {},
      );
    };
    const onAbort = () => {
      if (jobId) {
        stopJob();
        inner.abort();
      } else if (uploaded) cancelWhenCreated = true;
      else inner.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const controls: PdfSecurityWorkerOptions = {
      fetchImpl,
      signal: inner.signal,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.pollIntervalMs !== undefined
        ? { pollIntervalMs: options.pollIntervalMs }
        : {}),
      ...(options.maxPollAttempts !== undefined
        ? { maxPollAttempts: options.maxPollAttempts }
        : {}),
      onPhase: (phase) => {
        if (phase === "uploaded") uploaded = true;
        options.onPhase?.(phase);
      },
      onJobCreated: (id) => {
        jobId = id;
        if (cancelWhenCreated) {
          stopJob();
          inner.abort();
        }
      },
    };
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (signal.aborted) throw canceled();
      options.preflight?.(file, bytes);
      let result = await run({ filename: file.name, bytes }, controls);
      for (
        let resumes = 0;
        !result.ok &&
        result.stillRunning &&
        result.jobId &&
        !signal.aborted &&
        resumes < WORKER_BATCH_MAX_RESUMES;
        resumes += 1
      ) {
        jobId = result.jobId;
        result = await resume(result.jobId, controls);
      }
      if (signal.aborted) throw canceled();
      if (result.ok) return result;
      if (result.stillRunning && result.jobId) {
        jobId = result.jobId;
        stopJob();
        throw new BatchItemError(workerStillRunningMessage(), "timeout");
      }
      throw new BatchItemError(
        result.message,
        result.code,
        result.retryAfterSeconds,
      );
    } catch (error) {
      if (signal.aborted) throw canceled();
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}
