import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/lib/jobs";
import {
  RATE_LIMITED_MESSAGE,
  rateLimitErrorResult,
  rateLimitHeaders,
  retryAfterHeaderValue,
} from "./response";
import type { RateLimitDecision } from "./types";

function deny(retryAfterSeconds: number): RateLimitDecision {
  return {
    allowed: false,
    action: "jobs.create",
    policyId: "jobs.create",
    provider: "local-memory",
    enforced: true,
    retryAfterSeconds,
    retryAfterBucket: "1-5m",
  };
}

describe("rateLimitErrorResult", () => {
  it("builds the typed 429 rate_limited envelope", () => {
    const result = rateLimitErrorResult(deny(42));
    expect(result.status).toBe(429);
    expect(result.body.error.code).toBe("rate_limited");
    expect(result.body.error.docs).toBeTruthy();
  });

  it("keeps the message content-free (no identity, no caller)", () => {
    expect(RATE_LIMITED_MESSAGE).not.toMatch(/ip|token|cookie|filename|user-agent/i);
  });
});

describe("retryAfterHeaderValue", () => {
  it("returns whole, non-negative delta-seconds", () => {
    expect(retryAfterHeaderValue(deny(42))).toBe("42");
    expect(retryAfterHeaderValue(deny(1.2))).toBe("2"); // rounded up
  });

  it("clamps a malformed wait to 0 rather than emit a negative header", () => {
    expect(retryAfterHeaderValue(deny(-9))).toBe("0");
    expect(retryAfterHeaderValue(deny(Number.NaN))).toBe("0");
  });
});

describe("rateLimitHeaders", () => {
  it("emits Retry-After plus the standard RateLimit-* trio", () => {
    const headers = rateLimitHeaders(deny(42));
    expect(headers["retry-after"]).toBe("42");
    // Limit comes from the policy (jobs.create → the published contract number).
    expect(headers["ratelimit-limit"]).toBe(String(RATE_LIMITS.jobsPerHourPerClient));
    // On a deny the budget is spent, so remaining is always 0 — no count leaks.
    expect(headers["ratelimit-remaining"]).toBe("0");
    expect(headers["ratelimit-reset"]).toBe("42");
  });

  it("keeps every value content-free (policy + clock only, never the caller)", () => {
    const serialized = JSON.stringify(rateLimitHeaders(deny(120)));
    expect(serialized).not.toMatch(/ip|token|cookie|filename|user-agent|c_/i);
  });
});
