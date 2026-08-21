/**
 * The per-action throttle policies for the public API.
 *
 * These are the single source of truth for "how many requests, per how long,
 * per client" on each abuse surface. The three client-facing limits reuse the
 * numbers already published in the job contract ({@link RATE_LIMITS} in
 * `@/lib/jobs`) so the guard, the docs, and the contract never drift; the
 * remaining actions get conservative, purpose-fit windows.
 *
 * Pure data. A policy names a route capability and a budget — never a caller — so
 * the whole table is content-free and safe to log, snapshot, or ship to a client.
 */

import { RATE_LIMITS } from "@/lib/jobs";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { AI_SPEND_DAILY_TOKEN_CEILING } from "@/lib/jobs/ai-spend-ceiling";
import type { RateLimitAction, RateLimitPolicy } from "./types";
import { RATE_LIMIT_ACTIONS } from "./types";

const HOUR = 3600;
const MINUTE = 60;
const DAY = 86_400;

/**
 * The active policy for every {@link RateLimitAction}.
 *
 * Rationale:
 *  - `uploads.create` / `jobs.create` — the expensive, backend-touching writes;
 *    capped per hour at the published contract numbers.
 *  - `jobs.delete` — a mutation, but a legitimate client may cancel several jobs
 *    in a burst; kept at the create budget rather than tighter.
 *  - `jobs.status` — polled frequently by the UI while a job runs; a per-minute
 *    budget matching the published status limit.
 *  - `artifacts.fetch` — a completed job can have several outputs a user grabs
 *    back-to-back; a generous per-minute budget so normal downloads never trip.
 *  - `worker.status` / `worker.operations` — cheap, read-only presence/health
 *    probes the UI, dashboards, and monitors poll; a generous per-minute budget
 *    so enabling the guard never silences a monitor under normal cadence.
 *  - `interest.note` — the gated-tool "notify me" counter. A person browsing
 *    every unbuilt tool clicks a handful of times ever; a modest hourly budget
 *    leaves that untouched while keeping a script from inflating a tool's
 *    count cheaply (the counter is advisory, not a ballot — this only raises
 *    the cost of stuffing it).
 */
export const RATE_LIMIT_POLICIES: Record<RateLimitAction, RateLimitPolicy> = {
  "uploads.create": {
    id: "uploads.create",
    action: "uploads.create",
    limit: RATE_LIMITS.uploadsPerHourPerClient,
    windowSeconds: HOUR,
  },
  "jobs.create": {
    id: "jobs.create",
    action: "jobs.create",
    limit: RATE_LIMITS.jobsPerHourPerClient,
    windowSeconds: HOUR,
  },
  "jobs.status": {
    id: "jobs.status",
    action: "jobs.status",
    limit: RATE_LIMITS.statusRequestsPerMinutePerClient,
    windowSeconds: MINUTE,
  },
  "jobs.delete": {
    id: "jobs.delete",
    action: "jobs.delete",
    limit: RATE_LIMITS.jobsPerHourPerClient,
    windowSeconds: HOUR,
  },
  "artifacts.fetch": {
    id: "artifacts.fetch",
    action: "artifacts.fetch",
    limit: 120,
    windowSeconds: MINUTE,
  },
  "worker.status": {
    id: "worker.status",
    action: "worker.status",
    limit: RATE_LIMITS.statusRequestsPerMinutePerClient,
    windowSeconds: MINUTE,
  },
  "worker.operations": {
    id: "worker.operations",
    action: "worker.operations",
    limit: RATE_LIMITS.statusRequestsPerMinutePerClient,
    windowSeconds: MINUTE,
  },
  "interest.note": {
    id: "interest.note",
    action: "interest.note",
    limit: 30,
    windowSeconds: HOUR,
  },
  // The free daily AI allowance (owner ruling, 2026-08-10): counted in runs
  // per client per day because a user can act on "3 runs a day" and cannot
  // act on a global dollar figure. Enforced at job creation for AI-capability
  // tools, ON TOP of jobs.create; the refusal names the allowance, not a
  // generic throttle.
  //
  // ⚠️ THIS COMMENT ONCE SAID "the internal spend ceiling is a separate circuit
  // breaker, never published, never this policy" — while no such ceiling
  // existed. It was the worst-placed of three copies of that claim: this is the
  // file someone would open to ADD a global bound, and it told them the bound
  // already lived elsewhere.
  //
  // The ceiling is real as of 2026-08-11 and is `ai.spend`, immediately below.
  // This policy is a per-client FAIRNESS device and has never been a cost
  // control; the two are deliberately separate, because conflating them is what
  // let the gap sit unnoticed.
  "ai.run": {
    id: "ai.run",
    action: "ai.run",
    limit: RATE_LIMITS.aiRunsPerDayPerClient,
    windowSeconds: DAY,
  },
  // THE SAME FAIRNESS DEVICE, DENOMINATED IN CHARACTERS. A "run" priced a job
  // correctly while every job was one provider call; chunked translation makes
  // one run up to thirty, so three runs a day both refuses a long document and
  // charges three short ones the whole day.
  //
  // PAGES WERE RULED FIRST AND THE MEASUREMENT REFUSED THEM. Today's capacity is
  // 30,774 characters; in pages that is 5.00 dense or 17.91 sparse — a 3.58x
  // spread, so no single pages/day figure preserves it (five cuts sparse
  // documents to 0.28x, eighteen hands dense ones 3.60x). Characters have no
  // such error bar: they are the quantity the ceiling already bounds.
  //
  // It is still a FAIRNESS device and still not a cost control — `ai.spend`
  // above is the cost control. The unit was chosen to be legible to the person
  // about to spend it, and the panel extracts the text before uploading, so it
  // can name the real figure for the real file rather than an average.
  "ai.characters": {
    id: "ai.characters",
    action: "ai.characters",
    limit: AI_CHARACTER_ALLOWANCE,
    windowSeconds: DAY,
  },
  // THE GLOBAL DAILY TOKEN CEILING, and the only policy here that is a COST
  // CONTROL rather than a fairness device. Every other policy counts requests
  // per client; this one counts TOKENS across all clients, into one constant
  // bucket (`AI_SPEND_BUCKET`), because "3 per address" bounds nothing when the
  // number of addresses is unbounded.
  //
  // It is spent in two phases — `peek` before a job is accepted, `spend` on the
  // terminal transition — because a limiter tests before an action while a token
  // cost is only known after the provider replies. The figure is PROVISIONAL and
  // says so in `AI_SPEND_CEILING.measuredOn`.
  "ai.spend": {
    id: "ai.spend",
    action: "ai.spend",
    limit: AI_SPEND_DAILY_TOKEN_CEILING,
    windowSeconds: DAY,
  },
};

/** The policy governing `action`. Total over the closed {@link RateLimitAction} union. */
export function policyFor(action: RateLimitAction): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[action];
}

/** Every policy, in the stable action order. Handy for docs tables and tests. */
export function allPolicies(): RateLimitPolicy[] {
  return RATE_LIMIT_ACTIONS.map(policyFor);
}
