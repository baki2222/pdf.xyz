/**
 * GET /api/artifacts/local/[artifactId] — download a local-dev worker output.
 *
 * ACTIVE ONLY when `PDFXYZ_WORKER_MODE=local-dev`; otherwise it answers
 * `503 worker_not_configured`. The download flows through the shared
 * {@link serveArtifactRetrieval} boundary over the local-dev {@link createLocalDevArtifactBackend}:
 * the handle shape is checked, the store's storage capability and the artifact's lifecycle
 * are reported, and the pure access layer proves the handle maps to a completed, non-expired
 * output that is a recognized, downloadable, non-empty kind (re-validating its content-free
 * provenance manifest when one was recorded), and — if the client asserts a `?job=` binding —
 * that the artifact belongs to that job, before a single byte is streamed with safe,
 * deterministic, GENERATED response headers (never a stored/user filename). The shared Phase
 * 40 delivery gate then verifies the bytes before they stream (length consistency, delivery
 * ceiling, `Accept-Ranges: none`) and answers `HEAD` with the verified headers and no body.
 * This boundary has NO authentication or authorization: possession of the unguessable opaque
 * handle is the capability, and `?job=` is an optional integrity cross-check, not access
 * control. A denial returns a stable, content-free reason and status; every decision emits a
 * bounded metric + a content-free receipt. The storage-backed counterpart of this route (a
 * configured object bucket, read server-side) is `../[artifactId]`; both share the same
 * access + delivery path. See docs/WORKER_ARCHITECTURE.md.
 */

import { createLocalDevArtifactBackend } from "@/lib/workers/artifacts/retrieval-local";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { respondRateLimited } from "../../../_lib/http";
import { serveArtifactRetrieval } from "../../_lib/serve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const limit = await enforceRateLimit("artifacts.fetch", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const { artifactId } = await context.params;
  return serveArtifactRetrieval(createLocalDevArtifactBackend(), request, artifactId);
}

/** Stream a local-dev artifact's bytes with safe, verified delivery headers. */
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
