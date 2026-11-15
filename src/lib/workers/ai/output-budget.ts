/**
 * The one rule every AI engine applies to its generation budget: an operator's
 * `limits.maxOutputTokens` can LOWER the engine's default, never raise it.
 *
 * Why it matters: `AI_SPEND_CEILING.outputTokensPerFullRun`
 * (`src/lib/jobs/ai-spend-ceiling.ts`) is "the most output tokens a single run
 * can produce", and the daily token ceiling is derived from it. That sentence
 * is true only while no engine can be talked into sending more than its
 * default, and every default is at most that figure. Chat, extract and
 * translate used `override ?? DEFAULT` until 2026-11-16, so a raised override
 * went straight to the provider — and translate derives its per-call INPUT
 * ceiling from the same number, so it would have raised the characters sent
 * per chunk too.
 *
 * Enforced by "every AI engine sends at most the per-run output figure" in
 * `src/lib/jobs/ai-spend-ceiling.test.ts`, which runs each engine's real entry
 * point with a recording provider and DISCOVERS the engines by scanning
 * `src/lib/workers` for `provider.complete(` call sites.
 */

/**
 * The output-token budget to send: `defaultTokens`, lowered (never raised) by
 * `override`.
 *
 * An override that is absent, non-finite, or below 1 is IGNORED and the default
 * is sent: `Math.min(default, 0)` would ask for zero tokens and
 * `Math.min(default, NaN)` is `NaN`, and neither is a budget a provider can
 * honour. A fractional override is floored, since providers take whole tokens.
 */
export function clampOutputTokens(
  defaultTokens: number,
  override: number | undefined,
): number {
  if (override === undefined || !Number.isFinite(override) || override < 1) {
    return defaultTokens;
  }
  return Math.min(defaultTokens, Math.floor(override));
}
