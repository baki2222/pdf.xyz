"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  BatchSkip,
  NotedResult,
  batchProgress,
  batchReducer,
  initBatch,
  type BatchEvent,
  type BatchProgress,
  type BatchSeed,
  type BatchState,
} from "@/lib/batch";
import { endingReady, errorMessage, failureCode } from "./runner-kit";
import { cancelActivity, reportActivity } from "@/lib/activity/bus";
import {
  reportToolCompleted,
  reportToolFailed,
} from "@/lib/telemetry/tool-outcome";

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** One file to run through the batch, plus a stable id for its slot. */
export interface BatchUnit {
  id: string;
  name: string;
  file: File;
}

export interface BatchRunner<R> {
  state: BatchState<R>;
  progress: BatchProgress;
  /** Kick off sequential processing (no-op if already running). */
  start: () => void;
  /** Stop after the in-flight item; queued items become `canceled`. */
  cancel: () => void;
  /** Re-seed back to a fresh, idle batch over the current units. */
  reset: () => void;
  /** Run the failed rows again, keeping every finished one as it is. */
  retryFailed: () => void;
  /** Take a file out of the list; only before anything has run. */
  remove: (id: string) => void;
  /**
   * Why the batch stopped by itself (`haltOn`), while it stays stopped: the
   * finished rows are kept, and the files after the failure never ran.
   */
  haltReason: string | null;
  running: boolean;
}

export interface BatchRunnerOptions {
  /**
   * Report each file's outcome to telemetry from here (the default). A
   * `process` that already reports — a worker job runs inside
   * `withToolOutcome` — passes `false`, or every file is counted twice.
   */
  reportsOutcome?: boolean;
  /**
   * A failure that would repeat for every file after it (the browser ran out
   * of memory, our server is unavailable): return the sentence that says so,
   * and the batch stops there instead of failing the rest one by one.
   */
  haltOn?: (error: unknown) => string | null | undefined;
}

/** What one file's `process` may hand back: a result, or a noted one. */
export type BatchProcess<R> = (
  file: File,
  signal: AbortSignal,
) => Promise<R | NotedResult<R>>;

/**
 * Drives the pure batch machine (`@/lib/batch`) over a real, on-device async
 * task. Items run **sequentially** to bound peak memory (one PDF decoded at a
 * time); cancellation aborts before the next item and signals the in-flight one;
 * and all dispatches are guarded so a mid-run unmount never updates dead state.
 *
 * @param process runs one file to a result. It receives an `AbortSignal` so a
 *   long task can bail early on cancel; throwing yields a per-item error,
 *   throwing a `BatchSkip` leaves the file out with its reason, and returning
 *   `withNote(result, note)` finishes it with a sentence on its row.
 */
export function useBatchRunner<R>(
  units: BatchUnit[],
  process: BatchProcess<R>,
  { reportsOutcome = true, haltOn }: BatchRunnerOptions = {},
): BatchRunner<R> {
  const seeds = useMemo<BatchSeed[]>(
    () => units.map((unit) => ({ id: unit.id, name: unit.name })),
    [units],
  );
  const [state, dispatch] = useReducer(
    batchReducer as (s: BatchState<R>, e: BatchEvent<R>) => BatchState<R>,
    seeds,
    initBatch as (s: BatchSeed[]) => BatchState<R>,
  );

  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const unitsRef = useRef(units);
  useEffect(() => {
    unitsRef.current = units;
  }, [units]);
  // The rows as last rendered: what a press of Run or Retry acts on.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // Files taken out before Run stay out when the batch is run again.
  const removedRef = useRef(new Set<string>());
  const [halt, setHalt] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      // A batch left mid-run never reaches its own end below.
      if (runningRef.current) cancelActivity();
    };
  }, []);

  // Re-seed when the set of files actually changes (new picker selection), but
  // not on the initial render (the reducer's init already seeded that set).
  const signature = useMemo(
    () => units.map((unit) => unit.id).join("|"),
    [units],
  );
  const signatureRef = useRef(signature);
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    abortRef.current?.abort();
    runningRef.current = false;
    removedRef.current.clear();
    dispatch({
      type: "reset",
      items: units.map((unit) => ({ id: unit.id, name: unit.name })),
    });
  }, [signature, units]);

  const runIds = useCallback(
    async (ids: readonly string[]) => {
      if (runningRef.current) return;
      runningRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setHalt(null);
      dispatch({ type: "start" });
      // The masthead's square and a hidden tab's title read this (spec E.11).
      reportActivity("busy");
      let failures = 0;
      let halted = false;

      for (const [index, id] of ids.entries()) {
        if (controller.signal.aborted || !mountedRef.current) break;
        const unit = unitsRef.current.find((u) => u.id === id);
        if (!unit) continue;
        dispatch({ type: "item-start", id: unit.id });
        const started = Date.now();
        // The last file's settle is the batch's result: it is drawn with the
        // result's ending (the receipt, Continue with), not before it — see
        // `endingReady` in the runner kit.
        const last = index === ids.length - 1;
        try {
          const value = await process(unit.file, controller.signal);
          const noted = value instanceof NotedResult ? value : null;
          // Each file is one run of the tool, reported as it settles — the
          // batch holds its own state rather than `useAsyncRun`'s, so it must
          // (see `@/lib/telemetry/tool-outcome`) — unless `process` already
          // reports its own run.
          if (reportsOutcome)
            reportToolCompleted({ elapsedMs: Date.now() - started });
          if (last) await endingReady();
          if (!mountedRef.current) return;
          dispatch({
            type: "item-success",
            id: unit.id,
            result: noted ? (noted.result as R) : (value as R),
            ...(noted ? { note: noted.note } : {}),
          });
        } catch (err) {
          // A skip is a file with nothing to do: not a run, not a failure.
          if (err instanceof BatchSkip) {
            if (last) await endingReady();
            if (!mountedRef.current) return;
            dispatch({ type: "item-skip", id: unit.id, reason: err.message });
            continue;
          }
          // Stopping is the user's choice, not the tool failing.
          const stopped = controller.signal.aborted || isAbort(err);
          if (!stopped) {
            if (reportsOutcome) reportToolFailed({ code: failureCode(err) });
            failures += 1;
          }
          const haltReason = stopped ? null : (haltOn?.(err) ?? null);
          if (last || haltReason) await endingReady();
          if (!mountedRef.current) return;
          dispatch({
            type: "item-error",
            id: unit.id,
            error: errorMessage(err),
          });
          if (haltReason) {
            // The files after this one would fail the same way: they never
            // run, and every finished row stays as it is.
            halted = true;
            setHalt(haltReason);
            controller.abort();
            dispatch({ type: "cancel" });
            break;
          }
        }
      }
      runningRef.current = false;
      // Stopped is not finished: a canceled batch ends without news. A batch
      // that stopped ITSELF did fail, and says so.
      if (halted) reportActivity("failed");
      else if (controller.signal.aborted || !mountedRef.current)
        cancelActivity();
      else reportActivity(failures > 0 ? "failed" : "done");
    },
    [process, reportsOutcome, haltOn],
  );

  const start = useCallback(() => {
    void runIds(
      stateRef.current.items
        .filter((item) => item.status === "queued")
        .map((item) => item.id),
    );
  }, [runIds]);

  const retryFailed = useCallback(() => {
    if (runningRef.current) return;
    const ids = stateRef.current.items
      .filter((item) => item.status === "error")
      .map((item) => item.id);
    if (ids.length === 0) return;
    dispatch({ type: "retry", ids });
    void runIds(ids);
  }, [runIds]);

  const remove = useCallback((id: string) => {
    if (stateRef.current.phase !== "idle") return;
    removedRef.current.add(id);
    dispatch({ type: "remove", id });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "cancel" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    runningRef.current = false;
    setHalt(null);
    dispatch({
      type: "reset",
      items: unitsRef.current
        .filter((unit) => !removedRef.current.has(unit.id))
        .map((unit) => ({ id: unit.id, name: unit.name })),
    });
  }, []);

  const progress = useMemo(() => batchProgress(state), [state]);

  return {
    state,
    progress,
    start,
    cancel,
    reset,
    retryFailed,
    remove,
    haltReason: state.phase === "canceled" ? halt : null,
    running: state.phase === "running",
  };
}
