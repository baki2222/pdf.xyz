// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RedisFetch,
  RedisHttpResponse,
} from "@/lib/workers/queue/redis-client";
import { policyFor } from "./policy";
import { RATE_LIMIT_ENV } from "./config";
import {
  FIXED_WINDOW_SCRIPT,
  createRedisRateLimitProvider,
  rateLimitBucketKey,
} from "./redis";
import type { RateLimitRedisConfig } from "./redis-config";
import { enforceRateLimit, resetRateLimitGuardForTests } from "./guard";
import {
  clearRateLimitProviderForTests,
  registerRateLimitProvider,
} from "./provider";
import { rateLimitErrorResult, rateLimitHeaders } from "./response";

const CONFIG: RateLimitRedisConfig = {
  baseUrl: "https://rl-example-98765.upstash.io",
  token: "RL_tokenEXAMPLEvalue00000000000000000000",
  keyPrefix: "pdfxyz",
};

/** Parsed EVAL command: `["EVAL", script, "1", key, windowMs]`. */
interface EvalCall {
  script: string;
  numKeys: string;
  key: string;
  windowMs: string;
}

/**
 * An in-memory fake of the Redis REST endpoint that faithfully runs the fixed-window
 * script (INCR + first-hit PEXPIRE + PTTL) so the provider can be exercised end-to-end
 * with no network. Records every command body so a test can prove the request shape and
 * that only opaque keys ever cross the wire.
 */
function fakeRedis(
  opts: { failWith?: "network" | "http500" | "commanderror" | "garbage" } = {},
) {
  const windows = new Map<string, { count: number; expireAt: number }>();
  const now = 5_000_000; // fixed server clock; test windows never expire mid-run
  const calls: EvalCall[] = [];
  const bodies: string[] = [];

  const fetchImpl: RedisFetch = async (_url, init) => {
    bodies.push(init.body);
    const args = JSON.parse(init.body) as string[];
    calls.push({
      script: args[1]!,
      numKeys: args[2]!,
      key: args[3]!,
      windowMs: args[4]!,
    });

    if (opts.failWith === "network") throw new Error("ECONNREFUSED");
    if (opts.failWith === "http500") {
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
      } satisfies RedisHttpResponse;
    }

    const key = args[3]!;
    const windowMs = Number(args[4]);
    const cur = windows.get(key);
    let count: number;
    let pttl: number;
    if (!cur || cur.expireAt <= now) {
      windows.set(key, { count: 1, expireAt: now + windowMs });
      count = 1;
      pttl = windowMs;
    } else {
      cur.count += 1;
      count = cur.count;
      pttl = cur.expireAt - now;
    }

    const body: unknown =
      opts.failWith === "commanderror"
        ? { error: "ERR something" }
        : opts.failWith === "garbage"
          ? { result: "not-an-array" }
          : { result: [count, pttl] };
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } satisfies RedisHttpResponse;
  };

  return { fetchImpl, calls, bodies };
}

describe("FIXED_WINDOW_SCRIPT — atomic + constant", () => {
  it("is a single EVAL script that INCRs, sets the window TTL once, and reads PTTL", () => {
    expect(FIXED_WINDOW_SCRIPT).toContain("INCR");
    expect(FIXED_WINDOW_SCRIPT).toContain("PEXPIRE");
    expect(FIXED_WINDOW_SCRIPT).toContain("PTTL");
    // Race-safe: the TTL is stamped only on the counter's creation (count == 1).
    expect(FIXED_WINDOW_SCRIPT).toMatch(/count\s*==\s*1/);
    // Constant: dynamic data travels in KEYS/ARGV, never interpolated into the text.
    expect(FIXED_WINDOW_SCRIPT).toContain("KEYS[1]");
    expect(FIXED_WINDOW_SCRIPT).toContain("ARGV[1]");
    expect(FIXED_WINDOW_SCRIPT).not.toMatch(/\$\{/);
  });
});

describe("createRedisRateLimitProvider — enforcement + request shape", () => {
  it("allows up to the policy limit, then denies with a retry-after from the window", async () => {
    const { fetchImpl } = fakeRedis();
    const provider = createRedisRateLimitProvider(CONFIG, { fetchImpl });
    const policy = policyFor("jobs.create");

    for (let i = 0; i < policy.limit; i++) {
      const v = await provider.check(policy, "shared", 0);
      expect(v.allowed).toBe(true);
      expect(v.retryAfterSeconds).toBe(0);
    }
    const denied = await provider.check(policy, "shared", 0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(policy.windowSeconds);
  });

  it("sends a single EVAL over the wire, keyed on an opaque namespaced bucket only", async () => {
    const { fetchImpl, calls, bodies } = fakeRedis();
    const provider = createRedisRateLimitProvider(CONFIG, { fetchImpl });
    const policy = policyFor("jobs.status");

    // An already-opaque salted-hash token (what the guard hands the provider).
    const opaque = "c_deadbeefdeadbeefdeadbeefdeadbeef";
    await provider.check(policy, opaque, 0);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.script).toBe(FIXED_WINDOW_SCRIPT);
    expect(call.numKeys).toBe("1");
    expect(call.key).toBe(rateLimitBucketKey("pdfxyz", "jobs.status", opaque));
    expect(call.key).toBe(
      "pdfxyz:ratelimit:jobs.status:c_deadbeefdeadbeefdeadbeefdeadbeef",
    );
    // The window is passed as ARGV, in milliseconds.
    expect(call.windowMs).toBe(String(policy.windowSeconds * 1000));
    // Nothing but the opaque token, policy id, and prefix ever appears in the body.
    expect(bodies[0]).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/); // no IPv4
  });

  it("separates buckets per opaque token", async () => {
    const { fetchImpl } = fakeRedis();
    const provider = createRedisRateLimitProvider(CONFIG, { fetchImpl });
    const policy = policyFor("jobs.create");
    for (let i = 0; i < policy.limit; i++)
      await provider.check(policy, "c_aaaa", 0);
    expect((await provider.check(policy, "c_aaaa", 0)).allowed).toBe(false);
    // A different bucket has its own, untouched budget.
    expect((await provider.check(policy, "c_bbbb", 0)).allowed).toBe(true);
  });

  it("denies without a round-trip when a policy limit is non-positive", async () => {
    const { fetchImpl, calls } = fakeRedis();
    const provider = createRedisRateLimitProvider(CONFIG, { fetchImpl });
    const v = await provider.check(
      { id: "x", action: "jobs.create", limit: 0, windowSeconds: 60 },
      "shared",
      0,
    );
    expect(v.allowed).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("createRedisRateLimitProvider — fails by THROWING on any backend error", () => {
  for (const failWith of [
    "network",
    "http500",
    "commanderror",
    "garbage",
  ] as const) {
    it(`throws (never fabricates a verdict) on ${failWith}`, async () => {
      const { fetchImpl } = fakeRedis({ failWith });
      const provider = createRedisRateLimitProvider(CONFIG, { fetchImpl });
      await expect(
        provider.check(policyFor("jobs.create"), "shared", 0),
      ).rejects.toThrow();
    });
  }

  it("keeps the token out of the thrown error", async () => {
    const { fetchImpl } = fakeRedis({ failWith: "http500" });
    const provider = createRedisRateLimitProvider(CONFIG, { fetchImpl });
    const err = await provider
      .check(policyFor("jobs.create"), "shared", 0)
      .catch((e) => e);
    expect(String(err)).not.toContain(CONFIG.token);
    expect(String(err)).not.toContain("upstash.io");
  });
  // The fail-open/fail-closed degrade policy (provider + guard + parsing) is proven in
  // `redis-failmode.test.ts`; the throw-on-error paths above are its default (open) mode.
});

// --------------------------------------------------------------------------- //
// End-to-end through the guard: a configured remote provider enforces, and the
// resulting 429 body/headers are content-free.
// --------------------------------------------------------------------------- //
function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/jobs", { method: "POST", headers });
}

function clear(): void {
  resetRateLimitGuardForTests();
  clearRateLimitProviderForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  delete process.env[RATE_LIMIT_ENV.trustForwardedFor];
}
beforeEach(clear);
afterEach(clear);

describe("guard ↔ Redis provider — enforced remote decisions, content-free 429", () => {
  it("delegates to the Redis provider and produces a content-free 429 when denied", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    const { fetchImpl, bodies } = fakeRedis();
    registerRateLimitProvider(
      createRedisRateLimitProvider(CONFIG, { fetchImpl }),
    );

    const policy = policyFor("jobs.create");
    const hostile = {
      "x-forwarded-for": "203.0.113.77",
      "user-agent": "EvilBot/9",
      cookie: "session=TOPSECRET",
    };
    let decision = await enforceRateLimit("jobs.create", req(hostile));
    for (let i = 0; i < policy.limit; i++) {
      decision = await enforceRateLimit("jobs.create", req(hostile));
    }

    // Enforced, distributed, denied.
    expect(decision.allowed).toBe(false);
    expect(decision.enforced).toBe(true);
    expect(decision.provider).toBe("remote");
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);

    // The decision, the 429 body, and the headers carry no identity.
    const wire = JSON.stringify({
      decision,
      body: rateLimitErrorResult(decision),
      headers: rateLimitHeaders(decision),
    });
    for (const leak of [
      "203.0.113.77",
      "EvilBot",
      "TOPSECRET",
      "upstash.io",
      CONFIG.token,
    ]) {
      expect(wire).not.toContain(leak);
    }
    // …and the store never saw the raw address either (only the salted-hash bucket).
    for (const body of bodies) expect(body).not.toContain("203.0.113.77");
  });
});
