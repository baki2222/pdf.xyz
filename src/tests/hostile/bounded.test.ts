import { describe, expect, test } from "vitest";
import { runBounded } from "./bounded";

// Positive and negative controls for the hang runner every hostile regression
// test relies on. Without these, a runner that always reported "settled" (or
// one whose child never started) would pass every guard built on it.
const CHILD = "src/tests/hostile/bounded-control.child.ts";

describe("runBounded", () => {
  test("a child that reports settles with its value", async () => {
    const r = await runBounded(CHILD, ["settle"], 30_000);
    expect(r).toMatchObject({ kind: "settled", value: { ok: 1 } });
  }, 40_000);

  test("a synchronous infinite loop is killed and reported as a hang", async () => {
    const r = await runBounded(CHILD, ["hang"], 4_000);
    expect(r.kind).toBe("hang");
    expect(r.ms).toBeGreaterThanOrEqual(4_000);
  }, 40_000);

  test("a crash before reporting is internal, not settled", async () => {
    const r = await runBounded(CHILD, ["crash"], 30_000);
    expect(r.kind).toBe("internal");
  }, 40_000);

  test("running out of heap is reported as memory", async () => {
    const r = await runBounded(CHILD, ["memory"], 30_000, {
      maxOldSpaceMb: 64,
    });
    expect(r.kind).toBe("memory");
  }, 40_000);
});
