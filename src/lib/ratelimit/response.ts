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

/** Client-facing 429 message. Generic by design; names no caller and no identity. */
export const RATE_LIMITED_MESSAGE =
  "Too many requests. This endpoint is rate-limited to protect the service; retry after the interval in the Retry-After header. See docs/SECURITY.md.";

/** Build the typed 429 error result for a denied decision. */
export function rateLimitErrorResult(
  _decision: RateLimitDecision,
): ApiResult<ApiError> {
  return apiError("rate_limited", RATE_LIMITED_MESSAGE);
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
