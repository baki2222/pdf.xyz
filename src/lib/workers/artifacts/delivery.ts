/**
 * The **artifact-download delivery policy**: the bounded, content-free decision the
 * client-facing download boundary makes AFTER the Phase 38 access layer has already
 * granted a handle and generated its safe headers, but BEFORE any byte is written to
 * the wire. Where {@link import("./access").decideArtifactAccess} answers *may this
 * handle be served, and with what headers*, this layer answers *are the bytes safe to
 * deliver as those headers claim* — a distinct, second gate over the same download.
 *
 * It exists because a proxied byte stream has failure modes an access check cannot see:
 *  - a `Content-Length` the boundary is about to emit must equal the bytes it will
 *    actually stream (and any length the upstream provider declared), or a client
 *    reads a truncated / over-read body while trusting a header that lies about it;
 *  - an artifact far larger than any real output must fail closed rather than be
 *    buffered and streamed, protecting the proxying app server;
 *  - a `HEAD` must return the same headers with no body, deterministically;
 *  - a `Range` request must get a documented, bounded answer — this boundary proxies
 *    whole buffered objects and does NOT implement resumable/partial range serving, so
 *    it advertises `Accept-Ranges: none` and ignores the `Range` header (whole-file
 *    `200`), never a fabricated `206`/`416`.
 *
 * Like the access layer it wraps, this is a pure, node-free leaf (data + tiny total
 * functions, no I/O, no clock, no Node built-in, no `Response`): the route glue in
 * `src/app/api/artifacts/_lib/serve.ts` owns the actual `Response`/stream, so the
 * decision logic is unit-tested in isolation. Nothing here ever sees — let alone
 * returns — a filename, object key, signed URL, bucket name, endpoint, job/user id,
 * temp path, token, byte snippet, or document content: it works only on the bounded
 * output kind, the already-safe generated headers, three byte COUNTS, an HTTP method,
 * and a bounded range disposition.
 *
 * Honesty rules — load-bearing, mirrored across the worker layer:
 *  - a delivery PASS is only a byte-consistency + method/range safety check. It is NOT
 *    authentication, NOT authorization (the access layer already decided those), NOT a
 *    content scan, NOT resumable range serving, NOT zero-copy streaming — it never
 *    claims any of those;
 *  - a delivery denial maps to a single content-free `503 service_unavailable`; the
 *    precise internal reason (`size_mismatch` / `oversize` / `stream_error`) lives
 *    only in the decision + receipt/metric, never widening what the client learns;
 *  - every field of a decision is content-free: a bounded reason enum, the already-safe
 *    header strings, a byte COUNT, and bounded method/range enums — never user input.
 */

import type { ApiErrorCode } from "@/lib/jobs";
import type { ArtifactDownloadHeaders } from "./access";
import type { ArtifactOutputKind } from "./types";

/**
 * The HTTP methods the download boundary serves. `GET` streams the bytes; `HEAD`
 * returns byte-identical headers (including the verified `Content-Length`) with no
 * body. Any other method never reaches this layer — the routes wire only these two.
 */
export const ARTIFACT_DELIVERY_METHODS = ["GET", "HEAD"] as const;
export type ArtifactDeliveryMethod = (typeof ARTIFACT_DELIVERY_METHODS)[number];

/**
 * The bounded disposition of a request's `Range` header. This boundary proxies whole
 * buffered objects and does not implement partial/resumable serving, so a present
 * `Range` is `ignored` (the whole file is returned `200` with `Accept-Ranges: none`)
 * and its absence is `none`. A closed enum so the "clients asked for a range we do not
 * serve" signal is observable without any high-cardinality byte-range value.
 */
export const ARTIFACT_DELIVERY_RANGES = ["none", "ignored"] as const;
export type ArtifactDeliveryRange = (typeof ARTIFACT_DELIVERY_RANGES)[number];

/** The coarse outcome of a delivery decision, for low-cardinality observability. */
export const ARTIFACT_DELIVERY_OUTCOMES = ["delivered", "denied"] as const;
export type ArtifactDeliveryOutcome =
  (typeof ARTIFACT_DELIVERY_OUTCOMES)[number];

/**
 * The bounded, content-free reason taxonomy for a delivery decision. `ok` accompanies
 * delivered bytes; the rest are the closed set of delivery-policy denials:
 *  - `size_mismatch` — the length the boundary would emit disagrees with the bytes
 *    it would stream, or with the length the upstream provider declared;
 *  - `oversize`        — the artifact exceeds the bounded delivery byte ceiling;
 *  - `stream_error`    — an unexpected error occurred while producing the response
 *    (e.g. the backend threw, or the body could not be built), mapped to a safe
 *    connection-closing `503` rather than a framework `500` that could leak a stack.
 * Every value is a stable internal code — never a filename, key, URL, id, size, path,
 * or document byte.
 *
 * NOTE: `size_mismatch` (not `length_mismatch`) is deliberate — every metric label must
 * survive the shared telemetry redactor unchanged, and `length_mismatch` contains the
 * `h_` the handoff-token rule scrubs (`lengt·h_·mismatch`), so it would be mangled and
 * `sanitizeMetric` would drop the sample. Keep these values redaction-stable.
 */
export const ARTIFACT_DELIVERY_REASONS = [
  "ok",
  "size_mismatch",
  "oversize",
  "stream_error",
] as const;
export type ArtifactDeliveryReason = (typeof ARTIFACT_DELIVERY_REASONS)[number];

/** The reasons that accompany a DENIED delivery decision (everything but `ok`). */
export type ArtifactDeliveryDenyReason = Exclude<ArtifactDeliveryReason, "ok">;

/** Fold a delivery reason to its coarse outcome (`ok` ⇒ delivered, else denied). */
export function deliveryOutcomeFor(
  reason: ArtifactDeliveryReason,
): ArtifactDeliveryOutcome {
  return reason === "ok" ? "delivered" : "denied";
}

/**
 * The delivery policy. `maxBytes` is the ONE knob: a hard defensive ceiling on the
 * size of an artifact this boundary will buffer-and-stream through the app server.
 * It backstops the fact that the publish-time per-output byte ceiling
 * (`PDFXYZ_WORKER_ARTIFACT_MAX_BYTES`) is opt-in and OFF by default — so without a
 * delivery ceiling a pathological or tampered object could be streamed unbounded.
 * Fixed (not operator-tunable) in this phase; generous, well above any real output.
 */
export interface ArtifactDeliveryPolicy {
  readonly maxBytes: number;
}

/**
 * The shipped default delivery ceiling: 1 GiB. Comfortably above any realistic single
 * produced PDF/text/image/archive output, while bounding what the proxying app server
 * will ever hold in memory and stream for one download.
 */
export const DEFAULT_ARTIFACT_DELIVERY_POLICY: ArtifactDeliveryPolicy =
  Object.freeze({
    maxBytes: 1_073_741_824,
  });

/** The bounded, content-free facts a delivery decision is made from. */
export interface DeliveryInput {
  /** The served output kind (from the access decision); rides metrics/receipts. */
  readonly kind: ArtifactOutputKind;
  /** The safe, generated headers the access layer produced for this artifact. */
  readonly headers: ArtifactDownloadHeaders;
  /** The byte length the access decision resolved (its `Content-Length`). */
  readonly decidedLength: number;
  /** The actual length of the bytes the boundary holds to stream. */
  readonly actualLength: number;
  /**
   * The length the upstream provider declared for the object (e.g. an object store's
   * `Content-Length` response header), or `null` when the source reports none (the
   * in-process developer store has no separate provider-declared length).
   */
  readonly reportedLength: number | null;
  /** The request method (`GET` streams bytes; `HEAD` returns headers only). */
  readonly method: ArtifactDeliveryMethod;
  /** The bounded disposition of the request's `Range` header. */
  readonly range: ArtifactDeliveryRange;
}

/**
 * A delivery decision: either `ok` with the final safe headers and whether a body is
 * included (false for `HEAD`), or a denial with a bounded reason and a fixed,
 * content-free detail. Never carries user input.
 */
export type ArtifactDeliveryDecision =
  | {
      readonly ok: true;
      readonly reason: "ok";
      /** The final response headers to emit (generated headers + delivery hardening). */
      readonly headers: ArtifactDownloadHeaders;
      /** Whether the response carries a body (`true` for `GET`, `false` for `HEAD`). */
      readonly includeBody: boolean;
      /** The verified byte length being delivered (equals the emitted `Content-Length`). */
      readonly byteLength: number;
    }
  | {
      readonly ok: false;
      readonly reason: ArtifactDeliveryDenyReason;
      /** One-line, content-free explanation. Never a filename, key, size, or content. */
      readonly detail: string;
    };

/** Content-free explanations per delivery-denial reason. Never a file, size, key, or content. */
export const ARTIFACT_DELIVERY_DETAIL: Record<
  ArtifactDeliveryDenyReason,
  string
> = {
  size_mismatch:
    "The artifact could not be delivered because its length could not be verified against the stored bytes.",
  oversize:
    "The artifact exceeds the delivery size limit for this endpoint and cannot be served here.",
  stream_error:
    "The artifact could not be delivered due to an unexpected error. Please try again.",
};

/**
 * Every delivery-policy denial maps to a single content-free `503 service_unavailable`.
 * The client learns only "the server could not safely deliver this right now"; the
 * precise internal reason (length mismatch vs oversize vs stream error) lives only in
 * the decision + the delivery receipt/metric, never widening what the client sees —
 * mirroring how the access layer folds several internal reasons to one client code.
 */
const CODE_BY_DELIVERY_REASON: Record<
  ArtifactDeliveryDenyReason,
  ApiErrorCode
> = {
  size_mismatch: "service_unavailable",
  oversize: "service_unavailable",
  stream_error: "service_unavailable",
};

/** The content-free `{ code, message }` a delivery-denial reason maps to for a response. */
export function httpErrorForDeliveryReason(
  reason: ArtifactDeliveryDenyReason,
): {
  code: ApiErrorCode;
  message: string;
} {
  return {
    code: CODE_BY_DELIVERY_REASON[reason],
    message: ARTIFACT_DELIVERY_DETAIL[reason],
  };
}

/**
 * Map an HTTP method string to the bounded {@link ArtifactDeliveryMethod} the boundary
 * serves. `HEAD` is recognized case-insensitively; everything else (the routes only
 * wire `GET`/`HEAD`) is treated as `GET`, so a body-less probe is never mistaken for a
 * streaming download and a stray verb can never widen behavior.
 */
export function deliveryMethodFor(
  method: string | null | undefined,
): ArtifactDeliveryMethod {
  return typeof method === "string" && method.toUpperCase() === "HEAD"
    ? "HEAD"
    : "GET";
}

/**
 * Classify a request's `Range` header into the bounded disposition. A present,
 * non-blank `Range` is `ignored` (this boundary serves whole files only); its absence
 * is `none`. The raw byte-range value is never retained — only the bounded enum.
 */
export function deliveryRangeFor(
  rangeHeader: string | null | undefined,
): ArtifactDeliveryRange {
  return typeof rangeHeader === "string" && rangeHeader.trim().length > 0
    ? "ignored"
    : "none";
}

/**
 * The extra response headers the delivery layer adds on top of the access layer's
 * generated headers. `Accept-Ranges: none` truthfully advertises that this boundary
 * does not serve byte ranges, so a well-behaved client requests the whole file rather
 * than a `206` this proxy would never honor.
 */
const DELIVERY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "accept-ranges": "none",
});

/** A finite, non-negative integer byte count (the only shape a length may take). */
function isByteCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Decide whether the already-access-granted bytes are safe to deliver, and if so with
 * what final headers. The single evaluation the download route delegates to AFTER the
 * access layer passes, in a deterministic precedence:
 *
 *   length verifiable (decided == actual, provider == actual) → within ceiling → deliver
 *
 * A failure at any step denies with a bounded reason and a fixed, content-free detail;
 * a pass returns the access headers augmented with `Accept-Ranges: none` and a
 * `Content-Length` re-asserted from the verified actual length (so the header can only
 * ever equal the body), plus whether a body is included (`false` for `HEAD`). Pure and
 * total; never throws.
 */
export function decideDelivery(
  input: DeliveryInput,
  policy: ArtifactDeliveryPolicy = DEFAULT_ARTIFACT_DELIVERY_POLICY,
): ArtifactDeliveryDecision {
  const { actualLength, decidedLength, reportedLength } = input;

  // The lengths must be well-formed byte counts. A non-finite/negative/fractional
  // length is a structural impossibility we refuse rather than emit a bogus header for.
  if (!isByteCount(actualLength) || !isByteCount(decidedLength)) {
    return denied("size_mismatch");
  }
  // The Content-Length the access layer resolved must equal the bytes we will stream
  // (defense-in-depth: they are equal by construction, but the boundary proves it here
  // so the emitted header can never diverge from the body).
  if (decidedLength !== actualLength) return denied("size_mismatch");
  // When the upstream provider declared a length, it must match the actual bytes too —
  // a truncated / over-declared object is refused, never streamed under a lying header.
  if (reportedLength !== null) {
    if (!isByteCount(reportedLength) || reportedLength !== actualLength) {
      return denied("size_mismatch");
    }
  }
  // A hard defensive ceiling: an artifact larger than any real output fails closed
  // rather than being buffered and streamed through the app server.
  if (
    isByteCount(policy.maxBytes) &&
    policy.maxBytes > 0 &&
    actualLength > policy.maxBytes
  ) {
    return denied("oversize");
  }

  const headers: ArtifactDownloadHeaders = {
    ...input.headers,
    ...DELIVERY_HEADERS,
    // Re-assert Content-Length from the verified actual length — the honest
    // "safe Content-Length only when verified". Identical to the access header here,
    // but sourced from the number this layer proved rather than trusted.
    "content-length": String(actualLength),
  };

  return {
    ok: true,
    reason: "ok",
    headers,
    includeBody: input.method !== "HEAD",
    byteLength: actualLength,
  };
}

/** Build a denied delivery decision with its fixed, content-free detail. */
function denied(reason: ArtifactDeliveryDenyReason): ArtifactDeliveryDecision {
  return { ok: false, reason, detail: ARTIFACT_DELIVERY_DETAIL[reason] };
}
