// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { discloseKeyingForTests } from "@/lib/ratelimit/config";
import { RATE_LIMIT_ENV } from "./config";
import { RATE_LIMIT_REDIS_ENV } from "./redis-config";
import { resolveRateLimitStatus, statusForDecision } from "./status";
import type { RateLimitDecision } from "./types";

// Per-client keying is gated on the privacy disclosure (ratelimit/config.ts,
// 2026-10-10). These tests exercise it, so they run in the disclosed
// counterfactual; src/tests/setup.ts restores the real flag after each test.
beforeEach(() => {
  discloseKeyingForTests(true);
});

/**
 * A store AND trusted client identity — both are required to enforce per
 * client. Without the trust flag the same store enforces into one global
 * bucket, which is now its own code (`remote-configured-shared`); this helper
 * describes the working deployment.
 */
const creds = (): Record<string, string> => ({
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://rl-example-98765.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "RL_tokenEXAMPLEvalue00000000000000000000",
  [RATE_LIMIT_ENV.trustForwardedFor]: "true",
  [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
  [RATE_LIMIT_ENV.keySalt]: "test-shared-salt",
});

describe("resolveRateLimitStatus — the four static states", () => {
  it("disabled by default: not enforced, not distributed", () => {
    const s = resolveRateLimitStatus({}, { providerRegistered: false });
    expect(s.code).toBe("disabled");
    expect(s.enforced).toBe(false);
    expect(s.distributed).toBe(false);
  });

  it("local-memory: enforced but NOT distributed", () => {
    const s = resolveRateLimitStatus(
      { [RATE_LIMIT_ENV.provider]: "local-memory" },
      { providerRegistered: false },
    );
    expect(s.code).toBe("local-memory");
    expect(s.enforced).toBe(true);
    expect(s.distributed).toBe(false);
  });

  it("remote-missing-config when a remote provider is selected but no store is wired", () => {
    const s = resolveRateLimitStatus(
      { [RATE_LIMIT_ENV.provider]: "redis" },
      { providerRegistered: false },
    );
    expect(s.code).toBe("remote-missing-config");
    expect(s.enforced).toBe(false);
  });

  it("remote-missing-config when the store is valid but no provider is registered", () => {
    const s = resolveRateLimitStatus(
      { [RATE_LIMIT_ENV.provider]: "redis", ...creds() },
      { providerRegistered: false },
    );
    // Valid credentials, but nothing enforces in this process ⇒ honestly not-configured.
    expect(s.code).toBe("remote-missing-config");
    expect(s.enforced).toBe(false);
  });

  it("remote-configured only when a valid store IS wired AND a provider is registered", () => {
    const s = resolveRateLimitStatus(
      { [RATE_LIMIT_ENV.provider]: "redis", ...creds() },
      { providerRegistered: true },
    );
    expect(s.code).toBe("remote-configured");
    expect(s.enforced).toBe(true);
    expect(s.distributed).toBe(true);
  });

  it("trusted identity with NO client-IP header named is the shared bucket, and says which variable", () => {
    // Before 2026-09 trust + salt was enough: identity then GUESSED a header
    // from a fallback list, and every guess was client-writable. With no
    // header named, identity refuses to key per client — and the posture must
    // say so rather than report a per-client limiter that is not one.
    const { [RATE_LIMIT_ENV.clientIpHeader]: _unset, ...noHeader } = creds();
    void _unset;
    const s = resolveRateLimitStatus(
      { [RATE_LIMIT_ENV.provider]: "redis", ...noHeader },
      { providerRegistered: true },
    );
    expect(s.code).toBe("remote-configured-shared");
    expect(s.envVars).toContain(RATE_LIMIT_ENV.clientIpHeader);
    for (const bad of [
      "",
      "   ",
      "cf connecting ip",
      "x-forwarded-for,x-real-ip",
    ]) {
      const withBad = resolveRateLimitStatus(
        {
          [RATE_LIMIT_ENV.provider]: "redis",
          ...noHeader,
          [RATE_LIMIT_ENV.clientIpHeader]: bad,
        },
        { providerRegistered: true },
      );
      expect(withBad.code, JSON.stringify(bad)).toBe(
        "remote-configured-shared",
      );
    }
  });
});

describe("statusForDecision — the runtime fifth state", () => {
  // A function, not a value: computed at collection time it would run before
  // the beforeEach that discloses per-client keying, and read as shared.
  const base = () =>
    resolveRateLimitStatus(
      { [RATE_LIMIT_ENV.provider]: "redis", ...creds() },
      { providerRegistered: true },
    );

  it("flags remote-error-fail-open when a configured limiter comes back unenforced", () => {
    const failOpen: RateLimitDecision = {
      allowed: true,
      action: "jobs.create",
      policyId: "jobs.create",
      provider: "disabled", // the guard's fail-open attribution
      enforced: false,
      retryAfterSeconds: 0,
      retryAfterBucket: "none",
    };
    const s = statusForDecision(base(), failOpen);
    expect(s.code).toBe("remote-error-fail-open");
    expect(s.enforced).toBe(false);
    expect(s.distributed).toBe(true);
  });

  it("passes an enforced decision through unchanged (still remote-configured)", () => {
    const enforced: RateLimitDecision = {
      allowed: false,
      action: "jobs.create",
      policyId: "jobs.create",
      provider: "remote",
      enforced: true,
      retryAfterSeconds: 42,
      retryAfterBucket: "10-60s",
    };
    expect(statusForDecision(base(), enforced).code).toBe("remote-configured");
  });

  it("never upgrades a non-configured base (e.g. disabled)", () => {
    const disabled = resolveRateLimitStatus({}, { providerRegistered: false });
    const anyDecision: RateLimitDecision = {
      allowed: true,
      action: "jobs.create",
      policyId: "jobs.create",
      provider: "disabled",
      enforced: false,
      retryAfterSeconds: 0,
      retryAfterBucket: "none",
    };
    expect(statusForDecision(disabled, anyDecision).code).toBe("disabled");
  });
});

describe("rate-limit status never leaks a value — variable names only", () => {
  it("serializes no endpoint, token, or env value across all states", () => {
    const envs = [
      {},
      { [RATE_LIMIT_ENV.provider]: "local-memory" },
      { [RATE_LIMIT_ENV.provider]: "redis" },
      { [RATE_LIMIT_ENV.provider]: "redis", ...creds() },
    ];
    for (const env of envs) {
      for (const providerRegistered of [true, false]) {
        const s = resolveRateLimitStatus(env, { providerRegistered });
        const serialized = JSON.stringify(s);
        for (const leak of [
          "rl-example-98765",
          "upstash.io",
          "RL_tokenEXAMPLEvalue00000000000000000000",
        ]) {
          expect(serialized).not.toContain(leak);
        }
        // Any variable it names is a known PDFXYZ_* variable NAME (never a value).
        for (const name of s.envVars)
          expect(name.startsWith("PDFXYZ_")).toBe(true);
      }
    }
  });
});
