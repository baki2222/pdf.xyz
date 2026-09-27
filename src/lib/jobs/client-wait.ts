/**
 * How long a browser waits for a worker job before it stops polling — per
 * tool, in one place.
 *
 * Every client module carried its own `DEFAULT_MAX_POLL_ATTEMPTS`, and the one
 * most tools inherit — 150 polls at 800 ms, two minutes — was shorter than the
 * work behind it: the worker's default AI call alone may run 120 s before the
 * queue, the scan, the extraction and the packaging, and LibreOffice's own
 * timeout is 120 s. A long summary, a translation or a large deck finished on
 * the worker after the browser had given up and said so.
 *
 * Two things fix that, and this module is the smaller one. The budgets below
 * cover ONE ordinary run of the slow step plus a margin, and
 * `client-wait.test.ts` holds each against the worker's own bound — a second,
 * independent number, because a constant has no relationships to constrain.
 * They do not try to cover every configuration: the worker's timeouts are env
 * vars on a separately deployed tier (AI up to 10 min, OCR up to 30), and a
 * 30-minute spinner is worse than an honest "still working". The other half is
 * that giving up is no longer final: a stopped wait carries its job id, and
 * every worker panel can keep waiting on that same job.
 *
 * Client-safe: no worker module, no catalog. The tool slugs below are pinned
 * to the catalog by `client-wait.test.ts`, in both directions.
 */

export interface JobPollBudget {
  /** Pause between status reads. */
  readonly intervalMs: number;
  /** Status reads before the client stops waiting. */
  readonly maxAttempts: number;
}

/** The least time a budget waits: attempts × interval (backoff only adds). */
export function pollWaitMs(budget: JobPollBudget): number {
  return budget.intervalMs * budget.maxAttempts;
}

/** Headroom for the queue, the malware scan, extraction and packaging. */
export const PIPELINE_MARGIN_MS = 60_000;

/**
 * The worker's default time for ONE AI provider call — a client-safe copy of
 * `AI_TIMEOUT_MS_BOUNDS.default`, held equal to it by `client-wait.test.ts`.
 */
export const AI_CALL_TIMEOUT_MS = 120_000;

/**
 * The worker's default LibreOffice timeout — a client-safe copy of the office
 * conversion config's default, held equal to it by `client-wait.test.ts`.
 */
export const OFFICE_CONVERSION_TIMEOUT_MS = 120_000;

/** The first requeue delay after a retryable failure (`retryRequeueDelayMs(1)`). */
export const FIRST_REQUEUE_DELAY_MS = 2_000;

function budgetFor(waitMs: number, intervalMs: number): JobPollBudget {
  return { intervalMs, maxAttempts: Math.ceil(waitMs / intervalMs) };
}

/** Every tool not named below: two minutes at 800 ms. */
export const DEFAULT_JOB_POLL: JobPollBudget = {
  intervalMs: 800,
  maxAttempts: 150,
};

/**
 * AI tools: one provider call that times out, the retry after it, and the
 * pipeline margin. 1.5 s between reads keeps a long wait at 40 status reads a
 * minute — a third of the per-client status allowance, so a second tab or a
 * resumed job does not trip it.
 */
export const AI_JOB_POLL: JobPollBudget = budgetFor(
  2 * AI_CALL_TIMEOUT_MS + FIRST_REQUEUE_DELAY_MS + PIPELINE_MARGIN_MS,
  1_500,
);

/**
 * A translation makes one provider call per chunk, one after another, so its
 * wait scales with the plan the panel already computed.
 */
export function translateJobPoll(chunks: number): JobPollBudget {
  const calls = Math.max(1, Math.floor(chunks));
  const perChunk = budgetFor(
    calls * AI_CALL_TIMEOUT_MS + PIPELINE_MARGIN_MS,
    AI_JOB_POLL.intervalMs,
  );
  return perChunk.maxAttempts > AI_JOB_POLL.maxAttempts
    ? perChunk
    : AI_JOB_POLL;
}

/**
 * Word/Excel/PowerPoint to PDF: one LibreOffice timeout plus the margin. A
 * timeout is final on the worker (it is not retried), so one is enough.
 */
export const OFFICE_TO_PDF_JOB_POLL: JobPollBudget = budgetFor(
  OFFICE_CONVERSION_TIMEOUT_MS + PIPELINE_MARGIN_MS,
  800,
);

/**
 * OCR keeps its three minutes. Its worker default is five minutes a run and
 * configurable to thirty; no browser wait covers that honestly, so a long scan
 * relies on "Keep waiting" rather than on a longer spinner.
 */
export const OCR_JOB_POLL: JobPollBudget = {
  intervalMs: 800,
  maxAttempts: 225,
};

/** The tools that call an AI provider — pinned to the catalog's "ai" mode. */
export const AI_JOB_TOOLS: readonly string[] = [
  "summarize-pdf",
  "translate-pdf",
  "chat-with-pdf",
  "ai-extract",
];

/** The tools LibreOffice converts — pinned to the office-conversion processor. */
export const OFFICE_TO_PDF_JOB_TOOLS: readonly string[] = [
  "word-to-pdf",
  "excel-to-pdf",
  "powerpoint-to-pdf",
];

/** The wait a browser gives a job of this tool. */
export function jobPollFor(tool: string): JobPollBudget {
  if (tool === "ocr-pdf") return OCR_JOB_POLL;
  if (AI_JOB_TOOLS.includes(tool)) return AI_JOB_POLL;
  if (OFFICE_TO_PDF_JOB_TOOLS.includes(tool)) return OFFICE_TO_PDF_JOB_POLL;
  return DEFAULT_JOB_POLL;
}

/**
 * The first moment at which a browser running `tool` would already have
 * stopped waiting, or null when a job finishing after `elapsedMs` is still
 * inside the wait. The deployment proof asks this of every job it runs: its
 * own timeout is longer than a browser's, so a job it records as PASS may be
 * one a real user watched give up.
 */
export function browserStoppedWaitingAt(
  tool: string,
  elapsedMs: number,
): number | null {
  const wait = pollWaitMs(jobPollFor(tool));
  return elapsedMs > wait ? wait : null;
}
