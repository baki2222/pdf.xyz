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
