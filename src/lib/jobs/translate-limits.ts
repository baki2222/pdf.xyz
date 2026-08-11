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
 * WHICH QUANTITY THESE NUMBERS ARE — resolved 2026-08-11, and the answer was
 * that the record itself was in two different units.
 *
 * **Both figures are now WORKER-EXTRACTED characters**, which is the quantity
 * `translate/engine.ts` compares (`extracted.text.trim().length`). Getting here
 * took three corrections and the third is the one that matters:
 *
 *  1. `largestSuccessChars: 10_258` was read off the product's own truncation
 *     block (`results.ai.truncation.charactersTotal`), so it always WAS an
 *     extracted count. The fixture that produced it drew 10,146. The ceiling is
 *     therefore **exact**, not conservative.
 *  2. `smallestFailureChars` was 13,528 — the fixture GENERATOR's accumulator,
 *     never extracted by anything. Its worker-extracted value is 13,678, quoted
 *     by the deployed refusal itself. Corrected here. The two ends of the
 *     bracket were recorded from different sources, in the same table, and the
 *     1.011 ratio holding across both is what made them reconcilable at all.
 *  3. **AND "EXTRACTED" IS NOT ONE QUANTITY.** See the extractor-seam warning
 *     below: the browser and the worker read the same document differently, so
 *     this bracket is calibrated in a unit the PANEL does not measure in.
 *
 * The lesson is the same one this constant has now taught twice: a figure whose
 * UNIT is unrecorded is a defect even when its value is right, because the next
 * person compares it to something. `AI_INPUT_LIMITS` named reading while
 * translate was bound by writing; `AI_MAX_OUTPUT_TOKENS_BOUNDS.default` named a
 * budget nothing consumed; this named a document while the code weighed an
 * extraction.
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
  /**
   * Largest source text that COMPLETED (3 pages, 36s).
   *
   * WORKER-EXTRACTED characters — the quantity the engine compares. Read from
   * `results.ai.truncation.charactersTotal` on the completed job. The fixture
   * that produced it drew 10,146 characters; the surplus is the extractor's.
   */
  largestSuccessChars: 10_258,
  /**
   * Smallest source text that FAILED with "reached its output limit" (4 pages, 45s).
   *
   * WORKER-EXTRACTED characters, quoted by the deployed refusal itself. Was
   * recorded as 13,528 — the generator's drawn count, a different unit from the
   * success end it sat beside in the same table.
   */
  smallestFailureChars: 13_678,
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
 *
 * ⚠️ TWO EXTRACTORS MEASURE AGAINST THIS NUMBER, AND THEY DO NOT AGREE.
 *
 * The engine compares `extracted.text.trim().length` from native
 * `pdftotext -layout`; the panel compares `extracted.characterCount` from pdfjs
 * in the browser. Same document, different counts — production, 2026-08-11:
 * browser **13,530**, worker **13,678**.
 *
 * THE MECHANISM, measured rather than reasoned about. `pdftotext -layout`
 * reconstructs the page's horizontal arrangement by padding between columns
 * with spaces. `textItemsToPlainText` structurally cannot do that: it appends
 * `item.str` and a newline on `hasEOL`, so it can never emit a space that is not
 * inside a text item. The surplus is therefore inter-column whitespace, and it
 * scales with PAGE GEOMETRY rather than with text length.
 *
 * Measured locally (Xpdf `pdftotext` 4.00 — NOT the worker's poppler build, so
 * treat the magnitudes as indicative and the SHAPE as the finding), six
 * pdf-lib fixtures, 120 lines each, worker length ÷ drawn length:
 *
 * ```
 *   single-column prose   -layout 1.0001   raw 1.0001
 *   deep left indent      -layout 1.0005   raw 1.0005
 *   two columns           -layout 1.1206   raw 1.0203
 *   sparse wide grid      -layout 1.4142   raw 1.1102
 *   four-column table     -layout 1.4385   raw 1.0801
 *   eight-column grid     -layout 1.8626   raw 1.2082
 * ```
 *
 * **So there is no factor to apply.** The ratio has no finite worst case: its
 * supremum is line-width ÷ characters-per-line, which a wide sparse table drives
 * arbitrarily high. Dropping `-layout` shrinks it (1.86 → 1.21 at the observed
 * worst) but does not close it. A "measured safety margin" here would be the
 * same mistake as the 3.5 × 1.3 that this file exists to record — a guess
 * multiplied into a ceiling — only worse, because this one has no bound to guess
 * at.
 *
 * WHAT IT COSTS TODAY: a document the panel measures just under this number can
 * measure just over it at the worker, so it is uploaded, scanned, charged one of
 * three daily AI runs, and then refused — the exact cost the pre-upload check
 * was built to remove, surviving in a narrow band at the boundary. Everything
 * outside that band is correct.
 *
 * The band is narrow because the ratio is ~1.00 for the ordinary prose this
 * ceiling was calibrated on. It is NOT narrow for tables: at 1.44 a four-column
 * document reaches this ceiling with barely two-thirds of its real text, and
 * pays output budget to have alignment spaces translated.
 */
export const TRANSLATE_MAX_INPUT_CHARS = translateMaxInputChars(
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
);
