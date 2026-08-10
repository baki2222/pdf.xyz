// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMIT_ENV } from "./config";
import { policyFor } from "./policy";
import { enforceRateLimit, resetRateLimitGuardForTests } from "./guard";
import {
  clearRateLimitProviderForTests,
  getRateLimitProvider,
  registerRateLimitProvider,
  type RateLimitProvider,
} from "./provider";
import type { RateLimitPolicy, RateLimiterVerdict } from "./types";

/**
 * A fake async provider — an in-process stand-in for a Redis/Upstash client. It
 * enforces a real fixed-window budget so the seam can be exercised end-to-end, and
 * it records every bucket key it is handed so a test can prove those keys are
 * opaque (never a raw identity). No network, no real store.
 */
function fakeProvider(): { provider: RateLimitProvider; seenKeys: string[] } {
  const counts = new Map<string, number>();
  const seenKeys: string[] = [];
  const provider: RateLimitProvider = {
    async check(
      policy: RateLimitPolicy,
      key: string,
      _nowMs: number,
    ): Promise<RateLimiterVerdict> {
      seenKeys.push(key);
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next <= policy.limit
        ? { allowed: true, retryAfterSeconds: 0 }
        : { allowed: false, retryAfterSeconds: policy.windowSeconds };
    },
  };
  return { provider, seenKeys };
}

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

describe("rate-limit provider seam", () => {
  it("registers and clears a backend", () => {
    expect(getRateLimitProvider()).toBeNull();
    const { provider } = fakeProvider();
    registerRateLimitProvider(provider);
    expect(getRateLimitProvider()).toBe(provider);
    clearRateLimitProviderForTests();
    expect(getRateLimitProvider()).toBeNull();
  });

  it("skips honestly when a remote provider is selected but none is registered", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    const decision = await enforceRateLimit("jobs.create", req());
    expect(decision.allowed).toBe(true);
    expect(decision.enforced).toBe(false);
    expect(decision.provider).toBe("remote-unimplemented");
  });

  it("delegates to a registered backend and reports enforced `remote` verdicts", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    const { provider } = fakeProvider();
    registerRateLimitProvider(provider);

    const policy = policyFor("jobs.create");
    for (let i = 0; i < policy.limit; i++) {
      const ok = await enforceRateLimit("jobs.create", req());
      expect(ok.allowed).toBe(true);
      expect(ok.enforced).toBe(true);
      expect(ok.provider).toBe("remote");
    }
    const denied = await enforceRateLimit("jobs.create", req());
    expect(denied.allowed).toBe(false);
    expect(denied.enforced).toBe(true);
    expect(denied.provider).toBe("remote");
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterBucket).not.toBe("none");
  });

  it("hands the backend only an opaque, address-free bucket token — even when trusted", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    const { provider, seenKeys } = fakeProvider();
    registerRateLimitProvider(provider);

    await enforceRateLimit(
      "jobs.create",
      req({ "x-forwarded-for": "203.0.113.9" }),
    );
    expect(seenKeys).toHaveLength(1);
    const key = seenKeys[0] ?? "";
    // The backend sees a salted hash prefixed `c_`, never the raw address.
    expect(key.startsWith("c_")).toBe(true);
    expect(key).not.toContain("203.0.113.9");
  });

  it("uses the shared bucket token when the forwarding header is untrusted (default)", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    const { provider, seenKeys } = fakeProvider();
    registerRateLimitProvider(provider);

    await enforceRateLimit(
      "jobs.create",
      req({ "x-forwarded-for": "203.0.113.9" }),
    );
    expect(seenKeys[0]).toBe("shared");
  });

  it("fails OPEN (allow, unenforced) when the backend throws", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    registerRateLimitProvider({
      async check(): Promise<RateLimiterVerdict> {
        throw new Error("backend unreachable");
      },
    });
    const decision = await enforceRateLimit("jobs.create", req());
    expect(decision.allowed).toBe(true);
    expect(decision.enforced).toBe(false);
    // Was `"disabled"`, which is what made this test part of the problem: it
    // asserted that a store outage is indistinguishable from the limiter being
    // switched off. Failing open is still right; reporting it as the deliberate
    // off-state was not, and it sent a debugging session down the wrong path.
    expect(decision.provider).toBe("remote-error");
  });

  it("never leaks the request identity into a remote decision", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    const { provider } = fakeProvider();
    registerRateLimitProvider(provider);

    const hostile = {
      "x-forwarded-for": "203.0.113.250",
      "user-agent": "EvilBot/6.6",
      cookie: "session=TOPSECRET",
    };
    const policy = policyFor("jobs.create");
    let decision = await enforceRateLimit("jobs.create", req(hostile));
    for (let i = 0; i < policy.limit; i++) {
      decision = await enforceRateLimit("jobs.create", req(hostile));
    }
    expect(decision.allowed).toBe(false);
    const serialized = JSON.stringify(decision);
    for (const leak of ["203.0.113.250", "EvilBot", "TOPSECRET"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("is ignored on the local-memory path (no delegation)", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    const { provider, seenKeys } = fakeProvider();
    registerRateLimitProvider(provider);

    const decision = await enforceRateLimit("jobs.create", req());
    expect(decision.provider).toBe("local-memory");
    // local-memory uses its own in-process core; the remote backend is untouched.
    expect(seenKeys).toHaveLength(0);
  });
});
