/**
 * How much text translate can actually handle — **derived from the OUTPUT budget,
 * because that is what binds it.**
 *
 * Every AI tool was put on one shared input cap, `AI_INPUT_LIMITS.maxInputCharacters`
 * (500,000). For summarize, chat and extract that is genuinely the binding
 * constraint: a lot goes in, a short answer comes out. **Translate's output is as
 * long as its input**, so the thing that stops it is how much the model is allowed
 * to WRITE — and nothing distinguished the two, because the shared constant's name
 * describes reading.
 *
 * Measured on production 2026-08-11, `gpt-5.6-luna`:
 *
 *     3 pages,  10,258 chars  ->  completed, 36s
 *    40 pages, 135,280 chars  ->  FAILED,    49s  ("reached its output limit")
 *   200 pages, 800,090 chars  ->  FAILED,    same class
 *
 * The panel meanwhile advertised **500,000 characters read** — off by more than an
 * order of magnitude, and a user paid 49 seconds and one of three daily AI runs to
 * discover it.
 *
 * A CONSEQUENCE WORTH NAMING: the truncation notice built in TASK-43/45 can never
 * fire for translate. Truncation begins at 500,000 characters; translate fails
 * long before that. An honesty surface was shipped into a tool that cannot reach
 * the condition it describes.
 */

/**
 * Characters per output token, conservatively.
 *
 * ~4 is the usual rule of thumb for English in GPT-family tokenizers; other
 * scripts and accented languages tokenize worse (fewer characters per token).
 * The low estimate is the safe one here — it makes the ceiling SMALLER, and the
 * cost of being too high is the 49-second paid failure this exists to prevent.
 */
export const TRANSLATE_CHARS_PER_OUTPUT_TOKEN = 3.5;

/**
 * How much longer a translation runs than its source.
 *
 * Translations of English into Romance and Germanic languages typically run
 * 15–30% longer in characters; 1.3 is the top of that band, so the ceiling is
 * sized for the worst common case rather than the average. Deliberately ONE
 * factor and not a per-language table: a table is a second thing to maintain, and
 * an unlisted language would silently fall back to the wrong number.
 */
export const TRANSLATE_EXPANSION_FACTOR = 1.3;

/**
 * The most source text translate can accept for a given output budget.
 *
 * A FUNCTION, not a constant: if the output budget ever rises, translate's real
 * capacity rises with it, and a frozen number would become the same lie one notch
 * over. Callers pass the budget the engine will actually send.
 */
export function translateMaxInputChars(maxOutputTokens: number): number {
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) return 0;
  return Math.floor(
    (maxOutputTokens * TRANSLATE_CHARS_PER_OUTPUT_TOKEN) /
      TRANSLATE_EXPANSION_FACTOR,
  );
}

/**
 * The refusal a user sees, with both numbers in it.
 *
 * "Too long" without saying how long, against what, is not something anyone can
 * act on — they cannot tell whether to split the file in two or in twenty.
 */
export function translateTooLongMessage(
  characters: number,
  ceiling: number,
): string {
  return (
    `This document has ${characters.toLocaleString("en-US")} characters of text, and ` +
    `Translate PDF can handle about ${ceiling.toLocaleString("en-US")} in one run — ` +
    `roughly ${Math.max(1, Math.round(ceiling / 3794))} pages of ordinary prose. ` +
    `Split it into smaller files and translate them one at a time.`
  );
}

/**
 * The output budget translate actually sends today.
 *
 * It lives here rather than in the engine so the published ceiling and the
 * request that produces it cannot disagree — the engine imports it back.
 *
 * NOTE, and it is a finding rather than a design: `PDFXYZ_AI_MAX_OUTPUT_TOKENS`
 * (bounded, defaulting to 4,000 in `workers/ai/config.ts`) is resolved and then
 * read by NOTHING. No `native.ts` passes `maxOutputTokens` into an engine's
 * limits, so all four AI engines fall back to their own hardcoded defaults and
 * the configured value is inert. Wiring it up would change what three other
 * tools send, so it is reported rather than done here.
 */
export const TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS = 8_000;

/**
 * The ceiling as advertised and as checked before upload.
 *
 * Derived from the default budget. If an operator ever raises the budget, the
 * engine will accept more than this advertises — the panel under-promises,
 * which is the safe direction: nobody is told a document will work and then
 * charged to find out it does not.
 */
export const TRANSLATE_MAX_INPUT_CHARS = translateMaxInputChars(
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
);
