/**
 * The typed, content-free taxonomy for **storage-artifact cleanup verification** (Phase 42).
 *
 * Phase 41 denies an expired or tombstoned storage-backed artifact at retrieval — `410 Gone`,
 * before a single byte is delivered. But an app-level retrieval DENIAL is not the same claim as
 * "object storage deleted the bytes": the object can still sit in the bucket, answering a raw
 * GET `200`, until either the executor's active delete-now removes it or the bucket's coarse
 * lifecycle rule reaps it. This module is the vocabulary an operator uses to tell those apart —
 * to prove, from CONTENT-FREE evidence, whether an artifact that should be gone is actually
 * absent (and by which mechanism) or merely retrieval-denied.
 *
 * The whole subsystem obeys the same honesty contract as the rest of the worker layer:
 *  - it NEVER calls the cloud (confirming a live bucket would need a provider API call this
 *    build deliberately does not make — mirroring `../lifecycle/verify`). The evidence is
 *    injected: a test supplies a fake, and an operator exports it out-of-band with their own
 *    credentials and pipes it to the CLI;
 *  - every value here is a bounded enum, a small integer count, or authored prose — NEVER a
 *    filename, object key, bucket name, signed URL, endpoint, region, job/user id, token, OCR
 *    text, provider exception text, expiry instant, size, or document byte;
 *  - it proves ABSENCE only from positive absence evidence. A present-but-denied object is
 *    reported as exactly that (cleanup pending), never fabricated into "deleted". Absent /
 *    unknown / unreadable evidence fails toward the honest lower claim, never toward a false
 *    "verified" or a false "drift".
 */

import type { RetrievalStorageProvider } from "../artifacts/access";
import type { ArtifactLifecycleMetadata } from "../artifacts/lifecycle";

/** Stable identity of the cleanup-verification policy — stamped on receipts for an audit trail. */
export const CLEANUP_POLICY_ID = "pdfxyz-worker-cleanup-verifier";
/** Bump when the verdict/state taxonomy or its evaluation semantics change. */
export const CLEANUP_POLICY_VERSION = 1;

/**
 * What a storage probe observed for one artifact object, reduced to a bounded fact:
 *  - `absent`  — the bucket answered a genuine `404`: the object is gone (actively deleted,
 *    reaped by the lifecycle backstop, or never-existed — honestly indistinguishable);
 *  - `present` — the bucket answered a `200`: the object's bytes are still there;
 *  - `error`   — the probe could not complete (5xx / network / timeout): unknowable this run.
 *
 * This is the ONLY thing the exporter records about the provider's answer — never the status
 * line, headers, body, or any exception text.
 */
export const CLEANUP_PRESENCE = ["present", "absent", "error"] as const;
export type CleanupPresence = (typeof CLEANUP_PRESENCE)[number];

/**
 * The content-free evidence for ONE artifact the app expected to have been cleaned up. Every
 * field is a coarse lifecycle fact or a boolean — nothing that identifies the object:
 *  - `presence`     — what the storage probe saw ({@link CleanupPresence});
 *  - `lifecycle`    — the object's decoded, content-free lifecycle metadata
 *    ({@link ArtifactLifecycleMetadata}: an expiry instant + an optional tombstone marker), or
 *    `null` when the object carries none. This is the SAME evidence Phase 41 reads on a GET; the
 *    verifier re-evaluates it against its own clock via the shared `evaluateArtifactLifecycle`,
 *    so the two can never disagree on whether an object is expired/tombstoned;
 *  - `activeDelete` — whether the executor recorded a delete-now receipt for this object (so an
 *    absence can be ATTRIBUTED to active app deletion rather than the lifecycle backstop). It is
 *    a bare boolean — never the receipt, its time, or the object it names.
 */
export interface CleanupObjectEvidence {
  readonly presence: CleanupPresence;
  readonly lifecycle: ArtifactLifecycleMetadata | null;
  readonly activeDelete: boolean;
}

/**
 * The bounded per-object cleanup CLASSIFICATION — the honest answer to "what happened to this
 * artifact that should be gone?". Deliberately distinct from the retrieval lifecycle
 * ({@link import("../artifacts/lifecycle").StorageArtifactLifecycle}) because it fuses the
 * app's lifecycle view WITH the storage probe:
 *  - `absent-active`    — gone, and a delete-now receipt attributes it to ACTIVE app deletion
 *    ("active delete-now cleanup working");
 *  - `absent-backstop`  — gone, with no active-delete receipt: attributed to the bucket
 *    LIFECYCLE backstop reaping it (or a never-existed handle — an honest `404` either way)
 *    ("bucket lifecycle backstop verified");
 *  - `retrieval-denied` — PRESENT, but past its retention window / tombstoned, so Phase 41
 *    denies the download. Its bytes are not yet reaped but it is still within the acceptable
 *    post-expiry reap grace ("app retrieval denial working; byte cleanup pending"). NOT a
 *    verified deletion;
 *  - `drift`            — PRESENT past its retention window AND past the reap grace: the bucket
 *    lifecycle backstop should have removed it and has not ("lifecycle drift");
 *  - `live`             — PRESENT within its retention window: not a cleanup target at all
 *    (excluded from the should-be-gone accounting);
 *  - `unknown`          — no usable cleanup evidence (a present object with no lifecycle
 *    metadata, so expiry cannot be judged) ("unknown / unverified");
 *  - `unavailable`      — the probe itself failed: unknowable this run, retry.
 */
export const CLEANUP_OBJECT_STATES = [
  "absent-active",
  "absent-backstop",
  "retrieval-denied",
  "drift",
  "live",
  "unknown",
  "unavailable",
] as const;
export type CleanupObjectState = (typeof CLEANUP_OBJECT_STATES)[number];

/**
 * The aggregate verification VERDICT over a set of per-object classifications — the single
 * value an operator's monitor keys on:
 *  - `verified`       — every should-be-gone artifact is confirmed ABSENT (active or backstop),
 *    with at least one such confirmation and nothing worse. The only honest "cleanup proven";
 *  - `drift`          — at least one artifact is present past its retention window + reap grace;
 *  - `unknown`        — nothing worse, but cleanup could not be PROVEN: some objects are still
 *    present-but-denied (reap pending) or carry no evidence, or there was nothing to verify;
 *  - `unavailable`    — nothing drifted, but at least one probe failed, so verification is
 *    incomplete this run (retry);
 *  - `not-configured` — storage is not wired in this deployment, so there is nothing to verify
 *    (the honest default; never upgraded to a success).
 */
export const CLEANUP_VERIFICATION_VERDICTS = [
  "verified",
  "drift",
  "unknown",
  "unavailable",
  "not-configured",
] as const;
export type CleanupVerdict = (typeof CLEANUP_VERIFICATION_VERDICTS)[number];

/** A content-free tally: how many probed objects fell into each {@link CleanupObjectState}. */
export type CleanupStateCounts = Readonly<Record<CleanupObjectState, number>>;

/**
 * The full, content-free result of a cleanup verification. It carries ONLY the aggregate
 * verdict, the bounded storage provider, per-state COUNTS (never per-object identities), the
 * total number of objects considered, and an authored one-line summary. Safe to log, forward
 * to a SIEM, or print verbatim.
 */
export interface CleanupVerification {
  /** The aggregate verdict. */
  readonly verdict: CleanupVerdict;
  /** The bounded storage backend this verification was evaluated for. A closed enum. */
  readonly provider: RetrievalStorageProvider;
  /** Per-state counts over every object considered. */
  readonly counts: CleanupStateCounts;
  /** Total objects considered (the sum of `counts`). */
  readonly total: number;
  /**
   * Count of should-be-gone objects confirmed absent (`absent-active` + `absent-backstop`) —
   * the positive cleanup evidence, surfaced for a dashboard without re-deriving it from counts.
   */
  readonly reaped: number;
  /**
   * Count of objects still present past their reap grace (`drift`) — the load-bearing drift
   * signal, surfaced directly so an operator can alert on "cleanup drift > 0".
   */
  readonly drift: number;
  /** One-line, content-free summary of the verdict. Authored here; never echoes evidence. */
  readonly summary: string;
}

/** A zeroed {@link CleanupStateCounts} — the starting tally. */
export function emptyCleanupCounts(): Record<CleanupObjectState, number> {
  return {
    "absent-active": 0,
    "absent-backstop": 0,
    "retrieval-denied": 0,
    drift: 0,
    live: 0,
    unknown: 0,
    unavailable: 0,
  };
}
