/**
 * Thin HTTP glue for the job API route handlers. The handlers stay declarative:
 * read + size-limit the JSON body here, run the pure validators/builders from
 * "@/lib/jobs", and serialize the resulting `{ status, body }` with `respond`.
 *
 * Returns plain web-standard `Response` objects (Next.js route handlers accept
 * them) so the routes carry no Next-only coupling and are trivially testable.
 */

import {
  apiError,
  type ApiError,
  type ApiResult,
  type ParseResult,
} from "@/lib/jobs";
import { JOB_LIMITS } from "@/lib/jobs";
import { formatByteLimit } from "@/lib/uploads/byte-limit";
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

/** `Sec-Fetch-Site` values that are not a cross-site browser request. */
const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * Refuse a state-changing request that a browser sent on behalf of ANOTHER
 * site. Call it FIRST in every POST/PUT/PATCH/DELETE handler — before
 * `enforceRateLimit`, because the rate-limit charge is exactly what a hostile
 * page would be spending: its visitors' uploads, jobs and daily AI runs.
 *
 * Why this is needed at all: a page anywhere can make its visitor's browser
 * send a CORS "simple" POST with no preflight (`mode: "no-cors"`, a safelisted
 * Content-Type). `Sec-Fetch-Site` — set by the browser, not the page — says
 * where it came from; `same-origin` and `none` (the user's own navigation)
 * pass, everything else is refused. A browser too old to send it still sends
 * `Origin` on a cross-origin POST, which must name this host. A request with
 * neither header is not a browser acting for another site (the proof harness,
 * curl, a server) and passes — this is CSRF protection, not authentication.
 */
export function rejectCrossSite(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null)
    return SAFE_FETCH_SITES.has(site.trim().toLowerCase())
      ? null
      : crossSiteRefusal();
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    // `Origin: null` — sandboxed or opaque.
    return crossSiteRefusal();
  }
  const own = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
  ]
    .filter((h): h is string => !!h)
    .map((h) => h.split(",")[0]!.trim().toLowerCase());
  return own.includes(originHost) ? null : crossSiteRefusal();
}

function crossSiteRefusal(): Response {
  return respond(
    apiError("forbidden", "Cross-site requests are not accepted."),
  );
}

function errorResult(...args: Parameters<typeof apiError>): {
  ok: false;
  error: ApiResult<ApiError>;
} {
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
  // The MIME ESSENCE, not a substring. `text/plain;application/json` contains
  // the words and parses (Fetch spec) to `text/plain` — a CORS-safelisted type
  // any page can send cross-site with no preflight. Until 2026-09 an
  // `includes()` here accepted it.
  const contentType = request.headers.get("content-type") ?? "";
  const essence = contentType.split(";")[0]!.trim().toLowerCase();
  if (essence !== "application/json") {
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
      `The request is larger than ${formatByteLimit(JOB_LIMITS.maxRequestBodyBytes)}, the most this endpoint accepts.`,
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
      `The request is larger than ${formatByteLimit(JOB_LIMITS.maxRequestBodyBytes)}, the most this endpoint accepts.`,
    );
  }

  if (text.trim().length === 0) return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return errorResult("invalid_request", "Request body must be valid JSON.");
  }
}
