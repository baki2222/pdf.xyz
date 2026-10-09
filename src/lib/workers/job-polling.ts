/**
 * The one place a browser waits for a worker job to finish.
 *
 * Four client modules each carried their own copy of this loop — identical down
 * to the wording of "Timed out waiting for the worker." — and every copy had the
 * same three defects. Three copies of a fix is two chances to drift, so the loop
 * lives here now and they call it.
 *
 * WHAT WAS WRONG, AND WHY EACH MATTERS
 *
 * 1. ONE bad status response ended the job. The loop did
 *    `if (!statusRes.ok) return readError(…)`, so a single 502 from a CDN, a
 *    momentary 503 during a deploy, or one dropped packet reported "Lost contact
 *    with the worker job" — while the job carried on and finished normally on the
 *    worker. The user's file was produced and then thrown away. Polling is a
 *    long-lived conversation over an unreliable network; a transient failure is
 *    the expected case, not the exceptional one.
 *
 * 2. A timeout DISCARDED the job id. `job.jobId` was in scope and the failure
 *    dropped it, so a job that completed thirty seconds later became permanently
 *    unreachable — the output existed, on the server, addressable, and nothing in
 *    the UI could name it. Whatever the client gives up on, it now says what it
 *    gave up on, so the caller can offer the user a way back to it.
 *
 * 3. It could THROW. `fetch` rejects rather than returning a non-2xx for offline,
 *    DNS failure, connection reset, and CORS. Nothing in the client layer caught
 *    that — the sole `try/catch` in the whole layer parses a JSON error body —
 *    so the rejection escaped into a panel that had no `catch` and no `finally`,
 *    `setBusy(false)` never ran, and the button spun forever with no error at
 *    all. The tool looked hung, and a reload was the only way out.
 *
 * So: this function RETRIES what is worth retrying, NAMES what it gives up on,
 * and NEVER throws. The last of those is a contract the callers depend on, and
 * `job-polling.test.ts` holds it to that with an injected `fetch` that rejects.
 */

import type { Job, JobStatus } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/**
 * Where a browser-driven job is, in the words a busy label needs. One label
 * ("Recognizing on the worker…") used to cover a 100 MB upload, a queue wait
 * and the work itself, so a user watching an upload was told the text was
 * being recognized.
 */
export type WorkerJobPhase =
  "uploading" | "queued" | "processing" | "downloading";

/** The phase a job record's status puts it in. */
export function phaseOfJob(status: JobStatus): WorkerJobPhase {
  return status === "queued" ? "queued" : "processing";
}

/** Minimal `fetch` shape, matching the one the client modules already inject. */
export type PollFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface PollJobOptions {
  /** The job to wait on. Its id is echoed back on every failure. */
  job: Job;
  fetchImpl: PollFetch;
  pollIntervalMs: number;
  maxPollAttempts: number;
  signal?: AbortSignal;
  /** Injected in tests so retry backoff does not spend real time. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Called with every job record read, so a caller can report progress. */
  onJob?: (job: Job) => void;
}

export type PollJobResult =
  | { ok: true; job: Job }
  | {
      ok: false;
      /** Client-safe and honest; never a raw exception message. */
      message: string;
      /**
       * Always present. This is the whole point of (2) above: a caller that gives
       * up can still tell the user which job it gave up on.
       */
      jobId: string;
      /** `true` when the job may still be running and may still succeed. */
      stillRunning: boolean;
    };

/**
 * Consecutive failed status reads tolerated before giving up.
 *
 * Three is chosen against what it has to survive — a single blip, and a short
 * gap while a deploy rolls — not to be generous. Each retry also backs off, so
 * the loop does not hammer an endpoint that is already struggling. A failure
 * that persists past this is reported, and reported as *still running*, because
 * from the browser's side an unreachable status endpoint says nothing whatsoever
 * about the job.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

/** Bounded exponential backoff applied on top of the normal poll interval. */
function backoffMs(base: number, consecutiveFailures: number): number {
  return Math.min(base * 2 ** consecutiveFailures, base * 8);
}

/** True for the transport-level and server-side failures worth another try. */
function isRetryableStatus(status: number): boolean {
  // 5xx is the server saying "not now"; 408 and 429 say it explicitly. A 4xx
  // other than those is the request itself being wrong, and retrying an
  // unchanged wrong request only delays an honest error.
  return status >= 500 || status === 408 || status === 429;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `job` until it reaches a terminal status, or give up with a reason.
 *
 * A returned `{ok: true}` only means the job REACHED a terminal state — it may
 * be `failed`. Callers keep their existing job-level handling; this is about
 * getting an answer at all, not about which answer it is.
 */
export async function pollJobToTerminal(
  options: PollJobOptions,
): Promise<PollJobResult> {
  const {
    fetchImpl,
    pollIntervalMs,
    maxPollAttempts,
    signal,
    sleepImpl = defaultSleep,
  } = options;
  const jobId = options.job.jobId;

  let job = options.job;
  let attempts = 0;
  let consecutiveFailures = 0;
  let lastFailure = "";

  while (!isTerminalStatus(job.status)) {
    if (attempts >= maxPollAttempts) {
      return {
        ok: false,
        // Says what is true: we stopped waiting. The job did not necessarily
        // stop working, and the id below is what makes that statement useful
        // rather than an apology.
        message: "Stopped waiting for the worker — the job may still finish.",
        jobId,
        stillRunning: true,
      };
    }

    await sleepImpl(
      consecutiveFailures === 0
        ? pollIntervalMs
        : backoffMs(pollIntervalMs, consecutiveFailures),
    );
    attempts += 1;

    // Every network hazard funnels through here: a rejection and a non-2xx are
    // the same event to a user, and both are retried the same way.
    let res: Awaited<ReturnType<PollFetch>> | null = null;
    try {
      res = await fetchImpl(`/api/jobs/${jobId}`, { signal });
    } catch {
      res = null;
    }

    if (res === null || !res.ok) {
      // An aborted run is the user's own doing, not a fault to retry.
      if (signal?.aborted) {
        return {
          ok: false,
          message: "The run was canceled.",
          jobId,
          stillRunning: false,
        };
      }
      if (res !== null && !isRetryableStatus(res.status)) {
        return {
          ok: false,
          message: "The worker rejected the status request for this job.",
          jobId,
          stillRunning: false,
        };
      }
      consecutiveFailures += 1;
      lastFailure =
        res === null
          ? "the network dropped"
          : `the server answered ${res.status}`;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return {
          ok: false,
          message: `Lost contact with the worker while waiting (${lastFailure}) — the job may still finish.`,
          jobId,
          stillRunning: true,
        };
      }
      continue;
    }

    let next: unknown;
    try {
      next = await res.json();
    } catch {
      // A 200 with an unreadable body is the same kind of blip as a 502.
      consecutiveFailures += 1;
      lastFailure = "the response could not be read";
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return {
          ok: false,
          message: `Lost contact with the worker while waiting (${lastFailure}) — the job may still finish.`,
          jobId,
          stillRunning: true,
        };
      }
      continue;
    }

    // A good read resets the budget: three blips spread across a long job are
    // not the same as three in a row, and only the latter means anything.
    consecutiveFailures = 0;
    job = next as Job;
    options.onJob?.(job);
  }

  return { ok: true, job };
}
