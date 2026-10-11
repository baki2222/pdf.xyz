// @vitest-environment node
/**
 * A limiter that claims to be distributed must derive the same key everywhere.
 *
 * The defect was not an unstable salt. The salt did exactly what its docblock
 * promised — a per-process random, correct for a per-process limiter. The
 * defect is that adding the Upstash provider made a SECOND component depend on
 * a property the salt had never offered, and nothing connected them: the
 * posture went on reporting `distributed: true`, which the key derivation could
 * not support. Measured on production as four `c_` buckets from two machines,
 * with every cold start rotating again.
 *
 * So the load-bearing test here is (b): `distributed` and cross-instance key
 * stability cannot disagree. (a) is its unit-level companion — necessary, but
 * it pins the parameter, and the parameter was never the thing that broke.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discloseKeyingForTests } from "@/lib/ratelimit/config";
import { SHARED_BUCKET_TOKEN } from "./identity";
import { RATE_LIMIT_ENV, resolveRateLimitConfig } from "./config";
import { RATE_LIMIT_REDIS_ENV } from "./redis-config";
import { resolveRateLimitStatus } from "./status";

// Per-client keying is gated on the privacy disclosure (ratelimit/config.ts,
// 2026-10-10). These tests exercise it, so they run in the disclosed
// counterfactual; src/tests/setup.ts restores the real flag after each test.
beforeEach(() => {
  discloseKeyingForTests(true);
});

const headers = (address: string) =>
  new Headers({ "cf-connecting-ip": address });

/** A deployment that has done everything required to enforce per client. */
const PER_CLIENT: Record<string, string> = {
  [RATE_LIMIT_ENV.provider]: "redis",
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://example-store.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "A".repeat(48),
  [RATE_LIMIT_ENV.trustForwardedFor]: "true",
  [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
  [RATE_LIMIT_ENV.keySalt]: "a-shared-secret-set-on-every-instance",
};

/**
 * Load `identity` as a genuinely separate module instance, the way a second
 * serverless instance would. A module-level cache cannot survive this, which is
 * the whole point: the old `randomBytes` salt lived in exactly such a cache.
 */
async function freshIdentity() {
  vi.resetModules();
  return (await import("./identity")) as typeof import("./identity");
}

describe("(b) the distributed claim and the key derivation cannot disagree", () => {
  it("derives the same bucket on two independent instances when it claims distributed", async () => {
    const status = resolveRateLimitStatus(PER_CLIENT);
    expect(
      status.distributed,
      "precondition: this environment claims a distributed limiter",
    ).toBe(true);
    expect(status.code).toBe("remote-configured");

    const config = resolveRateLimitConfig(PER_CLIENT);
    const instanceA = await freshIdentity();
    const instanceB = await freshIdentity();

    const a = instanceA.deriveClientToken(headers("203.0.113.7"), config);
    const b = instanceB.deriveClientToken(headers("203.0.113.7"), config);

    expect(a).not.toBe(SHARED_BUCKET_TOKEN);
    expect(
      b,
      "two instances derived DIFFERENT buckets for the same caller while the " +
        "posture claimed `distributed: true` — every instance would count that " +
        "caller separately, which is not a weaker limit but effectively none",
    ).toBe(a);
  });

  it("still separates two different callers", async () => {
    const config = resolveRateLimitConfig(PER_CLIENT);
    const instance = await freshIdentity();
    const a = instance.deriveClientToken(headers("203.0.113.7"), config);
    const b = instance.deriveClientToken(headers("198.51.100.42"), config);
    expect(a).not.toBe(b);
    // Content-free by construction: the address never appears in the token.
    expect(a).not.toContain("203.0.113.7");
  });
});

describe("(a) the salt comes from configuration, not from boot", () => {
  it("is stable across instances", async () => {
    const config = resolveRateLimitConfig(PER_CLIENT);
    const first = (await freshIdentity()).deriveClientToken(
      headers("203.0.113.7"),
      config,
    );
    const second = (await freshIdentity()).deriveClientToken(
      headers("203.0.113.7"),
      config,
    );
    expect(second).toBe(first);
  });

  it("changes the buckets when the operator rotates it", async () => {
    // Rotation is a deliberate action with a known blast radius: one window of
    // counters. That is the correct shape for a security parameter — unlike the
    // old per-process random, which rotated on every cold start.
    const rotated = resolveRateLimitConfig({
      ...PER_CLIENT,
      [RATE_LIMIT_ENV.keySalt]: "a-different-secret",
    });
    const config = resolveRateLimitConfig(PER_CLIENT);
    const instance = await freshIdentity();
    expect(
      instance.deriveClientToken(headers("203.0.113.7"), rotated),
    ).not.toBe(instance.deriveClientToken(headers("203.0.113.7"), config));
  });
});

describe("the combination an operator reaches by setting one variable", () => {
  const FLAG_ON_SALT_UNSET: Record<string, string> = {
    [RATE_LIMIT_ENV.provider]: "redis",
    [RATE_LIMIT_REDIS_ENV.restUrl]: "https://example-store.upstash.io",
    [RATE_LIMIT_REDIS_ENV.restToken]: "A".repeat(48),
    [RATE_LIMIT_ENV.trustForwardedFor]: "true",
    [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
    // NO keySalt, deliberately — that is the entire subject of this block. A
    // blanket "add the salt to every trusted fixture" sweep put one here and
    // both assertions below went green against nothing.
  };

  it("falls back to the shared bucket rather than keying per instance", async () => {
    // The dangerous path: trust granted, no shared secret. Salting locally here
    // would reproduce the production defect exactly, and silently.
    const config = resolveRateLimitConfig(FLAG_ON_SALT_UNSET);
    const instance = await freshIdentity();
    expect(
      instance.deriveClientToken(headers("203.0.113.7"), config),
      "with no shared salt the limiter must refuse to key per client",
    ).toBe(SHARED_BUCKET_TOKEN);
  });

  it("SAYS SO — the posture reports remote-configured-shared, not remote-configured", () => {
    // Tested explicitly rather than inferred from the code, because a fallback
    // is most likely to be wrong on exactly the path an operator reaches by
    // setting one variable and not the other.
    const status = resolveRateLimitStatus(FLAG_ON_SALT_UNSET);
    expect(status.code).toBe("remote-configured-shared");
    expect(status.detail).toMatch(/one shared bucket/i);
    expect(status.envVars).toContain(RATE_LIMIT_ENV.keySalt);
  });
});
