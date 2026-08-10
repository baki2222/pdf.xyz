/**
 * The upload-intake **evaluators**: pure functions that turn an untrusted upload
 * request (or a received buffer) into a typed, content-free {@link IntakeDecision}.
 *
 * This is the small, deterministic gate the public upload routes run *before* any
 * storage or queue work — and before the precise, per-tool contract validation in
 * `@/lib/jobs`. It is intentionally coarse and tolerant: it rejects the clearly
 * out-of-contract (too many files, an over-size declaration, an unrecognized type,
 * a hostile filename, a non-PDF masquerading as a PDF) with a stable code, and
 * *passes through* anything ambiguous or malformed so the tool validator can own
 * the precise field-level error. The two layers never disagree in a way that lets
 * a bad input through — intake is only ever stricter, never laxer.
 *
 * Privacy is structural, not incidental. A rejection carries only:
 *  - a stable {@link IntakeRejectionCode},
 *  - a message built from *policy constants and positional indices* — never a raw
 *    filename, path, URL, object key, byte of content, or declared size,
 *  - a positional `field` pointer (`files[2]`), and
 *  - a {@link IntakeTelemetry} record of enums + policy numbers, safe to log.
 * The one client-supplied value that can appear in a message — a Content-Type — is
 * first passed through {@link normalizeContentType}, so only a bounded `type/subtype`
 * token can survive; a path/URL/filename smuggled into that field fails the shape
 * check and is treated as absent.
 */

import {
  apiError,
  type ApiError,
  type ApiErrorCode,
  type ApiResult,
} from "@/lib/jobs";
import {
  classifyDeclaredType,
  familyForMime,
  normalizeContentType,
} from "./families";
import { sniffPdf, type PdfSniffReason } from "./pdf";
import { resolveIntakePolicy, type IntakePolicy } from "./policy";

/**
 * The stable codes the intake layer emits. A strict subset of {@link ApiErrorCode}
 * — the assertion below makes that a compile error to violate — so a rejection maps
 * to exactly one HTTP status through the shared `apiError` builder.
 */
export type IntakeRejectionCode =
  | "invalid_upload_request"
  | "unsupported_file_type"
  | "too_many_files"
  | "file_too_large"
  | "request_too_large"
  | "malformed_pdf";

// Compile-time proof that every intake code is a real ApiErrorCode with a mapped
// status. If someone renames a code in only one place, this stops the build.
type _IntakeCodesAreApiCodes = IntakeRejectionCode extends ApiErrorCode
  ? true
  : never;
const _assertIntakeCodes: _IntakeCodesAreApiCodes = true;
void _assertIntakeCodes;

/**
 * A content-free record of *why* an upload was rejected, safe to emit to a metric
 * or a server log. Every field is a stable enum or a policy-derived number; none
 * is a client-supplied string beyond the fixed code.
 */
export interface IntakeTelemetry {
  readonly code: IntakeRejectionCode;
  /** The policy limit that was exceeded (bytes or a count), when applicable. */
  readonly limit?: number;
  /** Positional index of the offending file within the request, when applicable. */
  readonly index?: number;
  /** Structural reason a PDF failed its bounded sniff. */
  readonly pdf?: PdfSniffReason;
  /** Why a declared type was rejected: unknown, or MIME/extension disagreement. */
  readonly reason?: "unrecognized" | "mismatch";
}

/** A single, content-free intake rejection. */
export interface IntakeRejection {
  readonly code: IntakeRejectionCode;
  /** Human-readable, content-free reason. Never contains a filename or content. */
  readonly message: string;
  /** Positional field pointer, e.g. `files[2].filename`. Never a raw name. */
  readonly field?: string;
  /** The loggable, content-free view of this rejection. */
  readonly telemetry: IntakeTelemetry;
}

/** The outcome of an intake evaluation: allow, or a typed rejection. */
export type IntakeDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly rejection: IntakeRejection };

const ALLOW: IntakeDecision = { ok: true };

/** Build a rejection, deriving its telemetry twin so the two can never drift. */
function reject(
  code: IntakeRejectionCode,
  message: string,
  extra: Omit<IntakeTelemetry, "code"> & { field?: string } = {},
): IntakeDecision {
  const { field, ...telemetryExtra } = extra;
  return {
    ok: false,
    rejection: {
      code,
      message,
      ...(field ? { field } : {}),
      telemetry: { code, ...telemetryExtra },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A control character: C0 (U+0000–U+001F) or DEL (U+007F). */
function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Is a declared filename plainly hostile — a path segment, traversal token, or
 * control character? Mirrors the tool validator's rejection set so the two agree,
 * but here it only ever gates a *reject-or-skip* decision and never echoes the name.
 */
function isHostileFilename(trimmed: string): boolean {
  if (trimmed === "." || trimmed === "..") return true;
  if (trimmed.includes("..")) return true; // traversal
  if (/[/\\]/.test(trimmed)) return true; // path separators
  if (hasControlChars(trimmed)) return true;
  return false;
}

/**
 * Evaluate one declared file descriptor. Returns a rejection for a clear
 * violation, or `null` to defer (missing/mis-typed fields are the tool validator's
 * precise job). Never throws and never echoes the filename.
 */
function evaluateFileDescriptor(
  file: unknown,
  index: number,
  policy: IntakePolicy,
): IntakeDecision {
  if (!isRecord(file)) return ALLOW; // shape is the validator's job

  // Filename: bound the length and reject the plainly hostile — content-free.
  const { filename } = file;
  if (typeof filename === "string") {
    const trimmed = filename.trim();
    if (trimmed.length > policy.maxFilenameLength) {
      return reject(
        "invalid_upload_request",
        `A filename exceeds the ${policy.maxFilenameLength}-character limit.`,
        {
          field: `files[${index}].filename`,
          limit: policy.maxFilenameLength,
          index,
        },
      );
    }
    if (isHostileFilename(trimmed)) {
      return reject(
        "invalid_upload_request",
        "A filename contains path segments or illegal characters.",
        { field: `files[${index}].filename`, index },
      );
    }
  }

  // Declared type: only judge a plausibly-shaped Content-Type; a malformed/absent
  // one is deferred so the validator can name the precise field problem.
  const normalizedMime = normalizeContentType(file.contentType);
  if (normalizedMime !== null) {
    const classified = classifyDeclaredType(filename, file.contentType);
    if (!classified.ok) {
      const message =
        classified.reason === "mismatch"
          ? "A file's declared type does not match its filename extension."
          : `Files of type "${normalizedMime}" are not an accepted upload format.`;
      return reject("unsupported_file_type", message, {
        field: `files[${index}].contentType`,
        index,
        reason: classified.reason,
      });
    }
  }

  // Per-file size: only judge a real, positive number; the validator owns "must be
  // a positive integer".
  const { bytes } = file;
  if (
    typeof bytes === "number" &&
    Number.isFinite(bytes) &&
    bytes > policy.maxFileBytes
  ) {
    return reject(
      "file_too_large",
      `A file exceeds the ${policy.maxFileBytes}-byte per-file upload limit.`,
      { field: `files[${index}].bytes`, limit: policy.maxFileBytes, index },
    );
  }

  return ALLOW;
}

/**
 * Evaluate an upload-session request body (the JSON metadata of `POST /api/uploads`)
 * against `policy`. Coarse and tolerant: rejects too-many/over-size/unrecognized/
 * hostile inputs with a stable code, and defers everything else to the tool
 * validator. Never throws; never reads or echoes file content.
 */
export function evaluateUploadDescriptors(
  body: unknown,
  policy: IntakePolicy = resolveIntakePolicy(),
): IntakeDecision {
  if (!isRecord(body)) return ALLOW; // the validator owns "must be an object"
  const { files } = body;
  if (!Array.isArray(files)) return ALLOW; // …and "files must be an array"

  if (files.length > policy.maxFiles) {
    return reject(
      "too_many_files",
      `Too many files: at most ${policy.maxFiles} per upload.`,
      { field: "files", limit: policy.maxFiles },
    );
  }

  let totalBytes = 0;
  for (let i = 0; i < files.length; i++) {
    const perFile = evaluateFileDescriptor(files[i], i, policy);
    if (!perFile.ok) return perFile;
    const file = files[i];
    const bytes = isRecord(file) ? file.bytes : undefined;
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) {
      totalBytes += bytes;
    }
  }

  if (totalBytes > policy.maxRequestBytes) {
    return reject(
      "request_too_large",
      `The upload's combined size exceeds the ${policy.maxRequestBytes}-byte request limit.`,
      { field: "files", limit: policy.maxRequestBytes },
    );
  }

  return ALLOW;
}

/**
 * Evaluate the *count* dimension of a job request's `inputs` — the one intake knob
 * that applies to job creation, where inputs are opaque already-uploaded file ids
 * (no size or type to re-check). Ties a job to the same configurable per-request
 * file cap: you can never reference more inputs than an upload may contain.
 */
export function evaluateJobInputCount(
  body: unknown,
  policy: IntakePolicy = resolveIntakePolicy(),
): IntakeDecision {
  if (!isRecord(body)) return ALLOW;
  const { inputs } = body;
  if (!Array.isArray(inputs)) return ALLOW;
  if (inputs.length > policy.maxFiles) {
    return reject(
      "too_many_files",
      `Too many inputs: at most ${policy.maxFiles} per job.`,
      { field: "inputs", limit: policy.maxFiles },
    );
  }
  return ALLOW;
}

/**
 * Evaluate a *received* upload buffer against the policy's structural checks.
 * Byte-level checks cover PDFs only and are OPT-IN: with both `requirePdf*` knobs
 * off (the default) every buffer passes, so the default build is unchanged. When
 * enabled, a PDF that lacks its `%PDF-` header or `%%EOF` marker within the bounded
 * windows is rejected as `malformed_pdf`. Never reads document content — see
 * `./pdf`. Non-PDF families always pass here (their byte validation, when it
 * exists, lives in the worker).
 */
export function evaluateUploadedBytes(
  bytes: Uint8Array,
  meta: { contentType: unknown },
  policy: IntakePolicy = resolveIntakePolicy(),
): IntakeDecision {
  const family = familyForMime(normalizeContentType(meta.contentType));
  if (family !== "pdf") return ALLOW;
  if (!policy.requirePdfMagic && !policy.requirePdfEof) return ALLOW; // opt-in only

  const sniff = sniffPdf(bytes, policy);
  if (sniff.empty) {
    return reject("malformed_pdf", "The uploaded PDF is empty.", {
      pdf: "empty",
    });
  }
  if (policy.requirePdfMagic && !sniff.hasHeader) {
    return reject(
      "malformed_pdf",
      "The uploaded file is not a valid PDF (missing %PDF- header).",
      { pdf: "missing_header" },
    );
  }
  if (policy.requirePdfEof && !sniff.hasEof) {
    return reject(
      "malformed_pdf",
      "The uploaded file is not a valid PDF (missing %%EOF trailer).",
      { pdf: "missing_eof" },
    );
  }
  return ALLOW;
}

/**
 * Serialize an intake rejection into the standard `{ status, body }` API error
 * envelope, so a route returns it exactly like any other error via `respond`. The
 * field pointer (a positional path) is surfaced as a detail; nothing content-bearing
 * is ever added.
 */
export function intakeErrorResult(
  rejection: IntakeRejection,
): ApiResult<ApiError> {
  return apiError(
    rejection.code,
    rejection.message,
    rejection.field
      ? [{ field: rejection.field, message: rejection.message }]
      : undefined,
  );
}
