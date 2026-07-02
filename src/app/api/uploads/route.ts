/**
 * POST /api/uploads — create an upload session (DEVELOPMENT CONTRACT STUB).
 *
 * This validates a request against the typed contract in "@/lib/jobs" and then
 * answers honestly: no real object storage is wired up, so it returns a
 * `503 worker_not_configured`. It NEVER mints usable upload URLs or pretends a
 * file was accepted. See docs/WORKER_ARCHITECTURE.md.
 */

import {
  isWorkerBackendConfigured,
  notImplemented,
  parseCreateUploadSessionRequest,
  workerNotConfigured,
} from "@/lib/jobs";
import { readJsonBody, respond } from "../_lib/http";

// Never statically cached: this is a request-scoped, no-store endpoint.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return respond(body.error);

  const parsed = parseCreateUploadSessionRequest(body.value);
  if (!parsed.ok) return respond(parsed.error);

  // The request is well-formed. We never fake success — respond based on whether
  // a real backend is configured in this environment.
  return respond(
    isWorkerBackendConfigured() ? notImplemented() : workerNotConfigured(),
  );
}
