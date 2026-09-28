/**
 * How much of a document ONE run of a read-bound AI tool reads — Summarize,
 * Chat with PDF and AI Data Extraction — in the unit a visitor is given.
 *
 * ── THE DEFECT (2026-09-28) ─────────────────────────────────────────────────
 *
 * Every read-bound page stated "500,000 characters read": the FAQ (shipped as
 * FAQPage JSON-LD) and each panel's Limit row, all interpolating
 * `AI_INPUT_LIMITS.maxInputCharacters`. That was the ENGINE's truncation
 * window. Once the worker enforced what the job reserved
 * (`workers/processor/read-cap.ts`), a run reads
 * `min(engine window, the reservation)`, and the largest reservation a browser
 * can make is one whole day's allowance (`workers/ai-read-declaration.ts`
 * clamps to it). So a 300,000-character report was read to about a quarter of
 * that while its page promised all of it. The figure named the mechanism that
 * USED to bind, not the property "what one run can read".
 *
 * ── WHY THE PUBLISHED UNIT IS THE BROWSER'S ─────────────────────────────────
 *
 * The reservation is charged in worker-extracted characters (`declared × h`,
 * see `ai-allowance.ts`), a unit nobody outside the worker can measure. The
 * figure a visitor can check against their own document is the browser count
 * the panel declares — the same unit the daily allowance is published in. The
 * worker window {@link AI_READ_WINDOW_WORKER_CHARACTERS} is that declaration
 * with the extractor headroom on top, so a document of
 * {@link AI_READ_LIMIT_CHARACTERS} browser characters is read whole; were the
 * engine window ever the tighter bound, the published figure falls to what
 * that window covers in the browser's unit, never above it.
 *
 * `ai-ceiling-surfaces.test.ts` derives the same number INDEPENDENTLY — it
 * runs the real declaration on an over-long real PDF and the real processor on
 * an over-long text, and reads what the job reports it sent — and fails any
 * page stating another figure. This module is the copy's source, not the
 * guard's.
 */
import { AI_CHARACTER_ALLOWANCE_DELIVERED } from "./ai-allowance";
import { AI_DELIVERY_LIMITS, deliveryCapFor } from "./delivery-cap";
import { AI_INPUT_LIMITS } from "./types";

/**
 * Worker characters the largest admissible read-bound run reads: the engine's
 * truncation window, narrowed to the cap of the largest declaration the
 * limiter can ever admit — one whole day's allowance.
 */
export const AI_READ_WINDOW_WORKER_CHARACTERS = Math.min(
  AI_INPUT_LIMITS.maxInputCharacters,
  deliveryCapFor(
    { declaredCharacters: AI_CHARACTER_ALLOWANCE_DELIVERED },
    AI_DELIVERY_LIMITS,
  ).characters,
);

/**
 * THE PUBLISHED PER-RUN READ LIMIT, in browser-counted characters: the most a
 * read-bound client declares (`declareAiRead` clamps to exactly this), and so
 * the most one run is charged for and reads.
 */
export const AI_READ_LIMIT_CHARACTERS = Math.min(
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  Math.floor(AI_READ_WINDOW_WORKER_CHARACTERS / AI_DELIVERY_LIMITS.headroom),
);

/** Pages {@link AI_READ_LIMIT_CHARACTERS} covers at the DENSEST measured layout. */
export const aiReadPagesAtDensest = Math.floor(
  AI_READ_LIMIT_CHARACTERS / AI_INPUT_LIMITS.densestCharactersPerPage,
);

/** Pages {@link AI_READ_LIMIT_CHARACTERS} covers at the SPARSEST measured layout. */
export const aiReadPagesAtSparsest = Math.floor(
  AI_READ_LIMIT_CHARACTERS / AI_INPUT_LIMITS.sparsestCharactersPerPage,
);
