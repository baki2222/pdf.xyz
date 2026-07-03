/**
 * Standard API response envelopes and pure builders for them.
 *
 * Everything here is framework-agnostic: a builder returns `{ status, body }`
 * (an {@link ApiResult}) rather than a `Response`, so the same logic is unit
 * testable without Next.js and reused by the thin route handlers, which only add
 * headers. This is where the honest "worker backend not configured" response
 * lives — the single place that guarantees we never fake success.
 */

/** Machine-readable error codes. Each maps to exactly one HTTP status. */
export type ApiErrorCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "unsupported_tool"
  | "unprocessable_entity"
  | "payload_too_large"
  | "conflict"
  | "worker_not_configured"
  | "not_implemented"
  | "not_found"
  | "method_not_allowed"
  | "rate_limited"
  | "service_unavailable"
  | "internal_error"
  // ── Upload-intake guardrails (Phase 35) ──────────────────────────────────
  // A small, deterministic validation layer at the public upload boundary,
  // enforced BEFORE any storage/queue work. Deliberately distinct from the
  // tool-level contract validation (which produces `invalid_request` /
  // `unprocessable_entity`) and from worker-side malware/soundness scanning, so
  // an operator can reason about — and tune — each layer independently. See
  // `@/lib/uploads/intake` and docs/SECURITY.md → "Upload intake guardrails".
  | "invalid_upload_request" // 400 — malformed upload request shape or filename bound
  | "unsupported_file_type" // 415 — declared type is not an accepted upload family
  | "too_many_files" // 422 — more files than the per-request cap
  | "file_too_large" // 413 — one declared file over the per-file byte cap
  | "request_too_large" // 413 — declared combined upload size over the request cap
  | "malformed_pdf" // 422 — bytes fail the bounded %PDF-/%%EOF structural sniff
  // ── Artifact-retrieval guardrails (Phase 38) ─────────────────────────────
  // The download boundary's authorization/lifecycle denials, distinct from the
  // structural/provenance ones (which reuse `not_found`/`conflict`/
  // `unprocessable_entity`/`unsupported_media_type`). See `@/lib/workers/artifacts/access`
  // and docs/SECURITY.md → "Artifact retrieval guardrails".
  | "forbidden" // 403 — a presented capability/binding does not grant this artifact
  | "gone"; // 410 — the artifact provably existed and is now gone (expired/deleted)

/** Field-level detail for validation failures. */
export interface FieldError {
  field: string;
  message: string;
}

/** The one error shape every route returns. */
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Present for validation errors; names the offending fields. */
    details?: FieldError[];
    /** Pointer to the contract docs for this endpoint. */
    docs: string;
  };
}

/** A status + body pair, ready for a route handler to serialize. */
export interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * The outcome of parsing/validating untrusted input: either a typed value or a
 * fully-formed error result ready to return to the client.
 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiResult<ApiError> };

/** In-repo pointer to the endpoint contract. Honest and stable. */
export const CONTRACT_DOCS = "docs/WORKER_ARCHITECTURE.md";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unsupported_media_type: 415,
  unsupported_tool: 404,
  unprocessable_entity: 422,
  payload_too_large: 413,
  conflict: 409,
  worker_not_configured: 503,
  not_implemented: 501,
  not_found: 404,
  method_not_allowed: 405,
  rate_limited: 429,
  // A configured upstream (e.g. object storage) was reached but failed transiently;
  // the request is retryable. Distinct from `worker_not_configured` (no backend at all).
  service_unavailable: 503,
  internal_error: 500,
  // Upload-intake guardrails (Phase 35).
  invalid_upload_request: 400,
  unsupported_file_type: 415,
  too_many_files: 422,
  file_too_large: 413,
  request_too_large: 413,
  malformed_pdf: 422,
  // Artifact-retrieval guardrails (Phase 38).
  forbidden: 403,
  gone: 410,
};

/** Build a typed error result with the correct HTTP status for `code`. */
export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: FieldError[],
): ApiResult<ApiError> {
  return {
    status: STATUS_BY_CODE[code],
    body: {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
        docs: CONTRACT_DOCS,
      },
    },
  };
}

/** Build a successful result. */
export function ok<T>(body: T, status = 200): ApiResult<T> {
  return { status, body };
}

/**
 * The honest response returned once a request is well-formed but no real worker
 * backend is wired up in this environment. A `503` (not `200`) so nothing can
 * ever mistake a stub for a completed job. The message never leaks which infra
 * is missing.
 */
export const WORKER_NOT_CONFIGURED_MESSAGE =
  "The secure worker backend is not configured in this environment. This endpoint is a typed contract stub: no files are stored, scanned, or processed. See docs/WORKER_ARCHITECTURE.md.";

export function workerNotConfigured(): ApiResult<ApiError> {
  return apiError("worker_not_configured", WORKER_NOT_CONFIGURED_MESSAGE);
}

/**
 * Returned when a backend *is* detected but this build intentionally ships no
 * processing pipeline. Keeps the "never fake success" promise on both branches.
 */
export const NOT_IMPLEMENTED_MESSAGE =
  "A worker backend was detected, but this build ships no processing pipeline. Wire a worker to the documented contract to enable this endpoint. See docs/WORKER_ARCHITECTURE.md.";

export function notImplemented(): ApiResult<ApiError> {
  return apiError("not_implemented", NOT_IMPLEMENTED_MESSAGE);
}
