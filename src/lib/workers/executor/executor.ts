/**
 * The worker executor: the pure orchestration loop that turns a queued job into a
 * completed (or honestly failed) one. It is the async counterpart of the
 * synchronous local-dev adapter, and the foundation a production worker process
 * will run.
 *
 * One tick claims the next job from a {@link ClaimableQueue}, reads its inputs via
 * an {@link ExecutorStorage}, dispatches the {@link Processor} the registry resolves
 * for its tool, writes the produced artifacts, and drives the job to a terminal
 * state — handling cancellation, retryable-vs-terminal failures, and artifact
 * cleanup along the way. It is dependency-injected and node-free, so it is unit
 * tested deterministically with a fake clock and in-memory queue/storage; it does
 * NOT start any timer, thread, or long-running process, so importing it never
 * spins up a background service in the app runtime.
 *
 * Honesty and privacy guarantees:
 *  - a job is `completed` only after real artifact bytes were written;
 *  - every failure carries a typed {@link import("@/lib/jobs").JobError};
 *  - inputs are wiped once a job reaches a terminal state (a retryable requeue is
 *    *not* terminal, so its inputs survive for the retry);
 *  - the log callback only ever receives opaque ids, the tool slug, an attempt
 *    number, and an error code — never bytes, filenames, keys, or paths.
 */

import type { JobArtifact } from "@/lib/jobs";
import { sanitizeDisplayFilename } from "@/lib/jobs/filenames";
import type { ClaimableQueue } from "../queue/claim";
import type { ProcessorInputFile } from "../processor/types";
import type { ProcessorRegistry } from "../processor/registry";
import type { ExecutorLogEvent, ExecutorStorage, ExecutorTick } from "./types";

/** Everything the executor needs, all injectable for deterministic tests. */
export interface ExecutorDeps {
  queue: ClaimableQueue;
  storage: ExecutorStorage;
  registry: ProcessorRegistry;
  /** Lease each claimed job for this long (ms). */
  leaseMs?: number;
  /** Max delivery attempts before a retryable failure becomes terminal. */
  maxAttempts?: number;
  /** Content-free log sink; receives only ids, tool, attempt, and error code. */
  log?: (event: ExecutorLogEvent) => void;
}

export interface WorkerExecutor {
  /** Claim and run at most one job; returns what happened this tick. */
  runOnce(): Promise<ExecutorTick>;
  /** Run ticks until the queue is idle (or a hard cap is hit). */
  drain(maxTicks?: number): Promise<ExecutorTick[]>;
}

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DRAIN_CAP = 1000;

export function createWorkerExecutor(deps: ExecutorDeps): WorkerExecutor {
  const { queue, storage, registry } = deps;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const log = deps.log ?? (() => {});

  const wipeInputs = async (inputs: string[]): Promise<void> => {
    for (const fileId of inputs) await storage.deleteInput(fileId);
  };

  const isCanceled = async (jobId: string): Promise<boolean> => {
    const current = await queue.status(jobId);
    return current.ok && current.value.status === "canceled";
  };

  async function runOnce(): Promise<ExecutorTick> {
    const claim = await queue.claim({ leaseMs });
    if (!claim.ok) return { outcome: "error" };
    if (claim.value === null) return { outcome: "idle" };

    const { job, inputs, inputNames, options, attempt } = claim.value;
    const base = { jobId: job.jobId, tool: job.tool, attempt };
    log({ event: "claimed", ...base });

    // Resolve the processor for this tool. An unroutable job fails terminally —
    // retrying can't invent a processor.
    const processor = registry.resolve(job.tool);
    if (!processor) {
      log({ event: "no_processor", ...base });
      await queue.fail(
        job.jobId,
        {
          code: "not_implemented",
          message: "No processor is registered for this tool.",
          retryable: false,
        },
        { requeue: false },
        attempt,
      );
      await wipeInputs(inputs);
      return { outcome: "failed", jobId: job.jobId, attempt };
    }

    // Scanning phase: read the inputs. A missing input is a terminal failure
    // (the object is gone; re-reading won't bring it back).
    log({ event: "scanning", ...base });
    const files: ProcessorInputFile[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const fileId = inputs[i]!;
      const file = await storage.readInput(fileId);
      if (!file) {
        log({ event: "input_missing", ...base });
        await queue.fail(
          job.jobId,
          {
            code: "not_found",
            message: "An input file was not found (it may have expired).",
            retryable: false,
          },
          { requeue: false },
          attempt,
        );
        await wipeInputs(inputs);
        return { outcome: "failed", jobId: job.jobId, attempt };
      }
      // The job spec's sanitized display name (when present) is the authoritative
      // source of truth for the input's name and overrides whatever the storage
      // layer recovered (object metadata / a content-type fallback). Re-sanitize
      // defensively; a spec name can never influence a key, path, or log line.
      const specName = inputNames?.[i];
      const filename = specName
        ? sanitizeDisplayFilename(specName)
        : file.filename;
      files.push(filename === file.filename ? file : { ...file, filename });
    }

    // Cancellation can arrive while the job is queued or being claimed; stop
    // before doing any real work and wipe the inputs.
    if (await isCanceled(job.jobId)) {
      await wipeInputs(inputs);
      log({ event: "canceled", ...base });
      return { outcome: "canceled", jobId: job.jobId, attempt };
    }

    // Advance scanning → processing. A conflict here means the job was canceled
    // in the race window, so we stop honestly.
    const advanced = await queue.advance(
      job.jobId,
      { status: "processing", progress: 0 },
      attempt,
    );
    if (!advanced.ok) {
      await wipeInputs(inputs);
      log({ event: "canceled", ...base });
      return { outcome: "canceled", jobId: job.jobId, attempt };
    }
    log({ event: "processing", ...base });

    const result = await processor.process({
      tool: job.tool,
      options,
      inputs: files,
    });

    if (!result.ok) {
      const requeue = result.error.retryable && attempt < maxAttempts;
      const disposition = await queue.fail(
        job.jobId,
        result.error,
        { requeue },
        attempt,
      );
      if (!disposition.ok) {
        // The only reason fail() conflicts is that the job already reached a
        // terminal state (canceled) mid-flight. Treat it as a cancellation.
        await wipeInputs(inputs);
        log({ event: "canceled", ...base });
        return { outcome: "canceled", jobId: job.jobId, attempt };
      }
      if (requeue) {
        // A retryable failure is NOT terminal — keep the inputs for the retry.
        log({ event: "requeued", ...base, errorCode: result.error.code });
        return {
          outcome: "requeued",
          jobId: job.jobId,
          attempt,
          error: result.error,
        };
      }
      await wipeInputs(inputs);
      log({ event: "failed", ...base, errorCode: result.error.code });
      return {
        outcome: "failed",
        jobId: job.jobId,
        attempt,
        error: result.error,
      };
    }

    // Success: persist the real artifacts, then mark the job completed.
    const artifacts: JobArtifact[] = [];
    for (const artifact of result.artifacts) {
      artifacts.push(
        await storage.writeArtifact({
          jobId: job.jobId,
          filename: artifact.filename,
          contentType: artifact.contentType,
          bytes: artifact.bytes,
        }),
      );
    }

    const completed = await queue.complete(job.jobId, artifacts, attempt);
    if (!completed.ok) {
      // The job was canceled between processing and completion — clean up the
      // artifacts we just wrote so nothing outlives the cancellation.
      for (const artifact of artifacts) {
        await storage.deleteArtifact(artifact.artifactId);
      }
      await wipeInputs(inputs);
      log({ event: "canceled", ...base });
      return { outcome: "canceled", jobId: job.jobId, attempt };
    }

    await wipeInputs(inputs);
    log({ event: "completed", ...base });
    return { outcome: "completed", jobId: job.jobId, attempt };
  }

  async function drain(maxTicks = DEFAULT_DRAIN_CAP): Promise<ExecutorTick[]> {
    const ticks: ExecutorTick[] = [];
    for (let i = 0; i < maxTicks; i++) {
      const tick = await runOnce();
      ticks.push(tick);
      if (tick.outcome === "idle" || tick.outcome === "error") break;
    }
    return ticks;
  }

  return { runOnce, drain };
}
