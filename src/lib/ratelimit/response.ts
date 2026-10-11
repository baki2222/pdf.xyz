/**
 * The pure mapping from a denied {@link RateLimitDecision} to the app's standard
 * typed error envelope — reusing the existing `rate_limited` → 429 code so the
 * guard adds no new response shape.
 *
 * The body stays deliberately generic and content-free: it never names the caller
 * or how they were identified, and it never quotes a header, path, or body value.
 * The precise wait goes in the `Retry-After` HTTP header (standard delta-seconds),
 * which is derived purely from the policy window and the clock and so leaks nothing.
 *
 * Node-free: it composes only `apiError` from `@/lib/jobs`, so a route can build
 * the 429 without pulling the node identity/guard layer, and it is unit-testable
 * on its own.
 */

import { apiError, type ApiError, type ApiResult } from "@/lib/jobs";
import type { RateLimitDecision } from "./types";
import { policyFor } from "./policy";
import {
  AI_ALLOWANCE_ACTION,
  AI_ALLOWANCE_USED_MESSAGE,
} from "@/lib/jobs/ai-allowance";

/**
 * Client-facing 429 message. Generic by design; names no caller and no
 * identity. Written for the PERSON reading a tool panel, which is where it
 * lands: it used to tell them to "retry after the interval in the
 * Retry-After header. See docs/SECURITY.md." The wait is still in that
 * header, for API clients, and the browser clients now read it and say it in
 * words (`@/lib/workers/read-error`).
 *
 * It said "Too many requests from this connection" until 2026-10-10, while
 * the limiter counted every visitor in one shared bucket (production read
 * `remote-configured-shared`). It names no scope now: true however the
 * limiter keys, and `ratelimit/keying-disclosure.test.tsx` reads it for one.
 */
export const RATE_LIMITED_MESSAGE =
  "Too many requests right now. Please wait a little and try again.";

/**
 * The AI-allowance refusal names the true reason. A user who hits the free
 * daily allowance has not found a degraded service or a generic flood
 * throttle — they have used the 3 runs the product gives away — and telling
 * them anything vaguer is the "service unavailable" lie the owner ruled out.
 * Derived from the policy constant so the numbers census owns the figure.
 */
// The words live in `@/lib/jobs/ai-allowance`, sharing a clause with the
// offer rather than being a second sentence about the same fact. Re-exported
// so callers of this module are unaffected.
export { AI_ALLOWANCE_USED_MESSAGE };

/** Build the typed 429 error result for a denied decision. */
export function rateLimitErrorResult(
  decision: RateLimitDecision,
): ApiResult<ApiError> {
  return apiError(
    "rate_limited",
    // Compared against the constant the GUARD uses, never a literal repeated
    // here. The literal is what went stale: the allowance moved to a new action
    // and this line went on answering about the old one.
    decision.action === AI_ALLOWANCE_ACTION
      ? AI_ALLOWANCE_USED_MESSAGE
      : RATE_LIMITED_MESSAGE,
  );
}

/**
 * The `Retry-After` header value (whole delta-seconds, never negative) for a
 * denied decision. A denied decision always carries a positive wait; this clamps
 * defensively so a malformed value can never emit a negative header.
 */
export function retryAfterHeaderValue(decision: RateLimitDecision): string {
  const seconds = Number.isFinite(decision.retryAfterSeconds)
    ? Math.max(0, Math.ceil(decision.retryAfterSeconds))
    : 0;
  return String(seconds);
}

/**
 * The full set of rate-limit headers for a denied decision: the standard
 * `Retry-After` plus the widely-deployed `RateLimit-*` trio so a well-behaved
 * client can self-throttle without guessing.
 *
 * Every value is content-free — derived only from the policy and the decision's
 * own retry-after, never from the caller. On a deny `RateLimit-Remaining` is always
 * `0` (the budget is spent), so no per-caller count is ever revealed. Header names
 * are lower-cased for the WHATWG `Headers`/`Response` init the app uses.
 */
export function rateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  const retryAfter = retryAfterHeaderValue(decision);
  return {
    "retry-after": retryAfter,
    "ratelimit-limit": String(policyFor(decision.action).limit),
    "ratelimit-remaining": "0",
    "ratelimit-reset": retryAfter,
  };
}
