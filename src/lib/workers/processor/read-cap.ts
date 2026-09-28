/**
 * The delivery cap, applied to an engine that READS a document — Summarize,
 * Chat with PDF and AI Data Extraction.
 *
 * ── THE DEFECT (2026-09-28) ─────────────────────────────────────────────────
 *
 * `POST /api/jobs` charges every AI job `deliveryCapFor(...).characters` and
 * hands that same cap to the adapter, which carries it to the worker as
 * `ProcessorInput.delivery`. Translate's processor read it. These three never
 * did: they ran with `maxInputChars: AI_INPUT_LIMITS.maxInputCharacters`
 * (500,000) whatever had been reserved. So the reservation bound nothing — the
 * exact "reservation nothing enforces looks enforced" shape the route's own
 * comment names — and a caller that declared one character was read in full.
 *
 * ── WHAT IS ENFORCED ────────────────────────────────────────────────────────
 *
 * The CHARACTER bound only, as the engines' existing truncation window: the
 * engine reads `min(its configured window, cap.characters)` and discloses the
 * page it reached, exactly as it already does for a document longer than its
 * window. The cap is in worker-extracted characters and already carries the
 * extractor headroom, so an honest caller's document is read whole.
 *
 * The PAGE bound is not applied here, and read-bound clients do not declare
 * one: it exists to cross-check chunked translation, and a truncation window
 * cut at a page boundary is described by `describeWindow` as a mid-page cut of
 * the next page. A declared bound nothing enforces would be the defect above
 * again, so there is none.
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────────
 *
 * Re-read with `readDeliveryCap`, never trusted: the value came back from the
 * queue as `JSON.parse(raw) as T`. Absent means unbounded (a job queued before
 * the cap existed); present-and-malformed is a bug on our own write path, and
 * its convenient reading — "read everything" — is what the cap prevents.
 */
import { readDeliveryCap } from "@/lib/jobs/delivery-cap";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";

/** The one limit every read-bound engine's truncation window is taken from. */
export interface ReadWindowLimits {
  maxInputChars?: number;
}

export type BoundReadLimits<L extends ReadWindowLimits> =
  { ok: true; limits: L | undefined } | { ok: false; message: string };

/**
 * `limits` with its reading window narrowed to what the job reserved.
 *
 * Returns `limits` untouched when the job carries no cap. The message on a
 * malformed cap is the one translate's processor sends for the same fault.
 */
export function boundReadLimits<L extends ReadWindowLimits>(
  limits: L | undefined,
  delivery: unknown,
): BoundReadLimits<L> {
  const cap = readDeliveryCap(delivery);
  if (!cap.ok) {
    return {
      ok: false,
      message: `This job could not be run because ${cap.reason}.`,
    };
  }
  if (cap.cap === null) return { ok: true, limits };
  const window = limits?.maxInputChars ?? AI_INPUT_LIMITS.maxInputCharacters;
  return {
    ok: true,
    limits: {
      ...(limits ?? ({} as L)),
      maxInputChars: Math.min(window, cap.cap.characters),
    },
  };
}
