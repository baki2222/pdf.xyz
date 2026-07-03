/**
 * GET /api/artifacts/local/[artifactId] — download a local-dev worker output.
 *
 * ACTIVE ONLY when `PDFXYZ_WORKER_MODE=local-dev`; otherwise it answers
 * `503 worker_not_configured`. Every download flows through the pure
 * {@link decideArtifactAccess} retrieval guardrail: the handle shape is checked, the
 * store's storage capability and the artifact's lifecycle are reported, and the access
 * layer proves the handle maps to a completed, non-expired output that is a recognized,
 * downloadable, non-empty kind (re-validating its content-free provenance manifest when
 * one was recorded), and — if the client asserts a `?job=` binding — that the artifact
 * belongs to that job, before a single byte is streamed with safe, deterministic,
 * GENERATED response headers (never a stored/user filename). This boundary has NO
 * authentication or authorization: possession of the unguessable opaque handle is the
 * capability, and `?job=` is an optional integrity cross-check, not access control. A
 * denial returns a stable, content-free reason and status. Every decision emits a bounded
 * metric + a content-free receipt. A real deployment serves outputs from a signed,
 * expiring object-storage URL, not the app server. See docs/WORKER_ARCHITECTURE.md.
 */

import { apiError } from "@/lib/jobs";
import { resolveWorkerMode } from "@/lib/workers";
import { devWorkerStore } from "@/lib/workers/store";
import {
  decideArtifactAccess,
  httpErrorForAccessReason,
  isValidArtifactHandle,
  type ArtifactAccessDenyReason,
  type ArtifactAccessReason,
  type ArtifactOutputKind,
  type RetrievalStorageCapability,
  type RetrievalStorageProvider,
} from "@/lib/workers/artifacts";
import { recordArtifactRetrieval } from "@/lib/workers/artifacts/retrieval-metrics";
import { emitArtifactRetrievalReceipt } from "@/lib/workers/artifacts/retrieval-receipt";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { respond, respondRateLimited } from "../../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The storage capability THIS in-process route can serve a download from: only when the
 * developer-only local worker is active. A `remote-configured` deployment serves outputs
 * from signed, expiring object-store URLs out of band (never this app route); a disabled
 * one has no backend. Reported to the guardrail WITHOUT any bucket/region/key/URL.
 */
function localRetrievalStorage(): RetrievalStorageCapability {
  const mode = resolveWorkerMode();
  const provider: RetrievalStorageProvider =
    mode === "local-dev"
      ? "local-dev"
      : mode === "remote-configured"
        ? "remote-configured"
        : "not-configured";
  return { provider, ready: mode === "local-dev" };
}

/** Emit the bounded retrieval metric AND the content-free receipt for one decision. */
function observe(reason: ArtifactAccessReason, kind: ArtifactOutputKind): void {
  recordArtifactRetrieval(reason, kind);
  emitArtifactRetrievalReceipt({ reason, kind });
}

/** Observe the denial, then return the stable, content-free error response. */
function deny(
  reason: ArtifactAccessDenyReason,
  kind: ArtifactOutputKind,
): Response {
  observe(reason, kind);
  const { code, message } = httpErrorForAccessReason(reason);
  return respond(apiError(code, message));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const limit = await enforceRateLimit("artifacts.fetch", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const storage = localRetrievalStorage();

  const { artifactId } = await context.params;
  if (!isValidArtifactHandle(artifactId)) {
    return deny("malformed_handle", "unknown");
  }

  // Only touch the store when storage can actually serve here. When it cannot (any
  // non-local-dev mode) the guardrail's storage check fires first, so the placeholder
  // lifecycle is never consulted — the decision is `storage_unavailable` (→ 503).
  const retrieval = storage.ready
    ? devWorkerStore.retrieveArtifact(artifactId)
    : ({ lifecycle: "absent" } as const);
  const stored = retrieval.lifecycle === "live" ? retrieval.artifact : undefined;
  // The owning job's completion is confirmed when its record is still present (an
  // artifact is only ever stored for a completed job, so an expired/dropped job record
  // does not make a live artifact un-downloadable).
  const job = stored ? devWorkerStore.getJob(stored.jobId) : undefined;

  // Optional job binding: a client that holds a job id may bind the download to it. The
  // raw ids are compared HERE; only the resulting boolean crosses into the pure layer.
  const assertedJob =
    new URL(request.url).searchParams.get("job")?.trim() || null;
  const jobBinding =
    stored && assertedJob
      ? { asserted: true, matches: assertedJob === stored.jobId }
      : undefined;

  const decision = decideArtifactAccess({
    lifecycle: retrieval.lifecycle,
    jobCompleted: job === undefined || job.status === "completed",
    contentType: stored?.contentType ?? "",
    byteLength: stored?.bytes.byteLength ?? 0,
    manifest: stored?.manifest ?? null,
    storage,
    ...(jobBinding ? { jobBinding } : {}),
  });

  if (!decision.ok) return deny(decision.reason, "unknown");

  observe("ok", decision.kind);

  // Copy into a fresh ArrayBuffer-backed view so the body is a concrete BodyInit (the
  // stored view's buffer type is only `ArrayBufferLike`). Non-null: a `live` lifecycle
  // with an `ok` decision always has stored bytes.
  const bytes = stored!.bytes;
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, { status: 200, headers: { ...decision.headers } });
}
