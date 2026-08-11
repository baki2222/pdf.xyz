/**
 * The GLOBAL daily AI token ceiling — a cost control, not a fairness device.
 *
 * **Until 2026-08-11 this did not exist.** Three files described it as an
 * "internal circuit breaker"; nothing implemented one, and the correction is
 * recorded at each of them. The only bound was `aiRunsPerDayPerClient: 3`,
 * bucketed by a salted hash of the client address — which is "3 × however many
 * addresses reach us", not a bound at all. Tolerable only while one run was one
 * provider call; chunked translation makes one run up to thirty.
 *
 * The per-client allowance is unchanged and stays what it is. Conflating a
 * fairness device with a cost control is what let the gap sit unnoticed.
 */
import { TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS } from "./translate-limits";

/**
 * The figure, and **which half of it is a guess**.
 *
 * `TRANSLATE_CALIBRATION`'s shape, deliberately — figure and evidence in one
 * object — with one difference that matters: `measuredOn` reads `"provisional"`
 * EXPLICITLY rather than being absent. Absent invites the next reader to assume
 * it was forgotten, and **a provisional number that looks measured survives the
 * review a rough one would not.**
 *
 * IT CANNOT BE SET FROM HISTORY. No job record before `9415595` carries token
 * usage, and there is no back-fill because the numbers were never stored (see
 * `ai-results.ts`). So the corpus starts at that commit and this figure is
 * revised from real traffic — shipping provisional-and-labelled beats waiting
 * while spend is unbounded.
 *
 * THE TWO INPUTS ARE NOT BOTH GUESSES, which is the whole reason it is built
 * this way rather than as one round number. The `3.5 × 1.3 = 2.69` that this
 * codebase already removed from translate's ceiling was two plausible constants
 * multiplied into a figure 1.8× wrong; here exactly one factor is invented and
 * it is named.
 */
export const AI_SPEND_CEILING = {
  /**
   * **PROVISIONAL — not a measurement.** Revise from real `results.ai.usage`
   * rows once there are some, and change this string in the same commit.
   */
  measuredOn: "provisional",
  /**
   * ENFORCED, not estimated: the output budget translate actually sends, so it
   * is the most output tokens a single run can produce. Imported rather than
   * typed, so it cannot drift from the request that produces it.
   */
  outputTokensPerFullRun: TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  /**
   * THE GUESS, isolated here so it is the only thing anyone has to argue with:
   * how many maximum-output runs a day the product funds before AI degrades.
   */
  fullRunsPerDay: 250,
} as const;

/**
 * The ceiling, in total tokens per day.
 *
 * **It errs low by construction, which is the ruled direction.** The counter
 * this is compared against records TOTAL tokens — input, output, cache write and
 * cache read — while this product is `fullRunsPerDay × output tokens only`. A
 * real run also spends input and cache tokens, so the ceiling is reached in
 * FEWER than `fullRunsPerDay` runs, never more. The unmeasured part therefore
 * makes the bound tighter rather than looser, which is the one direction a cost
 * control is allowed to be wrong in.
 *
 * Erring low is only survivable because the tripped path degrades honestly — see
 * the AI-unavailable copy. That is why the two were built together: a ceiling
 * that errs low without an honest unavailable state is just an outage.
 */
export const AI_SPEND_DAILY_TOKEN_CEILING =
  AI_SPEND_CEILING.fullRunsPerDay * AI_SPEND_CEILING.outputTokensPerFullRun;

/**
 * The bucket every AI job counts into: ONE global counter.
 *
 * A **constant, namespaced literal** — never derived from env, host, region or
 * deployment id. A ceiling whose key changes on a deploy resets itself silently,
 * which is the same shape as the `count == 1` TTL bug caught in the limiter:
 * a cost control that looks like it is working and is not.
 */
export const AI_SPEND_BUCKET = "pdfxyz:global";

/**
 * Total tokens a completed AI call spent, from what the provider reported.
 *
 * Every class is counted because every class is billed, at three different
 * rates — fresh, cache write (~1.25×), cache read (~0.1×). This is a TOKEN
 * ceiling rather than a currency one, so the classes are summed rather than
 * priced; the alternative is a per-model price table that would go stale
 * silently. Recorded classes are summed exactly as recorded.
 *
 * Returns 0 when the provider reported nothing — and that is a MEASUREMENT GAP,
 * not a free call. The caller says so rather than treating it as zero cost; see
 * the executor's terminal hook.
 */
export function aiSpendTokens(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
}): number {
  const n = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  return (
    n(usage.inputTokens) +
    n(usage.outputTokens) +
    n(usage.cachedInputTokens) +
    n(usage.cacheWriteInputTokens)
  );
}

/**
 * What a visitor is told when the GLOBAL ceiling is spent.
 *
 * HONEST DEGRADATION IS LOAD-BEARING HERE, NOT A NICETY. The figure errs low by
 * construction, so this path WILL be reached, and reached when nothing is wrong
 * with the caller or their file. Three things it must therefore not do:
 *
 *  - **Not read as the user's fault.** It is not their allowance and not a
 *    throttle on them; the per-client allowance has its own, separate sentence.
 *  - **Not read as a broken document.** "Something went wrong with your PDF"
 *    would send someone to re-export a file that was always fine — the same
 *    class of misdirection as a summary of 131 pages presented as one of 400.
 *  - **Not publish the figure or the headroom.** A number nobody outside can act
 *    on, and one that tells an abuser exactly how much room is left.
 *
 * It says what is true, whose problem it is, and that it is temporary. The shape
 * is the worker-not-ready path's: a real reason, no blame, no invented ETA.
 */
export const AI_CEILING_REACHED_MESSAGE =
  "AI features are temporarily unavailable — the service has reached its daily processing limit. This is a limit on our side, not on your file or your account. Please try again tomorrow; every other PDF tool is unaffected.";
