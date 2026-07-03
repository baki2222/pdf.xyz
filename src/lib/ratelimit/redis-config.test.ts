// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATE_LIMIT_PREFIX,
  RATE_LIMIT_REDIS_ENV,
  parseRateLimitRedisConfig,
} from "./redis-config";
// The `failMode` env → resolver → config threading and the provider's open/closed
// degrade behavior are proven in `redis-failmode.test.ts`.

// Fake credentials only — nothing here is a real token.
const TOKEN = "RL_tokenEXAMPLEvalue00000000000000000000";
const validEnv = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://rl-example-98765.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: TOKEN,
  ...overrides,
});

describe("parseRateLimitRedisConfig — valid", () => {
  it("parses a minimal config with the default prefix", () => {
    const result = parseRateLimitRedisConfig(validEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      baseUrl: "https://rl-example-98765.upstash.io",
      token: TOKEN,
      keyPrefix: DEFAULT_RATE_LIMIT_PREFIX,
    });
  });

  it("accepts an http origin and a sanitized custom prefix", () => {
    const result = parseRateLimitRedisConfig(
      validEnv({
        [RATE_LIMIT_REDIS_ENV.restUrl]: "http://localhost:8080",
        [RATE_LIMIT_REDIS_ENV.keyPrefix]: ":edge-a:",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.baseUrl).toBe("http://localhost:8080");
    expect(result.config.keyPrefix).toBe("edge-a"); // surrounding colons stripped
  });
});

describe("parseRateLimitRedisConfig — not configured vs mis-configured", () => {
  it("reports not-provided (no issues) when NOTHING is set", () => {
    const result = parseRateLimitRedisConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.provided).toBe(false);
  });

  it("reports provided-but-incomplete when only one credential is set", () => {
    const result = parseRateLimitRedisConfig({
      [RATE_LIMIT_REDIS_ENV.restUrl]: "https://rl-example-98765.upstash.io",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.provided).toBe(true);
    expect(result.issues.map((i) => i.field)).toContain(RATE_LIMIT_REDIS_ENV.restToken);
  });
});

describe("parseRateLimitRedisConfig — malformed values (shared queue validators)", () => {
  it("rejects a non-http URL, or one with a path, query, or credentials", () => {
    for (const url of [
      "not-a-url",
      "ftp://example.com",
      "https://example.com/path",
      "https://user:pass@example.com",
      "https://example.com?x=1",
    ]) {
      const result = parseRateLimitRedisConfig(validEnv({ [RATE_LIMIT_REDIS_ENV.restUrl]: url }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((i) => i.field)).toContain(RATE_LIMIT_REDIS_ENV.restUrl);
    }
  });

  it("rejects a token with whitespace and a traversal key prefix", () => {
    const badToken = parseRateLimitRedisConfig(
      validEnv({ [RATE_LIMIT_REDIS_ENV.restToken]: "bad token" }),
    );
    expect(badToken.ok).toBe(false);
    if (!badToken.ok) {
      expect(badToken.issues.map((i) => i.field)).toContain(RATE_LIMIT_REDIS_ENV.restToken);
    }

    const badPrefix = parseRateLimitRedisConfig(
      validEnv({ [RATE_LIMIT_REDIS_ENV.keyPrefix]: "../escape" }),
    );
    expect(badPrefix.ok).toBe(false);
    if (!badPrefix.ok) {
      expect(badPrefix.issues.map((i) => i.field)).toContain(RATE_LIMIT_REDIS_ENV.keyPrefix);
    }
  });
});

describe("parseRateLimitRedisConfig — never leaks a secret value", () => {
  it("keeps issue messages free of the token value and names variables only", () => {
    const result = parseRateLimitRedisConfig(
      validEnv({ [RATE_LIMIT_REDIS_ENV.restUrl]: "not-a-url" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain(TOKEN);
    for (const issue of result.issues) {
      expect(Object.values(RATE_LIMIT_REDIS_ENV)).toContain(issue.field);
    }
  });
});
