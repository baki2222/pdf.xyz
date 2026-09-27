/**
 * What the free daily AI allowance is, said once.
 *
 * **The sentence was true when it was written and the system changed underneath
 * it.** `identity.ts` used to hand every caller `SHARED_BUCKET_TOKEN`, so there
 * genuinely was one bucket and three runs for the whole product — and the copy
 * said so: *"shared across everyone using pdf.xyz right now."* Then the limiter
 * was fixed. With the salt set and `PDFXYZ_RATE_LIMIT_TRUST_PROXY=true`, every
 * client gets its own bucket, and production reports
 * `rateLimit: { code: "remote-configured", enforced: true, distributed: true }` —
 * `remote-configured`, not `remote-configured-shared`.
 *
 * So each visitor has had their own three runs for some time, while the product
 * told them a stranger might have already spent them. `policy.ts` has said
 * `per client per day` in a comment the whole time; nothing made the copy read it.
 *
 * VERIFIED FROM THE CODE PATH, not inferred from the posture code: every action
 * goes through the same `deriveClientToken(request.headers, config)` in
 * `ratelimit/guard.ts`, with no per-action branch — so `ai.run` is bucketed
 * exactly like the policies proven with two clients (300 requests, ~242 allowed,
 * each client stopping at ~120).
 *
 * WHY THE COPY LIVES HERE. The sentence existed in SIX places: four literal
 * duplicates in `tool-facts.ts`, the constant on line 320 those four ignored,
 * and a third independent copy in `workers/ai-tool-availability.ts`. A constant
 * built to prevent duplication that one of six callers used is not a source of
 * truth, it is a seventh copy. This module is the lowest layer all of them can
 * import, so there is nowhere left to put a duplicate that compiles.
 *
 * THE BUCKET IS AN ADDRESS, AND AN ADDRESS IS NOT A PERSON. `deriveClientToken`
 * is `sha256(salt ␀ address)` over the forwarded address — no cookie, no session,
 * no per-action branch — so everyone behind one NAT shares one bucket: an office,
 * a campus, a café, a mobile CGNAT range. The first version of this fix
 * over-corrected into *"You have used your 3 free AI runs for today"*, which is
 * not a dropped hedge but a **factual claim about the reader's own past
 * conduct**, and it is wrong for every visitor who shares an address with
 * whoever spent them.
 *
 * So the copy attributes the spend to the CONNECTION. That is true for one person
 * and true for fifty behind one address, and it keeps the information that
 * actually matters — this is not the whole world's three runs, which is what the
 * pre-2026-08-11 wording claimed.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED: that the allowance is guaranteed, isolated,
 * or unaffected by anything else. These sentences say what the allowance IS and
 * say nothing about what happens if the service itself stops — which is the
 * difference between a fact and a promise.
 *
 * ⚠️ THIS DOCBLOCK USED TO CITE A REASON THAT DOES NOT EXIST. It said "a separate
 * internal spend ceiling exists as a circuit breaker, is never published, and can
 * stop AI for everyone" — and no such ceiling is implemented. Searched five ways
 * on 2026-08-11 (concept, config surface, limiter policies, docs, the
 * `PDFXYZ_AI_*` namespace): there is no global spend or token bound anywhere, and
 * no configuration for one. `aiRunsPerDayPerClient: 3` bucketed by address is the
 * only AI cost control, and per-client is not a global bound — it is "3 × however
 * many addresses reach us".
 *
 * **The copy above is still correct**; not promising availability is safe whether
 * or not a breaker exists. Only the stated REASON was fiction, and a reason that
 * cannot be checked is how three files came to describe a mechanism nobody built.
 * The ceiling is being built (owner ruling, 2026-08-11); when it lands, this note
 * becomes a pointer to it rather than a warning about its absence.
 */
import { RATE_LIMITS } from "./types";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "./translate-limits";
import { deliveryCapFor } from "./delivery-cap";
import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  CHAT_TOOL_SLUG,
} from "./chat-with-pdf";

/**
 * The quantity, shared by both sentences — and the only part that can go stale,
 * because it is the only part derived from a constant.
 *
 * Split from the cadence on purpose. An offer states a rate ("a day"); a refusal
 * states an exhausted quantity ("are used up for today"), and gluing the cadence
 * into the refusal produced "your 3 free AI runs a day for today". What the two
 * surfaces must never disagree about is the NUMBER and what it counts, so that
 * is what they share.
 */
/**
 * The free daily allowance, in CHARACTERS of document text.
 *
 * DERIVED FROM BOTH FACTORS, never typed: it is exactly today's effective
 * capacity — the largest document one run could translate, times the runs a
 * client got — so nothing becomes more expensive by accident, and the figure
 * moves if either factor does. A typed `30_774` would go on describing a tool
 * that had changed underneath it, which is this codebase's most-repeated defect.
 *
 * WHY NOT PAGES, WHICH WERE RULED FIRST. Measured against the density figures
 * taken on 2026-08-10: this budget is 5.00 pages of dense text or 17.91 of
 * sparse — a **3.58× spread**. Five pages a day would cut sparse documents to
 * 0.28× of today's capacity; eighteen would hand dense ones 3.60×. A page is a
 * unit of layout, not of cost, and the conversion carries an error bar the
 * number itself would never show.
 *
 * WHAT A CHARACTER BUDGET GIVES BACK. Pages were chosen to be *countable before
 * uploading*, and characters satisfy that more exactly: the panel already
 * extracts the text before it uploads anything (it must, for the per-call
 * ceiling), so it can state what THIS document will cost rather than an average
 * that is wrong by 3.58× in one direction or the other.
 *
 * ⚠️ PROVISIONAL, like `AI_SPEND_CEILING.measuredOn`. It preserves today's
 * capacity; it is not yet informed by real per-job usage, which only began being
 * persisted recently. Revise it from `results.ai.usage` rows and record the date
 * here in the same commit.
 */
/**
 * WHAT A CLIENT CAN ACTUALLY TRANSLATE IN A DAY — the number we publish.
 *
 * Browser-counted characters: the quantity the panel measures before it
 * uploads, and the only one a visitor holding a document could ever check.
 *
 * ⚠️ THE HEADROOM IS NOT IN IT, AND THE FIRST VERSION OF THIS PUT IT IN.
 * The bucket below is `this × h`, and the copy quoted the BUCKET — so the
 * product advertised 61,548 characters at h=2 while a client could translate
 * 30,774 of their own text, and would have advertised 123,096 at h=4. The
 * number was right; it was in a unit nobody outside this file can measure,
 * which is the defect `AI_INPUT_LIMITS` (a cap named for reading, enforced on
 * writing) and `TRANSLATE_CALIBRATION` (one bracket recorded in two units) each
 * cost us already. Caught before it shipped, by `ratelimit/allowance-unit.test.ts`,
 * which spends the budget the way the route spends it instead of asserting that
 * a sentence contains a constant.
 */
export const AI_CHARACTER_ALLOWANCE_DELIVERED =
  TRANSLATE_MAX_INPUT_CHARS * RATE_LIMITS.aiRunsPerDayPerClient;

/**
 * THE BUCKET THE LIMITER DEBITS, in worker-extracted characters.
 *
 * A job reserves `declared × h` because the worker finds more text than the
 * browser reported, so the budget those reservations are drawn from has to be
 * in the same unit or an honest caller would be cut off early. It is derived
 * from the published figure rather than beside it, so the two cannot drift and
 * the relationship between them stays visible: **this is that figure, expressed
 * in the worker's unit.** `h` therefore cancels out of capacity entirely — which
 * is exactly why its size is free, and why raising it changes nothing a visitor
 * is told.
 */
export const AI_CHARACTER_ALLOWANCE = Math.floor(
  AI_CHARACTER_ALLOWANCE_DELIVERED * TRANSLATE_EXTRACTOR_HEADROOM,
);

/** Where the figure came from, so its age is visible rather than implicit. */
export const AI_CHARACTER_ALLOWANCE_BASIS = {
  measuredOn: "provisional",
  /** The PUBLISHED figure. The bucket is this times the extractor headroom. */
  derivedFrom: "TRANSLATE_MAX_INPUT_CHARS × aiRunsPerDayPerClient",
  /** Why pages lost: the measured density spread this budget maps onto. */
  pagesAtDensest: 5,
  pagesAtSparsest: 17,
  pageSpread: 3.58,
} as const;

/**
 * The rate-limit action that carries this allowance — the ONE definition, and
 * it lives HERE rather than in `ratelimit/types.ts` for two reasons.
 *
 * **It is what selects the message below.** `rateLimitErrorResult` chooses
 * between the generic throttle sentence and `AI_ALLOWANCE_USED_MESSAGE` by
 * comparing a decision's action to this. Keeping the discriminator in the same
 * module as the words it discriminates for is what stops the pair drifting —
 * and they did drift: `enforceAiCharacterAllowance` moved from `ai.run` to
 * `ai.characters` while `response.ts` went on comparing against a literal
 * `"ai.run"`, so every real refusal shipped the GENERIC message and told users
 * "Too many requests ... see docs/SECURITY.md" instead of naming the allowance
 * they had just spent. Both halves were individually correct.
 *
 * **And the unit test could not see it**: it hand-built a decision with
 * `action: "ai.run"` and asserted the right message came back — a correct
 * assertion about an action no route enforces any more.
 *
 * `ai.run` remains in the action union because a deployed record may still
 * carry it. Nothing enforces it: it is a superseded policy, not a live one.
 */
export const AI_ALLOWANCE_ACTION = "ai.characters";

/**
 * The limits `POST /api/jobs` reserves an AI job under — the route passes THIS
 * object to `deliveryCapFor`, so the charge below and the charge the route makes
 * are one expression, not two that happen to agree.
 */
export const AI_JOB_DELIVERY_LIMITS = {
  fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
  headroom: TRANSLATE_EXTRACTOR_HEADROOM,
} as const;

/**
 * What ONE job reserves when its client declares no character count: a whole
 * call's worth, whatever the document holds. Summarize and Extract declare
 * nothing, so this is the price of every summary and every extraction.
 */
export const AI_UNDECLARED_JOB_CHARGE = deliveryCapFor(
  {},
  AI_JOB_DELIVERY_LIMITS,
).characters;

/**
 * How many undeclared jobs the day's bucket holds. Floor, because the limiter
 * refuses a job that does not fit whole.
 */
export const AI_UNDECLARED_RUNS_PER_DAY = Math.floor(
  AI_CHARACTER_ALLOWANCE / AI_UNDECLARED_JOB_CHARGE,
);

/**
 * The fewest chat questions the day's bucket holds, however long the PDF: a
 * question is never charged more than {@link CHAT_MAX_CHARACTERS_PER_QUESTION}
 * (`chatReservationTerms` caps it there), so at least this many fit. Floor,
 * like the per-run count, because the limiter refuses a job that does not fit
 * whole. `tools/ai-allowance-per-tool.test.ts` spends the real route with the
 * costliest question a client can declare and counts the same number.
 */
export const CHAT_QUESTIONS_PER_DAY_AT_LEAST = Math.floor(
  AI_CHARACTER_ALLOWANCE / CHAT_MAX_CHARACTERS_PER_QUESTION,
);

/**
 * How ONE job of each AI tool whose browser client DECLARES its characters
 * counts against the character allowance — the words the refusal uses for it.
 * Its keys ARE {@link AI_TOOLS_DECLARING_CHARACTERS}, so a declaring tool
 * cannot be missing from the refusal.
 *
 * Chat joined 2026-09-27, when its panel began declaring the PDF it measured:
 * each question re-sends the document, so it is charged by the document's
 * length plus the conversation, capped per question (`chatReservationTerms`).
 */
const DECLARED_JOB_COST: Readonly<Record<string, string>> = {
  "translate-pdf": "a translation counts its document's text",
  [CHAT_TOOL_SLUG]:
    "a chat question counts its PDF's text again, with the conversation",
};

/**
 * The AI tools whose browser client DECLARES the characters a job holds, so the
 * route charges it by length and the character figure is true for it.
 *
 * Checked against the code in both directions:
 * `tools/ai-allowance-per-tool.test.ts` reads every `runSecurityJob` call with
 * the TypeScript parser and fails if this set is not exactly the AI tools
 * whose call passes `declaredCharacters`.
 */
export const AI_TOOLS_DECLARING_CHARACTERS: ReadonlySet<string> = new Set(
  Object.keys(DECLARED_JOB_COST),
);

/** What one run of a per-run AI tool is called on its page. */
const RUN_UNIT: Readonly<Record<string, { one: string; many: string }>> = {
  "summarize-pdf": { one: "summary", many: "summaries" },
  "ai-extract": { one: "extraction", many: "extractions" },
};

const GENERIC_RUN = { one: "run", many: "runs" } as const;

const runsNoun = (unit: { one: string; many: string }, n: number) =>
  n === 1 ? unit.one : unit.many;

/** "a, b and c" (or "a, b or c"). */
const listed = (items: readonly string[], conjunction: "and" | "or") =>
  items.length <= 2
    ? items.join(` ${conjunction} `)
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;

export const AI_ALLOWANCE_RUNS = `${AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US")} free characters of AI text`;

/**
 * The offer's clause: the quantity plus its cadence.
 *
 * Shared rather than shipped as one string serving both surfaces: an offer and a
 * refusal legitimately read differently, and forcing one sentence to do both
 * jobs is how the refusal ended up carrying "it may not reflect your own usage"
 * — a hedge that made sense only while the bucket was shared.
 */
export const AI_ALLOWANCE_CLAUSE = `${AI_ALLOWANCE_RUNS} a day`;

/**
 * What a visitor is offered, stated before they spend it — in the unit of the
 * tools that DECLARE their characters. Never publish this on a page whose jobs
 * are charged per run: use {@link aiAllowanceFactFor}.
 */
export const AI_ALLOWANCE_FACT = `${AI_ALLOWANCE_CLAUSE} for your connection — the allowance resets daily.`;

/**
 * The allowance, stated for ONE tool in the unit the route charges that tool.
 *
 * WAS {@link AI_ALLOWANCE_FACT} on all four AI pages. That figure is true only
 * for a job that declares its characters; a summary or extraction declares
 * nothing and is charged {@link AI_UNDECLARED_JOB_CHARGE} whatever its length.
 * So Summarize told a visitor with a 2,000-character memo to expect about
 * fifteen summaries a day (they got three), and told one with a long report
 * that "30,774 characters a day" could not cover it (it could, at the same
 * price as the memo).
 *
 * Chat declares, but a question is not a translation: it re-sends the whole
 * PDF with the conversation, and it is capped. So its sentence says what one
 * question counts and the floor the cap guarantees. Its panel used to say "at
 * most 41,032 characters a question" beside "30,774 … a day" — a bucket figure
 * (the worker's unit) next to the published one (the reader's), which read as
 * one question costing more than a whole day.
 *
 * Every sentence says the allowance is SHARED: every AI tool debits one
 * bucket, so "3 summaries a day" alone would be false for anyone who
 * translated first.
 */
export function aiAllowanceFactFor(slug: string): string {
  if (slug === CHAT_TOOL_SLUG) {
    const n = CHAT_QUESTIONS_PER_DAY_AT_LEAST;
    return `${AI_ALLOWANCE_FACT} Each question counts this PDF's text again, plus the question and the conversation sent with it, so a short document leaves room for many follow-ups — and however long the document, at least ${n} ${n === 1 ? "question fits" : "questions fit"} in a day if nothing else draws on it. The other AI tools draw on the same allowance.`;
  }
  if (AI_TOOLS_DECLARING_CHARACTERS.has(slug)) {
    return `${AI_ALLOWANCE_FACT} The other AI tools draw on the same allowance.`;
  }
  const unit = RUN_UNIT[slug] ?? GENERIC_RUN;
  const n = AI_UNDECLARED_RUNS_PER_DAY;
  return `Each ${unit.one} uses a fixed share of the free daily AI allowance for your connection, whatever the document's length — ${n} ${runsNoun(unit, n)} a day if nothing else draws on it. The allowance is shared with the other AI tools and resets daily.`;
}

/** "summaries or extractions", from the same table the pages read. */
const PER_RUN_UNITS = listed(
  Object.values(RUN_UNIT).map((u) => runsNoun(u, AI_UNDECLARED_RUNS_PER_DAY)),
  "or",
);

/**
 * What a visitor is told when it runs out.
 *
 * It names the CONNECTION, never the reader. See the module docblock: the bucket
 * is an address, and an address is not a person. The first version of this fix
 * said "You have used your 3 free AI runs for today", which is a factual claim
 * about the reader's own past conduct and is false for everyone behind a shared
 * address who has run nothing.
 *
 * The shared-network sentence is the one addition beyond stating the scope:
 * "this connection" is accurate but leaves a blameless reader hunting for what
 * they did. Naming the shared-network case answers that without reinstating
 * the old "shared across everyone using pdf.xyz", which claimed one bucket for
 * the whole product and was false for every visitor.
 *
 * NOT TOOL-AWARE: the route cannot say which tool is refused — it is one
 * constant, served by `rateLimitErrorResult` to every AI tool, and nothing
 * passes the tool in. So it must be true on every AI page alike, and it names
 * EVERY AI tool's unit, never one:
 *  - it said "The 30,774 free characters of AI text for this connection are
 *    used up for today" — false for a visitor refused after three one-page
 *    summaries, who had used a few thousand;
 *  - until 2026-09-27 its middle sentence said "text translated by someone
 *    else" — one tool's use, false on the chat, summarize and extract pages,
 *    which is where the refusal was met most (a chat question used to cost a
 *    third of the day).
 * `ratelimit/allowance-copy.test.ts` holds it to every AI tool in the
 * catalogue (all of them or none), and `tools/ai-allowance-per-tool.test.ts`
 * holds its per-run clause to the pages' own counts.
 */
export const AI_ALLOWANCE_USED_MESSAGE = `The free AI allowance for this connection is used up for today. It covers ${AI_ALLOWANCE_RUNS} — ${listed(Object.values(DECLARED_JOB_COST), "and")} — or ${AI_UNDECLARED_RUNS_PER_DAY} ${PER_RUN_UNITS}, shared across the AI tools. On a shared network that can include AI work by someone else. The allowance resets daily; retry after the interval in the Retry-After header.`;
