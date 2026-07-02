/**
 * POST /api/jobs — create a processing job (DEVELOPMENT CONTRACT STUB).
 *
 * Validates a job request against the typed contract in "@/lib/jobs" (strict
 * tool/input/options/URL checks) and then answers honestly. No queue or worker
 * is wired up, so a well-formed request returns `503 worker_not_configured`.
 * It NEVER enqueues or fakes a completed job. See docs/WORKER_ARCHITECTURE.md.
 */

import {
  isWorkerBackendConfigured,
  notImplemented,
  parseCreateJobRequest,
  workerNotConfigured,
} from "@/lib/jobs";
import { readJsonBody, respond } from "../_lib/http";

// Never statically cached: this is a request-scoped, no-store endpoint.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return respond(body.error);

  const parsed = parseCreateJobRequest(body.value);
  if (!parsed.ok) return respond(parsed.error);

  // The request is well-formed. We never fake success — respond based on whether
  // a real backend is configured in this environment.
  return respond(
    isWorkerBackendConfigured() ? notImplemented() : workerNotConfigured(),
  );
}
