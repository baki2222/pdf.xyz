import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/lib/jobs";
import {
  AI_ALLOWANCE_ACTION,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
} from "@/lib/jobs/ai-allowance";

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

  it("names the true reason when the AI allowance is used, derived from the constant", () => {
    // A refused AI run is not a degraded service and not a generic flood
    // throttle — the user spent the allowance. Saying anything vaguer is the
    // "service unavailable" lie the owner ruled out.
    /**
     * INVERTED, NOT DELETED — this test pinned a live defect.
     *
     * It hand-built a decision with `action: "ai.run"` and asserted the right
     * message came back. Perfectly correct, and about an action **no route
     * enforces**: `enforceAiCharacterAllowance` moved to `ai.characters` when
     * the allowance was re-denominated, while `rateLimitErrorResult` went on
     * choosing its message with a literal `=== "ai.run"`. So every real
     * refusal shipped the GENERIC message — "Too many requests ... see
     * docs/SECURITY.md" — and this test stayed green through all of it,
     * because it supplied by hand the one thing production no longer had.
     *
     * The action now comes from `AI_ALLOWANCE_ACTION`, the same constant the
     * guard uses, so the two cannot drift apart again. And
     * `ratelimit/allowance-probe.test.ts` drives the REAL route to a real
     * refusal and reads the message off the response — which is the check that
     * would have caught this, and the one that was missing.
     */
    const result = rateLimitErrorResult({
      ...deny(42),
      action: AI_ALLOWANCE_ACTION,
      policyId: AI_ALLOWANCE_ACTION,
    });
    // AMENDED TWICE BEFORE THAT, and the second is worth reading too.
    //
    // First: the allowance stopped being denominated in runs, because a run
    // stopped pricing a job once one job became up to thirty provider calls.
    //
    // Then: this asserted the BUCKET's size. The bucket is in worker-extracted
    // characters — a quantity nobody outside the codebase can measure — while
    // the sentence is read by someone holding a document. Deriving from a
    // constant is not enough on its own; it has to be the constant in the
    // reader's unit. The two differ by exactly the extractor headroom.
    expect(result.body.error.message).toContain(
      AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US"),
    );
    expect(result.body.error.message).toMatch(/free characters/i);
    expect(result.body.error.message).toMatch(/resets daily/i);
    // Every other action keeps the generic content-free message.
    expect(rateLimitErrorResult(deny(42)).body.error.message).toBe(
      RATE_LIMITED_MESSAGE,
    );
  });

  it("keeps the message content-free (no identity, no caller)", () => {
    expect(RATE_LIMITED_MESSAGE).not.toMatch(
      /ip|token|cookie|filename|user-agent/i,
    );
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
    expect(headers["ratelimit-limit"]).toBe(
      String(RATE_LIMITS.jobsPerHourPerClient),
    );
    // On a deny the budget is spent, so remaining is always 0 — no count leaks.
    expect(headers["ratelimit-remaining"]).toBe("0");
    expect(headers["ratelimit-reset"]).toBe("42");
  });

  it("keeps every value content-free (policy + clock only, never the caller)", () => {
    const serialized = JSON.stringify(rateLimitHeaders(deny(120)));
    expect(serialized).not.toMatch(/ip|token|cookie|filename|user-agent|c_/i);
  });
});
