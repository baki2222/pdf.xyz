/**
 * POST /api/uploads — create an upload session.
 *
 * Validates the request against the typed contract in "@/lib/jobs", then
 * delegates to the active worker adapter (see `@/lib/workers`). With no backend
 * the adapter answers honestly (`503 worker_not_configured`); it never mints
 * usable upload URLs or pretends a file was accepted. Only the developer-only
 * local-dev worker returns real, single-use slots. See
 * docs/WORKER_ARCHITECTURE.md.
 */

import { parseCreateUploadSessionRequest } from "@/lib/jobs";
import { getWorkerAdapter } from "@/lib/workers";
import { readJsonBody, respond } from "../_lib/http";

// Never statically cached: a request-scoped, no-store endpoint. Node runtime —
// the local-dev adapter uses Node built-ins (lazily imported only in that mode).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return respond(body.error);

  const parsed = parseCreateUploadSessionRequest(body.value);
  if (!parsed.ok) return respond(parsed.error);

  const adapter = await getWorkerAdapter();
  const outcome = await adapter.createUploadSession(parsed.value);
  return respond(
    outcome.ok ? { status: outcome.status, body: outcome.value } : outcome.error,
  );
}
