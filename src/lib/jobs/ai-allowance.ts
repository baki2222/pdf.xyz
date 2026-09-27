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

/** What a visitor is offered, stated before they spend it. */
export const AI_ALLOWANCE_FACT = `${AI_ALLOWANCE_CLAUSE} for your connection — the allowance resets daily.`;

/**
 * The most one Summarize, Chat or Extract run can take from the allowance, in
 * the browser's unit — the same unit as {@link AI_CHARACTER_ALLOWANCE_DELIVERED}.
 *
 * It is the undeclared charge (`TRANSLATE_MAX_INPUT_CHARS × h`) with the
 * headroom taken back out, exactly as the published daily figure is the bucket
 * with it taken out. `ratelimit/allowance-unit.test.ts` prices a run through
 * `aiReservationFor` and holds the sentence below to what it returns.
 */
export const AI_PER_CALL_RUN_CEILING = TRANSLATE_MAX_INPUT_CHARS;

/**
 * The offer on the three `per-call` tools, where one run is one provider call.
 *
 * ⚠️ WHY IT SAYS "NEVER MORE THAN" AND NOT "THE CHARACTERS IN YOUR DOCUMENT".
 * A run is charged by what it sends (its declared document, plus the question,
 * prompt or focus the server measures, plus the engine's instructions) only
 * while the running worker proves it sends no more than that (`aiReadCap`); an
 * image built before that proof charges every run the ceiling. Either way the
 * sentence's ceiling holds: the price is clamped at one whole run. The worker is deployed by hand, after the web
 * tier, so the stronger sentence would be true of `main` and false of whatever
 * image is serving — the defect this codebase keeps paying for. This one is
 * true of both.
 *
 * Until 2026-09-27 the three panels showed {@link AI_ALLOWANCE_FACT} alone, and
 * every run cost the ceiling: three one-page summaries, or three chat
 * questions, against a published 30,774 characters.
 */
export const AI_PER_CALL_ALLOWANCE_FACT = `${AI_ALLOWANCE_CLAUSE} for your connection. One run never counts more than ${AI_PER_CALL_RUN_CEILING.toLocaleString("en-US")} of them, however long the document is, and the allowance resets daily.`;

/**
 * What a visitor is told when it runs out.
 *
 * It names the CONNECTION, never the reader. See the module docblock: the bucket
 * is an address, and an address is not a person. The first version of this fix
 * said "You have used your 3 free AI runs for today", which is a factual claim
 * about the reader's own past conduct and is false for everyone behind a shared
 * address who has run nothing.
 *
 * The middle sentence is the one addition beyond stating the scope: "this
 * connection" is accurate but leaves a blameless reader hunting for what they
 * did. Naming the shared-network case answers that without reinstating the old
 * "shared across everyone using pdf.xyz", which claimed one bucket for the whole
 * product and was false for every visitor.
 *
 * TOOL-NEUTRAL, because the route cannot say which tool is refused: it is one
 * constant, served by `rateLimitErrorResult` to every AI tool, and nothing
 * passes the tool in. Until 2026-09-27 the middle sentence said "text
 * translated by someone else" — false on the chat, summarize and extract pages,
 * which is where the refusal was met most (a chat question used to cost a third
 * of the day). `ratelimit/allowance-copy.test.ts` checks it against every AI
 * tool in the catalogue.
 */
export const AI_ALLOWANCE_USED_MESSAGE = `The ${AI_ALLOWANCE_RUNS} for this connection are used up for today. On a shared network that can include AI text used by someone else. The allowance resets daily; retry after the interval in the Retry-After header.`;
