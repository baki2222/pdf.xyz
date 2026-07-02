/**
 * GET /api/jobs/[id] — read job status (DEVELOPMENT CONTRACT STUB).
 *
 * Validates the job id format, then answers honestly. With no backend wired up
 * there are no jobs to look up, so a well-formed id returns
 * `503 worker_not_configured`. It NEVER fabricates a job or a "completed"
 * status. See docs/WORKER_ARCHITECTURE.md.
 */

import {
  apiError,
  isValidJobId,
  isWorkerBackendConfigured,
  notImplemented,
  workerNotConfigured,
} from "@/lib/jobs";
import { respond } from "../../_lib/http";

// Status is never cached: always reflects the live job state.
export const dynamic = "force-dynamic";

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

  // Well-formed id, but nothing to look up without a backend. Never fabricate a
  // job — respond based on whether a real backend is configured.
  return respond(
    isWorkerBackendConfigured() ? notImplemented() : workerNotConfigured(),
  );
}
