// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAsyncRun } from "./runner-kit";

afterEach(cleanup);

/** A task the test settles by hand, so a reset can land while it runs. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Audit #47 (2026-11-06): Scan to PDF's Clear called `reset()` while Create
 * PDF was running. The task had already captured the photos, carried on, and
 * `run` then called `setResult` with no check that a reset had happened: the
 * person who pressed Clear was shown "Scan saved as PDF" for the pages they
 * had just discarded. The guard belongs here, in the hook every runner
 * shares, not in one runner's button.
 */
describe("useAsyncRun: a reset invalidates the run in flight", () => {
  it("a run that finishes after reset() draws no result", async () => {
    const { result } = renderHook(() => useAsyncRun<string>());
    const task = deferred<string>();
    let settled: Promise<unknown>;
    act(() => {
      settled = result.current.run(() => task.promise);
    });
    expect(result.current.busy).toBe(true);
    act(() => result.current.reset());
    expect(result.current.busy).toBe(false);
    await act(async () => {
      task.resolve("the pages that were cleared");
      await settled;
    });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("nor an error, when it fails after reset()", async () => {
    const { result } = renderHook(() => useAsyncRun<string>());
    const task = deferred<string>();
    let settled: Promise<unknown>;
    act(() => {
      settled = result.current.run(() => task.promise);
    });
    act(() => result.current.reset());
    await act(async () => {
      task.reject(new Error("decoder gave up"));
      await settled;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it("a stale run cannot clear the busy flag of the run started after it", async () => {
    const { result } = renderHook(() => useAsyncRun<string>());
    const first = deferred<string>();
    const second = deferred<string>();
    let firstSettled: Promise<unknown>;
    let secondSettled: Promise<unknown>;
    act(() => {
      firstSettled = result.current.run(() => first.promise);
    });
    act(() => result.current.reset());
    act(() => {
      secondSettled = result.current.run(() => second.promise);
    });
    await act(async () => {
      first.resolve("old");
      await firstSettled;
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.result).toBeNull();
    await act(async () => {
      second.resolve("new");
      await secondSettled;
    });
    expect(result.current.result).toBe("new");
    expect(result.current.busy).toBe(false);
  });

  it("control: with no reset, the run's value is the result", async () => {
    const { result } = renderHook(() => useAsyncRun<string>());
    await act(async () => {
      await result.current.run(async () => "made");
    });
    expect(result.current.result).toBe("made");
    expect(result.current.busy).toBe(false);
  });
});
