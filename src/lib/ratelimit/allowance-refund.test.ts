// @vitest-environment node
/**
 * The refund half of the AI character allowance — the primitives under the
 * route-level chain in `app/api/jobs/allowance-refund.chain.test.ts`.
 *
 * A refund is the inverse of a charge whose work never happened, and it has
 * three ways to do harm, each pinned here on EVERY backend (the in-memory core,
 * the Redis script's JS twin, and the guard's reservation handle):
 *
 *  1. creating a window — a refund with nothing to refund must write nothing;
 *  2. banking credit — the counter must never go below zero;
 *  3. moving the reset — a refund is not a new hit.
 *
 * Plus the guard's own rule: a handle releases at most once, and only a
 * reservation that actually SPENT has anything to release.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RedisFetch,
  RedisHttpResponse,
} from "@/lib/workers/queue/redis-client";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { RATE_LIMIT_ENV } from "./config";
import { policyFor } from "./policy";
import { createMemoryRateLimiter } from "./memory";
import {
  FIXED_WINDOW_SCRIPT,
  REFUND_SCRIPT,
  createRedisRateLimitProvider,
} from "./redis";
import {
  enforceAiCharacterAllowance,
  reserveAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "./guard";
import {
  clearRateLimitProviderForTests,
  registerRateLimitProvider,
  type RateLimitProvider,
} from "./provider";
import type { RateLimitPolicy } from "./types";

const T0 = 1_700_000_000_000;
const LOCAL = { [RATE_LIMIT_ENV.provider]: "local-memory" };
const REMOTE = { [RATE_LIMIT_ENV.provider]: "redis" };
const POLICY = policyFor("ai.characters");
const req = () => new Request("http://localhost/api/jobs", { method: "POST" });

beforeEach(() => {
  resetRateLimitGuardForTests();
  clearRateLimitProviderForTests();
});
afterEach(() => {
  resetRateLimitGuardForTests();
  clearRateLimitProviderForTests();
});

describe("in-memory core — refund", () => {
  it("gives back a charge within the live window", () => {
    const core = createMemoryRateLimiter();
    core.spend(POLICY, "k", T0, 40_000);
    core.refund(POLICY, "k", T0 + 5, 40_000);
    expect(core.peek(POLICY, "k", T0 + 6).used).toBe(0);
  });

  it("never creates a window", () => {
    const core = createMemoryRateLimiter();
    core.refund(POLICY, "k", T0, 40_000);
    expect(core.size()).toBe(0);
  });

  it("never goes below zero", () => {
    const core = createMemoryRateLimiter();
    core.spend(POLICY, "k", T0, 100);
    core.refund(POLICY, "k", T0, 40_000);
    expect(core.peek(POLICY, "k", T0).used).toBe(0);
    // And the next charge is charged in full: no credit was banked.
    core.spend(POLICY, "k", T0, 500);
    expect(core.peek(POLICY, "k", T0).used).toBe(500);
  });

  it("does not move the window's reset time", () => {
    const core = createMemoryRateLimiter();
    core.spend(POLICY, "k", T0, 1_000);
    const before = core.peek(POLICY, "k", T0 + 60_000).resetAfterSeconds;
    core.refund(POLICY, "k", T0 + 60_000, 500);
    expect(core.peek(POLICY, "k", T0 + 60_000).resetAfterSeconds).toBe(before);
  });

  it("is a no-op once the window has reset — the charge expired with it", () => {
    const core = createMemoryRateLimiter();
    core.spend(POLICY, "k", T0, 1_000);
    const after = T0 + POLICY.windowSeconds * 1000;
    core.refund(POLICY, "k", after, 1_000);
    expect(core.peek(POLICY, "k", after).used).toBe(0);
  });
});

/**
 * A Redis REST fake that runs JS twins of BOTH scripts on a clock, keyed by the
 * exact script text — so a provider that sent anything else fails loudly.
 */
function twinStore() {
  let clockMs = 0;
  const entries = new Map<string, { count: number; expireAtMs: number }>();
  const live = (key: string) => {
    const e = entries.get(key);
    if (e && e.expireAtMs <= clockMs) entries.delete(key);
    return entries.get(key);
  };
  const pttl = (key: string) => {
    const e = live(key);
    return e ? e.expireAtMs - clockMs : -2;
  };
  const fetchImpl: RedisFetch = async (_url, init) => {
    const args = JSON.parse(init.body) as string[];
    const [, script, , key] = args as [string, string, string, string];
    let result: [number, number];
    if (script === FIXED_WINDOW_SCRIPT) {
      const windowMs = Number(args[4]);
      const cost = Number(args[5]);
      const e = live(key);
      if (cost > 0) {
        if (!e)
          entries.set(key, { count: cost, expireAtMs: clockMs + windowMs });
        else e.count += cost;
      }
      result = [live(key)?.count ?? 0, pttl(key)];
    } else if (script === REFUND_SCRIPT) {
      const cost = Number(args[4]);
      const e = live(key);
      if (cost > 0 && e) e.count -= Math.min(cost, e.count);
      result = [live(key)?.count ?? 0, pttl(key)];
    } else {
      throw new Error("twinStore: unexpected script");
    }
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
    keys: () => [...entries.keys()].filter((k) => live(k) !== undefined),
    expiry: (key: string) => live(key)?.expireAtMs,
  };
}

const REDIS_CONFIG = {
  baseUrl: "https://rl-example-98765.upstash.io",
  token: "RL_tokenEXAMPLEvalue00000000000000000000",
  keyPrefix: "pdfxyz",
};

describe("redis provider — refund", () => {
  it("the script's text carries all three rules", () => {
    // The Lua is not executed in this suite; the twin above mirrors it. These
    // pin the lines the twin depends on, so the two cannot drift silently.
    const lines = REFUND_SCRIPT.split("\n").map((l) => l.trim());
    const firstWrite = lines.findIndex((l) => /DECRBY/.test(l));
    const guard = lines.findIndex((l) => /pttl <= 0/.test(l));
    expect(guard, "the no-live-window guard must exist").toBeGreaterThan(-1);
    expect(firstWrite, "DECRBY must exist").toBeGreaterThan(-1);
    expect(guard, "the guard must run before the only write").toBeLessThan(
      firstWrite,
    );
    expect(REFUND_SCRIPT).toMatch(/math\.min\(cost, count\)/);
    // No command that could create a key or move its TTL.
    expect(REFUND_SCRIPT).not.toMatch(/'(SET|SETEX|PEXPIRE|EXPIRE|INCRBY)'/);
  });

  it("gives back a charge, never below zero, never moving the TTL", async () => {
    const store = twinStore();
    const provider = createRedisRateLimitProvider(REDIS_CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    await provider.spend!(POLICY, "tok", 0, 1_000);
    const [key] = store.keys();
    const expiry = store.expiry(key!);
    store.advance(60_000);
    await provider.refund!(POLICY, "tok", 0, 40_000);
    expect((await provider.peek!(POLICY, "tok", 0)).used).toBe(0);
    expect(store.expiry(key!)).toBe(expiry);
  });

  it("writes nothing when there is no live window", async () => {
    const store = twinStore();
    const provider = createRedisRateLimitProvider(REDIS_CONFIG, {
      fetchImpl: store.fetchImpl,
    });
    await provider.refund!(POLICY, "tok", 0, 40_000);
    expect(store.keys()).toEqual([]);
    // Expired: the window took the charge with it.
    await provider.spend!(POLICY, "tok", 0, 1_000);
    store.advance(POLICY.windowSeconds * 1000);
    await provider.refund!(POLICY, "tok", 0, 1_000);
    expect(store.keys()).toEqual([]);
  });

  it("throws on a store error so the guard can report 'not refunded'", async () => {
    const provider = createRedisRateLimitProvider(REDIS_CONFIG, {
      fetchImpl: async () =>
        ({ ok: false, status: 500, json: async () => ({}) }) as never,
    });
    await expect(provider.refund!(POLICY, "tok", 0, 1)).rejects.toThrow();
  });
});

describe("guard — the reservation handle", () => {
  it("releases what it spent, exactly once", async () => {
    const r = await reserveAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      req(),
      LOCAL,
      T0,
    );
    expect(r.decision.allowed).toBe(true);
    expect(
      (await enforceAiCharacterAllowance(1, req(), LOCAL, T0)).allowed,
      "health: the day really is spent before the release",
    ).toBe(false);

    expect(await r.release(T0 + 1)).toBe(true);
    expect(await r.release(T0 + 2), "a second release is a no-op").toBe(false);

    // Exactly the day, not the day plus a second refund's worth of credit.
    const whole = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      req(),
      LOCAL,
      T0 + 3,
    );
    expect(whole.allowed).toBe(true);
    expect(
      (await enforceAiCharacterAllowance(1, req(), LOCAL, T0 + 4)).allowed,
    ).toBe(false);
  });

  it("a refused reservation has nothing to release", async () => {
    await enforceAiCharacterAllowance(AI_CHARACTER_ALLOWANCE, req(), LOCAL, T0);
    const refused = await reserveAiCharacterAllowance(1_000, req(), LOCAL, T0);
    expect(refused.decision.allowed).toBe(false);
    // If this refunded, a refused request would hand back characters that a
    // DIFFERENT, successful job paid for.
    expect(await refused.release(T0)).toBe(false);
    expect(
      (await enforceAiCharacterAllowance(1, req(), LOCAL, T0)).allowed,
    ).toBe(false);
  });

  it("an unenforced reservation has nothing to release", async () => {
    const off = await reserveAiCharacterAllowance(1_000, req(), {}, T0);
    expect(off.decision.enforced).toBe(false);
    expect(await off.release(T0)).toBe(false);
  });

  it("refunds a registered remote backend under the SAME token it charged", async () => {
    const core = createMemoryRateLimiter();
    const charged: string[] = [];
    const refunded: string[] = [];
    const provider: RateLimitProvider = {
      check: async (p: RateLimitPolicy, k, now) => core.check(p, k, now),
      peek: async (p, k, now) => core.peek(p, k, now),
      spend: async (p, k, now, cost) => {
        charged.push(k);
        core.spend(p, k, now, cost);
      },
      refund: async (p, k, now, cost) => {
        refunded.push(k);
        core.refund(p, k, now, cost);
      },
    };
    registerRateLimitProvider(provider);
    const r = await reserveAiCharacterAllowance(5_000, req(), REMOTE, T0);
    expect(r.decision.provider).toBe("remote");
    expect(await r.release(T0 + 1)).toBe(true);
    expect(refunded).toEqual(charged);
    expect(charged).toHaveLength(1);
    expect(core.peek(POLICY, charged[0]!, T0 + 2).used).toBe(0);
  });

  it("a remote backend without refund keeps the charge and says so", async () => {
    const core = createMemoryRateLimiter();
    registerRateLimitProvider({
      check: async (p, k, now) => core.check(p, k, now),
      peek: async (p, k, now) => core.peek(p, k, now),
      spend: async (p, k, now, cost) => core.spend(p, k, now, cost),
    });
    const r = await reserveAiCharacterAllowance(5_000, req(), REMOTE, T0);
    expect(r.decision.allowed).toBe(true);
    expect(await r.release(T0 + 1)).toBe(false);
  });
});
