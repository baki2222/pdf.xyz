// @vitest-environment node
/**
 * Deeper behavioral coverage for the distributed limiter that the primary
 * `redis.test.ts` leaves open because its inline fake runs on a FIXED clock:
 *
 *  - **Window reset / bounded TTL.** Once the window's TTL elapses a fresh budget
 *    begins, and the underlying key self-expires — so a flood of distinct clients
 *    can never grow the keyspace without bound. Exercised with a clock-advancing
 *    fake that faithfully implements INCR + first-hit PEXPIRE + PTTL, so the store
 *    behaves like real Redis TTL without a network.
 *  - **Fixed window (no slide).** The TTL is stamped exactly once, on the
 *    counter's creation, so a mid-window hit does NOT extend the window — the
 *    deny's retry-after counts down toward a fixed reset.
 *  - **Atomicity under concurrency.** Firing a burst of checks concurrently admits
 *    EXACTLY the limit and never one more, because each check is a single atomic
 *    `EVAL` (the fake runs the twin to completion with no interleaving, matching
 *    Redis's script atomicity). A race-prone get-then-set would over-admit here.
 *
 * The twin below is kept in lock-step with {@link FIXED_WINDOW_SCRIPT} by asserting
 * the provider only ever sends that exact script (see `redis.test.ts`); this file
 * pins the *semantics* the script encodes.
 */
import { describe, expect, it } from "vitest";
import type {
  RedisFetch,
  RedisHttpResponse,
} from "@/lib/workers/queue/redis-client";
import { policyFor } from "./policy";
import { FIXED_WINDOW_SCRIPT, createRedisRateLimitProvider } from "./redis";
import type { RateLimitRedisConfig } from "./redis-config";
import type { RateLimitPolicy } from "./types";

const CONFIG: RateLimitRedisConfig = {
  baseUrl: "https://rl-example-98765.upstash.io",
  token: "RL_tokenEXAMPLEvalue00000000000000000000",
  keyPrefix: "pdfxyz",
};

/** A small, precise policy so budgets are crisp and the tests stay fast. */
function policy(limit: number, windowSeconds = 60): RateLimitPolicy {
  return { id: "jobs.create", action: "jobs.create", limit, windowSeconds };
}

/**
 * A clock-advancing in-memory Redis that runs the fixed-window twin: INCR the
 * counter, stamp the window TTL only on creation (count === 1), and report PTTL.
 * `advance(ms)` moves the server clock so window expiry/reset is deterministic.
 */
function clockStore() {
  let clockMs = 0;
  let failing = false;
  const entries = new Map<
    string,
    { count: number; expireAtMs: number | null }
  >();

  const live = (key: string) => {
    const e = entries.get(key);
    if (!e) return undefined;
    if (e.expireAtMs !== null && e.expireAtMs <= clockMs) {
      entries.delete(key);
      return undefined;
    }
    return e;
  };
  const incr = (key: string): number => {
    const e = live(key);
    if (!e) {
      entries.set(key, { count: 1, expireAtMs: null });
      return 1;
    }
    e.count += 1;
    return e.count;
  };
  const pexpire = (key: string, ms: number): void => {
    const e = live(key);
    if (e) e.expireAtMs = clockMs + ms;
  };
  const pttl = (key: string): number => {
    const e = live(key);
    if (!e) return -2;
    if (e.expireAtMs === null) return -1;
    return e.expireAtMs - clockMs;
  };
  // The JS twin of FIXED_WINDOW_SCRIPT — same guard/effect order as the Lua.
  const runFixedWindow = (key: string, windowMs: number): [number, number] => {
    const count = incr(key);
    if (count === 1) pexpire(key, windowMs);
    return [count, pttl(key)];
  };

  const fetchImpl: RedisFetch = async (_url, init) => {
    if (failing) throw new Error("ECONNREFUSED");
    const args = JSON.parse(init.body) as string[];
    if (args[0] !== "EVAL" || args[1] !== FIXED_WINDOW_SCRIPT) {
      throw new Error("clockStore: unexpected command");
    }
    const result = runFixedWindow(args[3]!, Number(args[4]));
    return {
      ok: true,
      status: 200,
      json: async () => ({ result }),
    } satisfies RedisHttpResponse;
  };

  return {
    fetchImpl,
    advance: (ms: number) => {
      clockMs += ms;
    },
    setFailing: (v: boolean) => {
      failing = v;
    },
    liveKeys: () => [...entries.keys()].filter((k) => live(k) !== undefined),
  };
}

describe("redis limiter — window reset & bounded TTL", () => {
  it("begins a fresh budget once the window TTL elapses", async () => {
    const store = clockStore();
    const provider = createRedisRateLimitProvider(CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    const p = policy(3, 60);

    for (let i = 0; i < p.limit; i++) {
      expect((await provider.check(p, "shared", 0)).allowed).toBe(true);
    }
    expect((await provider.check(p, "shared", 0)).allowed).toBe(false);

    store.advance(p.windowSeconds * 1000 + 1); // past the window
    expect((await provider.check(p, "shared", 0)).allowed).toBe(true); // reset
  });

  it("keeps the window FIXED from the first hit — retry-after counts down, never slides", async () => {
    const store = clockStore();
    const provider = createRedisRateLimitProvider(CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    const p = policy(2, 60);

    for (let i = 0; i < p.limit; i++) await provider.check(p, "shared", 0);
    const first = await provider.check(p, "shared", 0);
    expect(first.allowed).toBe(false);

    store.advance(30_000); // 30s into the 60s window
    const later = await provider.check(p, "shared", 0);
    expect(later.allowed).toBe(false);
    // A fresh PEXPIRE would reset retry-after to ~60s; a fixed window shrinks it.
    expect(later.retryAfterSeconds).toBeLessThan(first.retryAfterSeconds);
  });

  it("self-expires every key, so a flood of distinct clients cannot grow the keyspace", async () => {
    const store = clockStore();
    const provider = createRedisRateLimitProvider(CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    const p = policy(1, 60);

    for (let i = 0; i < 50; i++) await provider.check(p, `c_${i}`, 0);
    expect(store.liveKeys().length).toBe(50);

    store.advance(p.windowSeconds * 1000 + 1);
    expect(store.liveKeys().length).toBe(0); // all TTLs elapsed
  });
});

describe("redis limiter — atomic under concurrency", () => {
  it("admits EXACTLY the limit under a concurrent burst (never over-admits)", async () => {
    const store = clockStore();
    const provider = createRedisRateLimitProvider(CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    const p = policy(5, 60);

    const burst = await Promise.all(
      Array.from({ length: p.limit + 25 }, () =>
        provider.check(p, "shared", 0),
      ),
    );
    expect(burst.filter((v) => v.allowed).length).toBe(p.limit);
    expect(burst.filter((v) => !v.allowed).length).toBe(25);
  });

  it("keeps concurrent buckets independent", async () => {
    const store = clockStore();
    const provider = createRedisRateLimitProvider(CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    const p = policy(4, 60);

    const mixed = await Promise.all([
      ...Array.from({ length: p.limit + 3 }, () =>
        provider.check(p, "c_aaa", 0),
      ),
      ...Array.from({ length: p.limit + 3 }, () =>
        provider.check(p, "c_bbb", 0),
      ),
    ]);
    // Each of the two buckets admits exactly its own limit.
    expect(mixed.filter((v) => v.allowed).length).toBe(p.limit * 2);
  });
});

describe("redis limiter — retry-after honors the live TTL", () => {
  it("derives the deny retry-after from the store's remaining PTTL", async () => {
    const store = clockStore();
    const provider = createRedisRateLimitProvider(CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    const p = policyFor("jobs.status"); // a real per-minute policy

    for (let i = 0; i < p.limit; i++) await provider.check(p, "shared", 0);
    const denied = await provider.check(p, "shared", 0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(p.windowSeconds);
  });
});
