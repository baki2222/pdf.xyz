/**
 * How much text translate can actually handle — **measured end to end, not
 * derived from two rules of thumb.**
 *
 * Every AI tool was put on one shared input cap, `AI_INPUT_LIMITS.maxInputCharacters`
 * (500,000). For summarize, chat and extract that is genuinely the binding
 * constraint: a lot goes in, a short answer comes out. **Translate's output is as
 * long as its input**, so the thing that stops it is how much the model is allowed
 * to WRITE — and nothing distinguished the two, because the shared constant's name
 * describes reading. The panel advertised 500,000 characters and the tool died
 * around 12,000, after 49 seconds and one of three daily AI runs.
 *
 * THE FIRST FIX WAS ALSO WRONG, AND WRONG THE SAME WAY. It multiplied two
 * plausible constants — ~3.5 characters per output token, ~1.3 expansion for a
 * translation running longer than its source — and got 2.69, which put the
 * ceiling at 21,538. The measured value is **1.28**. Two guesses, each defensible
 * alone, compounded into a number 1.8x too generous and still in the unsafe
 * direction. There is no version of that model where reading it would have
 * revealed the error.
 *
 * SO THE FACTOR IS THE MEASUREMENT. One rate, obtained by running real documents
 * through the real provider, rather than two factors that multiply. A single
 * end-to-end rate cannot compound, and its provenance is a date and a bracket
 * rather than an argument.
 */

/**
 * The production bracket this ceiling is derived from.
 *
 * Five documents, one model, one target language, one afternoon. The pair that
 * matters is `largestSuccessChars` and `smallestFailureChars`: the true boundary
 * is between them, and every published number has to sit inside that gap.
 *
 * ⚠️ CALIBRATED ON SPANISH, WHICH IS A FAVOURABLE CASE — but the non-Latin risk
 * this warning was written for has been checked at the shipped value, and it did
 * not materialise. Characters-per-token is a property of the TARGET language,
 * and Latin scripts are the best represented in these tokenizers; the concern
 * was that Bengali, Russian and Ukrainian would cost materially more tokens per
 * character and that a Spanish-calibrated ceiling would overpromise for them.
 *
 * MEASURED 2026-08-11, production, `target=bn`: a 10,258-character document —
 * the shipped ceiling exactly, and the size that passes in Spanish — **completed
 * in 36 seconds**, the same time as Spanish. Bengali is among the hardest scripts
 * advertised here, with Cyrillic between it and Latin, so this is cover for the
 * set rather than one lucky point.
 *
 * WHAT THAT PROVES AND DOES NOT. It proves the Bengali ceiling is **at or above**
 * the shipped value, which is the only question the design put at risk. It does
 * NOT locate the Bengali ceiling and does NOT show the two languages share one.
 * The gap is therefore **unmeasured rather than unexamined** — and if the budget
 * ever rises, the ceiling rises with it and this single point stops covering the
 * new value. Re-probe before trusting a larger number.
 */
/**
 * WHICH QUANTITY THESE NUMBERS ARE, because the code compares a different one.
 *
 * Both checks test the EXTRACTED character count — `extracted.text.trim().length`
 * in the engine, `extracted.characterCount` in the panel. The bracket figures
 * below were reported as document sizes, and extraction adds whitespace and line
 * breaks: measured on production, a 13,528-character fixture extracted to 13,678
 * (+1.1%).
 *
 * So if `largestSuccessChars` is also a document size, the document that
 * succeeded actually presented ~1% MORE text than the ceiling now allows, and
 * the ceiling is conservative by about that margin. If it was already an
 * extracted count, the ceiling is exact. **The unknown is bounded and points the
 * safe way in both cases**, which is why no constant moves — but a future reader
 * should not assume this figure is the quantity the check sees.
 */
export const TRANSLATE_CALIBRATION = {
  /** ISO date of the production run. */
  measuredOn: "2026-08-11",
  /** The model the bracket was measured against. */
  model: "gpt-5.6-luna",
  /** Target language of the bracket — see the warning above. */
  targetLanguage: "es",
  /** The output budget in force during the run. */
  outputTokenBudget: 8_000,
  /** Largest source text that COMPLETED (3 pages, 36s). */
  largestSuccessChars: 10_258,
  /** Smallest source text that FAILED with "reached its output limit" (4 pages, 45s). */
  smallestFailureChars: 13_528,
} as const;

/**
 * Source characters per output token, measured.
 *
 * Not a tokenizer statistic and not an expansion estimate — the two together, as
 * one observed rate, so they cannot compound. Deriving it from
 * `largestSuccessChars` rather than typing it means the number and the evidence
 * for the number are the same thing.
 */
export const TRANSLATE_CHARS_PER_OUTPUT_TOKEN =
  TRANSLATE_CALIBRATION.largestSuccessChars /
  TRANSLATE_CALIBRATION.outputTokenBudget;

/**
 * The most source text translate can accept for a given output budget.
 *
 * A FUNCTION, not a constant: if the output budget ever rises, translate's real
 * capacity rises with it, and a frozen number would become the same lie one notch
 * over. Callers pass the budget the engine will actually send.
 */
export function translateMaxInputChars(maxOutputTokens: number): number {
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) return 0;
  return Math.floor(maxOutputTokens * TRANSLATE_CHARS_PER_OUTPUT_TOKEN);
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
 * Derived from the default budget, so at that budget it is exactly the largest
 * document measured to complete. If an operator ever raises the budget, the
 * engine will accept more than this advertises — the panel under-promises, which
 * is the safe direction: nobody is told a document will work and then charged to
 * find out it does not.
 */
export const TRANSLATE_MAX_INPUT_CHARS = translateMaxInputChars(
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
);
