import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import type {
  FetchLike,
  PdfSecurityWorkerOptions,
  PdfSecurityWorkerResult,
  PdfSecurityWorkerSuccess,
} from "@/lib/workers/pdf-security-client";
import type { WorkerJobPhase } from "@/lib/workers/job-polling";
import {
  reportToolCompleted,
  reportToolFailed,
} from "@/lib/telemetry/tool-outcome";
import { BatchSkip } from "@/lib/batch";

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
 *   - Every request goes through a recording transport, so a failure is
 *     known by the STAGE that answered it (reserve, put, create, poll,
 *     download). A failed job THROWS a {@link BatchItemError} carrying the
 *     client's code, the 429's typed wait and that stage.
 *   - Only the two HOURLY limits pause the batch ({@link workerBatchPause}):
 *     `POST /api/uploads` (reserve) and `POST /api/jobs` (create). A 429
 *     from storage (put) fails the row with the storage sentence; a 429 on
 *     the download of a job that already finished is waited out here and
 *     the result fetched again BY THE JOB'S ID — never a new job — and a
 *     row that still could not download keeps that id, so "Retry failed"
 *     downloads it instead of running the file again.
 *   - A job the client stopped WAITING for is picked up again by its id
 *     (`resume`), at most {@link WORKER_BATCH_MAX_RESUMES} times — never
 *     uploaded again. Past that the batch asks our server to stop the job
 *     (DELETE) and the row says so ({@link workerStillRunningMessage}).
 *   - Cancel stops the job on our server: DELETE `/api/jobs/:id`, once, for
 *     the job in flight. A cancel that lands after the upload but before
 *     the job exists does not abort the job request: it waits for the id,
 *     then stops that job — an aborted request can still create a job the
 *     page would never hear of, and so could never stop.
 *   - Telemetry: ONE outcome per file, reported here ({@link workerOutcomeReporter})
 *     when the file's row settles. The client's own reporting is off for a
 *     batch's attempts (`reportsOutcome: false`), because one file can take
 *     several attempts — a pause re-runs it, a resume waits again — and
 *     each would otherwise count as a run of the tool.
 *   - It never touches `useWorkerJob`'s sessionStorage resume key: a batch
 *     is not resumable after a reload, and its rows say what happened.
 *
 * One in flight is the driver's (`useBatchRunner` runs files strictly in
 * turn); `worker-batch.test.ts` pins it at the wire.
 */

/** How many times one file's job is waited for again once a wait runs out. */
export const WORKER_BATCH_MAX_RESUMES = 2;

/** How many times a refused download is waited out and asked for again. */
export const WORKER_BATCH_DOWNLOAD_RETRIES = 2;

/**
 * The longest `Retry-After` a refused download is waited out for in place:
 * the window of the download limit (`artifacts.fetch`, per minute). The
 * test binds it to `RATE_LIMIT_POLICIES` — a constant nothing else checks.
 */
export const WORKER_BATCH_DOWNLOAD_WAIT_CAP_SECONDS = 60;

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

/** Which request of one job answered: the stage a failure belongs to. */
export type WorkerStage = "reserve" | "put" | "create" | "poll" | "download";

/** A file's job failed: the client's own message, code, a 429's wait, the stage. */
export class BatchItemError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
    readonly stage?: WorkerStage,
  ) {
    super(message);
    this.name = "BatchItemError";
  }
}

/**
 * The stage a request belongs to, from its method and path — the paths the
 * job client calls (`/api/uploads`, `/api/jobs`, `/api/jobs/:id`), a PUT to
 * the slot storage gave, and a GET of anything else: the artifact.
 */
export function workerStageOf(url: string, method = "GET"): WorkerStage | null {
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0]!;
  if (method === "POST" && path === "/api/uploads") return "reserve";
  if (method === "POST" && path === "/api/jobs") return "create";
  if (method === "PUT") return "put";
  if (method !== "GET") return null;
  if (path.startsWith("/api/jobs/")) return "poll";
  return "download";
}

/** The row of a file whose job outlived every wait. */
export function workerStillRunningMessage(): string {
  return `The batch stopped waiting for this file after ${1 + WORKER_BATCH_MAX_RESUMES} waits and asked our server to stop its job. Retry failed sends it again, as a new job.`;
}

/** The row of a file whose job finished but whose result was refused. */
export function workerDownloadRefusedMessage(message: string): string {
  return `${message} Our server finished this file; Retry failed downloads its result without running it again, while our server keeps it (${DEFAULT_RETENTION.outputTtlMinutes} minutes after it finished).`;
}

/**
 * `useBatchRunner`'s `pauseOn` for a worker batch: a refusal by one of the
 * two HOURLY limits — reserving the upload or creating the job — that said
 * how long to wait is a pause until then. Any other 429 (storage, the
 * download) is not: the pause banner names the hourly limit.
 */
export function workerBatchPause(error: unknown): number | null {
  if (
    error instanceof BatchItemError &&
    error.code === "rate_limited" &&
    error.retryAfterSeconds !== undefined &&
    (error.stage === "reserve" || error.stage === "create")
  )
    return Date.now() + error.retryAfterSeconds * 1000;
  return null;
}

/** How one file's row settled, for telemetry. */
export type WorkerOutcome =
  { ok: true; elapsedMs: number } | { ok: false; code?: string };

/** The batch's telemetry: one outcome per file, for the page's tool. */
export function workerOutcomeReporter(
  toolSlug: string,
): (outcome: WorkerOutcome) => void {
  return (outcome) => {
    if (outcome.ok)
      reportToolCompleted({ toolSlug, elapsedMs: outcome.elapsedMs });
    else
      reportToolFailed({
        toolSlug,
        ...(outcome.code !== undefined ? { code: outcome.code } : {}),
      });
  };
}

export interface WorkerProcessOptions {
  /** Transport for every request, the DELETE included (tests). */
  fetchImpl?: FetchLike;
  /** The phase of the file in flight: uploading, queued, working… */
  onPhase?: (phase: WorkerJobPhase) => void;
  /** Passed to the client (tests): instant waits. Also the download wait. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  /**
   * A look at the file's bytes before anything is uploaded; throw a
   * `BatchSkip` to leave it out (a signed PDF that the single-file panel
   * would ask about first).
   */
  preflight?: (file: File, bytes: Uint8Array) => void;
  /** One outcome per file, as its row settles (never for a pause or a cancel). */
  report?: (outcome: WorkerOutcome) => void;
  /**
   * Finished jobs whose result could not be downloaded, by file: kept by
   * the caller across runs, so "Retry failed" fetches the result by id.
   */
  finished?: WeakMap<File, string>;
}

function canceled(): DOMException {
  return new DOMException("Canceled.", "AbortError");
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** A wait that ends early, rejecting, when the batch is canceled. */
function waitFor(
  ms: number,
  signal: AbortSignal,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  if (sleep) return sleep(ms);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(canceled());
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** One file of a worker batch, as `useBatchRunner` runs it. */
export function workerProcess(
  run: WorkerRun,
  resume: WorkerResume,
  options: WorkerProcessOptions = {},
): (file: File, signal: AbortSignal) => Promise<PdfSecurityWorkerSuccess> {
  const transport: FetchLike =
    options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit));
  const finished = options.finished ?? new WeakMap<File, string>();
  return async (file, signal) => {
    if (signal.aborted) throw canceled();
    const started = Date.now();
    const inner = new AbortController();
    let jobId: string | null = null;
    let uploaded = false;
    let cancelWhenCreated = false;
    // The stage of the last response, when it was not OK: what a failure
    // result is about. Cleared by every OK answer, so it is never stale.
    let failedAt: WorkerStage | null = null;
    const fetchImpl: FetchLike = async (input, init) => {
      const res = await transport(input, init);
      if (init?.method !== "DELETE")
        failedAt = res.ok ? null : workerStageOf(input, init?.method);
      return res;
    };
    // Reached once per file at most: the abort listener fires once, and the
    // still-running path runs only when no cancel came (the test pins it).
    const stopJob = () => {
      if (!jobId) return;
      void transport(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(
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
      // One outcome per FILE is reported below, not one per attempt.
      reportsOutcome: false,
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
    // A throw from the client is a dropped connection, as `withToolOutcome`
    // reports it; anything thrown before the job (the file read) is not.
    let threwInJob = false;
    const attempt = async (
      call: () => Promise<PdfSecurityWorkerResult>,
    ): Promise<PdfSecurityWorkerResult> => {
      try {
        return await call();
      } catch (error) {
        threwInJob = true;
        throw error;
      }
    };
    try {
      let result: PdfSecurityWorkerResult;
      const done = finished.get(file);
      if (done) {
        // This file's job already finished: fetch its result, nothing else.
        jobId = done;
        result = await attempt(() => resume(done, controls));
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (signal.aborted) throw canceled();
        options.preflight?.(file, bytes);
        result = await attempt(() =>
          run({ filename: file.name, bytes }, controls),
        );
      }
      let resumes = 0;
      let downloads = 0;
      while (!result.ok && !signal.aborted) {
        if (
          result.stillRunning &&
          result.jobId &&
          resumes < WORKER_BATCH_MAX_RESUMES
        ) {
          resumes += 1;
          const id = (jobId = result.jobId);
          result = await attempt(() => resume(id, controls));
          continue;
        }
        const wait = result.retryAfterSeconds;
        if (
          failedAt === "download" &&
          result.code === "rate_limited" &&
          jobId &&
          wait !== undefined &&
          wait <= WORKER_BATCH_DOWNLOAD_WAIT_CAP_SECONDS &&
          downloads < WORKER_BATCH_DOWNLOAD_RETRIES
        ) {
          downloads += 1;
          const id = jobId;
          await waitFor(wait * 1000, signal, options.sleep);
          if (signal.aborted) break;
          result = await attempt(() => resume(id, controls));
          continue;
        }
        break;
      }
      if (signal.aborted) throw canceled();
      if (result.ok) {
        finished.delete(file);
        options.report?.({ ok: true, elapsedMs: Date.now() - started });
        return result;
      }
      if (result.stillRunning && result.jobId) {
        jobId = result.jobId;
        stopJob();
        throw new BatchItemError(workerStillRunningMessage(), "timeout");
      }
      if (failedAt === "download" && jobId) {
        finished.set(file, jobId);
        throw new BatchItemError(
          workerDownloadRefusedMessage(result.message),
          result.code,
          result.retryAfterSeconds,
          "download",
        );
      }
      finished.delete(file);
      throw new BatchItemError(
        result.message,
        result.code,
        result.retryAfterSeconds,
        failedAt ?? undefined,
      );
    } catch (error) {
      if (signal.aborted || isAbort(error)) {
        if (signal.aborted) throw canceled();
        throw error;
      }
      if (!(error instanceof BatchSkip) && workerBatchPause(error) === null)
        options.report?.({
          ok: false,
          code:
            error instanceof BatchItemError
              ? error.code
              : threwInJob
                ? "network"
                : undefined,
        });
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}
