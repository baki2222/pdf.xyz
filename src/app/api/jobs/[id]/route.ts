/**
 * GET /api/jobs/[id] — read job status.
 *
 * Validates the job id format, then delegates to the active worker adapter (see
 * `@/lib/workers`). With no backend there are no jobs to look up, so a
 * well-formed id returns `503 worker_not_configured`; the API never fabricates a
 * job or a "completed" status. The developer-only local-dev worker returns the
 * real, terminal job it stored. See docs/WORKER_ARCHITECTURE.md.
 */

import { apiError, isValidJobId } from "@/lib/jobs";
import { getWorkerAdapter } from "@/lib/workers";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { rejectCrossSite, respond, respondRateLimited } from "../../_lib/http";

// Status is never cached: it always reflects the live job state. Node runtime —
// the local-dev adapter uses Node built-ins (lazily imported only in that mode).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limit = await enforceRateLimit("jobs.status", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const { id } = await context.params;

  if (!isValidJobId(id)) {
    return respond(
      apiError("invalid_request", "Malformed job id.", [
        { field: "id", message: "Expected a job id of the form job_…" },
      ]),
    );
  }

  const adapter = await getWorkerAdapter();
  const outcome = await adapter.getJob(id);
  return respond(
    outcome.ok
      ? { status: outcome.status, body: outcome.value }
      : outcome.error,
  );
}

/**
 * DELETE /api/jobs/[id] — signed "delete now" / cancel path.
 *
 * In production this is where the adapter cancels queued/running work and asks
 * storage to delete produced artifacts immediately. With no backend it returns
 * the same honest not-configured response as status. The local-dev adapter uses
 * its queue/storage providers to cancel in-flight jobs or expire completed jobs
 * and remove their artifacts.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Cross-site browser writes are refused before anything else — including
  // the rate-limit charge they would otherwise spend (see rejectCrossSite).
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const limit = await enforceRateLimit("jobs.delete", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const { id } = await context.params;

  if (!isValidJobId(id)) {
    return respond(
      apiError("invalid_request", "Malformed job id.", [
        { field: "id", message: "Expected a job id of the form job_…" },
      ]),
    );
  }

  const adapter = await getWorkerAdapter();
  const outcome = await adapter.cancelJob(id);
  return respond(
    outcome.ok
      ? { status: outcome.status, body: outcome.value }
      : outcome.error,
  );
}
