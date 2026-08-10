/**
 * The single client-facing artifact-download path, shared by the local-dev route
 * (`../local/[artifactId]`) and the storage-backed route (`../[artifactId]`).
 *
 * Both routes resolve an {@link ArtifactRetrievalBackend} — the developer in-process store,
 * or a configured object bucket read server-side — and hand it here. This is the ONE place
 * the Phase 38 access + Phase 40 delivery contract lives: the handle shape is checked, the
 * backend's lifecycle-tagged result flows through the pure {@link decideRetrieval} →
 * `decideArtifactAccess` policy, and — only on a pass — through the pure
 * {@link decideDelivery} byte-delivery gate before the bytes are streamed through THIS app
 * server with safe, deterministic, GENERATED headers (never a stored/user filename, object
 * key, or signed URL). A denial returns a stable, content-free `{ code, message }`.
 *
 * Two gates, two observations. The ACCESS gate decides whether the handle may be served and
 * generates its headers; every access decision emits one bounded retrieval metric + receipt.
 * The DELIVERY gate then verifies the bytes are safe to deliver as those headers claim — the
 * emitted `Content-Length` equals both the bytes to stream and any length the provider
 * declared, the artifact is within the delivery ceiling, `HEAD` returns headers with no body,
 * and a `Range` request gets a bounded whole-file answer (`Accept-Ranges: none`); every
 * delivery decision emits one bounded delivery metric + receipt. An unexpected error anywhere
 * closes to a content-free `503`, never a framework `500` with a stack.
 *
 * There is NO authentication or authorization here: possession of the unguessable opaque
 * handle is the capability, and `?job=` is an optional integrity cross-check (honored only
 * for a backend that has a server-side job record), not access control.
 */

import { apiError } from "@/lib/jobs";
import {
  decideRetrieval,
  httpErrorForAccessReason,
  isValidArtifactHandle,
  type ArtifactAccessDenyReason,
  type ArtifactAccessReason,
  type ArtifactOutputKind,
  type ArtifactRetrievalBackend,
  type ArtifactRetrievalResult,
  type RetrievalStorageProvider,
} from "@/lib/workers/artifacts";
import {
  decideDelivery,
  deliveryMethodFor,
  deliveryRangeFor,
  httpErrorForDeliveryReason,
  type ArtifactDeliveryMethod,
  type ArtifactDeliveryRange,
  type ArtifactDeliveryReason,
} from "@/lib/workers/artifacts/delivery";
import { recordArtifactRetrieval } from "@/lib/workers/artifacts/retrieval-metrics";
import { emitArtifactRetrievalReceipt } from "@/lib/workers/artifacts/retrieval-receipt";
import { recordArtifactDelivery } from "@/lib/workers/artifacts/delivery-metrics";
import { emitArtifactDeliveryReceipt } from "@/lib/workers/artifacts/delivery-receipt";
import { respond } from "../../_lib/http";

/**
 * Emit the bounded retrieval (ACCESS) metric AND the content-free receipt for one access
 * decision. Both carry the bounded storage `provider` (local-dev vs remote-configured vs
 * not-configured), so observability can split local-dev from storage-backed retrieval
 * without any high-cardinality label — and never a handle, key, bucket, or signed URL.
 */
function observeAccess(
  reason: ArtifactAccessReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
): void {
  recordArtifactRetrieval(reason, kind, provider);
  emitArtifactRetrievalReceipt({ reason, kind, provider });
}

/**
 * Emit the bounded DELIVERY metric AND the content-free delivery receipt for one delivery
 * decision — the second gate, fired only after access was granted. The metric stays lean
 * (outcome/reason/kind/provider); the receipt additionally records the bounded method/range.
 */
function observeDelivery(
  reason: ArtifactDeliveryReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
  method: ArtifactDeliveryMethod,
  range: ArtifactDeliveryRange,
): void {
  recordArtifactDelivery(reason, kind, provider);
  emitArtifactDeliveryReceipt({ reason, kind, provider, method, range });
}

/**
 * Serialize a content-free `{ code, message }` error, body-less for `HEAD` (which never
 * carries a body) and full JSON for `GET`. The status + safe headers are identical either
 * way, so a `HEAD` probe learns exactly what a `GET` would, minus the bytes.
 */
function errorResponse(
  code: Parameters<typeof apiError>[0],
  message: string,
  method: ArtifactDeliveryMethod,
): Response {
  const res = respond(apiError(code, message));
  if (method !== "HEAD") return res;
  return new Response(null, { status: res.status, headers: res.headers });
}

/** Observe an ACCESS denial, then return the stable, content-free error response. */
function denyAccess(
  reason: ArtifactAccessDenyReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
  method: ArtifactDeliveryMethod,
): Response {
  observeAccess(reason, kind, provider);
  const { code, message } = httpErrorForAccessReason(reason);
  return errorResponse(code, message, method);
}

/**
 * Serve one artifact-download request from `backend`. Validates the handle, resolves the
 * backend's result (only touching the source when the backend can actually serve — when it
 * cannot, the access layer's readiness gate denies `storage_unavailable` first), evaluates
 * the shared access policy, then the delivery policy, and either streams the bytes with safe
 * headers or denies with a content-free reason. Total: any unexpected error is caught and
 * mapped to a safe `503` (a delivery `stream_error`), never a leaked stack.
 */
export async function serveArtifactRetrieval(
  backend: ArtifactRetrievalBackend,
  request: Request,
  handle: string,
): Promise<Response> {
  // Method + range are pure header reads, resolved up front so they are available even to
  // the defensive catch below (a stray verb collapses to `GET`; the routes wire only GET/HEAD).
  const method = deliveryMethodFor(request.method);
  const range = deliveryRangeFor(request.headers.get("range"));
  // Start with the honest no-config provider; it is refined once `capability()` resolves,
  // so even an early unexpected error attributes to a bounded provider (never a bucket name).
  let provider: RetrievalStorageProvider = "not-configured";

  try {
    // The backend's key-free capability is pure (no I/O), so resolve it FIRST — the bounded
    // `provider` then rides every metric/receipt, including the malformed-handle denial below.
    const storage = backend.capability();
    provider = storage.provider;

    if (!isValidArtifactHandle(handle)) {
      return denyAccess("malformed_handle", "unknown", provider, method);
    }

    // Only touch the backend when it can serve here. When it cannot (not configured), the
    // access layer's storage check fires first, so the source is never consulted.
    const result: ArtifactRetrievalResult = storage.ready
      ? await backend.fetch(handle)
      : { kind: "absent" };

    // Optional job binding: a client that holds a job id may bind the download to it. The raw
    // id is compared inside the pure layer against the backend-resolved owning job (present
    // only for a store-backed source); only the boolean crosses in.
    const assertedJob =
      new URL(request.url).searchParams.get("job")?.trim() || null;

    const { decision, bytes, reportedLength } = decideRetrieval(
      result,
      storage,
      assertedJob,
    );
    if (!decision.ok)
      return denyAccess(decision.reason, "unknown", provider, method);

    // Access granted — record the served ACCESS decision. The DELIVERY gate below is a
    // distinct second decision (was the byte delivery itself safe), separately observed.
    observeAccess("ok", decision.kind, provider);

    // Non-null: an `ok` decision always carries the bytes to stream.
    const view = bytes!;
    const delivery = decideDelivery({
      kind: decision.kind,
      headers: decision.headers,
      decidedLength: decision.byteLength,
      actualLength: view.byteLength,
      reportedLength: reportedLength ?? null,
      method,
      range,
    });

    if (!delivery.ok) {
      observeDelivery(delivery.reason, decision.kind, provider, method, range);
      const { code, message } = httpErrorForDeliveryReason(delivery.reason);
      return errorResponse(code, message, method);
    }

    observeDelivery("ok", decision.kind, provider, method, range);

    // A `HEAD` returns the verified headers (including `Content-Length`) with no body.
    if (!delivery.includeBody) {
      return new Response(null, {
        status: 200,
        headers: { ...delivery.headers },
      });
    }

    // Copy into a fresh ArrayBuffer-backed view so the body is a concrete BodyInit (the
    // stored view's buffer type is only `ArrayBufferLike`).
    const body = new Uint8Array(view.byteLength);
    body.set(view);
    return new Response(body, {
      status: 200,
      headers: { ...delivery.headers },
    });
  } catch {
    // Defense-in-depth: any unexpected failure (a backend that threw, a body that could not
    // be built) becomes a safe, content-free `503` — never a framework `500` with a stack,
    // and never a provider detail. Recorded as a delivery `stream_error`.
    observeDelivery("stream_error", "unknown", provider, method, range);
    const { code, message } = httpErrorForDeliveryReason("stream_error");
    return errorResponse(code, message, method);
  }
}
