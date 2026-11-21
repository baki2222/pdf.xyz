import { describe, expect, test } from "vitest";
import { KILL_HEADROOM_SHARE, killHeadroom, runBounded } from "./bounded";

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

  // The [kill-headroom] line (CI-flake audit lane 2): the kill binds every
  // child test and vitest's reporter cannot see it. Positive and negative
  // controls on fixed outcomes, so the threshold is pinned, not timed.
  test("a child past half its kill is a warning; under it, or a hang, is a plain line", () => {
    expect(KILL_HEADROOM_SHARE).toBe(0.5);
    const over = killHeadroom("x.child.ts a", { kind: "settled", ms: 60 }, 100);
    expect(over).toEqual({
      line: "[kill-headroom] x.child.ts a: settled in 60 ms of a 100 ms kill (60%)",
      warn: true,
    });
    expect(killHeadroom("x", { kind: "settled", ms: 40 }, 100).warn).toBe(
      false,
    );
    expect(killHeadroom("x", { kind: "memory", ms: 51 }, 100).warn).toBe(true);
    expect(killHeadroom("x", { kind: "hang", ms: 100 }, 100).warn).toBe(false);
  });
});
