/**
 * What an engine does when the executor stops owning the job it is running.
 *
 * The executor renews a claimed job's lease while the processor runs, and aborts
 * the `signal` it hands the processor (`ProcessorInput.signal`) the moment a
 * renewal is REJECTED — another attempt has the job, or it was canceled. That
 * attempt's result is discarded either way (it never writes an artifact or a
 * terminal state), so every second its Ghostscript / qpdf / LibreOffice /
 * Chromium / OCR child keeps running is CPU spent on a single small VPS for
 * nobody, while holding an engine slot.
 *
 * This module is the one shape that abort takes on the way back up:
 *
 *  - native runners pass the signal to `execFile` / `spawn` (Node kills the
 *    child with SIGTERM on abort) and refuse to START a child for an attempt
 *    that is already aborted ({@link throwIfAttemptAborted}) — Node spawns the
 *    process first and kills it on the next tick otherwise, measured on Node 24;
 *  - the abort surfaces as an {@link AttemptAbortedError}, recognisable by
 *    {@link isAttemptAbort} whether it was thrown here or is Node's own
 *    `AbortError` (`code: "ABORT_ERR"`) from `execFile`;
 *  - a processor whose signal aborted returns {@link attemptAbortedFailure}
 *    instead of whatever its engine made of a killed child — so a lost attempt
 *    is never classified as `timeout`, `engine failed`, a damaged file, or
 *    `canceled`. The executor's lease-lost branch (`lease.rejected()`, checked
 *    before the success/failure fork) discards it and writes nothing; the code
 *    exists so a log, a metric or a test that DOES see it can tell what it is.
 *
 * Node-free: `AbortSignal` is a web global, so engines and processors import
 * this without pulling a Node built-in into a bundle.
 */

import type { JobError } from "@/lib/jobs";
import { processorFail, type ProcessorResult } from "./processor/types";

/** The job-error code of an attempt that stopped because it lost its lease. */
export const ATTEMPT_ABORTED_CODE = "attempt_aborted";

/** Thrown by a native runner whose attempt was aborted (before or during a child). */
export class AttemptAbortedError extends Error {
  readonly code = ATTEMPT_ABORTED_CODE;
  constructor() {
    super("This attempt was stopped: it no longer owns the job.");
    this.name = "AttemptAbortedError";
  }
}

/**
 * Is `error` an abort — ours, or Node's `AbortError` from a child process or
 * `AbortSignal.throwIfAborted()`? Read by NAME and CODE, never by message, and
 * never by `killed` (Node does not set it on an abort; a timeout sets it).
 */
export function isAttemptAbort(error: unknown): boolean {
  if (error instanceof AttemptAbortedError) return true;
  if (typeof error !== "object" || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === "AbortError" || code === "ABORT_ERR";
}

/** Throw {@link AttemptAbortedError} when the attempt's signal has aborted. */
export function throwIfAttemptAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AttemptAbortedError();
}

/** Rethrow an abort as itself (normalised), so a broad `catch` cannot reclassify it. */
export function rethrowIfAttemptAbort(error: unknown): void {
  if (isAttemptAbort(error)) throw new AttemptAbortedError();
}

/** The {@link JobError} a processor reports for an attempt that lost its lease. */
export function attemptAbortedJobError(): JobError {
  return {
    code: ATTEMPT_ABORTED_CODE,
    message: "This attempt was stopped because another attempt owns the job.",
    // The JOB is fine and still queued under its new owner; this attempt is
    // what stopped. The executor never acts on it (see the module comment).
    retryable: true,
  };
}

/**
 * One signal that aborts when any of `signals` does. `AbortSignal.any` (Node
 * 20.3+; the worker image runs Node 22 — `Dockerfile` `ARG NODE_VERSION`).
 * Absent members are skipped; with none, `undefined`.
 */
export function anySignal(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

/**
 * Run one processor call for an attempt that may be aborted, and make its
 * outcome say so: a processor that THREW an abort, or returned anything at all
 * after its signal aborted, becomes {@link attemptAbortedJobError}.
 *
 * KEEPS `results` (rule 3, CLAUDE.md): an AI processor aborted after its
 * provider answered has spent tokens, and the executor's spend hook reads
 * `result.results.ai.usage` from WHATEVER the processor returned, ahead of the
 * lease-lost branch. Replacing the failure with a bare one would record that
 * spend as free.
 */
export async function settleAttempt(
  signal: AbortSignal | undefined,
  run: () => Promise<ProcessorResult>,
): Promise<ProcessorResult> {
  let result: ProcessorResult;
  try {
    result = await run();
  } catch (error) {
    // Keyed on the SIGNAL, not the error's shape: an `AbortError` from some
    // other abort (a fetch the processor cancelled itself) while this attempt
    // still owns the job is not a lost lease, and is not reported as one.
    if (signal?.aborted) return processorFail(attemptAbortedJobError());
    throw error;
  }
  if (!signal?.aborted) return result;
  return processorFail(attemptAbortedJobError(), result.results);
}

/** The per-call control a native runner method takes: today, the attempt's signal. */
export interface RunControl {
  /** Aborted when the attempt stops owning its job; the runner kills its child. */
  signal?: AbortSignal;
}

/** `{ signal }` when there is one, `{}` otherwise — for exec options and spreads. */
export function signalOption(signal: AbortSignal | undefined): {
  signal?: AbortSignal;
} {
  return signal ? { signal } : {};
}
