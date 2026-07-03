/**
 * GET /api/artifacts/local/[artifactId] — download a local-dev worker output.
 *
 * ACTIVE ONLY when `PDFXYZ_WORKER_MODE=local-dev`; otherwise it answers
 * `503 worker_not_configured`. Streams the produced PDF from the in-memory dev
 * store with no-store caching and an attachment disposition. A real deployment
 * serves outputs from a signed, expiring object-storage URL, not the app server.
 * See docs/WORKER_ARCHITECTURE.md.
 */

import { apiError, workerNotConfigured } from "@/lib/jobs";
import { isLocalDevWorker } from "@/lib/workers";
import { devWorkerStore, isValidArtifactId } from "@/lib/workers/store";
import { sanitizeSegment } from "@/lib/pdf/files";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { respond, respondRateLimited } from "../../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const limit = await enforceRateLimit("artifacts.fetch", request);
  if (!limit.allowed) return respondRateLimited(limit);

  if (!isLocalDevWorker()) return respond(workerNotConfigured());

  const { artifactId } = await context.params;
  if (!isValidArtifactId(artifactId)) {
    return respond(apiError("invalid_request", "Malformed artifact id."));
  }

  const artifact = devWorkerStore.getArtifact(artifactId);
  if (!artifact) {
    return respond(
      apiError("not_found", "No such artifact (it may have expired)."),
    );
  }

  // The filename came from a validated upload, but strip anything unsafe for a
  // header value defensively before echoing it back.
  const filename = sanitizeSegment(artifact.filename);
  // Copy into a fresh ArrayBuffer-backed view so the body is a concrete
  // BodyInit (the stored view's buffer type is only `ArrayBufferLike`).
  const body = new Uint8Array(artifact.bytes.byteLength);
  body.set(artifact.bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": artifact.contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
