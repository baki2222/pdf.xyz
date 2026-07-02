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

/** Serialize an ApiResult to a JSON Response with privacy-safe caching headers. */
export function respond(result: ApiResult<unknown>): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Job metadata is never cacheable; also blocks shared-cache leakage.
      "cache-control": "no-store",
    },
  });
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
