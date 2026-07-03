/**
 * The pure **storage-artifact cleanup verifier** (Phase 42).
 *
 * Given a set of content-free {@link CleanupObjectEvidence} — one per artifact the app expected
 * to have been cleaned up — it classifies each object and folds the set to a single
 * {@link CleanupVerdict}. It is total, deterministic, node-free, and offline: it NEVER calls a
 * provider (the evidence is exported out-of-band and injected), and it re-uses Phase 41's
 * {@link evaluateArtifactLifecycle} so the "is this object expired/tombstoned?" question is
 * answered EXACTLY as the retrieval boundary answers it — the two can never disagree.
 *
 * The load-bearing honesty rules (mirrored from `../artifacts/lifecycle`):
 *  - ABSENCE is the only proof of cleanup. A `404` is credited as cleaned up; a present object
 *    is never fabricated into "deleted" no matter what its lifecycle metadata says — at most it
 *    is `retrieval-denied` (Phase 41 blocks the download) or, past the reap grace, `drift`;
 *  - attribution is conservative: an absence is `absent-active` only with a delete-now receipt,
 *    else `absent-backstop` (the honest default — it could also be a never-existed handle, which
 *    is indistinguishable from a reaped one and equally "gone");
 *  - drift is asserted only from a USABLE expiry instant past its grace; an unreadable clock, a
 *    placeholder deadline, or a tombstone with no expiry falls toward `retrieval-denied`, never
 *    a fabricated `drift`;
 *  - a `not-configured` provider short-circuits to the `not-configured` verdict — an
 *    unconfigured deployment has nothing to verify and is never upgraded to a success.
 */

import { evaluateArtifactLifecycle } from "../artifacts/lifecycle";
import type { RetrievalStorageProvider } from "../artifacts/access";
import {
  emptyCleanupCounts,
  type CleanupObjectEvidence,
  type CleanupObjectState,
  type CleanupStateCounts,
  type CleanupVerdict,
  type CleanupVerification,
} from "./types";

/**
 * The default post-expiry reap grace: how long an expired object may linger in the bucket
 * before its continued presence is judged DRIFT rather than a normal "denied, awaiting reap".
 * 48 hours mirrors AWS S3's documented lifecycle behavior — expiration is evaluated once a day
 * and an object is typically (but not guaranteed to be) removed within ~48h of its expiration
 * date. A shorter grace would flag normal sweep latency as drift; a longer one would hide a
 * genuinely stuck object. Operators can override it per run.
 */
export const DEFAULT_REAP_GRACE_MS = 48 * 60 * 60 * 1000;

/** The knobs a verification runs with. All injected, so the verifier is fully deterministic. */
export interface CleanupVerifyOptions {
  /** The bounded storage backend this evidence describes. `not-configured` short-circuits. */
  readonly provider: RetrievalStorageProvider;
  /** The verifier's clock (epoch ms). Defaults to `Date.now()`. */
  readonly now?: number;
  /** The post-expiry reap grace in ms (default {@link DEFAULT_REAP_GRACE_MS}). */
  readonly graceMs?: number;
}

/** A usable positive, finite instant (epoch ms). Zero/negative is a placeholder, not a deadline. */
function usableInstant(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Whether a still-present object is past the reap grace — i.e. its bucket lifecycle backstop
 * SHOULD have removed it by now. True only when a usable expiry deadline and a usable clock
 * both exist and `now >= expiresAtMs + graceMs`. Any unusable input returns `false`, so a
 * placeholder deadline, an unreadable clock, or a tombstone-without-expiry can never fabricate
 * a `drift` finding — it falls toward the honest `retrieval-denied`.
 */
function pastReapGrace(
  expiresAtMs: number | undefined,
  nowMs: number,
  graceMs: number,
): boolean {
  if (expiresAtMs === undefined || !usableInstant(expiresAtMs) || !usableInstant(nowMs)) {
    return false;
  }
  const safeGrace = Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : 0;
  return nowMs >= expiresAtMs + safeGrace;
}

/**
 * Classify ONE artifact's cleanup evidence into a bounded {@link CleanupObjectState}. Pure and
 * total. The object's expired/tombstoned status is resolved by the shared Phase 41 evaluator so
 * this never diverges from what the retrieval boundary would deny.
 */
export function classifyCleanupObject(
  evidence: CleanupObjectEvidence,
  nowMs: number,
  graceMs: number = DEFAULT_REAP_GRACE_MS,
): CleanupObjectState {
  // A probe that could not complete tells us nothing about cleanup this run.
  if (evidence.presence === "error") return "unavailable";

  // Absent: the bytes are gone. Attribute the mechanism from the (conservative) evidence.
  if (evidence.presence === "absent") {
    return evidence.activeDelete ? "absent-active" : "absent-backstop";
  }

  // Present: the bucket still holds the bytes. Ask the SAME question Phase 41 asks on a GET.
  const lifecycle = evaluateArtifactLifecycle(evidence.lifecycle, nowMs);
  switch (lifecycle) {
    case "live":
      // Within its retention window — not a cleanup target; presence is expected.
      return "live";
    case "unknown":
      // Present, but no usable lifecycle evidence — its cleanup state cannot be judged.
      return "unknown";
    case "expired":
    case "deleted":
      // Present AND the app no longer considers it downloadable (Phase 41 denies it). Whether
      // that is acceptable depends on how long it has lingered past its retention deadline.
      return pastReapGrace(evidence.lifecycle?.expiresAtMs, nowMs, graceMs)
        ? "drift"
        : "retrieval-denied";
  }
}

/** Tally a set of per-object classifications into content-free {@link CleanupStateCounts}. */
function tally(states: readonly CleanupObjectState[]): Record<CleanupObjectState, number> {
  const counts = emptyCleanupCounts();
  for (const state of states) counts[state] += 1;
  return counts;
}

/**
 * Fold the per-state tally to the aggregate {@link CleanupVerdict}. "Worst honest state wins":
 * a confirmed problem (`drift`) outranks an incomplete run (`unavailable`), which outranks an
 * unproven-but-not-bad state (`unknown`); `verified` is reserved for a run where every
 * should-be-gone object is confirmed absent and nothing worse occurred.
 */
function foldVerdict(counts: CleanupStateCounts): CleanupVerdict {
  const reaped = counts["absent-active"] + counts["absent-backstop"];
  if (counts.drift > 0) return "drift";
  if (counts.unavailable > 0) return "unavailable";
  // Present-but-denied (reap pending) or present-without-evidence: cleanup is not yet PROVEN.
  if (counts["retrieval-denied"] > 0 || counts.unknown > 0) return "unknown";
  // Every should-be-gone object is confirmed absent — the only honest "cleanup proven".
  if (reaped > 0) return "verified";
  // Nothing to verify (empty, or only live objects): cleanup cannot be asserted either way.
  return "unknown";
}

/** Author a content-free, one-line summary for the verdict. Never echoes evidence. */
function summarize(
  verdict: CleanupVerdict,
  counts: CleanupStateCounts,
  total: number,
): string {
  const reaped = counts["absent-active"] + counts["absent-backstop"];
  switch (verdict) {
    case "not-configured":
      return "Not configured: no object-storage backend is wired here, so there is nothing to verify. Storage-backed cleanup verification is inert in this deployment.";
    case "verified":
      return `Verified: all ${reaped} storage artifact(s) that should be gone are confirmed absent from object storage (active delete-now and/or the bucket lifecycle backstop); no drift observed.`;
    case "drift":
      return `Drift: ${counts.drift} artifact(s) are still present in object storage past their retention window and reap grace; the bucket lifecycle backstop has not removed them. App retrieval denial (Phase 41) still blocks download — this is a cleanup gap, not a disclosure.`;
    case "unavailable":
      return `Unavailable: ${counts.unavailable} cleanup probe(s) could not complete this run, so cleanup could not be fully verified; no drift observed among the rest. Retry.`;
    case "unknown":
      if (total === 0) {
        return "Unknown: no cleanup evidence was supplied, so nothing could be verified. Export content-free cleanup evidence out-of-band and pipe it in.";
      }
      if (counts["retrieval-denied"] > 0) {
        return `Unknown: ${reaped} artifact(s) confirmed absent and ${counts["retrieval-denied"]} present-but-denied awaiting reap; cleanup is in progress but not yet proven complete. App retrieval denial is working.`;
      }
      return `Unknown: ${counts.unknown} present artifact(s) carry no usable lifecycle evidence, so their cleanup state cannot be judged; no drift observed.`;
  }
}

/**
 * Verify a set of content-free cleanup evidence into a single {@link CleanupVerification}.
 * Deterministic, total, offline, and content-free by construction: the result carries only the
 * verdict, the bounded provider, per-state counts, totals, and authored prose — never an
 * identity, instant, size, or byte from the evidence.
 *
 * A `not-configured` provider short-circuits to the `not-configured` verdict WITHOUT inspecting
 * the evidence, so an unconfigured deployment can never be reported as verified or drifting.
 */
export function verifyArtifactCleanup(
  evidence: readonly CleanupObjectEvidence[],
  options: CleanupVerifyOptions,
): CleanupVerification {
  const provider = options.provider;

  if (provider === "not-configured") {
    const counts = emptyCleanupCounts();
    return {
      verdict: "not-configured",
      provider,
      counts,
      total: 0,
      reaped: 0,
      drift: 0,
      summary: summarize("not-configured", counts, 0),
    };
  }

  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? DEFAULT_REAP_GRACE_MS;

  const states = evidence.map((e) => classifyCleanupObject(e, now, graceMs));
  const counts = tally(states);
  const total = states.length;
  const verdict = foldVerdict(counts);

  return {
    verdict,
    provider,
    counts,
    total,
    reaped: counts["absent-active"] + counts["absent-backstop"],
    drift: counts.drift,
    summary: summarize(verdict, counts, total),
  };
}
