// @vitest-environment node
/**
 * Route-level proof that the distributed limiter throttles a real API route.
 *
 * Where `redis.test.ts` exercises the provider and the guard directly, this drives
 * the actual `POST /api/uploads` handler with a registered Redis provider (backed
 * by an in-memory fake — no network), spends the window budget, and asserts the
 * route answers a content-free `429` with a `Retry-After`. This is the full path a
 * production request travels: route → guard → Redis provider → store.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RedisFetch, RedisHttpResponse } from "@/lib/workers/queue/redis-client";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { POST } from "@/app/api/uploads/route";
import { RATE_LIMIT_ENV } from "./config";
import { policyFor } from "./policy";
import { createRedisRateLimitProvider } from "./redis";
import type { RateLimitRedisConfig } from "./redis-config";
import { enforceRateLimit, resetRateLimitGuardForTests } from "./guard";
import { clearRateLimitProviderForTests, registerRateLimitProvider } from "./provider";

const CONFIG: RateLimitRedisConfig = {
  baseUrl: "https://rl-example-98765.upstash.io",
  token: "RL_tokenEXAMPLEvalue00000000000000000000",
  keyPrefix: "pdfxyz",
};

/** A fixed-window fake store (fixed clock: a single burst never straddles a reset). */
function fakeStore() {
  const windows = new Map<string, number>();
  const bodies: string[] = [];
  const fetchImpl: RedisFetch = async (_url, init) => {
    bodies.push(init.body);
    const args = JSON.parse(init.body) as string[];
    const key = args[3]!;
    const windowMs = Number(args[4]);
    const count = (windows.get(key) ?? 0) + 1;
    windows.set(key, count);
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: [count, windowMs] }),
    } satisfies RedisHttpResponse;
  };
  return { fetchImpl, bodies };
}

function uploadRequest(): Request {
  return new Request("http://localhost/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool: "ocr-pdf",
      files: [{ filename: "scan.pdf", contentType: "application/pdf", bytes: 1024 }],
    }),
  });
}

function clear(): void {
  resetRateLimitGuardForTests();
  clearRateLimitProviderForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  delete process.env[RATE_LIMIT_ENV.trustForwardedFor];
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
}
beforeEach(clear);
afterEach(clear);

describe("POST /api/uploads — distributed (Redis) rate limiter", () => {
  it("returns a content-free 429 with Retry-After once the budget is spent", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    const { fetchImpl, bodies } = fakeStore();
    registerRateLimitProvider(createRedisRateLimitProvider(CONFIG, { fetchImpl }));

    // Pre-spend the shared budget cheaply through the same registered provider…
    const policy = policyFor("uploads.create");
    const bare = new Request("http://localhost/api/uploads", { method: "POST" });
    for (let i = 0; i < policy.limit; i++) await enforceRateLimit("uploads.create", bare);

    // …so this real route call is the one over the limit.
    const denied = await POST(uploadRequest());
    expect(denied.status).toBe(429);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(denied.headers.get("ratelimit-remaining")).toBe("0");

    const body = await denied.json();
    expect(body.error.code).toBe("rate_limited");
    // The 429 (body + headers) leaks no identity, endpoint, or token.
    const wire = JSON.stringify({ body, headers: [...denied.headers.entries()] });
    for (const leak of ["upstash.io", CONFIG.token, "scan.pdf"]) {
      expect(wire).not.toContain(leak);
    }
    // The store only ever saw opaque, namespaced keys.
    for (const b of bodies) expect(b).toContain("pdfxyz:ratelimit:uploads.create:");
  });

  it("lets a request under the budget through to its normal (503 not-configured) path", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    const { fetchImpl } = fakeStore();
    registerRateLimitProvider(createRedisRateLimitProvider(CONFIG, { fetchImpl }));

    const res = await POST(uploadRequest());
    // With no worker configured the upload honestly 503s — the limiter did not deny it.
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
  });
});
