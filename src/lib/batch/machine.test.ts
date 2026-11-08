import { describe, expect, it } from "vitest";
import {
  batchProgress,
  batchReducer,
  initBatch,
  isBatchSettled,
  type BatchEvent,
} from "./machine";
import type { BatchState } from "./types";

const seeds = [
  { id: "a", name: "a.pdf" },
  { id: "b", name: "b.pdf" },
  { id: "c", name: "c.pdf" },
];

/** Fold a sequence of events over an initial batch state. */
function run<R>(state: BatchState<R>, events: BatchEvent<R>[]): BatchState<R> {
  return events.reduce(batchReducer, state);
}

describe("initBatch", () => {
  it("queues every item and starts idle", () => {
    const state = initBatch(seeds);
    expect(state.phase).toBe("idle");
    expect(state.items.map((i) => i.status)).toEqual([
      "queued",
      "queued",
      "queued",
    ]);
  });
});

describe("batchReducer — happy path", () => {
  it("runs all items to done and finishes", () => {
    const final = run(initBatch<number>(seeds), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-success", id: "a", result: 1 },
      { type: "item-start", id: "b" },
      { type: "item-success", id: "b", result: 2 },
      { type: "item-start", id: "c" },
      { type: "item-success", id: "c", result: 3 },
    ]);
    expect(final.phase).toBe("done");
    expect(final.items.map((i) => i.status)).toEqual(["done", "done", "done"]);
    expect(final.items.map((i) => i.result)).toEqual([1, 2, 3]);
    expect(isBatchSettled(final)).toBe(true);
  });

  it("records a per-item error and still finishes the batch", () => {
    const final = run(initBatch<number>(seeds.slice(0, 2)), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-error", id: "a", error: "bad pdf" },
      { type: "item-start", id: "b" },
      { type: "item-success", id: "b", result: 9 },
    ]);
    expect(final.phase).toBe("done");
    expect(final.items[0]).toMatchObject({ status: "error", error: "bad pdf" });
    expect(final.items[1]).toMatchObject({ status: "done", result: 9 });
  });
});

describe("batchReducer — guards", () => {
  it("ignores start unless idle with queued items", () => {
    const idleEmpty = initBatch<number>([]);
    expect(batchReducer(idleEmpty, { type: "start" })).toBe(idleEmpty);

    const running = batchReducer(initBatch<number>(seeds), { type: "start" });
    // A second start is a no-op.
    expect(batchReducer(running, { type: "start" })).toBe(running);
  });

  it("ignores item-start when not running or item not queued", () => {
    const idle = initBatch<number>(seeds);
    expect(batchReducer(idle, { type: "item-start", id: "a" })).toBe(idle);

    const running = batchReducer(idle, { type: "start" });
    const started = batchReducer(running, { type: "item-start", id: "a" });
    // Re-starting the same item does nothing (already running).
    expect(batchReducer(started, { type: "item-start", id: "a" })).toBe(
      started,
    );
    // Unknown id is a no-op.
    expect(batchReducer(running, { type: "item-start", id: "zzz" })).toBe(
      running,
    );
  });

  it("ignores success/error for items that are not running", () => {
    const running = batchReducer(initBatch<number>(seeds), { type: "start" });
    // 'a' is still queued, not running.
    expect(
      batchReducer(running, { type: "item-success", id: "a", result: 1 }),
    ).toBe(running);
  });
});

describe("batchReducer — cancel", () => {
  it("cancels queued items but lets the in-flight item settle without un-canceling", () => {
    let state = run(initBatch<number>(seeds), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-success", id: "a", result: 1 },
      { type: "item-start", id: "b" }, // b is now running
    ]);
    state = batchReducer(state, { type: "cancel" });
    expect(state.phase).toBe("canceled");
    // b keeps running; c (queued) is canceled.
    expect(state.items.map((i) => i.status)).toEqual([
      "done",
      "running",
      "canceled",
    ]);

    // b's in-flight result still lands, but the phase stays canceled.
    state = batchReducer(state, { type: "item-success", id: "b", result: 2 });
    expect(state.phase).toBe("canceled");
    expect(state.items[1]).toMatchObject({ status: "done", result: 2 });
    expect(isBatchSettled(state)).toBe(true);
  });

  it("cancel from idle marks everything canceled and is terminal", () => {
    const canceled = batchReducer(initBatch<number>(seeds), { type: "cancel" });
    expect(canceled.phase).toBe("canceled");
    expect(canceled.items.every((i) => i.status === "canceled")).toBe(true);
    // Cancel again / finished states are no-ops.
    expect(batchReducer(canceled, { type: "cancel" })).toBe(canceled);
  });
});

describe("batchReducer — reset", () => {
  it("re-seeds to a fresh idle batch", () => {
    const done = run(initBatch<number>(seeds.slice(0, 1)), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-success", id: "a", result: 1 },
    ]);
    expect(done.phase).toBe("done");
    const reset = batchReducer(done, {
      type: "reset",
      items: [{ id: "x", name: "x.pdf" }],
    });
    expect(reset.phase).toBe("idle");
    expect(reset.items).toEqual([{ id: "x", name: "x.pdf", status: "queued" }]);
  });
});

describe("batchProgress", () => {
  it("counts by status and computes whole-percent completion", () => {
    const state = run(initBatch<number>(seeds), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-success", id: "a", result: 1 },
      { type: "item-start", id: "b" },
      { type: "item-error", id: "b", error: "x" },
    ]);
    const progress = batchProgress(state);
    expect(progress).toMatchObject({
      total: 3,
      done: 1,
      error: 1,
      queued: 1,
      running: 0,
      canceled: 0,
      settled: 2,
      pct: 67, // round(2/3 * 100)
    });
  });

  it("is 0% for an empty batch (no divide-by-zero)", () => {
    expect(batchProgress(initBatch<number>([])).pct).toBe(0);
  });
});

describe("batchReducer — skipped and noted files (batch plan P0b)", () => {
  it("a skipped file is settled, carries its reason, and is not a failure", () => {
    const final = run(initBatch<number>(seeds.slice(0, 2)), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-skip", id: "a", reason: "not locked" },
      { type: "item-start", id: "b" },
      { type: "item-success", id: "b", result: 2, note: "repaired by guess" },
    ]);
    expect(final.phase).toBe("done");
    expect(final.items[0]).toMatchObject({
      status: "skipped",
      reason: "not locked",
    });
    expect(final.items[1]).toMatchObject({
      status: "done",
      result: 2,
      note: "repaired by guess",
    });
    expect(batchProgress(final)).toMatchObject({
      skipped: 1,
      error: 0,
      done: 1,
      settled: 2,
      pct: 100,
    });
  });

  it("a skip of an item that is not running changes nothing", () => {
    const state = initBatch<number>(seeds);
    expect(
      batchReducer(state, { type: "item-skip", id: "a", reason: "x" }),
    ).toBe(state);
  });

  it("a success without a note leaves no note key", () => {
    const final = run(initBatch<number>(seeds.slice(0, 1)), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-success", id: "a", result: 1 },
    ]);
    expect("note" in final.items[0]!).toBe(false);
  });
});

describe("batchReducer — retry the failed files", () => {
  const failedTwo = () =>
    run(initBatch<number>(seeds), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-success", id: "a", result: 1 },
      { type: "item-start", id: "b" },
      { type: "item-error", id: "b", error: "bad" },
      { type: "item-start", id: "c" },
      { type: "item-error", id: "c", error: "worse" },
    ]);

  it("re-queues only the named failures, keeps every finished result, and goes idle", () => {
    const retried = batchReducer(failedTwo(), { type: "retry", ids: ["b"] });
    expect(retried.phase).toBe("idle");
    expect(retried.items.map((i) => i.status)).toEqual([
      "done",
      "queued",
      "error",
    ]);
    expect(retried.items[0]!.result).toBe(1);
    expect(retried.items[1]!.error).toBeUndefined();
    // And a start runs it: the machine accepts the retried queue.
    const restarted = run(retried, [
      { type: "start" },
      { type: "item-start", id: "b" },
      { type: "item-success", id: "b", result: 2 },
    ]);
    expect(restarted.phase).toBe("done");
    expect(restarted.items.map((i) => i.result)).toEqual([1, 2, undefined]);
  });

  it("never re-queues a done or canceled row, and is a no-op while running", () => {
    const state = failedTwo();
    expect(batchReducer(state, { type: "retry", ids: ["a"] })).toBe(state);
    const running = run(initBatch<number>(seeds), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-error", id: "a", error: "x" },
    ]);
    expect(batchReducer(running, { type: "retry", ids: ["a"] })).toBe(running);
    const canceled = run(initBatch<number>(seeds), [
      { type: "start" },
      { type: "cancel" },
    ]);
    expect(batchReducer(canceled, { type: "retry", ids: ["a", "b"] })).toBe(
      canceled,
    );
  });

  it("a cancel during a retry cancels only what the retry queued", () => {
    const state = run(failedTwo(), [
      { type: "retry", ids: ["b", "c"] },
      { type: "start" },
      { type: "item-start", id: "b" },
      { type: "cancel" },
      { type: "item-success", id: "b", result: 2 },
    ]);
    expect(state.phase).toBe("canceled");
    expect(state.items.map((i) => i.status)).toEqual([
      "done",
      "done",
      "canceled",
    ]);
  });
});

describe("batchReducer — remove before Run", () => {
  it("takes the file out while idle", () => {
    const state = batchReducer(initBatch<number>(seeds), {
      type: "remove",
      id: "b",
    });
    expect(state.items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("does nothing once the batch has started, or for an unknown id", () => {
    const started = batchReducer(initBatch<number>(seeds), { type: "start" });
    expect(batchReducer(started, { type: "remove", id: "b" })).toBe(started);
    const idle = initBatch<number>(seeds);
    expect(batchReducer(idle, { type: "remove", id: "zzz" })).toBe(idle);
  });
});

/**
 * Batch plan P3: a rate limit PAUSES a worker batch. The file that was
 * refused goes back to the queue — it never failed, the hour ran out — and
 * the batch carries on from it at `resumeAt`. Compress and the browser
 * batches never dispatch these, so every test above is unchanged.
 */
describe("batchReducer — pause on a rate limit, and resume (batch plan P3)", () => {
  const RESUME_AT = 1_700_000_000_000;
  const midRun = () =>
    run(initBatch<number>(seeds), [
      { type: "start" },
      { type: "item-start", id: "a" },
      { type: "item-success", id: "a", result: 1 },
      { type: "item-start", id: "b" },
    ]);

  it("puts the running file back in the queue, never in error, and keeps the finished one", () => {
    const paused = batchReducer(midRun(), {
      type: "pause",
      resumeAt: RESUME_AT,
    });
    expect(paused.phase).toBe("paused");
    expect(paused.resumeAt).toBe(RESUME_AT);
    expect(paused.items.map((i) => i.status)).toEqual([
      "done",
      "queued",
      "queued",
    ]);
    expect(paused.items[0]!.result).toBe(1);
    expect(paused.items.some((i) => i.error !== undefined)).toBe(false);
    // Not settled: a paused batch has work left, and is not "done".
    expect(isBatchSettled(paused)).toBe(false);
    expect(batchProgress(paused).settled).toBe(1);
  });

  it("resumes into running with the same queue, and the paused file runs again", () => {
    const resumed = run(midRun(), [
      { type: "pause", resumeAt: RESUME_AT },
      { type: "resume" },
      { type: "item-start", id: "b" },
      { type: "item-success", id: "b", result: 2 },
      { type: "item-start", id: "c" },
      { type: "item-success", id: "c", result: 3 },
    ]);
    expect(resumed.phase).toBe("done");
    expect(resumed.resumeAt).toBeUndefined();
    expect(resumed.items.map((i) => i.result)).toEqual([1, 2, 3]);
  });

  it("a cancel while paused cancels every queued file, the paused one too", () => {
    const canceled = run(midRun(), [
      { type: "pause", resumeAt: RESUME_AT },
      { type: "cancel" },
    ]);
    expect(canceled.phase).toBe("canceled");
    expect(canceled.resumeAt).toBeUndefined();
    expect(canceled.items.map((i) => i.status)).toEqual([
      "done",
      "canceled",
      "canceled",
    ]);
  });

  it("no file starts while paused, and pause/resume outside their phase change nothing", () => {
    const paused = batchReducer(midRun(), {
      type: "pause",
      resumeAt: RESUME_AT,
    });
    expect(batchReducer(paused, { type: "item-start", id: "b" })).toBe(paused);
    const idle = initBatch<number>(seeds);
    expect(batchReducer(idle, { type: "pause", resumeAt: RESUME_AT })).toBe(
      idle,
    );
    expect(batchReducer(idle, { type: "resume" })).toBe(idle);
    const running = midRun();
    expect(batchReducer(running, { type: "resume" })).toBe(running);
  });
});
