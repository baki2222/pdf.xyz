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
  // ⚠️ THIS COMMENT USED TO SAY "the internal spend ceiling is a separate
  // circuit breaker, never published, never this policy". No such ceiling
  // exists — verified 2026-08-11 five ways, including the whole `PDFXYZ_AI_*`
  // namespace. This policy is the ONLY AI cost control in the product.
  //
  // It was the worst-placed of the three copies of that claim: this is the file
  // someone would open to add a global bound, and it told them the bound already
  // lived elsewhere. A ceiling is being built and will be a policy whose bucket
  // is global rather than per client — note that this limiter counts REQUESTS
  // (`redis.ts` runs a bare `INCR`, one per hit), so a token-denominated bound
  // needs a cost argument and `INCRBY`, not a new policy alone.
  "ai.run": {
    id: "ai.run",
    action: "ai.run",
    limit: RATE_LIMITS.aiRunsPerDayPerClient,
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
