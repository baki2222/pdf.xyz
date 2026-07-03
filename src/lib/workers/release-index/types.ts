/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence index / retention
 * manifest** (Phase 48).
 *
 * Phases 46–47 closed the *promotion* and *archival* loops: the release readiness gate
 * (`pnpm worker:release-gate`) folds the existing content-free worker checks into ONE PASS/WARN/FAIL
 * verdict, and the release evidence artifact (`pnpm worker:release-artifact`) stamps that gate result
 * with bounded git/release provenance and an INTEGRITY DIGEST, so a single build's promotion evidence
 * can be archived as a stable, tamper-evident, content-free `pdfxyz.release-artifact/1` file. This
 * phase closes the *retention* loop: it takes MANY of those already-content-free artifacts —
 * accumulated across a CI history, a release train, or an incident timeline — RE-VERIFIES each one's
 * integrity digest, and folds them into ONE stable, content-free INDEX / RETENTION MANIFEST that
 * answers a different question than any single artifact does —
 *
 *    "Across every release evidence artifact we have archived, is the archive INTACT (does every
 *     digest still verify), how much history is retained, and is any of it over-retention or stale?"
 *
 * — and fails closed when it cannot honestly say the archive is clean.
 *
 * This module is the closed vocabulary the index produces. It obeys the same honesty contract as the
 * rest of the worker layer, and is deliberately even MORE content-free than the artifacts it indexes:
 * it never copies a free-text field out of an ingested artifact, never echoes an input file path
 * (even on an error), and reduces every per-artifact fact to a low-cardinality, redaction-stable enum,
 * a small integer, a bounded age BUCKET, or a short hex digest prefix.
 *  - Every load-bearing token here is a bounded enum — never a filename, object key, bucket, URL,
 *    endpoint, region, id, token, size, path, byte, a raw commit URL, a raw branch name, or an
 *    operator's raw release label. The one non-enum strings are the app-authored prose, the index's
 *    own ISO stamp, and short lowercase-hex digest PREFIXES of the (already content-free) artifact
 *    digests.
 *  - It never fabricates history: an unreadable / not-an-artifact input is honestly `unreadable`
 *    (never silently dropped), an empty archive is honestly `unknown` (never a vacuous `ok`), and an
 *    artifact whose recomputed digest does NOT match its archived one is `mismatch`/`malformed`
 *    (which forces the whole index to `invalid`), never coerced to `verified`.
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, and
 * NOT a cloud action. The index proves nothing the archived artifacts do not already prove; it
 * RE-VERIFIES their digests and AGGREGATES their bounded facts into a retention view. Its authored
 * caveats (see {@link RELEASE_INDEX_CAVEATS}) say so out loud: it is local content-free indexing +
 * digest verification — not storage retention enforcement, signing, authentication, cloud validation,
 * deletion proof, or deployment promotion.
 */

import type {
  GateSource,
  GitCleanliness,
  OpsBundleSource,
  RefClass,
  ReleaseArtifactVerdict,
} from "../release-artifact/types";
import type { ReleaseGateVerdict } from "../release-gate/types";

/** The schema tag every release-index carries, so tooling can pin the shape it parses. */
export const RELEASE_INDEX_SCHEMA = "pdfxyz.release-index/1" as const;

/** Stable identity of the release-index policy — for docs / receipts / audit. */
export const RELEASE_INDEX_POLICY_ID = "pdfxyz-worker-release-evidence-index";
/** Bump when the index schema, the metadata set, the rollup, or the retention posture changes. */
export const RELEASE_INDEX_POLICY_VERSION = 1;

/**
 * The schema tag the index ingests — a Phase 47 `pdfxyz.release-artifact/1` file. Re-exported from
 * the release-artifact vocabulary so the index pins the exact shape it verifies.
 */
export { RELEASE_ARTIFACT_SCHEMA } from "../release-artifact/types";

/**
 * The single archival-health verdict an operator/CI keys on — about the ARCHIVE's integrity and
 * retention posture, NOT a re-judgement of each build's promotion readiness (the artifacts already
 * carry that). Deliberately named differently from the gate/artifact `pass/fail` ladder so a reader
 * never conflates "this archive is intact + well-retained" with "every archived build passed":
 *  - `ok`      — at least one artifact was indexed, EVERY digest re-verified, and the archive is
 *                within its retention bounds and not stale; a clean, intact retention manifest;
 *  - `warn`    — every digest verified, but a RETENTION concern was raised (more artifacts than the
 *                retention cap, an artifact older than the age cap, a stale newest artifact) or a
 *                non-artifact input was skipped; the archive is intact but needs a retention review;
 *  - `unknown` — the archive is EMPTY or INSUFFICIENT: no usable `pdfxyz.release-artifact/1` was
 *                ingested (no inputs, an empty set, or every input was unreadable), so there is
 *                nothing to index and the manifest cannot say `ok`;
 *  - `invalid` — at least one indexed artifact FAILED digest verification (its recomputed digest did
 *                not match its archived one, or its archived digest was malformed): a tampered or
 *                corrupt artifact is in the archive. The strongest signal; it dominates every other.
 *
 * These are the exact bounded values the run-level {@link import("../observability/metrics").WorkerMetricName}
 * `worker_release_index_total` carries as its `verdict` label; all four are low-cardinality,
 * redaction-stable tokens.
 */
export const RELEASE_INDEX_VERDICTS = ["ok", "warn", "unknown", "invalid"] as const;
export type ReleaseIndexVerdict = (typeof RELEASE_INDEX_VERDICTS)[number];

/**
 * The exit-code ladder a CI/retention job routes on — the same shape as the gate/artifact ladders so
 * the whole worker suite speaks one language:
 *  - `0` OK           — an intact, within-retention manifest was written;
 *  - `1` USAGE        — the CLI was misused (a bad flag, a non-numeric/negative retention bound, or an
 *                       unreadable output destination). CLI-owned; a build never resolves to it;
 *  - `2` INSUFFICIENT — the archive is empty/insufficient (no usable artifact was ingested), or an
 *                       internal fault occurred; the manifest cannot say `ok`;
 *  - `3` WARN         — a retention concern (over-count, over-age, stale) or a skipped non-artifact
 *                       input; the archive is intact but needs a retention review;
 *  - `4` INVALID      — at least one indexed artifact failed digest verification (a tampered / corrupt
 *                       artifact).
 * Monotonic — a higher code is always a stronger "do not trust this archive as-is".
 */
export const RELEASE_INDEX_EXIT = {
  OK: 0,
  USAGE: 1,
  INSUFFICIENT: 2,
  WARN: 3,
  INVALID: 4,
} as const;
export type ReleaseIndexExitCode = (typeof RELEASE_INDEX_EXIT)[keyof typeof RELEASE_INDEX_EXIT];

/**
 * The bounded per-artifact digest-verification status — the result of recomputing the artifact's
 * integrity digest over its canonical body and comparing it to the archived one:
 *  - `verified`  — the recomputed digest matched the archived one; the artifact was not altered;
 *  - `mismatch`  — a well-formed archived digest did NOT match the recomputed one (a tampered /
 *                  corrupt artifact body);
 *  - `malformed` — the archived integrity digest was not a well-formed sha256 hex (a broken artifact);
 *  - `unreadable`— the input was not a recognized `pdfxyz.release-artifact/1` file (a read failure,
 *                  malformed JSON, or the wrong shape), so there was no digest to verify.
 * `mismatch` and `malformed` are INTEGRITY failures that force the whole index to `invalid`.
 */
export const RELEASE_INDEX_DIGEST_STATUSES = ["verified", "mismatch", "malformed", "unreadable"] as const;
export type ReleaseIndexDigestStatus = (typeof RELEASE_INDEX_DIGEST_STATUSES)[number];

/** The two digest statuses that mean a RECOGNIZED artifact failed integrity (⇒ `invalid`). */
export const RELEASE_INDEX_INTEGRITY_FAILURES = ["mismatch", "malformed"] as const;

/**
 * The bounded classification of an artifact's operator release LABEL — a CLASS, never the raw label
 * (which, though validated by the artifact to a strict redaction-stable charset, is still an
 * operator-authored string the INDEX declines to echo):
 *  - `semver`  — the label looks like a `vX.Y[.Z]` release tag;
 *  - `named`   — any other present label (a channel / codename / build id);
 *  - `absent`  — no label was recorded on the artifact.
 */
export const RELEASE_LABEL_CLASSES = ["semver", "named", "absent"] as const;
export type ReleaseLabelClass = (typeof RELEASE_LABEL_CLASSES)[number];

/**
 * Coarse age buckets for an artifact's `generatedAt` relative to the index run's clock — a BUCKET,
 * never the raw stamp difference (which, in aggregate, could fingerprint a release cadence):
 *  - `<1h` / `1-24h` / `1-7d` / `7-30d` / `30-90d` / `90d+` — increasing age;
 *  - `future`  — the stamp is after the index clock (clock skew — surfaced honestly, never hidden);
 *  - `unknown` — the stamp was missing or not a parseable instant.
 */
export const RELEASE_INDEX_AGE_BUCKETS = [
  "<1h",
  "1-24h",
  "1-7d",
  "7-30d",
  "30-90d",
  "90d+",
  "future",
  "unknown",
] as const;
export type ReleaseIndexAgeBucket = (typeof RELEASE_INDEX_AGE_BUCKETS)[number];

/**
 * The bounded reasons the index rollup escalated off `ok` — a closed set a reader routes on without
 * parsing prose:
 *  - `tampered-artifact` — a recognized artifact's digest did not match (`mismatch`) ⇒ `invalid`;
 *  - `malformed-digest`  — a recognized artifact's archived digest was malformed ⇒ `invalid`;
 *  - `retention-count`   — more artifacts were indexed than `--max-artifacts` allows ⇒ `warn`;
 *  - `retention-age`     — an artifact is older than `--max-age-days` ⇒ `warn`;
 *  - `stale`             — the NEWEST artifact is older than `--max-age-days` ⇒ `warn`;
 *  - `unreadable-input`  — a non-artifact input was skipped (with ≥1 usable artifact) ⇒ `warn`;
 *  - `empty`             — no usable artifact was ingested ⇒ `unknown`.
 */
export const RELEASE_INDEX_DRIVERS = [
  "tampered-artifact",
  "malformed-digest",
  "retention-count",
  "retention-age",
  "stale",
  "unreadable-input",
  "empty",
] as const;
export type ReleaseIndexDriver = (typeof RELEASE_INDEX_DRIVERS)[number];

/**
 * One artifact's bounded, content-free summary in the manifest. Every field is a bounded enum, a
 * small integer, a bounded age bucket, a short hex digest prefix, or a boolean — never a filename,
 * path, raw ref, raw label, commit URL, size, or a byte of the artifact's body.
 */
export interface ReleaseIndexEntry {
  /** Stable position in the manifest (newest = 0), after the deterministic newest-first sort. */
  readonly position: number;
  /** The digest-verification status of this artifact. */
  readonly digestStatus: ReleaseIndexDigestStatus;
  /**
   * A short lowercase-hex prefix (≤12 chars) of the artifact's RECOMPUTED integrity digest, or `null`
   * for an `unreadable` input (there was no artifact to digest). The digest is a hash of the
   * already-content-free body, so a prefix of it is itself content-free.
   */
  readonly digestPrefix: string | null;
  /** The artifact's own archival verdict (`pass`/`warn`/`fail`/`unknown`), or `null` if unreadable. */
  readonly verdict: ReleaseArtifactVerdict | null;
  /** The archived release-gate verdict the artifact carried, or `null` if unreadable. */
  readonly gateVerdict: ReleaseGateVerdict | null;
  /** The build's working-tree cleanliness, or `null` if unreadable. */
  readonly cleanliness: GitCleanliness | null;
  /** The build's bounded ref class, or `null` if unreadable. */
  readonly refClass: RefClass | null;
  /** Whether a bounded git commit hash was recorded on the artifact (`false` if unreadable). */
  readonly commitPresent: boolean;
  /** The bounded class of the operator release label (`absent` if none / unreadable). */
  readonly labelClass: ReleaseLabelClass;
  /** Whether the artifact recorded an operator release label (`false` if unreadable). */
  readonly labelPresent: boolean;
  /** The bounded provenance of the artifact's archived gate result, or `null` if unreadable. */
  readonly gateSource: GateSource | null;
  /** Whether the artifact attached an ops-bundle summary as context (`source === "supplied"`). */
  readonly opsBundlePresent: boolean;
  /** The bounded provenance of the artifact's optional ops-bundle attachment, or `null` if unreadable. */
  readonly opsBundleSource: OpsBundleSource | null;
  /** The coarse age of the artifact relative to the index clock (`unknown` if the stamp was unsafe). */
  readonly ageBucket: ReleaseIndexAgeBucket;
  /**
   * Whether this artifact is OVER a retention bound (past the `--max-artifacts` position, or older
   * than `--max-age-days`) — a bounded prune-candidate flag; the index never deletes it, only flags it.
   */
  readonly overRetention: boolean;
}

/** Per-verdict counts over the RECOGNIZED artifacts (unreadable inputs carry no verdict). */
export interface ReleaseIndexVerdictCounts {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
  readonly unknown: number;
}

/** Per-digest-status counts over EVERY input (recognized artifacts + unreadable inputs). */
export interface ReleaseIndexDigestCounts {
  readonly verified: number;
  readonly mismatch: number;
  readonly malformed: number;
  readonly unreadable: number;
}

/**
 * The bounded retention posture — the manifest's answer to "how much history is retained and is any
 * of it over policy or stale". Every field is a small integer, a bounded age bucket, a boolean, or an
 * optional operator-supplied bound; never a raw stamp or a locator.
 */
export interface ReleaseIndexRetention {
  /** The operator's `--max-artifacts` cap, or `null` if none was supplied. */
  readonly maxArtifacts: number | null;
  /** The operator's `--max-age-days` cap, or `null` if none was supplied. */
  readonly maxAgeDays: number | null;
  /** How many inputs were provided in total (recognized artifacts + unreadable inputs). */
  readonly totalInputs: number;
  /** How many recognized `pdfxyz.release-artifact/1` artifacts were indexed. */
  readonly indexedArtifacts: number;
  /** How many inputs were skipped as unreadable / not-an-artifact. */
  readonly skippedInputs: number;
  /** How many indexed artifacts are over a retention bound (prune candidates). */
  readonly overRetentionCount: number;
  /** True iff `indexedArtifacts` exceeds `maxArtifacts` (a retention-count drift). */
  readonly overCount: boolean;
  /** True iff at least one indexed artifact is older than `maxAgeDays` (a retention-age drift). */
  readonly overAge: boolean;
  /** True iff the NEWEST indexed artifact is older than `maxAgeDays` (the archive is stale). */
  readonly stale: boolean;
  /** The coarse age of the NEWEST indexed artifact (`unknown` if none / unsafe stamp). */
  readonly newestAgeBucket: ReleaseIndexAgeBucket;
  /** The coarse age of the OLDEST indexed artifact (`unknown` if none / unsafe stamp). */
  readonly oldestAgeBucket: ReleaseIndexAgeBucket;
}

/** The composite rollup — the single verdict + exit code an operator/CI acts on. */
export interface ReleaseIndexRollup {
  readonly verdict: ReleaseIndexVerdict;
  readonly exitCode: ReleaseIndexExitCode;
  /** True iff `verdict === "ok"`. */
  readonly ready: boolean;
  /** The bounded reasons the rollup escalated off `ok` (empty on a clean `ok`). */
  readonly drivers: readonly ReleaseIndexDriver[];
  readonly detail: string;
}

/** The stable identity + retention-policy block the manifest records. */
export interface ReleaseIndexMetadata {
  /** The index schema version (numeric mirror of the string {@link RELEASE_INDEX_SCHEMA} tag). */
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_INDEX_POLICY_VERSION;
  /** The `pdfxyz.release-artifact/1` schema every indexed artifact is pinned to. */
  readonly artifactSchema: string;
}

/**
 * The stable, content-free release evidence index / retention manifest an operator or CI archives to
 * track many release artifacts over time. Every field is a bounded enum, a small integer, a bounded
 * age bucket, a short hex prefix, an ISO stamp, or app-authored prose — so the manifest carries no
 * locator, identifier, size, path, or byte, even from a hostile input.
 */
export interface ReleaseIndex {
  readonly schema: typeof RELEASE_INDEX_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseIndexMetadata;
  readonly rollup: ReleaseIndexRollup;
  readonly retention: ReleaseIndexRetention;
  readonly verdictCounts: ReleaseIndexVerdictCounts;
  readonly digestCounts: ReleaseIndexDigestCounts;
  /** One bounded summary per input, newest indexed artifact first, unreadable inputs last. */
  readonly artifacts: readonly ReleaseIndexEntry[];
  /** Bounded, app-authored retention guidance (out-of-scope steps this index does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested artifact. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log/forward verbatim). */
  readonly receipt: ReleaseIndexReceipt;
}

/**
 * The content-free **audit receipt** the index rides alongside its body — the flattened answer to
 * "what did this retention manifest resolve to, over how much history" for a SIEM / release record.
 * Bounded enums + small integers + a stable policy id + the run's own stamp only; safe to log or
 * forward verbatim.
 */
export interface ReleaseIndexReceipt {
  readonly category: "worker-release-index";
  readonly policyId: typeof RELEASE_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_INDEX_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseIndexVerdict;
  readonly exitCode: ReleaseIndexExitCode;
  /** How many recognized artifacts were indexed. */
  readonly indexedArtifacts: number;
  /** How many artifacts re-verified their digest (the intact count). */
  readonly verifiedArtifacts: number;
  /** How many artifacts FAILED digest verification (mismatch + malformed). */
  readonly integrityFailures: number;
  /** True iff any retention concern (over-count, over-age, or stale) was raised. */
  readonly retentionDrift: boolean;
}

/** The process exit code for an index. */
export function releaseIndexExitCode(index: ReleaseIndex): number {
  return index.rollup.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested artifact)
 * ------------------------------------------------------------------ */

/** The one-line rollup headline per verdict. Authored here, keyed by the enum. */
export const RELEASE_INDEX_VERDICT_SUMMARY: Record<ReleaseIndexVerdict, string> = {
  ok: "ARCHIVE INTACT: every indexed release evidence artifact re-verified its integrity digest, and the archive is within its retention bounds. A clean, content-free retention manifest.",
  warn: "RETENTION REVIEW: every digest verified, but a retention concern was raised (more artifacts than the cap, an artifact past the age cap, a stale newest artifact) or a non-artifact input was skipped. The archive is intact but needs a retention review.",
  unknown:
    "ARCHIVE EMPTY: no usable `pdfxyz.release-artifact/1` was indexed (no inputs, an empty set, or every input was unreadable). The manifest cannot certify an archive it could not read.",
  invalid:
    "ARCHIVE TAMPERED: at least one indexed artifact FAILED digest verification (its recomputed digest did not match its archived one, or its digest was malformed). A tampered or corrupt artifact is in the archive; do not trust it as-is.",
};

/**
 * The honesty caveats every index carries and every text render prints. The index RE-VERIFIES the
 * archived artifacts' digests and AGGREGATES their bounded facts into a retention view; it must never
 * be read as more than that.
 */
export const RELEASE_INDEX_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE INDEX / RETENTION MANIFEST: it re-verifies the integrity digest of each archived `pdfxyz.release-artifact/1` and folds their bounded facts into one content-free retention view. It is not itself a new proof, and it performs no promotion.",
  "It is local content-free INDEXING + digest verification — NOT storage retention ENFORCEMENT. It flags over-retention and stale history for an operator to act on; it never deletes, prunes, uploads, expires, or mutates any artifact, object, or bucket, and it makes no network call and reads no secret, bucket, or object.",
  "A digest re-verification is TAMPER-EVIDENCE over content-free data (confirm an archived body was not altered); it is NOT a cryptographic signature — there is no signing key and no attested identity — and it proves nothing about a body's meaning beyond byte-stability.",
  "It indexes only bounded enums, small counts, coarse age buckets, short hex digest prefixes, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job/user id, IP, token, raw ref, raw label, commit URL, size, byte, or document content, even from a hostile input.",
  "An `ok` verdict means the ARCHIVE is intact and within retention on THIS host — not that every archived build passed (the per-verdict counts report that separately), nor that any out-of-band concern (real cloud retention, legal hold, storage cost, provider quotas) is resolved. Those remain operator-owned.",
  "It is not malware scanning, sanitization, authentication, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, or mutates nothing.",
];

/**
 * Retention reminders the index carries but does NOT itself perform — the honest edges of an offline
 * retention manifest. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_INDEX_GUIDANCE: readonly string[] = [
  "Enforce retention out of band: this manifest FLAGS over-retention and stale history (over `--max-artifacts`, past `--max-age-days`), but pruning the archived artifact files or the objects behind them is an operator/CI action this offline index never performs.",
  "Re-run the index over the SAME set of artifacts you archive; an `invalid` verdict means a digest no longer matches — recover the untampered artifact from your CI archive and investigate, do not overwrite it.",
  "Validate real cloud/storage retention out of band: bucket lifecycle rules, object deletion, legal holds, and CDN state are not observable from this offline manifest, which reads only your archived content-free artifact files.",
  "Archive this manifest as a CI artifact alongside the release artifacts it indexes; it is a content-free retention record, not a substitute for the artifacts themselves or for your storage-side retention policy.",
];
