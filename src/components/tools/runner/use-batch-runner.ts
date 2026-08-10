"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  batchProgress,
  batchReducer,
  initBatch,
  type BatchEvent,
  type BatchProgress,
  type BatchSeed,
  type BatchState,
} from "@/lib/batch";
import { errorMessage } from "./runner-kit";

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
  running: boolean;
}

/**
 * Drives the pure batch machine (`@/lib/batch`) over a real, on-device async
 * task. Items run **sequentially** to bound peak memory (one PDF decoded at a
 * time); cancellation aborts before the next item and signals the in-flight one;
 * and all dispatches are guarded so a mid-run unmount never updates dead state.
 *
 * @param process runs one file to a result. It receives an `AbortSignal` so a
 *   long task can bail early on cancel; throwing yields a per-item error.
 */
export function useBatchRunner<R>(
  units: BatchUnit[],
  process: (file: File, signal: AbortSignal) => Promise<R>,
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
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
    dispatch({
      type: "reset",
      items: units.map((unit) => ({ id: unit.id, name: unit.name })),
    });
  }, [signature, units]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "start" });

    for (const unit of unitsRef.current) {
      if (controller.signal.aborted || !mountedRef.current) break;
      dispatch({ type: "item-start", id: unit.id });
      try {
        const result = await process(unit.file, controller.signal);
        if (!mountedRef.current) return;
        dispatch({ type: "item-success", id: unit.id, result });
      } catch (err) {
        if (!mountedRef.current) return;
        dispatch({ type: "item-error", id: unit.id, error: errorMessage(err) });
      }
    }
    runningRef.current = false;
  }, [process]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "cancel" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    runningRef.current = false;
    dispatch({
      type: "reset",
      items: unitsRef.current.map((unit) => ({ id: unit.id, name: unit.name })),
    });
  }, []);

  const progress = useMemo(() => batchProgress(state), [state]);

  return {
    state,
    progress,
    start: start as () => void,
    cancel,
    reset,
    running: state.phase === "running",
  };
}
