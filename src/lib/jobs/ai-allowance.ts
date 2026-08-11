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
 * WHAT IS DELIBERATELY NOT CLAIMED: that the allowance is guaranteed, isolated,
 * or unaffected by anything else. A separate internal spend ceiling exists as a
 * circuit breaker, is never published, and can stop AI for everyone. These
 * sentences say what the allowance IS and say nothing about what happens if the
 * service itself stops — which is the difference between a fact and a promise.
 */
import { RATE_LIMITS } from "./types";

/**
 * The clause both sentences are built from.
 *
 * Shared rather than shipped as one string serving both surfaces: an offer and a
 * refusal legitimately read differently, and forcing one sentence to do both
 * jobs is how the refusal ended up carrying "it may not reflect your own usage"
 * — a hedge that made sense only while the bucket was shared.
 */
export const AI_ALLOWANCE_CLAUSE = `${RATE_LIMITS.aiRunsPerDayPerClient} free AI runs a day`;

/** What a visitor is offered, stated before they spend it. */
export const AI_ALLOWANCE_FACT = `Your own ${AI_ALLOWANCE_CLAUSE} — the allowance resets daily.`;

/**
 * What a visitor is told when it runs out.
 *
 * It names their own usage, because it is their own bucket. The previous version
 * said the allowance was "currently shared across everyone using pdf.xyz, so it
 * may not reflect your own usage" — which sent someone who had spent nothing
 * looking for a stranger to blame.
 */
export const AI_ALLOWANCE_USED_MESSAGE = `You have used your ${AI_ALLOWANCE_CLAUSE} for today. The allowance resets daily; retry after the interval in the Retry-After header.`;
