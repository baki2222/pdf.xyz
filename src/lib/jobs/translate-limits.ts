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
 * budget nothing consumed (that knob was deleted on 2026-08-25); this named a
 * document while the code weighed an
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
 * THE ENV KNOB THAT USED TO SHADOW THIS IS GONE (2026-08-25).
 * `PDFXYZ_AI_MAX_OUTPUT_TOKENS` was resolved, bounds-checked, and read by
 * NOTHING — no `native.ts` passed `maxOutputTokens` into an engine's limits.
 * Wiring it was considered and REFUSED BY MEASUREMENT: its default was 4,000
 * against this constant's 8,000, so a deployment that set nothing would have
 * halved the published ceiling below — a figure the FAQ states and tests pin.
 * One global number cannot serve four engines whose outputs differ by purpose
 * (chat 2,000 · extract 4,000 · translate 8,000 per chunk), and its only real
 * effect was that an out-of-bounds value FAILED config resolution: it could
 * break a deployment while never doing anything. Deleted instead, and
 * `workers/ai/env-consumption.test.ts` now fails any future knob that is
 * declared and never consumed.
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
 * `item.str` and a newline on `hasEOL` (plus one after the page's last line when
 * reading order moves it off the end), so it can never emit a space that is not
 * inside a text item. The surplus is therefore inter-column whitespace, and it
 * scales with PAGE GEOMETRY rather than with text length.
 *
 * Measured locally (Xpdf `pdftotext` 4.00 — NOT the worker's poppler build, so
 * treat the magnitudes as indicative and the SHAPE as the finding), six
 * pdf-lib fixtures, 120 lines each, worker length ÷ drawn length, before and
 * after {@link collapseLayoutPadding} was put on the AI path:
 *
 * ```
 *   single-column prose   -layout 1.0001   collapsed 1.0001
 *   deep left indent      -layout 1.0005   collapsed 1.0005
 *   two columns           -layout 1.1206   collapsed 1.0198
 *   sparse wide grid      -layout 1.4142   collapsed 1.1076
 *   four-column table     -layout 1.4385   collapsed 1.0781
 *   eight-column grid     -layout 1.8626   collapsed 1.2031
 * ```
 *
 * **THE CEILING DOES NOT MOVE, and that is derived rather than assumed.** The
 * calibration document is prose, and collapsing is provably a no-op on prose —
 * single-column text has no runs of two or more spaces, which the first row
 * shows to four decimal places. So `largestSuccessChars` is still 10,258, the
 * rate is still 1.28225, and this constant is unchanged. What changed is that
 * the number now MEANS the same thing across document shapes: a four-column
 * document used to reach this ceiling with barely two-thirds of its real text.
 *
 * **AND THE RESIDUAL IS NOT PADDING AT ALL** — the arithmetic closes exactly.
 * Every collapsed surplus is one space per inter-column gap: 7 gaps × 120 lines
 * = 840 for the eight-column grid (4,140 + 840 = 4,980 against 4,981 measured),
 * 3 × 120 = 360 for the four-column (4,620 + 360 = 4,980 vs 4,981), 1 × 120 =
 * 120 for both two-column cases. All four land within one character.
 *
 * So after collapsing, **the worker's count is the correct one and the browser's
 * is short**: pdfjs concatenates adjacent text items with nothing between them,
 * so it reads `North1200` as eleven characters where any reader sees twelve.
 * The remaining divergence is pdfjs under-counting separators, not `pdftotext`
 * inflating. (Real documents that encode real space glyphs narrow this further;
 * these fixtures are the worst case for pdfjs.)
 *
 * WHAT IT STILL COSTS: the panel measures low, so a document it passes can be
 * refused at the worker after being uploaded, scanned and charged one of three
 * daily AI runs. The worst observed gap is now **1.20 rather than 1.86**, and
 * ~1.00 for the ordinary prose this ceiling was calibrated on. A margin is still
 * not the answer — the residual is a property of how many columns a page has.
 */
export const TRANSLATE_MAX_INPUT_CHARS = translateMaxInputChars(
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
);

/**
 * The measured collapsed divergence between the two extractors, per geometry —
 * the table above, as data rather than prose.
 *
 * It is here so the headroom below is DERIVED from the measurement rather than
 * typed beside it. A constant typed next to its own evidence still goes stale
 * silently; a constant computed from it cannot.
 */
export const TRANSLATE_EXTRACTOR_DIVERGENCE = {
  /** Xpdf `pdftotext` 4.00, six pdf-lib fixtures, 120 lines each. */
  measuredOn: "2026-08-11",
  /**
   * ⚠️ NOT THE BINARY WE SHIP. The worker runs poppler 22.12.0; these were taken
   * on Xpdf 4.00, and this file already records one claim from that binary — the
   * `default`-mode transposition — that **did not reproduce on poppler**. So the
   * shape is the finding and the magnitudes are indicative, and the headroom
   * derived from them is a SAMPLED maximum, not a bound. Re-measure on the
   * worker's binary before treating it as one.
   */
  binary: "xpdf-pdftotext-4.00",
  shippedBinary: "poppler-22.12.0",
  /** Worker length ÷ browser length, after `collapseLayoutPadding`. */
  collapsed: {
    singleColumnProse: 1.0001,
    deepLeftIndent: 1.0005,
    twoColumns: 1.0198,
    sparseWideGrid: 1.1076,
    fourColumnTable: 1.0781,
    eightColumnGrid: 1.2031,
  },
} as const;

/**
 * The same measurement on the binary we ACTUALLY SHIP — poppler 22.12.0, run on
 * the worker box, `-layout` plus `collapseLayoutPadding`.
 *
 * It is here because the Xpdf table above turned out to understate the range
 * badly, and not at the margin: **a wide table of short cells — any spreadsheet
 * exported to PDF — reaches 1.95**, which is 1.6× the Xpdf maximum. A headroom
 * of 1.2031 would have truncated the honest owner of such a document at ~63% of
 * their own file. That is not a tail case a backstop mops up; it is a common
 * input the constant simply did not cover.
 */
export const TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED = {
  measuredOn: "2026-08-21",
  binary: "poppler-22.12.0",
  /** `columns × characters-per-cell` → worker length ÷ drawn length. */
  collapsed: {
    oneColumnFiveChar: 1.0014,
    eightColumnFiveChar: 1.1709,
    sixteenColumnFiveChar: 1.1853,
    twentyFourColumnOneChar: 1.9203,
    fortyColumnOneChar: 1.9514,
  },
} as const;

/**
 * The horizontal divergence a page of `itemsPerLine` text items can produce —
 * the DERIVATION the measurements above check.
 *
 * After `collapseLayoutPadding`, `pdftotext -layout` can emit **at most one
 * space per column gap** (collapsing runs of whitespace to one is exactly what
 * guarantees that), and every drawn item contributes **at least one character**.
 * So per line the worker emits at most `n items + (n − 1) spaces + 1 newline`
 * while the browser emits at least `n items + 1 newline`:
 *
 * ```
 *   ratio ≤ (2n) / (n + 1)  =  1 + (n − 1)/(n + 1)  <  2   for every n
 * ```
 *
 * Two is approached and never reached. Checked against poppler on the shipped
 * binary and agreeing to four significant figures: n=24 predicts 1.9200 against
 * 1.9203 measured, n=40 predicts 1.9512 against 1.9514.
 */
export function extractorHorizontalRatioBound(itemsPerLine: number): number {
  const n = Math.max(1, Math.floor(itemsPerLine));
  return (2 * n) / (n + 1);
}

/**
 * The VERTICAL term, measured on the shipped binary — the one the derivation
 * below explicitly does not cover.
 *
 * `-layout` emits blank lines for vertical gaps and `collapseLayoutPadding`
 * only touches runs of spaces and tabs, so newlines pass through untouched.
 * That term multiplies the horizontal one, and the horizontal supremum of 2 was
 * shipped as a headroom while this was neither bounded nor measured.
 *
 * MEASURED 2026-08-21, poppler 22.12.0, worker box, `-layout` + collapse. Two
 * of the three exceed 2:
 *
 * ```
 *   24 columns, 10pt line gap   1,000 → 1,921   1.921
 *   24 columns, 40pt line gap   1,000 → 2,071   2.071   exceeds 2
 *   40 columns, 40pt line gap   1,640 → 3,351   2.043   exceeds 2
 * ```
 *
 * ⚠️ THESE ARE SAMPLES OF AN UNBOUNDED TERM, NOT A BOUND. Nothing here limits
 * how much blank space a page may hold, so the largest observed ratio is a
 * lower bound on the worst case and nothing more. They are recorded as evidence
 * that 2 was too small — which is a claim a sample CAN support — and
 * deliberately NOT used to derive the replacement, because deriving a constant
 * from a sampled maximum is the exact mistake that produced 1.2031.
 */
export const TRANSLATE_EXTRACTOR_DIVERGENCE_VERTICAL = {
  measuredOn: "2026-08-21",
  binary: "poppler-22.12.0",
  /** `columns × line gap` → worker length ÷ drawn length. */
  collapsed: {
    twentyFourColumnTenPointGap: 1.921,
    twentyFourColumnFortyPointGap: 2.071,
    fortyColumnFortyPointGap: 2.043,
  },
} as const;

/**
 * How much more text the WORKER may find than the browser reported.
 *
 * **A CHOSEN MARGIN. Not a derivation, and the distinction is the whole point
 * of this docblock** — a number this size, sitting under a page of measured
 * tables, reads as though it came from data. It did not.
 *
 * WHAT IS ACTUALLY DERIVED. {@link extractorHorizontalRatioBound} proves the
 * HORIZONTAL term is under 2 for every page, and poppler agrees to four
 * significant figures. That bound is real and it is complete — for the term it
 * covers. It says nothing about the vertical term, which multiplies it, has no
 * bound at all, and is measured above at up to 2.071 on its own.
 *
 * SO WHY NOT DERIVE THE PRODUCT. Because there is nothing to derive it from:
 * blank lines are unbounded, so any figure taken from the vertical
 * measurements would be a sampled maximum wearing a derivation's clothes. That
 * is precisely how the first version of this constant became **1.2031** —
 * `Math.max` over an Xpdf table — against a spreadsheet that reaches 1.9514 on
 * the binary we ship, which would have truncated that document's honest owner
 * at ~63% of their own file. Repeating the mistake one layer up, with better
 * arithmetic in front of it, would be harder to spot rather than less wrong.
 *
 * SO THE JUSTIFICATION IS THAT IT COSTS NOTHING, and that is a complete
 * argument rather than a shrug:
 *
 *  - **To an honest caller, nothing at all.** A reservation is `count × h`
 *    drawn from a budget of `deliverable × h`, so documents per day is
 *    `deliverable / count` — `h` cancels. The published allowance is
 *    {@link AI_CHARACTER_ALLOWANCE_DELIVERED}, which does not contain `h` at
 *    all, so raising it changes no number any visitor is told.
 *  - **To a liar, less than nothing.** A lie reserves `declared × h` and is
 *    delivered `declared × h`, and a liar wants `declared` small. Declaring
 *    one character buys four characters at h=4 instead of two at h=2. Both are
 *    nothing; the larger `h` is marginally worse for them.
 *  - **What it buys is truncation avoided.** The only cost of a small `h` is
 *    cutting an honest document short, and 4 is twice the highest ratio either
 *    binary has produced (2.071) and clear of the 3.28 composition that the
 *    worst horizontal and worst vertical terms together would imply.
 *
 * WHAT IT IS STILL NOT. It is not a proof that no document exceeds it. The
 * vertical term remains unbounded, so a sufficiently sparse page can still
 * breach this — which is why the reservation is backed by a DELIVERY CAP that
 * reports the bound it hit. An exceeded headroom then arrives as a positioned
 * gap saying “the remaining pages held more text than this job reserved”,
 * which is evidence this number is too small, rather than as a silently short
 * translation, which is not evidence of anything.
 */
export const TRANSLATE_EXTRACTOR_HEADROOM = 4;
