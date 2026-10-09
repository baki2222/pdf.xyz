/**
 * Tool-run outcomes — `tool_completed` / `tool_failed` — sent from wherever a
 * run keeps its own state:
 *
 *  - Browser runners: `useAsyncRun` (runner-kit), which most runners share;
 *    and the two that hold their own run state — compress's on-device analysis
 *    (`CompressEditor`) and the batch runner (`useBatchRunner`, one outcome per
 *    file).
 *  - Worker jobs: {@link withToolOutcome} around every function that creates a
 *    job (`POST /api/jobs`) — `runSecurityJob` (which most panels share),
 *    `runWorkerOcr`, `runWorkerCompression` and `runWorkerWebpageToPdf`.
 *
 * This list is not the guard. It once said "the two places every run already
 * passes through, so no runner or panel can forget" while compress-pdf and
 * webpage-to-pdf passed through neither. `run-outcome-coverage.test.ts`
 * DISCOVERS the run paths — every job creation, every function declaring its
 * own busy/running state — and fails on one that reaches no reporter.
 *
 * WHY A PAGE REGISTRY rather than a slug argument: the shared hook does not
 * know which tool it runs, and the capability is a catalog fact the job
 * clients deliberately do not import. The tool page does know both, and
 * {@link enterToolPage} is how it says so (see `ToolTelemetry`). An outcome
 * reported for a DIFFERENT tool than the page's, or with no tool page mounted,
 * is dropped — an event that names the wrong tool is worse than none.
 *
 * WHAT IS SENT, deliberately less than the schema allows: the tool, its
 * capability, a duration bucket, and for a failure a fixed reason category
 * derived from the error CODE (`toolErrorReason`). No output size — a range
 * of the user's own file size is information about the document — and never a
 * message, which can echo a filename.
 */
import type { ToolCapability } from "@/lib/jobs/types";
import { toolCompletedEvent, toolFailedEvent, track } from "./track";

export interface PageTool {
  readonly toolSlug: string;
  readonly capability: ToolCapability;
}

let pageTool: PageTool | null = null;

/**
 * Declare the tool this page runs; returns the matching exit. The exit only
 * clears its OWN entry, so a stale unmount cannot erase a newer page's tool.
 */
export function enterToolPage(tool: PageTool): () => void {
  pageTool = tool;
  return () => {
    if (pageTool === tool) pageTool = null;
  };
}

function toolFor(toolSlug: string | undefined): PageTool | null {
  if (pageTool === null) return null;
  if (toolSlug !== undefined && toolSlug !== pageTool.toolSlug) return null;
  return pageTool;
}

/**
 * A run on this page produced its output.
 *
 * Also where this browser REMEMBERS that the tool finished a job
 * (`recordCompletion`: the slug and the time, kept locally, never sent), so
 * the home desk's "Recent" row offers it again. Here and not on a result
 * panel's mount (the redesign planned that, E.8) because this is the one
 * point every run path is PROVEN to reach — `run-outcome-coverage.test.ts`
 * discovers the paths — while results render through several components.
 * It does not wait for analytics consent: nothing leaves the device. The
 * store is fetched when a run finishes, not with the page: a tool page that
 * never completes a run never loads it.
 */
export function reportToolCompleted(
  input: { toolSlug?: string; elapsedMs?: number } = {},
): void {
  const tool = toolFor(input.toolSlug);
  if (tool === null) return;
  void import("@/lib/intent/recents")
    .then(({ recordCompletion }) => recordCompletion(tool.toolSlug))
    .catch(() => {
      // Not remembered: the run still finished, and nothing else depends on
      // the recents being there.
    });
  track(
    toolCompletedEvent({
      toolSlug: tool.toolSlug,
      capability: tool.capability,
      ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
    }),
  );
}

/** A run on this page failed; `code` is a contract or client failure code. */
export function reportToolFailed(
  input: { toolSlug?: string; code?: string } = {},
): void {
  const tool = toolFor(input.toolSlug);
  if (tool === null) return;
  track(
    toolFailedEvent({
      toolSlug: tool.toolSlug,
      capability: tool.capability,
      ...(input.code !== undefined ? { code: input.code } : {}),
    }),
  );
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Run a worker job lifecycle and report how it ended. A resolved `{ ok }`
 * result is reported as completed or failed (with its `code`); a throw is a
 * dropped connection (`network`) and is re-thrown untouched. A deliberate
 * abort is the user stopping, not the tool failing, and is not reported.
 */
export async function withToolOutcome<R extends { ok: boolean; code?: string }>(
  toolSlug: string,
  run: () => Promise<R>,
): Promise<R> {
  const started = Date.now();
  try {
    const result = await run();
    if (result.ok) {
      reportToolCompleted({ toolSlug, elapsedMs: Date.now() - started });
    } else {
      reportToolFailed({
        toolSlug,
        ...(result.code !== undefined ? { code: result.code } : {}),
      });
    }
    return result;
  } catch (error) {
    if (!isAbort(error)) reportToolFailed({ toolSlug, code: "network" });
    throw error;
  }
}
