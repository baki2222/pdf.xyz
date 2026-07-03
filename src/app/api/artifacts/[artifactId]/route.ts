/**
 * GET /api/artifacts/[artifactId] — download a storage-backed secure-worker output.
 *
 * The production counterpart of `./local/[artifactId]`: when object storage is configured
 * (S3/R2), this route retrieves the artifact's bytes from the bucket SERVER-SIDE through an
 * internal reader and streams them through the SAME shared {@link serveArtifactRetrieval}
 * boundary the local-dev route uses — so both paths get byte-identical access checks, safe
 * GENERATED headers, a content-free denial taxonomy, and the same bounded metric + receipt.
 * A signed object-store URL is NEVER exposed to the client; nothing about the bucket, key,
 * endpoint, or signature leaves this server.
 *
 * When storage is absent or half-configured the backend is not `ready`, so the access layer
 * denies `storage_unavailable` (503) before any read — preserving the honest no-config
 * posture. A missing object is `not_found` (404); a manifest that fails re-validation is
 * refused; a transient bucket failure is a retryable `service_unavailable` (503), never a
 * false not-found. The shared Phase 40 delivery gate then verifies the bytes before they
 * stream (length consistency, delivery ceiling, `Accept-Ranges: none`) and answers `HEAD`
 * with the verified headers and no body. This boundary has NO authentication or
 * authorization: possession of the unguessable opaque handle is the capability. See
 * docs/WORKER_ARCHITECTURE.md.
 */

import { storageArtifactBackend } from "@/lib/workers/artifacts/retrieval-storage";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { respondRateLimited } from "../../_lib/http";
import { serveArtifactRetrieval } from "../_lib/serve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const limit = await enforceRateLimit("artifacts.fetch", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const { artifactId } = await context.params;
  return serveArtifactRetrieval(storageArtifactBackend(), request, artifactId);
}

/** Stream a storage-backed artifact's bytes with safe, verified delivery headers. */
export function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  return handle(request, context);
}

/** `HEAD`: the same access + delivery decision, returning verified headers with no body. */
export function HEAD(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  return handle(request, context);
}
