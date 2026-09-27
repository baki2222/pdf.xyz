/**
 * The read bound a `per-call` AI processor (summarize, chat, extract) runs
 * under. The start-up proof that this image honours it is `./read-cap-proof`.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * The route charges a `per-call` run the document characters the browser
 * declared (`aiReservationFor`), and that is only safe if the worker then READS
 * no more of the document than was declared. Before this module the three
 * processors ignored `input.delivery` entirely, so a declared count would have
 * been a discount on a full read: declare one character, pay four, have 500,000
 * sent to the provider. The cap is what makes a small document charge true.
 *
 * It bounds the document and nothing else. The options (a chat question and
 * its turns, an extract prompt or schema, a summarize focus) reach the model
 * whatever the cap says; the route measures and charges them itself.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 * It never RAISES the engine's own limit. The bound is
 * `min(configured, cap.characters)`, so an absent cap leaves every job exactly
 * where it was, and a large honest declaration reads to the engine's limit and
 * no further.
 */

import { readDeliveryCap, type JobError } from "@/lib/jobs";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";

/**
 * The character bound for one per-call run.
 *
 * FAIL-CLOSED for the reason `readDeliveryCap` gives: a cap that came back from
 * the queue malformed must not read as "no cap", because the convenient reading
 * of a broken bound is "read everything", which is the outcome it exists to
 * prevent.
 */
export function perCallReadLimit(
  delivery: unknown,
  configured: number | undefined,
): { ok: true; maxInputChars: number } | { ok: false; error: JobError } {
  const engineLimit = configured ?? AI_INPUT_LIMITS.maxInputCharacters;
  const cap = readDeliveryCap(delivery);
  if (!cap.ok) {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: `This job could not be run because ${cap.reason}.`,
        retryable: false,
      },
    };
  }
  return {
    ok: true,
    maxInputChars: cap.cap
      ? Math.min(engineLimit, Math.floor(cap.cap.characters))
      : engineLimit,
  };
}
