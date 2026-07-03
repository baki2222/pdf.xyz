// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit/config";
import { RATE_LIMIT_REDIS_ENV } from "@/lib/ratelimit/redis-config";
import {
  clearRateLimitProviderForTests,
  getRateLimitProvider,
} from "@/lib/ratelimit/provider";

const CREDS = {
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://rl-example-98765.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "RL_tokenEXAMPLEvalue00000000000000000000",
};

function clearEnv(): void {
  clearRateLimitProviderForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  delete process.env[RATE_LIMIT_REDIS_ENV.restUrl];
  delete process.env[RATE_LIMIT_REDIS_ENV.restToken];
  delete process.env.NEXT_RUNTIME;
  vi.restoreAllMocks();
}
beforeEach(clearEnv);
afterEach(clearEnv);

describe("instrumentation.register — wires the distributed provider honestly", () => {
  it("registers NOTHING by default (guard stays disabled)", () => {
    register();
    expect(getRateLimitProvider()).toBeNull();
  });

  it("registers a provider when a remote backend is selected AND the store is valid", () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    Object.assign(process.env, CREDS);
    register();
    expect(getRateLimitProvider()).not.toBeNull();
  });

  it("registers NOTHING when a remote backend is selected but the store is missing", () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis"; // no creds
    register();
    expect(getRateLimitProvider()).toBeNull();
  });

  it("registers NOTHING for local-memory (it needs no registered backend)", () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    register();
    expect(getRateLimitProvider()).toBeNull();
  });

  it("is a no-op outside the Node.js server runtime", () => {
    process.env.NEXT_RUNTIME = "edge";
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    Object.assign(process.env, CREDS);
    register();
    expect(getRateLimitProvider()).toBeNull();
  });

  it("logs only the bounded status code — no endpoint, token, or value", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    Object.assign(process.env, CREDS);
    register();
    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("remote-configured");
    for (const leak of ["rl-example-98765", "upstash.io", CREDS[RATE_LIMIT_REDIS_ENV.restToken]]) {
      expect(line).not.toContain(leak);
    }
  });

  it("stays silent by default (disabled prints nothing)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    register();
    expect(info).not.toHaveBeenCalled();
  });

  it("never throws", () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    Object.assign(process.env, CREDS);
    expect(() => register()).not.toThrow();
  });
});
