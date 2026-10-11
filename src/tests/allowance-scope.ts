/**
 * Who shares one count — the AI allowance, a rate limit — as the copy states
 * it, read as SHAPES and held to a corpus in both directions. One definition,
 * shared by every check that asks the question, so there is never a second
 * copy to drift (the reason `identity-claims.ts` beside it exists).
 *
 * Owned by `src/lib/ratelimit/keying-disclosure.test.tsx`, which binds the
 * scope a reader is told to the scope the limiter keys by. Also read by
 * `ratelimit/allowance-copy.test.ts` and `tools/ai-allowance-copy.test.ts`,
 * whose 2026-08-11 tests pinned "connection" as the only true scope and were
 * inverted on 2026-10-10 to ask this module instead.
 *
 * Under `src/tests`, outside the copy walk, because its corpus quotes the
 * very sentences the walk must not find written by hand.
 */

/**
 * A sentence that scopes a count to ONE connection — every spelling the
 * product shipped while the bucket was one site-wide pool.
 */
export const SCOPES_TO_CONNECTION =
  /\b(?:for|to|from)\s+(?:your|this)\s+connection\b|\bper\s+connection\b|\bconnection's\s+(?:allowance|pool|bucket)\b/i;

/** A sentence that says everyone using pdf.xyz shares it, in any spelling. */
export const SCOPES_TO_EVERYONE =
  /\b(?:shared\s+(?:by|across|among|between|with)|for)\s+everyone\s+using\s+pdf\.xyz\b/i;

/** Which scope `text` states: "connection", "everyone", "both" or "neither". */
export function scopeOf(
  text: string,
): "connection" | "everyone" | "both" | "neither" {
  const c = SCOPES_TO_CONNECTION.test(text);
  const e = SCOPES_TO_EVERYONE.test(text);
  return c && e ? "both" : c ? "connection" : e ? "everyone" : "neither";
}

/**
 * Sentences this product shipped scoped to the connection, while (from
 * 2026-10-10) nothing could key per connection. Each must read "connection".
 */
export const SHIPPED_CONNECTION_SCOPE = [
  "30,774 free characters of AI text a day for your connection — the allowance resets daily.",
  "Every AI tool on pdf.xyz spends from one pool per connection, 30,774 free characters of AI text a day.",
  "Each question is paid for out of 30,774 free characters of AI text a day, allotted to your connection rather than to this tool alone.",
  "Summaries draw on 30,774 free characters of AI text a day per connection, the same pool used by Translate PDF.",
  "The free AI allowance for this connection is used up for today, or too little of it is left for this document.",
  "This is a limit on our side — not a problem with your file, and not the daily AI allowance for your connection.",
  "Too many requests from this connection right now. Please wait a little and try again.",
] as const;

/** Sentences scoped to everyone — the pre-2026-08-11 one, and the shared state's. */
export const SHIPPED_EVERYONE_SCOPE = [
  "3 free AI runs a day, shared across everyone using pdf.xyz right now.",
  "30,774 free characters of AI text a day, shared by everyone using pdf.xyz — the allowance resets daily.",
] as const;

/** Other things a page calls a connection, which must read "neither". */
export const NOT_A_SCOPE = [
  "Upload your PDF over an encrypted connection.",
  "Check your connection and try again.",
  "a connection that drops mid-build does not interrupt work already in progress",
] as const;
