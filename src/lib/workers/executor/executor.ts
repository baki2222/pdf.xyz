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
 *  - an infected (or unscannable) input is blocked BEFORE any processing, so no
 *    artifact is ever produced for it, and the scan gate never reports an input as
 *    scanned unless a real scanner inspected it (the shipped default scans nothing
 *    and blocks nothing);
 *  - a structurally-unsound or contract-mismatched input (empty, a size mismatch,
 *    an unsupported family, or a PDF-expected input with no `%PDF-` envelope) is
 *    blocked BEFORE the scanner and any processing when a soundness gate is wired —
 *    a cheap bounded preflight, never a claim that the document is valid or safe;
 *  - inputs are wiped once a job reaches a terminal state (a retryable requeue is
 *    *not* terminal, so its inputs survive for the retry);
 *  - the log callback only ever receives opaque ids, the tool slug, an attempt
 *    number, and an error code — never bytes, filenames, keys, or paths.
 */

import type { JobArtifact, JobError } from "@/lib/jobs";
import { sanitizeDisplayFilename } from "@/lib/jobs/filenames";
import type { ClaimableQueue } from "../queue/claim";
import type { ProcessorInputFile } from "../processor/types";
import type { ProcessorRegistry } from "../processor/registry";
import type { MalwareScanner } from "../scanner/types";
import type { SoundnessGate } from "../soundness/types";
import { buildSoundnessReceipt, type SoundnessReceipt } from "../soundness/receipt";
import {
  deadLetterMetric,
  failureClassForCode,
  jobTerminalMetric,
  processorKindForId,
  processorLatencyMetric,
  processorMetric,
  redeliveryMetric,
  retryMetric,
  scanMetric,
  soundnessMetric,
  type ProcessorOutcome,
  type WorkerMetricSample,
} from "../observability/metrics";
import type { WorkerMetricSink } from "../observability/collector";
import type { ExecutorLogEvent, ExecutorOutcome, ExecutorStorage, ExecutorTick } from "./types";

/** Everything the executor needs, all injectable for deterministic tests. */
export interface ExecutorDeps {
  queue: ClaimableQueue;
  storage: ExecutorStorage;
  registry: ProcessorRegistry;
  /**
   * The malware-scan gate. Absent ⇒ no scan step runs and inputs are processed
   * unscanned (the honest default this build ships). When present, an `infected`
   * verdict blocks the job before processing and an `error` verdict is retried;
   * a `skipped` verdict proceeds without claiming the input was scanned.
   */
  scanner?: MalwareScanner;
  /**
   * The file-soundness gate (Phase 36). Absent ⇒ no soundness step runs and inputs
   * proceed unchecked (byte-for-byte unchanged, as every pre-Phase-36 caller). When
   * present it runs a bounded structural + metadata-consistency preflight on the
   * already-read inputs immediately after the storage read and BEFORE the scanner and
   * any processor; an `unsound` verdict blocks the job terminally (no artifact, and
   * the input never reaches ClamAV/OCR/compression), a `sound` verdict proceeds, and
   * a `skipped` verdict (the gate is disabled) proceeds without claiming the inputs
   * were checked. It is NOT malware scanning, sanitization, or a validity guarantee.
   */
  soundness?: SoundnessGate;
  /**
   * Optional content-free QUARANTINE RECEIPT sink (Phase 36). When present, a receipt
   * is emitted for each input the soundness gate terminally rejects — a bounded reason
   * enum, the stable policy id/version, a coarse size bucket + input count, the
   * processor family, and a timestamp. It retains NO bytes (the rejected input is
   * wiped by the same terminal disposition) and carries no filename, key, path, URL,
   * or content. Absent ⇒ no receipt is built and the clock is not read for one.
   */
  onSoundnessReceipt?: (receipt: SoundnessReceipt) => void;
  /** Lease each claimed job for this long (ms). */
  leaseMs?: number;
  /** Max delivery attempts before a retryable failure becomes terminal. */
  maxAttempts?: number;
  /** Content-free log sink; receives only ids, tool, attempt, and error code. */
  log?: (event: ExecutorLogEvent) => void;
  /**
   * Optional content-free metrics sink (Phase 28). When present, the executor emits
   * bounded {@link WorkerMetricSample}s at the scan gate, the processor boundary, and
   * every terminal disposition — never bytes, filenames, keys, or paths. Absent (the
   * default, and every pre-Phase-28 caller) ⇒ no metric is emitted and no clock is
   * read, so behavior is byte-for-byte unchanged.
   */
  metrics?: WorkerMetricSink;
  /**
   * Injected clock used ONLY to measure processor latency for metrics (read when
   * `metrics` is present) and to stamp a quarantine receipt (read when
   * `onSoundnessReceipt` is present and the gate rejects an input). Defaults to
   * `Date.now`; tests inject a fake to make the latency bucket and receipt timestamp
   * deterministic. It never influences orchestration logic.
   */
  now?: () => number;
}

/** Map an executor tick outcome to the processor's own outcome label. */
function processorOutcomeFromTick(outcome: ExecutorOutcome): ProcessorOutcome {
  switch (outcome) {
    case "completed":
      return "completed";
    case "requeued":
      return "requeued";
    case "canceled":
      return "canceled";
    default:
      return "failed";
  }
}

/**
 * Terminal, non-retryable failure when the scanner flags an input as infected. The
 * message is fixed and content-free — it never carries a filename, signature name,
 * scanner endpoint, or byte content — and the job is blocked before any processing,
 * so no artifact is ever produced.
 */
export const MALWARE_DETECTED_ERROR: JobError = {
  code: "malware_detected",
  message:
    "This file was blocked by a security scan and was not processed. No output was produced.",
  retryable: false,
};

/**
 * Retryable failure when a malware scan could not be completed (e.g. the scanner
 * was unreachable). Retryable because a later attempt MAY reach the scanner; the
 * input is never downgraded to "scanned" or "clean" and is never processed unscanned
 * on this path.
 */
export const SCAN_UNAVAILABLE_ERROR: JobError = {
  code: "scan_unavailable",
  message:
    "The security scan could not be completed, so the file was not processed. The request may succeed on retry.",
  retryable: true,
};

/**
 * Terminal, non-retryable failure when an input can never be scanned by the wired
 * scanner (e.g. it exceeds a hard scanner size limit): retrying cannot help, so the
 * gate fails closed and blocks it BEFORE processing rather than letting it through
 * unscanned. Content-free, and never propagates the scanner's own detail.
 */
export const SCAN_INVALID_ERROR: JobError = {
  code: "scan_invalid",
  message:
    "This file could not be security-scanned and was not processed. No output was produced.",
  retryable: false,
};

/**
 * Terminal, non-retryable failure when the file-soundness gate rejects an input
 * (Phase 36): e.g. it is empty, or a PDF-expected input carries no `%PDF-` envelope.
 * Non-retryable because the same bytes fail the same bounded check every time, so
 * the gate fails closed and blocks BEFORE processing — no artifact is produced. The
 * message is fixed and content-free; the specific reason rides the metric only and
 * never names the file, its size, or its contents.
 */
export const UNSOUND_INPUT_ERROR: JobError = {
  code: "unsound_input",
  message:
    "This file did not pass a basic soundness check and was not processed. No output was produced.",
  retryable: false,
};

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
  const { queue, storage, registry, scanner, soundness, onSoundnessReceipt } =
    deps;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const log = deps.log ?? (() => {});
  const metrics = deps.metrics;
  const now = deps.now ?? (() => Date.now());
  /** Emit a content-free metric sample when a sink is wired; a no-op otherwise. */
  const emit = (sample: WorkerMetricSample): void => {
    if (metrics) metrics(sample);
  };

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
    // A claim past the first attempt is a redelivery (a prior lease expired or a
    // retryable requeue returned the job to the queue). Content-free — no id leaves.
    if (attempt > 1) emit(redeliveryMetric());

    // Dispatch a running-state failure identically for the scan gate and the
    // processor: requeue a retryable error while attempts remain, else fail
    // terminally (wiping inputs). A conflict from fail() means the job was canceled
    // mid-flight, so it is reported as canceled. `terminalEvent` lets the infected
    // case log a distinct `scan_blocked` while everything else logs `failed`.
    const dispatchFailure = async (
      error: JobError,
      terminalEvent: ExecutorLogEvent["event"],
    ): Promise<ExecutorTick> => {
      const requeue = error.retryable && attempt < maxAttempts;
      const disposition = await queue.fail(
        job.jobId,
        error,
        { requeue },
        attempt,
      );
      if (!disposition.ok) {
        await wipeInputs(inputs);
        log({ event: "canceled", ...base });
        emit(jobTerminalMetric("canceled"));
        return { outcome: "canceled", jobId: job.jobId, attempt };
      }
      if (requeue) {
        // A retryable failure is NOT terminal — keep the inputs for the retry.
        log({ event: "requeued", ...base, errorCode: error.code });
        emit(retryMetric());
        return { outcome: "requeued", jobId: job.jobId, attempt, error };
      }
      await wipeInputs(inputs);
      log({ event: terminalEvent, ...base, errorCode: error.code });
      emit(jobTerminalMetric("failed", failureClassForCode(error.code)));
      // requeue is false here, so a still-`retryable` error means its attempts were
      // exhausted — a dead letter, distinct from a non-retryable terminal failure.
      if (error.retryable) emit(deadLetterMetric());
      return { outcome: "failed", jobId: job.jobId, attempt, error };
    };

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
      emit(jobTerminalMetric("failed", "unsupported"));
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
        emit(jobTerminalMetric("failed", "input_missing"));
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
    // before doing any real work (including the soundness gate and the scan) and
    // wipe the inputs.
    if (await isCanceled(job.jobId)) {
      await wipeInputs(inputs);
      log({ event: "canceled", ...base });
      emit(jobTerminalMetric("canceled"));
      return { outcome: "canceled", jobId: job.jobId, attempt };
    }

    // File-soundness gate. Runs only when a gate is wired, immediately after the
    // storage read and BEFORE the scanner and any processor, over the SAME
    // already-read inputs (no re-read, at most a bounded byte window per file). A
    // cheap deterministic structural + metadata-consistency preflight: an `unsound`
    // verdict fails the job terminally here, so a mismatched/unsafe input never
    // reaches ClamAV, OCR, or compression and no artifact is produced. It is a
    // preflight only, never malware scanning, sanitization, or a validity guarantee.
    if (soundness) {
      const result = soundness.check({ tool: job.tool, inputs: files });
      // Record the bounded verdict + reason (never the file, size, or contents).
      emit(soundnessMetric(result.verdict, result.reason));
      if (result.verdict === "unsound") {
        // Emit a content-free quarantine receipt (opt-in sink) before failing. It
        // retains NO bytes — the input is wiped by the terminal disposition below —
        // and carries only bounded enums, a coarse size bucket, and a count. The
        // clock is read only here, only when a sink is wired.
        if (onSoundnessReceipt) {
          const totalBytes = files.reduce(
            (sum, file) => sum + file.bytes.length,
            0,
          );
          onSoundnessReceipt(
            buildSoundnessReceipt({
              verdict: result.verdict,
              reason: result.reason,
              processor: processorKindForId(processor.id),
              totalBytes,
              inputCount: files.length,
              at: new Date(now()).toISOString(),
            }),
          );
        }
        // Blocked: terminal and non-retryable (the same bytes fail identically),
        // inputs wiped, no artifact. `result.detail` is deliberately NOT propagated —
        // the client error is a fixed, content-free message.
        return dispatchFailure(UNSOUND_INPUT_ERROR, "soundness_blocked");
      }
      if (result.verdict === "sound") {
        // The bounded preflight passed. Its ABSENCE before `processing` honestly
        // signals a `skipped` (unchecked, gate-disabled) path.
        log({ event: "soundness_ok", ...base });
      }
      // "skipped": the gate is disabled; proceed WITHOUT claiming the input was checked.
    }

    // Malware-scan gate. It runs only when a scanner is wired; with none, the
    // inputs are NOT scanned and the job proceeds unchanged (the honest default
    // this build ships). A real scanner blocks an infected input here, before any
    // processing, so no artifact is ever produced for it.
    if (scanner) {
      const scan = await scanner.scan({ tool: job.tool, inputs: files });
      // Record the verdict category (and the honesty bit) before acting on it. The
      // detail is deliberately never read — only the bounded verdict/scanned enum.
      emit(scanMetric(scan.verdict, scan.scanned));
      if (scan.verdict === "infected") {
        // Blocked: terminal and non-retryable (the same bytes scan the same way),
        // inputs wiped, no artifact. `scan.detail` is deliberately NOT propagated —
        // the client error is a fixed, content-free message.
        return dispatchFailure(MALWARE_DETECTED_ERROR, "scan_blocked");
      }
      if (scan.verdict === "invalid") {
        // The scanner cannot scan this input and retrying won't help (e.g. it
        // exceeds a hard size limit). Fail CLOSED — block it before processing
        // rather than let an unscanned input through. Terminal, no artifact.
        return dispatchFailure(SCAN_INVALID_ERROR, "scan_blocked");
      }
      if (scan.verdict === "error") {
        // The scan could not complete: requeue (retryable) or fail terminally. We
        // never fall through to processing an input a wired scanner failed to clear.
        return dispatchFailure(SCAN_UNAVAILABLE_ERROR, "failed");
      }
      if (scan.verdict === "clean") {
        // A real scan ran and passed — record it so an audit can prove the input
        // was scanned. Its ABSENCE before `processing` honestly signals a
        // `skipped` (unscanned) path.
        log({ event: "scan_clean", ...base });
      }
      // "skipped": no scanner ran; proceed WITHOUT claiming the input was scanned.
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
      emit(jobTerminalMetric("canceled"));
      return { outcome: "canceled", jobId: job.jobId, attempt };
    }
    log({ event: "processing", ...base });

    // The bounded processor family (compress/ocr/other) and a metrics-only clock read
    // — used solely to bucket processor latency; neither influences orchestration.
    const kind = processorKindForId(processor.id);
    const startedAt = metrics ? now() : 0;

    const result = await processor.process({
      tool: job.tool,
      options,
      inputs: files,
    });

    // Record the processor's wall-clock latency (bucketed at construction) for both a
    // successful and a failed run, before the disposition branches below.
    if (metrics) emit(processorLatencyMetric(kind, now() - startedAt));

    if (!result.ok) {
      // A conflict from fail() means the job was canceled mid-flight; the helper
      // reports that as canceled. Otherwise it requeues (retryable, attempts left)
      // or fails terminally, wiping inputs on any terminal disposition.
      const tick = await dispatchFailure(result.error, "failed");
      emit(processorMetric(kind, processorOutcomeFromTick(tick.outcome)));
      return tick;
    }

    // Success: persist the real artifacts, then mark the job completed. Any safe,
    // structured result metadata the processor observed (e.g. OCR page/character
    // counts, engine family, languages) is threaded onto the completion so it lands
    // on the job record and the status API. It is re-bounded at the queue's
    // persistence boundary; a processor that reports none simply completes without.
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

    const completed = await queue.complete(
      job.jobId,
      artifacts,
      attempt,
      result.results,
    );
    if (!completed.ok) {
      // The job was canceled between processing and completion — clean up the
      // artifacts we just wrote so nothing outlives the cancellation.
      for (const artifact of artifacts) {
        await storage.deleteArtifact(artifact.artifactId);
      }
      await wipeInputs(inputs);
      log({ event: "canceled", ...base });
      emit(processorMetric(kind, "canceled"));
      emit(jobTerminalMetric("canceled"));
      return { outcome: "canceled", jobId: job.jobId, attempt };
    }

    await wipeInputs(inputs);
    log({ event: "completed", ...base });
    emit(processorMetric(kind, "completed"));
    emit(jobTerminalMetric("completed"));
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
