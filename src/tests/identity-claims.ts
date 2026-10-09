/**
 * Two ban lists about WHO the reader is, shared by every check that runs
 * them, so there is never a second copy to drift.
 *
 *  - {@link ACCOUNT_CLAIMS}: identity language for a product with no user
 *    accounts. Owned by `src/lib/tools/account-honesty.test.ts`, whose
 *    docblock records why these three families and not five, and whose
 *    precondition proves the absence of accounts.
 *  - {@link PERSONAL_CONDUCT_CLAIMS}: allowance language that asserts what the
 *    reader personally did or owns. The limiter counts a connection, not a
 *    person. Owned by `src/lib/ratelimit/allowance-copy.test.ts`, which holds
 *    these shapes to a corpus in both directions (every shape catches a
 *    shipped sentence; every shipped sentence is caught).
 *
 * WHY A MODULE, AND WHY HERE. They were consts inside those two test files.
 * Importing one test file from another is a trap under `isolate: false` (see
 * `src/lib/tools/transmission-claims.ts`), so a third reader needs a plain
 * module. It lives under `src/tests`, outside the copy walk, because its own
 * labels name the words it bans and the walk would read them as copy.
 *
 * The third readers, each added 2026-10-09: the AI ceiling message's own test
 * (`src/lib/jobs/ai-spend-ceiling.test.ts`), because the message sits outside
 * the walk and a fix to it was otherwise protected by nothing; and the
 * copy-reach check in `src/lib/tools/copy-surface.test.ts`, which runs both
 * lists over the string literals of every phrase module recorded outside the
 * walk.
 */

/**
 * Banned outright, denials included: none had an honest use in the copy walk
 * when measured (2026-08-10), and honest copy has a move that needs none of
 * these words — "no account", which is also the stronger claim.
 */
export const ACCOUNT_CLAIMS = [
  { label: "a sign-in invitation", pattern: /\bsign[- ]?in\b/i },
  { label: "a log-in invitation", pattern: /\blog[- ]?in\b/i },
  {
    label: "a claim that the visitor has an account",
    pattern: /\byour account\b/i,
  },
] as const;

/**
 * Claims the limiter cannot support, as SHAPES. Each is a form of "this
 * counter knows who you are". It does not: it knows an address.
 */
export const PERSONAL_CONDUCT_CLAIMS: { name: string; pattern: RegExp }[] = [
  {
    name: "an accounting unit smaller than the address",
    pattern: /\bper\s+(?:device|user|person|visitor|browser)\b/i,
  },
  {
    // The intervening words are bounded by COUNT and by PUNCTUATION: `[A-Za-z']+`
    // cannot cross a comma or a full stop, so the subject stays inside one
    // clause. The bound started at two and the corpus immediately failed on
    // "You may have already used them" — which is the corpus doing its job,
    // and the reason a ban list without one is a list of words someone thought of.
    name: "second person plus a spend verb — a claim about the reader's conduct",
    pattern:
      /\byou\b(?:'ve|\s+have|\s+had)?(?:\s+[A-Za-z']+){0,4}\s+(?:used|spent|consumed|exhausted|reached|hit|run)\b/i,
  },
  {
    name: "a possessive over the allowance itself — whose runs these are",
    pattern:
      /\byour\s+(?:own\s+)?(?:\d[\d,]*\s+)?(?:free\s+)?(?:daily\s+)?(?:ai\s+)?(?:runs?|allowance)\b/i,
  },
];
