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
};

/** The policy governing `action`. Total over the closed {@link RateLimitAction} union. */
export function policyFor(action: RateLimitAction): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[action];
}

/** Every policy, in the stable action order. Handy for docs tables and tests. */
export function allPolicies(): RateLimitPolicy[] {
  return RATE_LIMIT_ACTIONS.map(policyFor);
}
