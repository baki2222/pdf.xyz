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
