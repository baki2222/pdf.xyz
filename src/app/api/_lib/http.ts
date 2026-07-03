/**
 * Thin HTTP glue for the job API route handlers. The handlers stay declarative:
 * read + size-limit the JSON body here, run the pure validators/builders from
 * "@/lib/jobs", and serialize the resulting `{ status, body }` with `respond`.
 *
 * Returns plain web-standard `Response` objects (Next.js route handlers accept
 * them) so the routes carry no Next-only coupling and are trivially testable.
 */

import { apiError, type ApiError, type ApiResult, type ParseResult } from "@/lib/jobs";
import { JOB_LIMITS } from "@/lib/jobs";
import {
  rateLimitErrorResult,
  rateLimitHeaders,
  type RateLimitDecision,
} from "@/lib/ratelimit";

/**
 * Serialize an ApiResult to a JSON Response with privacy-safe caching headers.
 * `extraHeaders` is merged last for the rare response that needs one (e.g. a
 * `Retry-After` on a 429); it never overrides the no-store cache posture in a way
 * that could leak job metadata.
 */
export function respond(
  result: ApiResult<unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Job metadata is never cacheable; also blocks shared-cache leakage.
      "cache-control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

/**
 * The one place a route turns a denied rate-limit decision into a `429`: a typed,
 * content-free `rate_limited` JSON body plus the standard `Retry-After` and
 * `RateLimit-*` headers. Every header value is derived from the policy and the
 * decision's retry-after — never the caller — so nothing here can leak who was
 * limited.
 */
export function respondRateLimited(decision: RateLimitDecision): Response {
  return respond(rateLimitErrorResult(decision), rateLimitHeaders(decision));
}

function errorResult(
  ...args: Parameters<typeof apiError>
): { ok: false; error: ApiResult<ApiError> } {
  return { ok: false, error: apiError(...args) };
}

/**
 * Safely read a JSON request body with a strict size cap. Files are uploaded
 * out-of-band via pre-signed URLs, so request bodies only ever carry small
 * metadata; anything larger is rejected before parsing.
 */
export async function readJsonBody(
  request: Request,
): Promise<ParseResult<unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResult(
      "unsupported_media_type",
      "Content-Type must be application/json.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > JOB_LIMITS.maxRequestBodyBytes
  ) {
    return errorResult(
      "payload_too_large",
      `Request body exceeds the ${JOB_LIMITS.maxRequestBodyBytes}-byte limit.`,
    );
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return errorResult("invalid_request", "Could not read the request body.");
  }

  if (new TextEncoder().encode(text).length > JOB_LIMITS.maxRequestBodyBytes) {
    return errorResult(
      "payload_too_large",
      `Request body exceeds the ${JOB_LIMITS.maxRequestBodyBytes}-byte limit.`,
    );
  }

  if (text.trim().length === 0) return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return errorResult("invalid_request", "Request body must be valid JSON.");
  }
}
