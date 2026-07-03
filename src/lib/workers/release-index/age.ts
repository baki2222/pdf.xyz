/**
 * Pure, node-free **age bucketing** for the release evidence index (Phase 48).
 *
 * An artifact's `generatedAt` is an ISO stamp. To assess retention (over-age, staleness) and to
 * report a bounded newest/oldest age WITHOUT ever echoing a raw stamp difference (which, in
 * aggregate, could fingerprint a release cadence), the index reduces each artifact's age relative to
 * the index run's clock to a coarse {@link ReleaseIndexAgeBucket}, and — for the retention decision
 * only — a whole-number age in days.
 *
 * Every function is a pure function of two given instants: `Date.parse` of a fixed ISO string is
 * deterministic (it reads no clock), so the index clock is INJECTED (the Node entry passes
 * `new Date().toISOString()`; tests pass a fixed stamp) and this leaf stays deterministically
 * unit-testable. A missing/malformed stamp or a non-finite instant is honestly `unknown`, never
 * coerced to a number.
 */

import type { ReleaseIndexAgeBucket } from "./types";

/** Milliseconds in a day — the unit the age-in-days retention comparison uses. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse an ISO instant to epoch milliseconds, or `null` if it is not a string or not a parseable
 * instant. Uses `Date.parse` (a pure, clock-free ECMAScript function) — never `Date.now()` / an
 * argless `new Date()`, so it stays deterministic.
 */
export function instantToMs(iso: unknown): number | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Bucket an artifact instant (`atMs`) relative to the index clock (`nowMs`) into a coarse
 * {@link ReleaseIndexAgeBucket}. A `null` artifact instant (missing/unsafe stamp) or a non-finite
 * clock is `unknown`; an instant AFTER the clock is `future` (clock skew, surfaced honestly).
 */
export function ageBucket(nowMs: number | null, atMs: number | null): ReleaseIndexAgeBucket {
  if (atMs === null || nowMs === null || !Number.isFinite(nowMs)) return "unknown";
  const deltaMs = nowMs - atMs;
  if (deltaMs < 0) return "future";
  const days = deltaMs / MS_PER_DAY;
  if (days < 1 / 24) return "<1h";
  if (days < 1) return "1-24h";
  if (days < 7) return "1-7d";
  if (days < 30) return "7-30d";
  if (days < 90) return "30-90d";
  return "90d+";
}

/**
 * The whole-number age in days of `atMs` relative to `nowMs`, floored, for the retention (over-age /
 * stale) comparison — or `null` if either instant is unavailable or the artifact is in the future
 * (a future stamp is never "over age"). The raw value is used ONLY to decide a boolean and is never
 * emitted; the manifest carries the bucket, not the number.
 */
export function ageInDays(nowMs: number | null, atMs: number | null): number | null {
  if (atMs === null || nowMs === null || !Number.isFinite(nowMs)) return null;
  const deltaMs = nowMs - atMs;
  if (deltaMs < 0) return null;
  return Math.floor(deltaMs / MS_PER_DAY);
}
