/**
 * Where a worker job is, as the browser OBSERVED it, and which of the
 * page's pipeline stages (`workerPipelineStages`) each observation stamps.
 *
 * Phase sources (spec E.10):
 *  - the job clients' `onPhase` — `uploading` on the line that calls
 *    `markUploadStarted()`, `uploaded` once the bytes are stored,
 *    `downloading` before the artifact fetch, `done` after it;
 *  - `pollJobToTerminal({ onStatus })`, through {@link phaseOfStatus}, once
 *    per DISTINCT job status.
 *
 * `delete` is never produced. Auto-delete happens after the job, on the
 * worker's schedule, and nothing in the browser sees it happen — so the
 * docket says "scheduled", never a tick. `phases.test.ts` holds that, and
 * holds this map to the stage lists in both directions.
 *
 * Browser-only and dependency-free apart from types: the worker daemon does
 * not import it.
 */
import type { JobStatus } from "@/lib/jobs/types";
import type { PipelineStage } from "@/lib/jobs/capabilities";

export const JOB_PHASES = [
  "uploading",
  "uploaded",
  "queued",
  "scanning",
  "preflight",
  "processing",
  "downloading",
  "done",
  "failed",
] as const;

export type JobPhase = (typeof JOB_PHASES)[number];

/** A phase, and when the browser saw it (`performance.now()` or `Date.now()`). */
export interface PhaseEvent {
  readonly phase: JobPhase;
  readonly at: number;
}

/** A job record's status, in the docket's vocabulary. */
export function phaseOfStatus(status: JobStatus): JobPhase {
  switch (status) {
    case "queued":
      return "queued";
    case "scanning":
      return "scanning";
    case "processing":
      return "processing";
    case "completed":
      return "done";
    case "failed":
    case "expired":
    case "canceled":
      return "failed";
  }
}

/** The ids the checks stage goes by: scan on, scan off, not yet heard. */
const CHECK_STAGES = ["scan", "preflight", "checks"] as const;

/**
 * The stage a phase stamps, or null for a phase that stamps none: `queued`
 * (waiting is not a stage), `done` and `failed` (they end the job, they are
 * not a step in it). Never `"delete"`.
 */
export function stageForPhase(
  phase: JobPhase,
  stages: readonly PipelineStage[],
): string | null {
  const has = (id: string) => stages.some((s) => s.id === id);
  switch (phase) {
    case "uploading":
    case "uploaded":
      return has("upload") ? "upload" : null;
    case "scanning":
    case "preflight":
      return CHECK_STAGES.find(has) ?? null;
    case "processing":
      return has("process") ? "process" : null;
    case "downloading":
      return has("download") ? "download" : null;
    case "queued":
    case "done":
    case "failed":
      return null;
  }
}

/**
 * `pollJobToTerminal`'s `onStatus`, forwarded to a client's `onPhase`. A
 * completed status is NOT forwarded: the client still has the download to
 * do, and reports `downloading` and then `done` itself, in that order.
 */
export function forwardStatus(
  onPhase: ((phase: JobPhase) => void) | undefined,
): (status: JobStatus) => void {
  return (status) => {
    const phase = phaseOfStatus(status);
    if (phase !== "done") onPhase?.(phase);
  };
}
