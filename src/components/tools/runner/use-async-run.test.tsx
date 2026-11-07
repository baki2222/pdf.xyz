// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { currentActivity, resetActivityForTests } from "@/lib/activity/bus";
import { useAsyncRun } from "./runner-kit";

beforeEach(resetActivityForTests);
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

/**
 * Review of audit #47 (2026-11-06): the first fix dropped a stale run's
 * value, error and busy flag, and with them its `reportActivity("done")`,
 * but nothing returned the activity bus to idle. After Clear the masthead
 * mark and a hidden tab's title (spec E.11) said "working" until the next
 * run. A reset that stops a run in flight ends it without news.
 */
describe("useAsyncRun: a reset ends the activity it started", () => {
  it("reset() during a run returns the bus to idle, and the run settling later does not revive it", async () => {
    const { result } = renderHook(() => useAsyncRun<string>());
    const task = deferred<string>();
    let settled: Promise<unknown>;
    act(() => {
      settled = result.current.run(() => task.promise);
    });
    // Health check: the run did report itself.
    expect(currentActivity().state).toBe("busy");
    act(() => result.current.reset());
    expect(currentActivity().state).toBe("idle");
    await act(async () => {
      task.resolve("the pages that were cleared");
      await settled;
    });
    expect(currentActivity().state).toBe("idle");
  });

  it("control: a stale run settling during a NEWER run leaves the newer run busy", async () => {
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
    expect(currentActivity().state).toBe("busy");
    await act(async () => {
      first.reject(new Error("stale"));
      await firstSettled;
    });
    expect(currentActivity().state).toBe("busy");
    await act(async () => {
      second.resolve("new");
      await secondSettled;
    });
    expect(currentActivity().state).toBe("done");
  });

  it("control: a reset with no run in flight does not touch the bus", async () => {
    const { result } = renderHook(() => useAsyncRun<string>());
    await act(async () => {
      await result.current.run(async () => "made");
    });
    expect(currentActivity().state).toBe("done");
    act(() => result.current.reset());
    expect(currentActivity().state).toBe("done");
  });
});
