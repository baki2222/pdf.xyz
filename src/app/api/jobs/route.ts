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
  aiReservationFor,
  capabilityForMode,
  parseCreateJobRequest,
  type AiReservation,
} from "@/lib/jobs";
import { getToolBySlug } from "@/lib/tools";
import { getWorkerAdapter } from "@/lib/workers";
import {
  runningWorkerRendersHtmlZip,
  runningWorkerEnforcesAiReadCap,
  runningWorkerTranslatesScans,
} from "@/lib/workers/heartbeat";
import { translateAsksForOcr } from "@/lib/jobs/translate-pdf";
import {
  HTML_ZIP_ENTRY_OPTION,
  HTML_ZIP_NOT_RUNNING_MESSAGE,
  isZipName,
} from "@/lib/workers/html-render/zip-config";
import {
  TRANSLATE_OCR_NOT_RUNNING_MESSAGE,
  translateOcrMissingPacksMessage,
} from "@/lib/jobs/translate-ocr";
import {
  describeOcrLanguage,
  isOcrLanguage,
  parsePdfToWordOptions,
} from "@/lib/jobs/ocr";
import {
  enforceRateLimit,
  peekAiSpendCeiling,
  reserveAiCharacterAllowance,
  type AiAllowanceReservation,
} from "@/lib/ratelimit/guard";
import { AI_JOB_DELIVERY_LIMITS } from "@/lib/jobs/ai-allowance";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { parseAiToolOptions } from "@/lib/jobs/ai-tool-options";
import { apiError } from "@/lib/jobs/responses";
import { evaluateJobInputCount, intakeErrorResult } from "@/lib/uploads/intake";
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

  // AN AI JOB'S OPTIONS ARE CHECKED BEFORE ANYTHING IS CHARGED. Until
  // 2026-09-28 only the worker parsed them, so a request the contract already
  // knew was bad — two schema fields both named "Total" — reserved a third of
  // the day and failed on the worker, which gives nothing back. The table is
  // the one the processors read, so this check and the worker's cannot
  // disagree about what is admissible (`@/lib/jobs/ai-tool-options`).
  const aiOptions = parseAiToolOptions(parsed.value.tool, parsed.value.options);
  if (aiOptions && !aiOptions.ok) return respond(aiOptions.error);

  // OCR INSIDE TRANSLATE IS ADMITTED ONLY WHEN THE RUNNING WORKER PROVES IT
  // (audit translate-pdf#3), and before anything is charged. An image built
  // before the feature ignores the request and refuses the scan as having no
  // text — after the allowance was taken. The panel offers OCR only on the
  // same proof (the same predicate, `translateScanAdmission`); this is the
  // line for every other caller, and for a worker that changed between the
  // page's status check and Run. The LANGUAGES are held to the same line: a
  // pack the beat does not report is refused by OCR's own check on the worker
  // before any work, and that failure gives the reservation back no more than
  // the older image's does.
  if (
    aiOptions?.ok &&
    parsed.value.tool === "translate-pdf" &&
    translateAsksForOcr(parsed.value.options ?? {})
  ) {
    const ocrRequest = parsePdfToWordOptions(parsed.value.options ?? {});
    // Already validated by `parseTranslateOptions` above; re-read for the codes.
    if (!ocrRequest.ok) return respond(ocrRequest.error);
    const admission = await runningWorkerTranslatesScans(
      ocrRequest.value.languages,
    );
    if (!admission.ok) {
      return respond(
        admission.reason === "missing_packs"
          ? apiError(
              "unprocessable_entity",
              translateOcrMissingPacksMessage(
                admission.missing.map((code) =>
                  isOcrLanguage(code) ? describeOcrLanguage(code) : code,
                ),
              ),
            )
          : apiError("not_implemented", TRANSLATE_OCR_NOT_RUNNING_MESSAGE),
      );
    }
  }

  // A ZIP JOB FOR HTML TO PDF IS ADMITTED ONLY WHEN THE RUNNING WORKER PRINTS
  // ONE (competitor audit #26) — the same predicate the page's offer and the
  // upload gate use (`liveWorkerRendersHtmlZip`). An image built before the
  // feature ignores `entry` and renders the archive's bytes as HTML. A ZIP
  // job is told by its `entry` option (the browser always sends one for a
  // ZIP) or by an input named .zip; the upload route refused a ZIP already
  // on the same proof, and this holds the line if the worker changed since.
  if (
    parsed.value.tool === "html-to-pdf" &&
    (parsed.value.options?.[HTML_ZIP_ENTRY_OPTION] !== undefined ||
      (parsed.value.inputNames ?? []).some(isZipName)) &&
    !(await runningWorkerRendersHtmlZip())
  )
    return respond(apiError("not_implemented", HTML_ZIP_NOT_RUNNING_MESSAGE));

  /**
   * What this job is charged, and what it may then deliver.
   *
   * DECLARED HERE rather than inside the branch below because the charge and
   * the cap are the same decision seen twice, and a `let` scoped to the branch
   * that CHARGES would let the branch that DELIVERS be forgotten — which is the
   * whole defect: a reservation nothing enforces looks enforced. `undefined`
   * means this job is not AI-capability: no charge, no cap.
   */
  let reservation: AiReservation | undefined;
  /**
   * The allowance this request DEBITED, held until the job exists. See the
   * release below the adapter call — the charge is taken BEFORE the fork and
   * so must be settled on BOTH of its branches.
   */
  let allowance: AiAllowanceReservation | undefined;
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
     * `reservation.charge` is what the allowance is debited below, and
     * `reservation.delivery` is what the worker is later bound to. Both come
     * from one call, so what is billed and what may be delivered cannot drift:
     * for translate they are the same number, and for a per-call tool (summarize,
     * chat, extract) the charge is the document read bound plus the options the
     * server measures off `parsed.value` plus the engine's instructions.
     *
     * A per-call tool is priced by its declared size only while the running
     * worker proves it reads no more of the document than that, and sends
     * nothing else the charge does not count (`aiReadCap` on a fresh
     * heartbeat). Until 2026-09-27 every such run was charged a third of the
     * day whatever the document held — three one-page summaries, or three chat
     * questions, against a published allowance of 30,774 characters.
     *
     * The worker bounds the DOCUMENT only. The question, carried turns, prompt,
     * schema or focus are bounded by the options byte cap and charged here, by
     * the server's own count of the body, never by the client's declaration.
     */
    /**
     * The limits object the published allowance is computed from, not a
     * second literal of it: each AI page states what ITS runs cost, and the
     * per-run ceiling and floor are derived from `AI_JOB_DELIVERY_LIMITS`.
     */
    reservation = await aiReservationFor(tool.slug, parsed.value, {
      ...AI_JOB_DELIVERY_LIMITS,
      readCapEnforced: () => runningWorkerEnforcesAiReadCap(),
    });
    allowance = await reserveAiCharacterAllowance(reservation.charge, request);
    if (!allowance.decision.allowed)
      return respondRateLimited(allowance.decision);
  }

  /**
   * A JOB THAT WAS NOT CREATED COSTS NOTHING.
   *
   * The allowance is charged above, before the job exists, and on 67e8d0f
   * nothing gave it back: a queue outage, storage not ready, a broker error —
   * each returned its honest error AND kept a third of the caller's day. Three
   * of those and the connection was refused AI until tomorrow, with no job to
   * show for it. The guard was correct; the defect was that the success branch
   * was the only branch anyone had thought about.
   *
   * Every failure is released, including an ambiguous broker error that might
   * have recorded the job: the caller never receives a job id, so can never
   * receive its result, and the money bound is `ai.spend`, recorded by the
   * worker on what it actually runs — not this fairness counter.
   */
  const adapter = await getWorkerAdapter();
  let outcome: Awaited<ReturnType<typeof adapter.createJob>>;
  try {
    outcome = await adapter.createJob(parsed.value, reservation?.delivery);
  } catch (error) {
    await allowance?.release();
    throw error;
  }
  if (!outcome.ok) await allowance?.release();
  return respond(
    outcome.ok
      ? { status: outcome.status, body: outcome.value }
      : outcome.error,
  );
}
