// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUEUE_PREFIX,
  REDIS_QUEUE_ENV,
  isRedisQueueSelected,
  parseRedisQueueConfig,
  resolveQueueCapability,
} from "./redis-config";

// Fake credentials only — nothing here is a real token.
const TOKEN = "AX_tokenEXAMPLEvalue000000000000000000000";
const validEnv = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: "https://us1-example-12345.upstash.io",
  [REDIS_QUEUE_ENV.restToken]: TOKEN,
  ...overrides,
});

describe("isRedisQueueSelected", () => {
  it("is true only for a recognized provider value (case-insensitive)", () => {
    expect(isRedisQueueSelected({})).toBe(false);
    expect(isRedisQueueSelected({ [REDIS_QUEUE_ENV.provider]: "sqs" })).toBe(false);
    expect(isRedisQueueSelected({ [REDIS_QUEUE_ENV.provider]: "redis" })).toBe(true);
    expect(isRedisQueueSelected({ [REDIS_QUEUE_ENV.provider]: "REDIS" })).toBe(true);
    expect(
      isRedisQueueSelected({ [REDIS_QUEUE_ENV.provider]: "  upstash-redis " }),
    ).toBe(true);
  });
});

describe("parseRedisQueueConfig — selection", () => {
  it("reports not-selected (no issues) when the provider flag is unset", () => {
    const result = parseRedisQueueConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.selected).toBe(false);
      expect(result.issues).toEqual([]);
    }
  });
});

describe("parseRedisQueueConfig — valid config", () => {
  it("parses a minimal config with sane, bounded defaults", () => {
    const result = parseRedisQueueConfig(validEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      baseUrl: "https://us1-example-12345.upstash.io",
      token: TOKEN,
      keyPrefix: DEFAULT_QUEUE_PREFIX,
      leaseCeilingMs: 300_000,
      maxAttempts: 5,
      jobTtlSeconds: 86_400,
    });
  });

  it("accepts the upstash-redis alias, an http origin, and bounded overrides", () => {
    const result = parseRedisQueueConfig(
      validEnv({
        [REDIS_QUEUE_ENV.provider]: "upstash-redis",
        [REDIS_QUEUE_ENV.restUrl]: "http://localhost:8080",
        [REDIS_QUEUE_ENV.keyPrefix]: ":tenant-a:",
        [REDIS_QUEUE_ENV.leaseSeconds]: "60",
        [REDIS_QUEUE_ENV.maxAttempts]: "3",
        [REDIS_QUEUE_ENV.jobTtlSeconds]: "3600",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      baseUrl: "http://localhost:8080",
      keyPrefix: "tenant-a", // surrounding colons stripped
      leaseCeilingMs: 60_000,
      maxAttempts: 3,
      jobTtlSeconds: 3600,
    });
  });
});

describe("parseRedisQueueConfig — missing required variables", () => {
  const required = [REDIS_QUEUE_ENV.restUrl, REDIS_QUEUE_ENV.restToken];
  for (const name of required) {
    it(`fails (selected) and names ${name} when it is absent`, () => {
      const result = parseRedisQueueConfig(validEnv({ [name]: undefined }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.selected).toBe(true);
      expect(result.issues.map((i) => i.field)).toContain(name);
    });

    it(`treats a blank ${name} as missing`, () => {
      const result = parseRedisQueueConfig(validEnv({ [name]: "   " }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.map((i) => i.field)).toContain(name);
    });
  }
});

describe("parseRedisQueueConfig — malformed values", () => {
  it("rejects a non-URL / non-http REST url, or one with a path or credentials", () => {
    for (const url of [
      "not-a-url",
      "ftp://example.com",
      "https://example.com/path",
      "https://user:pass@example.com",
      "https://example.com?x=1",
    ]) {
      const result = parseRedisQueueConfig(validEnv({ [REDIS_QUEUE_ENV.restUrl]: url }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((i) => i.field)).toContain(REDIS_QUEUE_ENV.restUrl);
    }
  });

  it("rejects a token containing whitespace", () => {
    const result = parseRedisQueueConfig(
      validEnv({ [REDIS_QUEUE_ENV.restToken]: "bad token" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.field)).toContain(REDIS_QUEUE_ENV.restToken);
  });

  it("rejects a traversal / illegal key prefix", () => {
    for (const prefix of ["../escape", "a/../b", "bad space", "has/slash"]) {
      const result = parseRedisQueueConfig(
        validEnv({ [REDIS_QUEUE_ENV.keyPrefix]: prefix }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((i) => i.field)).toContain(REDIS_QUEUE_ENV.keyPrefix);
    }
  });

  it("rejects out-of-range or non-integer lease/attempts/ttl", () => {
    const cases: Array<[string, string]> = [
      [REDIS_QUEUE_ENV.leaseSeconds, "4"], // below min (5)
      [REDIS_QUEUE_ENV.leaseSeconds, "999999"], // above max
      [REDIS_QUEUE_ENV.leaseSeconds, "12.5"],
      [REDIS_QUEUE_ENV.maxAttempts, "0"], // below min (1)
      [REDIS_QUEUE_ENV.maxAttempts, "99"], // above max (20)
      [REDIS_QUEUE_ENV.jobTtlSeconds, "60"], // below min (300)
      [REDIS_QUEUE_ENV.jobTtlSeconds, "99999999"], // above max (604800)
      [REDIS_QUEUE_ENV.jobTtlSeconds, "abc"],
    ];
    for (const [name, value] of cases) {
      const result = parseRedisQueueConfig(validEnv({ [name]: value }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((i) => i.field)).toContain(name);
    }
  });
});

describe("parseRedisQueueConfig — never leaks a secret value", () => {
  it("keeps issue messages free of the token value", () => {
    // A config where the token is present but something else is malformed.
    const result = parseRedisQueueConfig(
      validEnv({ [REDIS_QUEUE_ENV.restUrl]: "not-a-url" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain(TOKEN);
    // Every issue references a known variable NAME, nothing else.
    for (const issue of result.issues) {
      expect(Object.values(REDIS_QUEUE_ENV)).toContain(issue.field);
    }
  });
});

describe("resolveQueueCapability", () => {
  it("returns a ready, configured redis capability when fully configured", () => {
    const cap = resolveQueueCapability(validEnv());
    expect(cap).not.toBeNull();
    expect(cap).toMatchObject({
      provider: "redis",
      ready: true,
      configured: true,
      enqueue: true,
      status: true,
      cancel: true,
    });
  });

  it("returns null (fall back to honest not-configured) when unset or invalid", () => {
    expect(resolveQueueCapability({})).toBeNull();
    expect(
      resolveQueueCapability(validEnv({ [REDIS_QUEUE_ENV.restToken]: undefined })),
    ).toBeNull();
  });

  it("never exposes the endpoint, token, prefix, or a variable name", () => {
    const cap = resolveQueueCapability(
      validEnv({ [REDIS_QUEUE_ENV.keyPrefix]: "tenant-a" }),
    );
    const serialized = JSON.stringify(cap);
    for (const leak of [
      "upstash.io",
      "us1-example-12345",
      TOKEN,
      "tenant-a",
      "PDFXYZ_",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });
});
