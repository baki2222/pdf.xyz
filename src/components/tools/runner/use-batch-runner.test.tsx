// @vitest-environment jsdom
/**
 * The batch driver's options and new controls (batch plan P0b), on a fake
 * `process` so each file's outcome is chosen by the test:
 *
 *   - `reportsOutcome`: exactly ONE telemetry report per file — from here by
 *     default, from nowhere here when `process` already reports (a worker job
 *     inside `withToolOutcome`). Two reporters would count every file twice,
 *     which is the trap the plan names.
 *   - `haltOn`: a failure that would repeat stops the batch there, keeps the
 *     finished rows, and never runs the files after it.
 *   - `retryFailed`, `remove`, `BatchSkip`, `withNote`.
 *
 * No module is mocked (`src/tests/mock-isolation.test.ts`): telemetry is read
 * at its sink, the one place every report reaches.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useLayoutEffect, useRef } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { BatchSkip, withNote } from "@/lib/batch";
import { currentActivity, resetActivityForTests } from "@/lib/activity/bus";
import { observeFor } from "@/tests/time-bound";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import {
  useBatchRunner,
  type BatchProcess,
  type BatchRunnerOptions,
  type BatchUnit,
} from "./use-batch-runner";
import { warmEnding } from "./runner-kit";

const unitsOf = (...names: string[]): BatchUnit[] =>
  names.map((name) => ({
    id: name,
    name,
    file: new File([name], name, { type: "application/pdf" }),
  }));

// The last file of every run awaits endingReady(): the result-ending chunk,
// raced against ENDING_WAIT_MS (800 ms). Cold, that put up to 800 ms under
// a 1 s default wait, and a still-pending import spilled into the next
// test. Loaded once here with no cap, every wait below covers microtasks.
beforeAll(async () => {
  const ending = await warmEnding();
  // Positive control: endingReady swallows a failed load; prove it came.
  expect(ending.ContinueWith).toBeDefined();
});

let events: RedactedEvent[] = [];
let leave: () => void = () => {};
beforeEach(() => {
  events = [];
  configureTelemetry((e) => events.push(e));
  leave = enterToolPage({ toolSlug: "compress-pdf", capability: "in-browser" });
});
afterEach(() => {
  leave();
  resetTelemetry();
});

const outcomes = () =>
  events
    .map((e) => e.name)
    .filter((n) => n === "tool_completed" || n === "tool_failed");

function setup<R>(
  units: BatchUnit[],
  process: BatchProcess<R>,
  options?: BatchRunnerOptions,
) {
  return renderHook(() => useBatchRunner<R>(units, process, options));
}

/** A process that fails the files named in `failing`, and records each call. */
function fakeProcess(failing: Set<string>, calls: string[]) {
  return async (file: File) => {
    calls.push(file.name);
    if (failing.has(file.name)) throw new Error(`${file.name} broke`);
    return `${file.name}:ok`;
  };
}

describe("reportsOutcome — one report per file, from exactly one place", () => {
  // Stable across renders, as a real caller's useMemo'd units are.
  const units = unitsOf("a.pdf", "b.pdf", "c.pdf");

  it("by default the batch reports each file as it settles", async () => {
    const calls: string[] = [];
    const { result } = setup(units, fakeProcess(new Set(["b.pdf"]), calls));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    // Health: the files really ran, so a count of reports is a count of runs.
    expect(calls).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(outcomes()).toEqual([
      "tool_completed",
      "tool_failed",
      "tool_completed",
    ]);
  });

  it("with reportsOutcome:false it reports nothing, so a self-reporting process is counted once", async () => {
    const calls: string[] = [];
    const { result } = setup(units, fakeProcess(new Set(["b.pdf"]), calls), {
      reportsOutcome: false,
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(calls).toHaveLength(3);
    expect(outcomes()).toEqual([]);
  });
});

describe("haltOn — a failure that would repeat stops the batch", () => {
  const units = unitsOf("a.pdf", "b.pdf", "c.pdf", "d.pdf");
  const OUT_OF_MEMORY = "This browser ran out of memory.";

  it("keeps the finished rows, fails the one that broke, and never runs the rest", async () => {
    const calls: string[] = [];
    const process = async (file: File) => {
      calls.push(file.name);
      if (file.name === "b.pdf")
        throw new RangeError("Array buffer allocation failed");
      return `${file.name}:ok`;
    };
    const { result } = setup(units, process, {
      haltOn: (err) => (err instanceof RangeError ? OUT_OF_MEMORY : null),
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("canceled"));
    expect(calls).toEqual(["a.pdf", "b.pdf"]);
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "error",
      "canceled",
      "canceled",
    ]);
    expect(result.current.state.items[0]!.result).toBe("a.pdf:ok");
    expect(result.current.haltReason).toBe(OUT_OF_MEMORY);
  });

  it("control: an error haltOn does not name fails its row and the batch goes on", async () => {
    const calls: string[] = [];
    const { result } = setup(units, fakeProcess(new Set(["b.pdf"]), calls), {
      haltOn: (err) => (err instanceof RangeError ? OUT_OF_MEMORY : null),
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(calls).toHaveLength(4);
    expect(result.current.haltReason).toBeNull();
  });
});

describe("retryFailed — runs the failed rows again, and only them", () => {
  it("keeps every finished result and re-runs just the failure", async () => {
    const units = unitsOf("a.pdf", "b.pdf", "c.pdf");
    const calls: string[] = [];
    const failing = new Set(["b.pdf"]);
    const { result } = setup(units, fakeProcess(failing, calls));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    const first = result.current.state.items[0];
    expect(result.current.progress.error).toBe(1);

    failing.clear();
    act(() => result.current.retryFailed());
    await waitFor(() => expect(result.current.progress.done).toBe(3));
    expect(result.current.state.phase).toBe("done");
    expect(calls).toEqual(["a.pdf", "b.pdf", "c.pdf", "b.pdf"]);
    // The first row is the same object: its result was never re-made.
    expect(result.current.state.items[0]).toBe(first);
  });
});

describe("the files and the rows a press reads come from the same commit", () => {
  // A new selection re-seeds the rows in a PASSIVE effect, so for one
  // commit the old rows are still drawn under the new `units`. runIds takes
  // its ids from the rows (stateRef, synced in a layout effect) and looks
  // each up in the files (unitsRef). If unitsRef ran ahead of the rows (a
  // layout effect), a press in that commit looked the drawn rows up among
  // files they are not in, and ran nothing: the HEAD of 6e84169e did that.
  it("a press in the commit that brings new files runs the rows still drawn, and the new files then cancel it and re-seed", async () => {
    const before = unitsOf("a.pdf");
    const after = unitsOf("x.pdf", "y.pdf");
    const calls: { name: string; signal: AbortSignal }[] = [];
    const process: BatchProcess<string> = (file, signal) => {
      calls.push({ name: file.name, signal });
      return new Promise<string>(() => {});
    };
    let rowsAtPress: string[] | null = null;
    const { result, rerender } = renderHook(
      ({ units }: { units: BatchUnit[] }) => {
        const runner = useBatchRunner<string>(units, process);
        // Declared after the hook, so its layout effects (stateRef) have run.
        const pressed = useRef(false);
        useLayoutEffect(() => {
          if (units !== after || pressed.current) return;
          pressed.current = true;
          rowsAtPress = runner.state.items.map((i) => i.name);
          runner.start();
        });
        return runner;
      },
      { initialProps: { units: before } },
    );
    act(() => rerender({ units: after }));
    // Health check: the press landed in the commit that still drew the old
    // rows, before the re-seed (otherwise this proves nothing).
    expect(rowsAtPress).toEqual(["a.pdf"]);
    // The drawn row ran (not nothing) ...
    expect(calls.map((c) => c.name)).toEqual(["a.pdf"]);
    // ... and the new selection cancelled it and re-seeded the rows.
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(result.current.state.items.map((i) => i.name)).toEqual([
      "x.pdf",
      "y.pdf",
    ]);
    expect(result.current.state.phase).toBe("idle");
  });
});

describe("remove — before Run, and it stays out", () => {
  it("a removed file is never run, and Run again keeps it out", async () => {
    const units = unitsOf("a.pdf", "b.pdf", "c.pdf");
    const calls: string[] = [];
    const { result } = setup(units, fakeProcess(new Set(), calls));
    act(() => result.current.remove("b.pdf"));
    expect(result.current.state.items.map((i) => i.id)).toEqual([
      "a.pdf",
      "c.pdf",
    ]);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(calls).toEqual(["a.pdf", "c.pdf"]);
    act(() => result.current.reset());
    expect(result.current.state.items.map((i) => i.id)).toEqual([
      "a.pdf",
      "c.pdf",
    ]);
    // Once run, a row is a record: remove does nothing.
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    act(() => result.current.remove("a.pdf"));
    expect(result.current.state.items).toHaveLength(2);
  });
});

describe("BatchSkip and withNote — a row that is neither a result nor a failure", () => {
  it("a skip shows its reason and reports nothing; a note rides on its result", async () => {
    const units = unitsOf("a.pdf", "b.pdf");
    const process = async (file: File) => {
      if (file.name === "a.pdf") throw new BatchSkip("not locked");
      return withNote("b:ok", "repaired by guess");
    };
    const { result } = setup(units, process);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(result.current.state.items[0]).toMatchObject({
      status: "skipped",
      reason: "not locked",
    });
    expect(result.current.state.items[1]).toMatchObject({
      status: "done",
      result: "b:ok",
      note: "repaired by guess",
    });
    // One report: the file that ran. The skipped one was not a run.
    expect(outcomes()).toEqual(["tool_completed"]);
  });
});

/**
 * Batch plan P3: a rate limit PAUSES the batch. `pauseOn` turns the error
 * into the moment the limit lifts; the file goes back to the queue (never a
 * failure, never reported as one by the batch), nothing runs while paused,
 * and the same file runs again — by itself at `resumeAt` while the tab is
 * open, or at "Continue now", which waits for `resumeAt` too.
 */
describe("pauseOn — a rate limit pauses, and the batch carries on from the same file", () => {
  const units = unitsOf("a.pdf", "b.pdf", "c.pdf");
  class Limited extends Error {
    constructor(readonly resumeAt: number) {
      super("limited");
    }
  }
  const pauseOn = (err: unknown) =>
    err instanceof Limited ? err.resumeAt : null;

  // Only `Date` is faked, so "Continue now" judges the wait over against a
  // clock this test moves, while setTimeout stays real: RTL's polling and
  // the hook's own timer still run, and that timer is 60 s away, so only a
  // press can carry the batch on inside a test. Before 2026-11-21 the pause
  // was 400 ms of REAL time, and an early press, a 100 ms sleep and two
  // reads had to fit inside it: a slow runner let the hook's timer win, and
  // the batch read as resumed — red for speed, not for a defect.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetActivityForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts the file back, runs nothing until the wait is over, then runs it again and finishes", async () => {
    const calls: string[] = [];
    let limitedOnce = false;
    let resumeAt = 0;
    const process = async (file: File) => {
      calls.push(file.name);
      if (file.name === "b.pdf" && !limitedOnce) {
        limitedOnce = true;
        resumeAt = Date.now() + 60_000;
        throw new Limited(resumeAt);
      }
      return `${file.name}:ok`;
    };
    const { result } = setup(units, process, {
      reportsOutcome: false,
      pauseOn,
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("paused"));
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "queued",
      "queued",
    ]);
    expect(result.current.resumeAt).toBe(resumeAt);
    // "Continue now" a millisecond before the wait is over does nothing.
    // The window is KEPT, not drained: a wake deferred by a macrotask
    // (setTimeout(wake, 0)) lands after an act drain but inside 100 ms, so
    // only a real window sees it. Nothing legitimate can happen in it now,
    // so a slower runner only lengthens it.
    vi.setSystemTime(resumeAt - 1);
    act(() => result.current.continueNow());
    await act(() =>
      observeFor(
        "use-batch-runner.early-continue",
        100,
        "an early 'Continue now' must not wake the pause, even a macrotask later",
      ),
    );
    expect(result.current.state.phase).toBe("paused");
    expect(calls).toEqual(["a.pdf", "b.pdf"]);
    // At resumeAt the press carries on: the same file again, then the rest.
    vi.setSystemTime(resumeAt);
    act(() => result.current.continueNow());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(calls).toEqual(["a.pdf", "b.pdf", "b.pdf", "c.pdf"]);
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "done",
      "done",
    ]);
    expect(result.current.resumeAt).toBeNull();
    // The batch reported nothing of its own (the process reports).
    expect(outcomes()).toEqual([]);
  });

  it("'Continue now' once the wait is over carries on without the timer", async () => {
    // INVERTED 2026-11-21: this threw Limited(Date.now() - 1), so the hook's
    // own setTimeout(wake, 0) had resumed the batch before the press, and a
    // continueNow that did nothing stayed green. The timer is now 60 s
    // away: only the press can carry the batch on.
    const calls: string[] = [];
    let limited = false;
    let resumeAt = 0;
    const process = async (file: File) => {
      calls.push(file.name);
      if (file.name === "a.pdf" && !limited) {
        limited = true;
        resumeAt = Date.now() + 60_000;
        throw new Limited(resumeAt);
      }
      return `${file.name}:ok`;
    };
    const { result } = setup(units, process, { pauseOn });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("paused"));
    vi.setSystemTime(resumeAt);
    act(() => result.current.continueNow());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(calls).toEqual(["a.pdf", "a.pdf", "b.pdf", "c.pdf"]);
  });

  it("a cancel while paused cancels the paused file and every file after it, and nothing runs", async () => {
    const calls: string[] = [];
    let seen: AbortSignal | null = null;
    const process = async (file: File, signal: AbortSignal) => {
      calls.push(file.name);
      seen = signal;
      if (file.name === "b.pdf") throw new Limited(Date.now() + 60_000);
      return `${file.name}:ok`;
    };
    const { result } = setup(units, process, { pauseOn });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("paused"));
    // Positive control: the run is in progress while it waits.
    expect(currentActivity().state).toBe("busy");
    act(() => result.current.cancel());
    expect(result.current.state.phase).toBe("canceled");
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "canceled",
      "canceled",
    ]);
    // The loop has LEFT, which the 50 ms sleep here never showed (the only
    // timer that could resume it is 60 s away): abort wakes the wait, the
    // loop breaks, and only then does the run end without news. Abort, wake
    // and break are synchronous plus microtasks, so one drain is enough.
    await act(async () => {});
    expect(seen!.aborted).toBe(true);
    expect(currentActivity().state).toBe("idle");
    expect(calls).toEqual(["a.pdf", "b.pdf"]);
  });

  it("left to itself, the pause ends at resumeAt, never before, and the same file runs again", async () => {
    // The timer path, on real time: the Date fake is lifted for it.
    vi.useRealTimers();
    const calls: { name: string; at: number }[] = [];
    let limitedOnce = false;
    let resumeAt = 0;
    const process = async (file: File) => {
      calls.push({ name: file.name, at: Date.now() });
      if (file.name === "b.pdf" && !limitedOnce) {
        limitedOnce = true;
        resumeAt = Date.now() + 400;
        throw new Limited(resumeAt);
      }
      return `${file.name}:ok`;
    };
    const { result } = setup(units, process, {
      reportsOutcome: false,
      pauseOn,
    });
    act(() => result.current.start());
    // 3000 ms: the earlier form of this real-timer test waited this same
    // 400 ms pause and took at most 465 ms in all on CI (failed run
    // 44228410852, the max over 33 CI runs of 11-09..11-21; 425 ms among
    // the 12 passing runs of 11-18, run 44264031662), so > 6x; and it stays
    // under the 5 s test timeout, so this wait's own message wins.
    await waitFor(() => expect(result.current.state.phase).toBe("done"), {
      timeout: 3000,
    });
    expect(calls.map((c) => c.name)).toEqual([
      "a.pdf",
      "b.pdf",
      "b.pdf",
      "c.pdf",
    ]);
    // One-directional: a slower runner only makes the second run later. A
    // Node timer may fire up to 1 ms early against Date.now().
    expect(calls[2]!.at).toBeGreaterThanOrEqual(resumeAt - 1);
  });

  it("control: without pauseOn the same error fails its row", async () => {
    const process = async (file: File) => {
      if (file.name === "b.pdf") throw new Limited(Date.now() + 60_000);
      return `${file.name}:ok`;
    };
    const { result } = setup(units, process);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "error",
      "done",
    ]);
  });
});
