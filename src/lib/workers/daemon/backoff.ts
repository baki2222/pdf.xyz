/**
 * How long an idle `loop` worker waits before claiming again.
 *
 * A flat one-second poll is right when work is arriving and ruinous when it is
 * not: an idle worker issues 86,400 queue reads a day and does nothing with any
 * of them. On a request-metered broker that is not a rounding error — it is the
 * whole budget. A staging worker sat idle for nineteen days on Upstash's
 * 500,000-request free tier and exhausted it in under a week, after which every
 * Redis command failed, the liveness heartbeat could not be written, and the web
 * layer correctly reported a worker it could no longer see.
 *
 * So: hold the fast cadence while work is plausibly still coming, then back off
 * geometrically to a cap. A queue that just went quiet still gets sub-second
 * pickup — the case where a user is waiting — while a worker that has been alone
 * for minutes stops paying to hear silence.
 */

/** Consecutive idle ticks that keep the base cadence before backoff starts. */
export const IDLE_GRACE_TICKS = 30;

/** Ceiling for the backed-off wait. */
export const DEFAULT_MAX_IDLE_SLEEP_MS = 15_000;

/**
 * Wait before the next claim, given how many consecutive idle/error ticks have
 * happened. `consecutiveIdle` is 1 on the first idle tick.
 *
 * Pure and total: callers pass their own base/cap so this stays unit-testable
 * and the daemon keeps a single source of timing truth.
 */
export function idleBackoffMs(
  baseMs: number,
  maxMs: number,
  consecutiveIdle: number,
): number {
  const cap = Math.max(baseMs, maxMs);
  if (consecutiveIdle <= IDLE_GRACE_TICKS) return baseMs;

  // Doubling starts at the first tick past the grace window.
  const doublings = consecutiveIdle - IDLE_GRACE_TICKS;
  // Guard the shift: 2**n overflows to Infinity long before a real worker gets
  // here, and Infinity * 0 would be NaN if baseMs were ever 0.
  if (doublings >= 32) return cap;

  const grown = baseMs * 2 ** doublings;
  return Number.isFinite(grown) ? Math.min(grown, cap) : cap;
}
