/**
 * Typed model for the in-browser **batch runner** — running one deterministic,
 * client-side tool over a list of files, one item at a time, with honest
 * per-item status. This is the pure data shape; the reducer lives in `./machine`
 * and the React driver in `src/components/tools/runner/use-batch-runner.ts`.
 *
 * "Batch-ready" means the transformation needs no per-file user input and runs
 * fully on-device (e.g. lossless compression). Tools that need per-page choices
 * are deliberately *not* batched — the workspace marks them single-file instead
 * of faking progress.
 */

/** Lifecycle of a single batch item. All but `queued`/`running` are terminal. */
export type BatchItemStatus =
  | "queued" // waiting to run
  | "running" // currently processing
  | "done" // finished successfully (has `result`)
  | "error" // failed (has `error`)
  | "skipped" // looked at and deliberately left out (has `reason`)
  | "canceled"; // never ran because the batch was canceled

/** One file's slot in the batch, carrying its result or error when settled. */
export interface BatchItem<R> {
  /** Stable id, unique within the batch. */
  id: string;
  /** Display name (usually the file name). */
  name: string;
  status: BatchItemStatus;
  /** Present once `status === "done"`. */
  result?: R;
  /** User-facing reason, present once `status === "error"`. */
  error?: string;
  /**
   * Why the file was left out, present once `status === "skipped"`. A skip is
   * not a failure: nothing went wrong, there was nothing for the tool to do
   * (an Unlock of a file that is not locked).
   */
  reason?: string;
  /**
   * A sentence about a finished file that is not a failure (a repair that
   * had to guess, a file with no images to extract). Only on `done`.
   */
  note?: string;
}

/**
 * Overall batch phase. `done`/`canceled` are terminal. `paused` is a worker
 * batch waiting out a rate limit (batch plan P3): work is left, nothing runs,
 * and it goes back to `running` at `resumeAt`.
 */
export type BatchPhase = "idle" | "running" | "paused" | "done" | "canceled";

export interface BatchState<R> {
  phase: BatchPhase;
  items: BatchItem<R>[];
  /**
   * While `paused`: when the batch carries on by itself (epoch ms), from the
   * limit's own `Retry-After`. Absent in every other phase.
   */
  resumeAt?: number;
}

/** Seed for a batch item before it runs. */
export interface BatchSeed {
  id: string;
  name: string;
}

/** Derived, display-ready counts for accessible progress reporting. */
export interface BatchProgress {
  total: number;
  queued: number;
  running: number;
  done: number;
  error: number;
  skipped: number;
  canceled: number;
  /** Items in a terminal state (done + error + skipped + canceled). */
  settled: number;
  /** Whole-percent completion over all items (0–100). */
  pct: number;
}
