// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_ENV } from "./config";
import { RATE_LIMIT_REDIS_ENV } from "./redis-config";
import {
  createConfiguredRateLimitProvider,
  resolveRateLimitBackend,
} from "./factory";
import { policyFor } from "./policy";
import type { RedisFetch, RedisHttpResponse } from "@/lib/workers/queue/redis-client";

const creds = (): Record<string, string> => ({
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://rl-example-98765.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "RL_tokenEXAMPLEvalue00000000000000000000",
});

describe("resolveRateLimitBackend", () => {
  it("is `disabled` by default (nothing set)", () => {
    expect(resolveRateLimitBackend({}).kind).toBe("disabled");
  });

  it("is `local-memory` for the in-memory dev value", () => {
    const b = resolveRateLimitBackend({ [RATE_LIMIT_ENV.provider]: "local-memory" });
    expect(b.kind).toBe("local-memory");
    expect(b.redis).toBeNull();
  });

  it("is `redis` when a remote value is selected AND the store is valid", () => {
    const b = resolveRateLimitBackend({ [RATE_LIMIT_ENV.provider]: "redis", ...creds() });
    expect(b.kind).toBe("redis");
    expect(b.redis).not.toBeNull();
    expect(b.attempted).toBe(true);
  });

  it("is `unconfigured` (honest skip) when a remote value is selected but no store is wired", () => {
    const b = resolveRateLimitBackend({ [RATE_LIMIT_ENV.provider]: "upstash" });
    expect(b.kind).toBe("unconfigured");
    expect(b.redis).toBeNull();
    expect(b.attempted).toBe(false);
  });

  it("is `unconfigured` with named issues when the store is partially configured", () => {
    const b = resolveRateLimitBackend({
      [RATE_LIMIT_ENV.provider]: "redis",
      [RATE_LIMIT_REDIS_ENV.restUrl]: "https://rl-example-98765.upstash.io",
    });
    expect(b.kind).toBe("unconfigured");
    expect(b.attempted).toBe(true);
    expect(b.issues.map((i) => i.field)).toContain(RATE_LIMIT_REDIS_ENV.restToken);
  });
});

describe("createConfiguredRateLimitProvider", () => {
  it("returns null for disabled / local-memory / unconfigured", () => {
    expect(createConfiguredRateLimitProvider({})).toBeNull();
    expect(
      createConfiguredRateLimitProvider({ [RATE_LIMIT_ENV.provider]: "local-memory" }),
    ).toBeNull();
    expect(
      createConfiguredRateLimitProvider({ [RATE_LIMIT_ENV.provider]: "redis" }),
    ).toBeNull();
  });

  it("builds a working distributed provider when fully configured", async () => {
    const seenBodies: string[] = [];
    const fetchImpl: RedisFetch = async (_url, init) => {
      seenBodies.push(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: [1, 3_600_000] }),
      } satisfies RedisHttpResponse;
    };
    const provider = createConfiguredRateLimitProvider(
      { [RATE_LIMIT_ENV.provider]: "redis", ...creds() },
      { fetchImpl },
    );
    expect(provider).not.toBeNull();
    const verdict = await provider!.check(policyFor("jobs.create"), "shared", 0);
    expect(verdict.allowed).toBe(true);
    // It really talked to the (fake) store, keyed on the opaque bucket only.
    expect(seenBodies).toHaveLength(1);
    expect(seenBodies[0]).toContain("pdfxyz:ratelimit:jobs.create:shared");
  });
});
