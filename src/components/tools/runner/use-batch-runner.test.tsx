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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { BatchSkip, withNote } from "@/lib/batch";
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

const unitsOf = (...names: string[]): BatchUnit[] =>
  names.map((name) => ({
    id: name,
    name,
    file: new File([name], name, { type: "application/pdf" }),
  }));

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
