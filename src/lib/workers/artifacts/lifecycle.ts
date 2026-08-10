/**
 * The pure **storage-artifact lifecycle evaluation**: the bounded, content-free state a
 * storage-backed artifact object is in — derived from lifecycle EVIDENCE recorded on the
 * object (an explicit deletion tombstone, a signed expiry instant) rather than from the
 * object's mere presence in a bucket.
 *
 * Why this exists (the honest gap Phase 41 closes): an object store generally does NOT
 * tombstone, and its lifecycle deletion is best-effort and coarse (often a daily sweep). Once
 * the bucket reaps an object a GET is a genuine `404` → `absent`; but BEFORE that sweep runs
 * the bucket happily returns the bytes even though the app's retention window has already
 * passed. Phase 38/39 modeled retrieval lifecycle over a store that CAN tombstone (the
 * local-dev {@link import("../store").DevWorkerStore}), but the storage-backed reader could
 * only ever see a `200`/`404` and so always served the `200`. This evaluator is the
 * storage-backed counterpart: given the evidence the worker signs onto the object plus a
 * clock, it resolves a bounded state the retrieval boundary enforces BEFORE any bytes are
 * delivered — so a logically-expired or tombstoned object is denied `410 Gone` in the window
 * between its retention deadline and the bucket physically reaping it.
 *
 * The four states match the parent lifecycle vocabulary and are deliberately distinct from the
 * retrieval {@link import("./access").ArtifactLifecycle} (which has `absent` for "no object at
 * all"): here `unknown` means "the object is PRESENT but carries no usable lifecycle evidence"
 * — a legacy object written before this phase, or a deployment whose storage strips
 * user-metadata. `unknown` is the load-bearing honesty state: it is NEVER treated as deletion
 * or expiry. An object with no evidence is served (the bucket lifecycle rule remains the
 * eventual backstop, surfacing as an honest `404`/`absent` once it reaps), so the boundary
 * never OVERCLAIMS that something was expired or deleted without evidence.
 *
 * Honesty rules — load-bearing, mirrored across the worker layer:
 *  - this is bounded metadata evaluation against a clock, NOT proof the bytes were deleted,
 *    NOT malware scanning, NOT sanitization. Denying `expired`/`deleted` at retrieval is
 *    APP-LEVEL access denial, distinct from (and additional to) both the bucket's own
 *    lifecycle-deletion backstop and any active delete-now the executor performs;
 *  - every value is a bounded enum — never a filename, object key, signed URL, bucket name,
 *    endpoint, job/user id, token, timestamp string, size, or document byte;
 *  - absent/unknown/unreadable evidence fails toward SERVING (never a fabricated deletion),
 *    while an explicit tombstone or a passed retention deadline fails toward DENIAL.
 */

/**
 * The bounded lifecycle state a storage-backed artifact object resolves to:
 *  - `live`    — a usable retention window is recorded and has not passed (serve);
 *  - `expired` — a usable retention window is recorded and the clock is at/after it (deny, 410);
 *  - `deleted` — an explicit deletion tombstone is recorded (deny, 410);
 *  - `unknown` — the object is present but carries no usable lifecycle evidence, or the clock
 *                is unreadable (serve; the bucket lifecycle rule is the eventual backstop).
 *                NEVER treated as deletion.
 */
export const ARTIFACT_LIFECYCLE_STATES = [
  "live",
  "expired",
  "deleted",
  "unknown",
] as const;
export type StorageArtifactLifecycle =
  (typeof ARTIFACT_LIFECYCLE_STATES)[number];

/**
 * The content-free lifecycle evidence decoded from a storage-backed artifact object's signed
 * metadata. Both fields are coarse lifecycle facts, never document content:
 *  - `expiresAtMs` — the retention-window deadline as epoch milliseconds (the same instant the
 *    client already holds as its {@link import("@/lib/jobs").JobArtifact} `expiresAt`, just as
 *    a number). A finite, non-negative integer by construction of the codec;
 *  - `deleted` — an explicit tombstone marker: the object was deleted before its window
 *    elapsed. In the shipped flow the worker never writes this (active deletion is a bucket
 *    DELETE → `404` → `absent`); it is an enforcement hook the retrieval boundary HONORS when
 *    a deployment records one, so it is parsed and enforced but never fabricated.
 */
export interface ArtifactLifecycleMetadata {
  readonly expiresAtMs: number;
  readonly deleted: boolean;
}

/** A usable positive, finite instant (epoch ms), or `null`. Zero/negative is a placeholder, not a deadline. */
function usableInstant(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Evaluate lifecycle evidence against a clock into a bounded {@link StorageArtifactLifecycle}.
 * Pure and total; never throws. Precedence is deliberate:
 *
 *   no usable evidence → `unknown`   (serve; never overclaim deletion/expiry)
 *   explicit tombstone → `deleted`   (the strongest, earliest signal; clock-independent)
 *   usable deadline reached → `expired`
 *   otherwise → `live`
 *
 * A deletion tombstone is evaluated BEFORE the clock, so it denies even if the clock is
 * unreadable. Expiry uses the SAME `now >= deadline` boundary the local-dev store uses, so
 * local and storage-backed expiry agree. Expiry is asserted ONLY when both the deadline and
 * `nowMs` are finite, positive instants — an unreadable clock or a placeholder deadline never
 * fabricates an `expired` denial (it falls through to `live`), deferring to the bucket
 * lifecycle backstop.
 */
export function evaluateArtifactLifecycle(
  meta: ArtifactLifecycleMetadata | null,
  nowMs: number,
): StorageArtifactLifecycle {
  // No usable lifecycle evidence at all. The object is present but says nothing about its own
  // lifecycle, so it is served — the bucket lifecycle rule reaps it eventually, which surfaces
  // as an honest `absent`. We must never report it as deleted/expired here.
  if (meta === null) return "unknown";
  // An explicit tombstone wins over everything, and does not depend on the clock.
  if (meta.deleted) return "deleted";
  // A retention deadline that has passed — but only when both the deadline and the clock are
  // usable instants, so neither a placeholder deadline nor an unreadable clock denies falsely.
  if (
    usableInstant(meta.expiresAtMs) &&
    usableInstant(nowMs) &&
    nowMs >= meta.expiresAtMs
  ) {
    return "expired";
  }
  return "live";
}
