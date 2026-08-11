/**
 * Proof that the worker and the web tier share ONE limiter bucket.
 *
 * The spend ceiling is written by the worker (only it knows what a call cost)
 * and read by the web tier (only it can refuse a job). **They are different
 * processes with different environments**, and until 2026-08-11 the worker
 * carried the queue's Redis credentials but not the limiter's — so
 * `recordAiSpend` resolved `disabled`, returned `false` on every call, and the
 * counter could never rise. Twenty-six tests were green and the feature could
 * not work in production, because no test in this repo runs in two tiers.
 *
 * WHY A PROBE RATHER THAN A CONFIGURATION COMPARISON. Comparing the two tiers'
 * settings tests the units; this tests the chain. Two tiers can hold
 * identical-looking prefixes and still miss each other — a different instance, a
 * different database, a trailing space — and a comparison also goes stale the
 * moment a fourth variable joins the set that has to match. A probe that is
 * written on one side and read on the other cannot be wrong about any of that:
 * either the value comes back or the tiers are not sharing a counter.
 *
 * It carries NO SECRET and NO IDENTITY. The bucket is a constant literal and the
 * only thing stored is a counter the limiter already knows how to keep — this
 * module adds no store access of its own, it reuses the one seam that is already
 * atomic, TTL-bounded and fail-open.
 */
import { policyFor } from "./policy";
import type { RateLimitPolicy } from "./types";

/**
 * The probe's own bucket — constant, namespaced, and deliberately NOT the
 * ceiling's. A probe must never move the number it is checking on.
 */
export const SPEND_PROBE_BUCKET = "pdfxyz:probe";

/**
 * The probe rides the `ai.spend` policy's window and store, which is the whole
 * point: it proves the path THAT policy uses, not a path of its own. A separate
 * policy could be configured differently and prove nothing about the real one.
 */
export function spendProbePolicy(): RateLimitPolicy {
  return policyFor("ai.spend");
}

/** What a read of the probe can honestly conclude. */
export type SpendProbeVerdict =
  /** The worker's write was read back here: one bucket, confirmed empirically. */
  | { shared: true; writtenUnits: number }
  /**
   * Nothing was read back. Either the worker has not written yet, or the two
   * tiers are pointing at different buckets — this cannot tell those apart and
   * **must not claim to.** A posture that reported "misconfigured" on a worker
   * that simply had not started would be the confident-wrong answer again.
   */
  | { shared: false; reason: "no-probe-visible" }
  /** No limiter is configured on THIS side, so nothing can be concluded. */
  | { shared: false; reason: "unenforced" };

/** The units one probe write adds. Small, fixed, and never zero — a zero write
 * is indistinguishable from no write at all. */
export const SPEND_PROBE_UNITS = 1;

/**
 * How often the writing tier refreshes the probe.
 *
 * **A startup-only write is not enough, and the reason is the window.** The
 * probe rides `ai.spend`, whose window is a day, and the limiter sets a key's
 * expiry only when it is absent — a FIXED window, not a sliding one. So the
 * probe key vanishes at every rollover, and a worker that wrote once at boot
 * and has been up for a day would go dark: `no-probe-visible` on a perfectly
 * healthy deployment, which is precisely the amber-that-looks-like-a-fault this
 * posture exists to avoid. Startup gives a truthful reading without waiting for
 * traffic; the refresh keeps it truthful afterwards.
 *
 * A minute is chosen against the rollover gap, not against a cost target: the
 * probe is invisible for at most one interval per day, and at one INCRBY per
 * write that is ~1,440 store commands a day — below the worker's existing
 * heartbeat traffic and immaterial next to the job load it rides alongside.
 * Writing every tick instead would be up to 86,400, which is a real bill for no
 * additional truth.
 */
export const SPEND_PROBE_REFRESH_MS = 60_000;

/**
 * Should the writing tier refresh the probe now? Pure, so the cadence is
 * testable without a clock or a store.
 *
 * `null` means "never written in this process" and is always due — that is the
 * startup write, and it must not wait out an interval before the posture can
 * tell the truth.
 */
export function shouldWriteSpendProbe(
  lastWriteMs: number | null,
  nowMs: number,
): boolean {
  if (lastWriteMs === null) return true;
  // A clock that jumped backwards must not park the probe for a day.
  if (nowMs < lastWriteMs) return true;
  return nowMs - lastWriteMs >= SPEND_PROBE_REFRESH_MS;
}
