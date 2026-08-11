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

/* ------------------------------------------------------------------ *
 *  The OTHER ceiling — the one outside this system.
 * ------------------------------------------------------------------ */

/**
 * The provider's own spend cap, as a STATED EXTERNAL ASSUMPTION.
 *
 * Our token ceiling and OpenAI's dollar cap are two bounds on the same thing and
 * **they had never been compared.** Each is correct at its own layer; nobody put
 * them side by side — the composed-seam defect, in a number rather than a
 * pipeline.
 *
 * It matters because of which one trips first. **If the provider's cap binds
 * first, ours never fires**: the balance runs out, calls start failing as
 * generic provider errors, and the honest 503 in this file never renders. That
 * is "a guard that cannot fire, which reads as protection" — arriving through
 * the FIGURE rather than the wiring.
 *
 * ⚠️ THIS NUMBER IS NOT MACHINE-READABLE AND CANNOT BE VERIFIED BY ANY TEST. It
 * lives in the OpenAI billing console. It is recorded here with its source and
 * the date it was read, the same discipline as `densityMeasuredOn` — a fact from
 * outside the system, dated, with its provenance, so a reader can tell how old
 * it is and how to re-check it. **Re-checking means a human opening the billing
 * page.** If auto-reload is switched off or the cap changes, nothing here will
 * notice.
 */
export const AI_SPEND_EXTERNAL_BOUND = {
  /** Monthly ceiling on money leaving the account. */
  monthlyCapUsd: 100,
  /** Auto-reload was ON, adding $10 whenever the balance fell below $5. */
  source:
    "OpenAI billing console: auto-reload ON ($10 at $5), monthly limit $100",
  /** When a human last opened that page. */
  readOn: "2026-08-11",
} as const;

/**
 * Blended price per million tokens — **the WORST REACHABLE blend, not an average.**
 *
 * MEASURED 2026-08-11 from OpenAI's published rate card for `gpt-5.6-luna`
 * (developers.openai.com/api/docs/pricing), $ per 1M tokens:
 *
 * ```
 *   short ctx :  in 0.20   cachedIn 0.02   cacheWrite 0.25   out 1.20
 *   long  ctx :  in 0.40   cachedIn 0.04   cacheWrite 0.50   out 1.80
 * ```
 *
 * A ceiling is compared against a bound, so this is the highest blend a real
 * call can reach rather than the one a typical call costs. Realistic translate
 * blends at $0.96 and a 125k-token chat at $0.42; using either would make the
 * comparison an average pretending to be a limit.
 *
 * WHY $1.20 AND NOT $1.80, because this is the question a future reader will get
 * wrong. $1.80 is the long-context OUTPUT rate, and a blend can only reach it
 * with 100% output at long-context pricing — which is self-contradictory. Long
 * context is entered by a large INPUT, input is priced at a quarter to a third of
 * output, and a call with zero input tokens does not exist. So the long-context
 * rate always arrives attached to the thing that drags the blend down.
 *
 * The counter-intuitive consequence, worth stating because instinct says the
 * opposite: **big-context runs are the CHEAP ones.** The expensive workload is
 * the small call with a high output ratio.
 *
 * ⚠️ LIST PRICING, read by a human, not machine-readable. Re-check the same way
 * as {@link AI_SPEND_EXTERNAL_BOUND} — and note that changing `PDFXYZ_AI_MODEL`
 * changes this number with nothing here noticing.
 */
export const AI_BLENDED_PRICE_USD_PER_MTOK: number | null = 1.2;

/** Provenance for the price above, since no test can verify it. */
export const AI_PRICE_SOURCE = {
  model: "gpt-5.6-luna",
  source: "developers.openai.com/api/docs/pricing (published list pricing)",
  readOn: "2026-08-11",
  /** The rate used, and the one deliberately not used. */
  usedRateUsdPerMTok: 1.2,
  excludedRateUsdPerMTok: 1.8,
  excludedBecause:
    "long-context output pricing is only reachable via a large input, and input is cheaper than output, so a 100%-output long-context blend cannot occur",
} as const;

/** What the ceiling would cost per month at the worst reachable blend. */
export const AI_CEILING_MONTHLY_COST_USD =
  ((AI_SPEND_DAILY_TOKEN_CEILING * 30) / 1_000_000) *
  (AI_BLENDED_PRICE_USD_PER_MTOK ?? 0);

/**
 * The price at which the two ceilings coincide — **derived, not guessed**.
 *
 * Below this price ours binds first and the honest 503 renders. Above it, the
 * provider's cap binds first and ours is decoration. This is a fact about the
 * two numbers we already have, so it can be stated today without knowing the
 * actual price: it is the threshold the measurement will be compared against.
 *
 * `2,000,000 tokens/day × 30 days = 60,000,000 tokens/month`, and
 * `$100 ÷ 60 Mtok = $1.67 per Mtok`.
 */
export const AI_CEILING_BREAKEVEN_USD_PER_MTOK =
  AI_SPEND_EXTERNAL_BOUND.monthlyCapUsd /
  ((AI_SPEND_DAILY_TOKEN_CEILING * 30) / 1_000_000);

/**
 * Does our ceiling bind before the provider's cap?
 *
 * `"unknown"` while the price is unmeasured — **never a default of `true`**. A
 * cost control that assumes it binds first is exactly the claim this whole
 * exercise exists to stop being made without evidence.
 */
export function aiCeilingBindsFirst(): "yes" | "no" | "unknown" {
  const price = AI_BLENDED_PRICE_USD_PER_MTOK;
  if (price === null || !Number.isFinite(price) || price <= 0) return "unknown";
  return price < AI_CEILING_BREAKEVEN_USD_PER_MTOK ? "yes" : "no";
}
