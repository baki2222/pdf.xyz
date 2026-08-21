/**
 * POST /api/jobs — create a processing job.
 *
 * Validates a job request against the typed contract in "@/lib/jobs" (strict
 * tool/input/options/URL checks), then delegates to the active worker adapter
 * (see `@/lib/workers`). With no backend a well-formed request returns
 * `503 worker_not_configured`; the API never enqueues or fakes a completed job.
 * The developer-only local-dev worker runs supported jobs (compression) for
 * real and fails honestly when it cannot. See docs/WORKER_ARCHITECTURE.md.
 */

import {
  capabilityForMode,
  deliveryCapFor,
  parseCreateJobRequest,
  type JobDeliveryCap,
} from "@/lib/jobs";
import { getToolBySlug } from "@/lib/tools";
import { getWorkerAdapter } from "@/lib/workers";
import {
  enforceAiCharacterAllowance,
  enforceRateLimit,
  peekAiSpendCeiling,
} from "@/lib/ratelimit/guard";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { apiError } from "@/lib/jobs/responses";
import { evaluateJobInputCount, intakeErrorResult } from "@/lib/uploads/intake";
import { readJsonBody, respond, respondRateLimited } from "../_lib/http";

// Never statically cached: a request-scoped, no-store endpoint. Node runtime —
// the local-dev adapter uses Node built-ins (lazily imported only in that mode).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Abuse guard first, before reading the body: throttle a flood before doing any
  // work. A no-op unless a limiter is configured (see @/lib/ratelimit); the honest
  // not-configured semantics below are otherwise untouched.
  const limit = await enforceRateLimit("jobs.create", request);
  if (!limit.allowed) return respondRateLimited(limit);

  const body = await readJsonBody(request);
  if (!body.ok) return respond(body.error);

  // Upload-intake guardrail on the one dimension a job carries: how many uploaded
  // inputs it references. The same configurable per-request file cap governs both
  // an upload session and the job that consumes it. Sizes/types were validated at
  // upload time; here inputs are opaque ids, so only the count is (re)checked.
  const intake = evaluateJobInputCount(body.value);
  if (!intake.ok) return respond(intakeErrorResult(intake.rejection));

  const parsed = parseCreateJobRequest(body.value);
  if (!parsed.ok) return respond(parsed.error);

  // The free daily AI allowance, on top of jobs.create: an AI-capability tool
  // costs real provider spend per run, so it carries its own per-client daily
  // policy. Checked AFTER parsing because the verdict depends on which tool
  // the job names — and the refusal names the allowance, not a generic
  // throttle (see AI_ALLOWANCE_USED_MESSAGE).
  const tool = getToolBySlug(parsed.value.tool);
  /**
   * What this job may deliver, in the two units the reservation is exposed in.
   *
   * DECLARED HERE rather than inside the branch below because the reservation
   * and the cap are the same decision seen twice, and a `let` scoped to the
   * branch that CHARGES would let the branch that DELIVERS be forgotten — which
   * is the whole defect: a reservation nothing enforces looks enforced.
   * `undefined` means this job is not AI-capability and has no cap.
   */
  let delivery: JobDeliveryCap | undefined;
  if (tool && capabilityForMode(tool.processing) === "ai") {
    // The GLOBAL ceiling first, and it is not a 429. A spent cost control is
    // OUR limit, not this caller's quota — answering it as a rate limit would
    // tell someone who has run nothing that they are out of runs. Peeked, never
    // spent: asking whether AI is affordable must not make it unaffordable.
    const ceiling = await peekAiSpendCeiling();
    if (!ceiling.affordable) {
      return respond(
        apiError("service_unavailable", AI_CEILING_REACHED_MESSAGE),
      );
    }

    /**
     * The free daily allowance, reserved in CHARACTERS.
     *
     * A "run" priced a job while every job was one provider call; chunked
     * translation makes one job up to thirty, so three runs a day both refused
     * a long document and charged three short ones the whole day.
     *
     * THE RESERVATION CARRIES HEADROOM, and it is not generosity: the browser
     * counts with pdfjs and the worker reads with `pdftotext -layout`, and the
     * browser under-counts — it concatenates adjacent text items with nothing
     * between them. Reserving the raw claim would truncate an HONEST caller's
     * own document. The factor is derived (see the constant) rather than
     * sampled, and it cancels out of a client's documents-per-day entirely.
     *
     * AN UNDECLARED JOB RESERVES A WHOLE CALL'S WORTH. That is not a penalty
     * and not an error — it is exactly the behaviour every caller had before
     * this field existed (three such jobs a day), so a direct API caller keeps
     * working and simply pays the maximum until it declares.
     */
    /**
     * ONE OBJECT, CHARGED AND THEN ENFORCED — never two expressions that
     * happen to agree.
     *
     * `delivery.characters` is what the allowance is debited below and what the
     * worker is later bound to deliver. Handing that same value to the adapter
     * is what makes the debit true in both directions: without it the
     * reservation is a number the system takes and does not honour, and the
     * caller pays it and receives whatever the document happens to hold.
     */
    delivery = deliveryCapFor(parsed.value, {
      fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
      headroom: TRANSLATE_EXTRACTOR_HEADROOM,
    });
    const aiLimit = await enforceAiCharacterAllowance(
      delivery.characters,
      request,
    );
    if (!aiLimit.allowed) return respondRateLimited(aiLimit);
  }

  const adapter = await getWorkerAdapter();
  const outcome = await adapter.createJob(parsed.value, delivery);
  return respond(
    outcome.ok
      ? { status: outcome.status, body: outcome.value }
      : outcome.error,
  );
}
