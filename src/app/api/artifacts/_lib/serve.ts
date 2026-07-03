/**
 * The single client-facing artifact-download path, shared by the local-dev route
 * (`../local/[artifactId]`) and the storage-backed route (`../[artifactId]`).
 *
 * Both routes resolve an {@link ArtifactRetrievalBackend} — the developer in-process store,
 * or a configured object bucket read server-side — and hand it here. This is the ONE place
 * the Phase 38 access/header/receipt contract lives: the handle shape is checked, the
 * backend's lifecycle-tagged result flows through the pure {@link decideRetrieval} →
 * `decideArtifactAccess` policy, and — only on a pass — the bytes are streamed through THIS
 * app server with safe, deterministic, GENERATED headers (never a stored/user filename,
 * object key, or signed URL). A denial returns a stable, content-free `{ code, message }`.
 * Every decision, served or denied, emits one bounded metric + one content-free receipt.
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
import { recordArtifactRetrieval } from "@/lib/workers/artifacts/retrieval-metrics";
import { emitArtifactRetrievalReceipt } from "@/lib/workers/artifacts/retrieval-receipt";
import { respond } from "../../_lib/http";

/**
 * Emit the bounded retrieval metric AND the content-free receipt for one decision. Both
 * carry the bounded storage `provider` (local-dev vs remote-configured vs not-configured),
 * so observability can split local-dev from storage-backed retrieval without any
 * high-cardinality label — and never a handle, key, bucket, or signed URL.
 */
function observe(
  reason: ArtifactAccessReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
): void {
  recordArtifactRetrieval(reason, kind, provider);
  emitArtifactRetrievalReceipt({ reason, kind, provider });
}

/** Observe the denial, then return the stable, content-free error response. */
function deny(
  reason: ArtifactAccessDenyReason,
  kind: ArtifactOutputKind,
  provider: RetrievalStorageProvider,
): Response {
  observe(reason, kind, provider);
  const { code, message } = httpErrorForAccessReason(reason);
  return respond(apiError(code, message));
}

/**
 * Serve one artifact-download request from `backend`. Validates the handle, resolves the
 * backend's result (only touching the source when the backend can actually serve — when it
 * cannot, the access layer's readiness gate denies `storage_unavailable` first), evaluates
 * the shared retrieval policy, and either streams the bytes with safe headers or denies with
 * a content-free reason. Pure glue over the injected backend; total.
 */
export async function serveArtifactRetrieval(
  backend: ArtifactRetrievalBackend,
  request: Request,
  handle: string,
): Promise<Response> {
  // The backend's key-free capability is pure (no I/O), so resolve it FIRST — the bounded
  // `provider` then rides every metric/receipt, including the malformed-handle denial below.
  const storage = backend.capability();
  const provider = storage.provider;

  if (!isValidArtifactHandle(handle)) return deny("malformed_handle", "unknown", provider);

  // Only touch the backend when it can serve here. When it cannot (not configured), the
  // access layer's storage check fires first, so the source is never consulted.
  const result: ArtifactRetrievalResult = storage.ready
    ? await backend.fetch(handle)
    : { kind: "absent" };

  // Optional job binding: a client that holds a job id may bind the download to it. The raw
  // id is compared inside the pure layer against the backend-resolved owning job (present
  // only for a store-backed source); only the boolean crosses in.
  const assertedJob = new URL(request.url).searchParams.get("job")?.trim() || null;

  const { decision, bytes } = decideRetrieval(result, storage, assertedJob);
  if (!decision.ok) return deny(decision.reason, "unknown", provider);

  observe("ok", decision.kind, provider);

  // Copy into a fresh ArrayBuffer-backed view so the body is a concrete BodyInit (the
  // stored view's buffer type is only `ArrayBufferLike`). Non-null: an `ok` decision
  // always carries the bytes to stream.
  const view = bytes!;
  const body = new Uint8Array(view.byteLength);
  body.set(view);
  return new Response(body, { status: 200, headers: { ...decision.headers } });
}
