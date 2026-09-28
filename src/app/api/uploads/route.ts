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

import {
  capabilityForMode,
  parseCreateUploadSessionRequest,
  smallestAiReservation,
} from "@/lib/jobs";
import { getToolBySlug } from "@/lib/tools";
import { getWorkerAdapter } from "@/lib/workers";
import { runningWorkerEnforcesAiReadCap } from "@/lib/workers/heartbeat";
import {
  enforceRateLimit,
  peekAiCharacterAllowance,
  peekAiSpendCeiling,
} from "@/lib/ratelimit/guard";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { apiError } from "@/lib/jobs/responses";
import {
  evaluateUploadDescriptors,
  intakeErrorResult,
} from "@/lib/uploads/intake";
import {
  readJsonBody,
  rejectCrossSite,
  respond,
  respondRateLimited,
} from "../_lib/http";

// Never statically cached: a request-scoped, no-store endpoint. Node runtime —
// the local-dev adapter uses Node built-ins (lazily imported only in that mode).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Cross-site browser writes are refused before anything else — including
  // the rate-limit charge they would otherwise spend (see rejectCrossSite).
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  // Abuse guard first, before reading the body: throttle a flood before doing any
  // work. A no-op unless a limiter is configured (see @/lib/ratelimit); the honest
  // not-configured semantics below are otherwise untouched.
  const limit = await enforceRateLimit("uploads.create", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const body = await readJsonBody(request);
  if (!body.ok) return respond(body.error);

  // Upload-intake guardrails: reject out-of-contract size/type/count/shape early
  // with a stable code (file_too_large, unsupported_file_type, too_many_files, …),
  // before the typed validator and any storage/queue work. Deterministic order:
  // abuse guard → this gate → tool validation. A throttled flood never reaches
  // here; for the dimensions this layer owns its code wins, and it is only ever
  // stricter than the validator, never laxer. See docs/SECURITY.md.
  const intake = evaluateUploadDescriptors(body.value);
  if (!intake.ok) return respond(intakeErrorResult(intake.rejection));

  const parsed = parseCreateUploadSessionRequest(body.value);
  if (!parsed.ok) return respond(parsed.error);

  /**
   * AN UPLOAD WHOSE JOB CANNOT BE ADMITTED IS REFUSED BEFORE THE BYTES MOVE.
   *
   * `POST /api/jobs` decides whether an AI job may run — the global spend
   * ceiling, then the caller's daily allowance — and the client reaches it
   * only after this route AND the byte PUT. So a connection whose allowance
   * was already gone uploaded the whole file and was refused afterwards
   * (audit at 67e8d0f). Both are asked here too, with the same answers the
   * job route would give, and both are PEEKS: this route never spends.
   *
   * The allowance is asked about the SMALLEST reservation a job of THIS tool
   * could make, priced as the job route prices it (per call, and by the
   * running worker's proof) — not the file's likely cost: an upload does not
   * know what its job will declare, and refusing a file some honest
   * declaration could still run would be the opposite defect. Pinned against
   * the job route's own verdict in `ai-admission.chain.test.ts`.
   */
  const tool = getToolBySlug(parsed.value.tool);
  if (tool && capabilityForMode(tool.processing) === "ai") {
    const ceiling = await peekAiSpendCeiling();
    if (!ceiling.affordable) {
      return respond(
        apiError("service_unavailable", AI_CEILING_REACHED_MESSAGE),
      );
    }
    const allowance = await peekAiCharacterAllowance(
      await smallestAiReservation(tool.slug, () =>
        runningWorkerEnforcesAiReadCap(),
      ),
      request,
    );
    if (!allowance.allowed) return respondRateLimited(allowance);
  }

  const adapter = await getWorkerAdapter();
  const outcome = await adapter.createUploadSession(parsed.value);
  return respond(
    outcome.ok
      ? { status: outcome.status, body: outcome.value }
      : outcome.error,
  );
}
