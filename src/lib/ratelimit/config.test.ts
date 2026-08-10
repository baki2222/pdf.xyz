import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_ENV,
  isTrustForwardedFor,
  resolveRateLimitConfig,
  resolveRateLimitProviderId,
} from "./config";

/** Build an env source without touching the real process env. */
function env(
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...overrides };
}

describe("resolveRateLimitProviderId", () => {
  it("defaults to disabled when unset, blank, or explicitly off", () => {
    expect(resolveRateLimitProviderId(env({}))).toBe("disabled");
    expect(
      resolveRateLimitProviderId(env({ [RATE_LIMIT_ENV.provider]: "" })),
    ).toBe("disabled");
    expect(
      resolveRateLimitProviderId(
        env({ [RATE_LIMIT_ENV.provider]: "disabled" }),
      ),
    ).toBe("disabled");
    expect(
      resolveRateLimitProviderId(env({ [RATE_LIMIT_ENV.provider]: "off" })),
    ).toBe("disabled");
  });

  it("selects the in-memory limiter on a recognized local value", () => {
    for (const value of [
      "local-memory",
      "memory",
      "in-memory",
      "local",
      "LOCAL-MEMORY",
    ]) {
      expect(
        resolveRateLimitProviderId(env({ [RATE_LIMIT_ENV.provider]: value })),
      ).toBe("local-memory");
    }
  });

  it("maps any remote/edge provider name to the unimplemented seam (honest skip)", () => {
    for (const value of ["remote", "redis", "upstash-redis", "edge", "waf"]) {
      expect(
        resolveRateLimitProviderId(env({ [RATE_LIMIT_ENV.provider]: value })),
      ).toBe("remote-unimplemented");
    }
  });

  it("fails safe to disabled on an unrecognized value (never silently enforce)", () => {
    expect(
      resolveRateLimitProviderId(env({ [RATE_LIMIT_ENV.provider]: "bogus" })),
    ).toBe("disabled");
  });
});

describe("isTrustForwardedFor", () => {
  it("is off unless explicitly truthy", () => {
    expect(isTrustForwardedFor(env({}))).toBe(false);
    expect(
      isTrustForwardedFor(env({ [RATE_LIMIT_ENV.trustForwardedFor]: "false" })),
    ).toBe(false);
    for (const value of ["1", "true", "on", "yes", "enabled"]) {
      expect(
        isTrustForwardedFor(env({ [RATE_LIMIT_ENV.trustForwardedFor]: value })),
      ).toBe(true);
    }
  });
});

describe("resolveRateLimitConfig", () => {
  it("surfaces a name-only diagnostic for a mistyped provider, and stays disabled", () => {
    const config = resolveRateLimitConfig(
      env({ [RATE_LIMIT_ENV.provider]: "in-memroy" }),
    );
    expect(config.providerId).toBe("disabled");
    expect(config.issue?.field).toBe(RATE_LIMIT_ENV.provider);
    // The diagnostic names the variable, never the offending value.
    expect(config.issue?.message).not.toContain("in-memroy");
  });

  it("has no diagnostic for a recognized provider", () => {
    expect(
      resolveRateLimitConfig(env({ [RATE_LIMIT_ENV.provider]: "local-memory" }))
        .issue,
    ).toBeUndefined();
    expect(resolveRateLimitConfig(env({})).issue).toBeUndefined();
  });
});
