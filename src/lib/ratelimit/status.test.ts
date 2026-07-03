// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_ENV } from "./config";
import { RATE_LIMIT_REDIS_ENV } from "./redis-config";
import { resolveRateLimitStatus, statusForDecision } from "./status";
import type { RateLimitDecision } from "./types";

const creds = (): Record<string, string> => ({
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://rl-example-98765.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "RL_tokenEXAMPLEvalue00000000000000000000",
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
});

describe("statusForDecision — the runtime fifth state", () => {
  const base = resolveRateLimitStatus(
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
    const s = statusForDecision(base, failOpen);
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
    expect(statusForDecision(base, enforced).code).toBe("remote-configured");
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
        for (const name of s.envVars) expect(name.startsWith("PDFXYZ_")).toBe(true);
      }
    }
  });
});
