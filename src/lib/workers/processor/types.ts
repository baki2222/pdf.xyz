/**
 * The typed contract for a secure-worker **processor** — the compute that runs a
 * single job's transformation after the executor has claimed it and read its
 * inputs. This is the third provider seam (alongside storage and queue), and it
 * is pure data + a tiny interface: no Next.js, no network, no Node built-ins, so
 * the same shape is reused by the in-process local-dev worker and any future
 * production worker, and is unit-testable in isolation.
 *
 * Honesty rules mirror the rest of the worker layer:
 *  - `process()` returns real artifact bytes on success and a typed {@link JobError}
 *    on failure — never a fabricated "completed" output. A processor that cannot
 *    run a request (no native engine, unknown tool) fails honestly.
 *  - `capability()` is presence-only: it says whether the processor can run right
 *    now and why, never naming a path, version, key, or secret value.
 */

import type { JobDeliveryCap, JobError, JobResults } from "@/lib/jobs";
import type { AiUsageMeta, AiWindowMeta } from "@/lib/jobs/ai-results";

/**
 * One input file handed to a processor: the opaque id, the naming metadata the
 * processor needs to name its outputs, and the raw bytes the executor already
 * read from storage. A production worker reads these from the encrypted bucket;
 * the local-dev executor reads them from the in-process store.
 */
export interface ProcessorInputFile {
  fileId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  /**
   * The byte count the upload contract DECLARED for this input, when the worker-side
   * storage recovered one (the local-dev store carries it from the reservation; an
   * S3 deployment supplies it only if the object metadata records a declared size).
   * Optional and content-free — a coarse number, never surfaced. The file-soundness
   * gate (Phase 36) uses it to prove the fetched byte count still matches the
   * declared size (`size_mismatch`); processors ignore it. Absent ⇒ that
   * consistency check is skipped for this input.
   */
  declaredBytes?: number;
}

/** A validated processing request: the tool, its raw option bag, and input files. */
export interface ProcessorInput {
  tool: string;
  /** Raw options; each processor validates its own bag defensively. */
  options: Record<string, unknown>;
  inputs: ProcessorInputFile[];
  /**
   * What this job may deliver, as the route decided when it charged the
   * caller's allowance. Absent means unbounded — which is every non-AI job, and
   * every job queued before the cap existed.
   */
  delivery?: JobDeliveryCap;
}

/**
 * A produced output, before it is persisted and given a signed download URL.
 * The processor returns bytes + naming only; turning it into a downloadable
 * {@link import("@/lib/jobs").JobArtifact} (storing it, minting a signed URL) is
 * the orchestrator's job, not the processor's.
 */
export interface ProcessorArtifact {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Content-free, serializable metrics a processor may attach to a success (engine
 * name, byte sizes, ratios). Never carries document contents, filenames of
 * inputs, keys, or paths — safe to log and return. This is the FLAT logging seam;
 * the structured, client-facing metadata a completed job record carries is the
 * separate {@link ProcessorResult.results} below.
 */
export type ProcessorMeta = Record<string, string | number | boolean>;

/**
 * The outcome of a processor run: real artifacts, or a typed, honest failure.
 *
 * A success may carry two orthogonal, content-free metadata channels:
 *  - `meta`    — the FLAT {@link ProcessorMeta} for logging/observability;
 *  - `results` — the STRUCTURED {@link JobResults} the executor threads onto the
 *    completed job record and the job status API (today, OCR result metadata).
 * Both are optional; a processor that reports neither simply omits them. The
 * `results` block is re-bounded at the persistence boundary (`sanitizeJobResults`),
 * so it can never carry recognized text, a filename, key, path, URL, or secret.
 */
export type ProcessorResult =
  | {
      ok: true;
      artifacts: ProcessorArtifact[];
      meta?: ProcessorMeta;
      results?: JobResults;
    }
  | {
      ok: false;
      error: JobError;
      /**
       * Structured metadata a FAILED run still has to report.
       *
       * **A failure that spent money must be able to say so.** Until 2026-08-11
       * this arm was `{ ok: false; error }` and the type forbade it, so token
       * usage was discarded one layer below the executor's terminal transition —
       * and `incomplete_output` is a FAILURE, classified non-retryable precisely
       * because the model hit its output ceiling and therefore burned the
       * maximum budget. A spend hook reading only the success branch would have
       * been blind to exactly the largest expenses while appearing to work.
       *
       * Optional, because twelve non-AI processors have nothing to attach and
       * keep compiling unchanged. Optional also means an AI processor can forget
       * it and nothing complains, so the coverage is a per-processor control
       * rather than the type.
       */
      results?: JobResults;
    };

/** The honest, client-safe capability/status of a processor in this environment. */
export interface ProcessorCapability {
  /** Stable processor id (e.g. "compression", "ocr"). */
  id: string;
  /** Tool slugs this processor owns. */
  tools: readonly string[];
  /** True only when the processor can run at least one supported request now. */
  ready: boolean;
  /** One-line, client-safe explanation. Never a path, version, key, or value. */
  detail: string;
}

/**
 * A secure-worker processor. `supports` routes a request to a processor;
 * `capability` reports its honest readiness; `process` does the actual transform.
 * The `options` argument of `supports` is reserved for future capability gating
 * (a processor that only handles some option combinations); today's processors
 * route by tool alone.
 */
export interface Processor {
  readonly id: string;
  readonly tools: readonly string[];
  supports(tool: string, options?: Record<string, unknown>): boolean;
  capability(): ProcessorCapability;
  process(input: ProcessorInput): Promise<ProcessorResult>;
}

/**
 * Build a successful processor result. `meta` is the flat logging channel;
 * `results` is the structured, client-facing metadata the executor persists onto
 * the job record. Both are optional and omitted from the result when absent.
 */
export function processorOk(
  artifacts: ProcessorArtifact[],
  meta?: ProcessorMeta,
  results?: JobResults,
): ProcessorResult {
  return {
    ok: true,
    artifacts,
    ...(meta ? { meta } : {}),
    ...(results ? { results } : {}),
  };
}

/**
 * Build a failed processor result from a typed, client-safe job error.
 *
 * `results` carries what the run still has to report despite failing — today,
 * the AI token usage a call spent before it failed. See the failure arm's
 * docblock: a failure that spent money must be able to say so.
 */
export function processorFail(
  error: JobError,
  results?: JobResults,
): ProcessorResult {
  return { ok: false, error, ...(results ? { results } : {}) };
}

/**
 * The `results` block a FAILED AI run still owes the job record.
 *
 * ONE DEFINITION, four call sites. The four AI processors need the identical
 * mapping and four copies could drift into three — the same reason each engine's
 * `mapProviderFailure` builds its payload once and spreads it.
 *
 * Returns `undefined` when there was no provider call: `window` is computed
 * before the call, so its absence means nothing was spent and there is nothing
 * to report. Reporting a block then would invent a call that never ran, and the
 * ceiling would count a spend that did not happen — over-counting silently,
 * which is the failure mode of *fabricating* rather than of losing.
 *
 * Structurally typed rather than taking a union of the four run types: the
 * mapping depends only on these two fields, and naming four types here would
 * make this file know about every AI engine.
 */
export function aiResultsFromFailure(run: {
  usage?: AiUsageMeta;
  window?: AiWindowMeta;
}): JobResults | undefined {
  if (!run.window) return undefined;
  return {
    ai: {
      truncation: run.window,
      ...(run.usage ? { usage: run.usage } : {}),
    },
  };
}
