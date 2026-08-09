// @vitest-environment node
/**
 * The distributed limiter's **degrade policy** when the store is unreachable or
 * errors — an explicit, operator-chosen behavior the mission requires be both
 * selectable and tested:
 *
 *  - **fail-open (default).** The provider THROWS, so the guard fails OPEN (allow,
 *    `enforced: false`). A limiter outage can never take the public API down.
 *  - **fail-closed (opt-in via `PDFXYZ_RATE_LIMIT_FAIL_MODE=closed`).** The
 *    provider returns a deliberate DENY, so the guard answers `429` — shed load
 *    rather than serve unthrottled while the store is down.
 *
 * Both are proven at the provider level AND end-to-end through the guard, and the
 * fail mode is proven to parse from the environment into the config. Under no mode
 * does an errored backend fabricate an *allow* verdict from real store state.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RedisFetch } from "@/lib/workers/queue/redis-client";
import { RATE_LIMIT_ENV } from "./config";
import { policyFor } from "./policy";
import { createRedisRateLimitProvider } from "./redis";
import {
  RATE_LIMIT_REDIS_ENV,
  parseRateLimitRedisConfig,
  resolveRateLimitFailMode,
  type RateLimitRedisConfig,
} from "./redis-config";
import { enforceRateLimit, resetRateLimitGuardForTests } from "./guard";
import { clearRateLimitProviderForTests, registerRateLimitProvider } from "./provider";

const BASE: RateLimitRedisConfig = {
  baseUrl: "https://rl-example-98765.upstash.io",
  token: "RL_tokenEXAMPLEvalue00000000000000000000",
  keyPrefix: "pdfxyz",
};

/** A transport that always fails at the network layer (store unreachable). */
const downFetch: RedisFetch = async () => {
  throw new Error("ECONNREFUSED");
};

const creds = (): Record<string, string> => ({
  [RATE_LIMIT_REDIS_ENV.restUrl]: BASE.baseUrl,
  [RATE_LIMIT_REDIS_ENV.restToken]: BASE.token,
});

describe("resolveRateLimitFailMode — parsing", () => {
  it("defaults to open when unset or unrecognized", () => {
    expect(resolveRateLimitFailMode({})).toBe("open");
    expect(resolveRateLimitFailMode({ [RATE_LIMIT_REDIS_ENV.failMode]: "banana" })).toBe("open");
    expect(resolveRateLimitFailMode({ [RATE_LIMIT_REDIS_ENV.failMode]: "open" })).toBe("open");
  });

  it("selects closed for the recognized fail-closed values", () => {
    for (const value of ["closed", "close", "deny", "DENIED"]) {
      expect(resolveRateLimitFailMode({ [RATE_LIMIT_REDIS_ENV.failMode]: value })).toBe("closed");
    }
  });

  it("threads the fail mode into the parsed config", () => {
    const open = parseRateLimitRedisConfig(creds());
    expect(open.ok && open.config.failMode).toBe("open");
    const closed = parseRateLimitRedisConfig({
      ...creds(),
      [RATE_LIMIT_REDIS_ENV.failMode]: "closed",
    });
    expect(closed.ok && closed.config.failMode).toBe("closed");
  });
});

describe("provider degrade behavior on a store error", () => {
  const policy = policyFor("jobs.create");

  it("fail-open (default): THROWS so the guard can fail open", async () => {
    const provider = createRedisRateLimitProvider(BASE, { fetchImpl: downFetch });
    await expect(provider.check(policy, "shared", 0)).rejects.toThrow();
  });

  it("fail-open (explicit): THROWS", async () => {
    const provider = createRedisRateLimitProvider(
      { ...BASE, failMode: "open" },
      { fetchImpl: downFetch },
    );
    await expect(provider.check(policy, "shared", 0)).rejects.toThrow();
  });

  it("fail-closed: returns a deliberate DENY (no throw), retry-after = the window", async () => {
    const provider = createRedisRateLimitProvider(
      { ...BASE, failMode: "closed" },
      { fetchImpl: downFetch },
    );
    const verdict = await provider.check(policy, "shared", 0);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(policy.windowSeconds);
  });
});

// --------------------------------------------------------------------------- //
// End-to-end through the guard the routes actually call.
// --------------------------------------------------------------------------- //
function req(): Request {
  return new Request("http://localhost/api/jobs", { method: "POST" });
}
function clear(): void {
  resetRateLimitGuardForTests();
  clearRateLimitProviderForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  delete process.env[RATE_LIMIT_ENV.trustForwardedFor];
}
beforeEach(clear);
afterEach(clear);

describe("guard degrade behavior with a down store", () => {
  it("fails OPEN (unenforced allow) in the default mode", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    registerRateLimitProvider(createRedisRateLimitProvider(BASE, { fetchImpl: downFetch }));

    const decision = await enforceRateLimit("jobs.create", req());
    expect(decision.allowed).toBe(true);
    expect(decision.enforced).toBe(false);
    // Never faked as `remote` — but no longer flattened into `disabled` either.
    // A store that is DOWN and a limiter that is OFF are the same to a user and
    // opposite to an operator: one is an incident, the other is a decision. This
    // assertion used to hide that difference, which is why an outage looked like
    // a configuration choice for as long as anyone cared to look.
    expect(decision.provider).toBe("remote-error");
  });

  it("fails CLOSED (enforced 429) when configured fail-closed", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    registerRateLimitProvider(
      createRedisRateLimitProvider({ ...BASE, failMode: "closed" }, { fetchImpl: downFetch }),
    );

    const decision = await enforceRateLimit("jobs.create", req());
    expect(decision.allowed).toBe(false);
    expect(decision.enforced).toBe(true);
    expect(decision.provider).toBe("remote");
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });
});
