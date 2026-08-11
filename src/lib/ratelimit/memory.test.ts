import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "./memory";
import type { RateLimitPolicy } from "./types";

/** A tiny, fast policy so a test trips the limit in a few calls. */
const policy: RateLimitPolicy = {
  id: "test.action",
  action: "jobs.create",
  limit: 3,
  windowSeconds: 60,
};

const T0 = 1_000_000; // an arbitrary fixed clock; the limiter never calls Date.now.

describe("createMemoryRateLimiter", () => {
  it("allows exactly `limit` hits per window, then denies", () => {
    const rl = createMemoryRateLimiter();
    for (let i = 0; i < policy.limit; i++) {
      expect(rl.check(policy, "client", T0).allowed).toBe(true);
    }
    const denied = rl.check(policy, "client", T0);
    expect(denied.allowed).toBe(false);
    // Same instant as the first hit ⇒ the full window remains.
    expect(denied.retryAfterSeconds).toBe(policy.windowSeconds);
  });

  it("reports a shrinking, always-positive retry-after as the window drains", () => {
    const rl = createMemoryRateLimiter();
    for (let i = 0; i < policy.limit; i++) rl.check(policy, "client", T0);
    // 59.5s into a 60s window ⇒ 0.5s left, rounded up and floored to 1.
    const denied = rl.check(policy, "client", T0 + 59_500);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
  });

  it("starts a fresh budget once the window has elapsed", () => {
    const rl = createMemoryRateLimiter();
    for (let i = 0; i < policy.limit; i++) rl.check(policy, "client", T0);
    expect(rl.check(policy, "client", T0).allowed).toBe(false);
    // One window later, the client is allowed again.
    expect(rl.check(policy, "client", T0 + 60_000).allowed).toBe(true);
  });

  it("isolates buckets by client key", () => {
    const rl = createMemoryRateLimiter();
    for (let i = 0; i < policy.limit; i++) rl.check(policy, "a", T0);
    expect(rl.check(policy, "a", T0).allowed).toBe(false);
    // A different client shares nothing with the throttled one.
    expect(rl.check(policy, "b", T0).allowed).toBe(true);
  });

  it("isolates budgets by policy id for the same client", () => {
    const other: RateLimitPolicy = { ...policy, id: "other.action" };
    const rl = createMemoryRateLimiter();
    for (let i = 0; i < policy.limit; i++) rl.check(policy, "client", T0);
    expect(rl.check(policy, "client", T0).allowed).toBe(false);
    // The other policy has its own window for the same client.
    expect(rl.check(other, "client", T0).allowed).toBe(true);
  });

  it("treats a non-positive limit as never-allow, honestly", () => {
    const closed: RateLimitPolicy = { ...policy, limit: 0 };
    const rl = createMemoryRateLimiter();
    const verdict = rl.check(closed, "client", T0);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(closed.windowSeconds);
  });

  it("bounds memory by sweeping expired windows", () => {
    const rl = createMemoryRateLimiter({
      sweepIntervalMs: 1_000,
      softBucketCap: 2,
    });
    // Fill several distinct clients inside one window.
    for (const k of ["a", "b", "c", "d", "e"]) rl.check(policy, k, T0);
    expect(rl.size()).toBeGreaterThan(0);
    // Long after every window has reset, a new hit triggers a sweep that drops
    // all the stale entries — the map cannot grow without bound.
    rl.check(policy, "fresh", T0 + 10 * 60_000);
    expect(rl.size()).toBe(1);
  });
});

describe("peek + spend — the two phases of a measured ceiling", () => {
  it("peek reports the verdict without spending anything", () => {
    const rl = createMemoryRateLimiter();
    // A hundred peeks must not exhaust a budget of three. If peek spent, merely
    // asking whether AI is affordable would make it unaffordable.
    for (let i = 0; i < 100; i++) {
      expect(rl.peek(policy, "client", T0).allowed).toBe(true);
    }
    expect(rl.check(policy, "client", T0).allowed).toBe(true);
  });

  it("peek does not create a window", () => {
    // The accounting day must start when something is SPENT, not when someone
    // asks. A peek that created a bucket would make the answer depend on having
    // asked, and would start a TTL nothing had paid into.
    const rl = createMemoryRateLimiter();
    rl.peek(policy, "client", T0);
    expect(rl.size()).toBe(0);
  });

  it("spend records past the limit, because the money is already gone", () => {
    // THE ASSERTION THAT MATTERS. `check` denies WITHOUT incrementing so a
    // flooded counter stays bounded; `spend` must do the opposite. It runs after
    // the provider has replied, so refusing to record an amount that overshoots
    // would hide exactly the call that broke the ceiling — accounting blind
    // toward free, for the third time in this feature area.
    const rl = createMemoryRateLimiter();
    rl.spend(policy, "client", T0, 2);
    expect(rl.peek(policy, "client", T0).allowed).toBe(true);

    // One call that costs far more than the whole budget.
    rl.spend(policy, "client", T0, 1_000);
    expect(
      rl.peek(policy, "client", T0).allowed,
      "the overshooting spend was not recorded — the ceiling cannot see the " +
        "call that broke it",
    ).toBe(false);

    // And a further spend still LANDS rather than being dropped for being over.
    // Asserted on `used`, not on `allowed`: once denied it stays denied, so a
    // boolean cannot tell a recorded overshoot from a dropped one. The first
    // version of this test asserted `allowed` and passed against an
    // implementation that silently refused to record every over-budget spend.
    const before = rl.peek(policy, "client", T0).used;
    rl.spend(policy, "client", T0, 5);
    const after = rl.peek(policy, "client", T0).used;
    expect(before, "the limiter does not report accumulated units").toBeTypeOf(
      "number",
    );
    expect(
      after,
      "an over-budget spend was dropped — the ceiling under-counts exactly the " +
        "calls that broke it",
    ).toBe((before ?? 0) + 5);
  });

  it("spend records nothing for a cost that is not a positive number", () => {
    // A provider that reported no usage must not take the ceiling down with it.
    // Absent is not zero, and it is certainly not "spend NaN".
    const rl = createMemoryRateLimiter();
    for (const cost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      rl.spend(policy, "client", T0, cost);
    }
    expect(rl.size(), "a non-spend created a window").toBe(0);
    expect(rl.peek(policy, "client", T0).allowed).toBe(true);
  });

  it("the two phases compose: spend to the budget, and the next peek refuses", () => {
    const rl = createMemoryRateLimiter();
    expect(rl.peek(policy, "client", T0).allowed).toBe(true);
    rl.spend(policy, "client", T0, policy.limit);
    const verdict = rl.peek(policy, "client", T0);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a spent window still resets on its own clock", () => {
    const rl = createMemoryRateLimiter();
    rl.spend(policy, "client", T0, 10_000);
    expect(rl.peek(policy, "client", T0).allowed).toBe(false);
    // Past the window: the ceiling is a DAILY bound, so it has to come back.
    const later = T0 + policy.windowSeconds * 1000 + 1;
    expect(rl.peek(policy, "client", later).allowed).toBe(true);
  });
});
