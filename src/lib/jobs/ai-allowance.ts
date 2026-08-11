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
export const AI_ALLOWANCE_RUNS = `${RATE_LIMITS.aiRunsPerDayPerClient} free AI runs`;

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
 */
export const AI_ALLOWANCE_USED_MESSAGE = `The ${AI_ALLOWANCE_RUNS} for this connection are used up for today. On a shared network that can include runs made by someone else. The allowance resets daily; retry after the interval in the Retry-After header.`;
