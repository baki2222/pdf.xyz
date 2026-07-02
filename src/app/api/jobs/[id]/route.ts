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
import { respond } from "../../_lib/http";

// Status is never cached: it always reflects the live job state. Node runtime —
// the local-dev adapter uses Node built-ins (lazily imported only in that mode).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
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
    outcome.ok ? { status: outcome.status, body: outcome.value } : outcome.error,
  );
}
