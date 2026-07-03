/**
 * Pure, node-free **composer** for the release evidence index / retention manifest (Phase 48).
 *
 * It takes the bounded {@link IngestedArtifact} facts the trust boundary produced (`./ingest`), the
 * operator's retention bounds, and the index run's own stamp, and folds them into one stable
 * {@link ReleaseIndex}: it sorts the artifacts newest-first deterministically, assigns each a bounded
 * age bucket and a retention flag, tallies the per-verdict + per-digest-status counts, derives the
 * retention posture (over-count / over-age / stale), computes the composite rollup (`./rollup`), and
 * flattens the audit receipt (`./receipt`).
 *
 * Determinism: the sort is a total order (newest dated artifacts by descending instant, then
 * recognized-but-undateable, then unreadable inputs, ties broken by input order), the age buckets are
 * a pure function of the injected clock, and no field is a raw stamp — so the same inputs + clock
 * always produce a byte-identical manifest. Honesty: an artifact with an unsafe stamp is `unknown`
 * age (never guessed), a recognized artifact with no readable verdict is simply absent from the
 * verdict counts (never folded into a false bucket), and retention drift is FLAGGED, never enforced.
 */

import { ageBucket, ageInDays, instantToMs } from "./age";
import type { IngestedArtifact } from "./ingest";
import { buildReceipt } from "./receipt";
import { computeRollup } from "./rollup";
import {
  RELEASE_INDEX_CAVEATS,
  RELEASE_INDEX_GUIDANCE,
  RELEASE_INDEX_POLICY_VERSION,
  RELEASE_INDEX_POLICY_ID,
  RELEASE_INDEX_SCHEMA,
  RELEASE_ARTIFACT_SCHEMA,
  type ReleaseIndex,
  type ReleaseIndexAgeBucket,
  type ReleaseIndexDigestCounts,
  type ReleaseIndexEntry,
  type ReleaseIndexMetadata,
  type ReleaseIndexRetention,
  type ReleaseIndexVerdictCounts,
} from "./types";

/** The operator-supplied retention bounds (each `null` when not supplied). */
export interface RetentionBounds {
  readonly maxArtifacts: number | null;
  readonly maxAgeDays: number | null;
}

/** An ingested artifact paired with its original input position (for a stable sort tiebreak). */
interface Indexed {
  readonly a: IngestedArtifact;
  readonly inputIndex: number;
}

/** True iff this ingested input was a recognized artifact (not an unreadable / non-artifact input). */
function isRecognized(a: IngestedArtifact): boolean {
  return a.digestStatus !== "unreadable";
}

/**
 * The deterministic sort group: recognized+dated (0) → recognized+undateable (1) → unreadable (2).
 * A lower group sorts first, so dated artifacts lead, undateable recognized ones follow, and
 * non-artifact inputs land last.
 */
function sortGroup(a: IngestedArtifact): 0 | 1 | 2 {
  if (!isRecognized(a)) return 2;
  return a.atMs !== null ? 0 : 1;
}

/** Total-order comparator: group asc, then instant desc within the dated group, then input order. */
function compare(x: Indexed, y: Indexed): number {
  const gx = sortGroup(x.a);
  const gy = sortGroup(y.a);
  if (gx !== gy) return gx - gy;
  if (gx === 0) {
    // Both dated: newest (largest instant) first.
    const diff = (y.a.atMs ?? 0) - (x.a.atMs ?? 0);
    if (diff !== 0) return diff;
  }
  return x.inputIndex - y.inputIndex;
}

/** Assemble the index metadata block (stable identity + the pinned artifact schema). */
export function buildMetadata(): ReleaseIndexMetadata {
  return {
    schemaVersion: RELEASE_INDEX_POLICY_VERSION,
    policyId: RELEASE_INDEX_POLICY_ID,
    policyVersion: RELEASE_INDEX_POLICY_VERSION,
    artifactSchema: RELEASE_ARTIFACT_SCHEMA,
  };
}

/**
 * Fold the ingested artifacts + retention bounds + the run stamp into the full {@link ReleaseIndex}.
 * Pure and deterministic; `generatedAt` is both the manifest stamp and the age-bucket clock.
 */
export function buildIndex(
  generatedAt: string,
  ingested: readonly IngestedArtifact[],
  bounds: RetentionBounds,
): ReleaseIndex {
  const nowMs = instantToMs(generatedAt);
  const { maxArtifacts, maxAgeDays } = bounds;

  const sorted = ingested
    .map((a, inputIndex): Indexed => ({ a, inputIndex }))
    .sort(compare);

  const entries: ReleaseIndexEntry[] = [];
  const digestCounts = { verified: 0, mismatch: 0, malformed: 0, unreadable: 0 };
  const verdictCounts = { pass: 0, warn: 0, fail: 0, unknown: 0 };

  let recognizedIndex = 0; // 0-based position among recognized artifacts (newest = 0)
  let overRetentionCount = 0;
  let overAge = false;
  let newestAtMs: number | null | undefined; // the newest recognized artifact's instant
  let oldestAtMs: number | null | undefined; // the oldest recognized artifact's instant
  let newestAgeDays: number | null = null; // for the stale decision

  sorted.forEach(({ a }, position) => {
    digestCounts[a.digestStatus] += 1;
    const recognized = isRecognized(a);

    if (recognized && a.verdict !== null) verdictCounts[a.verdict] += 1;

    const overByCount = recognized && maxArtifacts !== null && recognizedIndex >= maxArtifacts;
    const days = ageInDays(nowMs, a.atMs);
    const overByAge = recognized && maxAgeDays !== null && days !== null && days > maxAgeDays;
    const overRetention = recognized && (overByCount || overByAge);
    if (overRetention) overRetentionCount += 1;
    if (overByAge) overAge = true;

    entries.push({
      position,
      digestStatus: a.digestStatus,
      digestPrefix: a.digestPrefix,
      verdict: a.verdict,
      gateVerdict: a.gateVerdict,
      cleanliness: a.cleanliness,
      refClass: a.refClass,
      commitPresent: a.commitPresent,
      labelClass: a.labelClass,
      labelPresent: a.labelPresent,
      gateSource: a.gateSource,
      opsBundlePresent: a.opsBundlePresent,
      opsBundleSource: a.opsBundleSource,
      ageBucket: ageBucket(nowMs, a.atMs),
      overRetention,
    });

    if (recognized) {
      if (newestAtMs === undefined) {
        newestAtMs = a.atMs;
        newestAgeDays = days;
      }
      oldestAtMs = a.atMs;
      recognizedIndex += 1;
    }
  });

  const indexedArtifacts = recognizedIndex;
  const skippedInputs = digestCounts.unreadable;
  const stale = maxAgeDays !== null && newestAgeDays !== null && newestAgeDays > maxAgeDays;
  const bucketOf = (ms: number | null | undefined): ReleaseIndexAgeBucket =>
    ms === undefined ? "unknown" : ageBucket(nowMs, ms);

  const retention: ReleaseIndexRetention = {
    maxArtifacts,
    maxAgeDays,
    totalInputs: ingested.length,
    indexedArtifacts,
    skippedInputs,
    overRetentionCount,
    overCount: maxArtifacts !== null && indexedArtifacts > maxArtifacts,
    overAge,
    stale,
    newestAgeBucket: bucketOf(newestAtMs),
    oldestAgeBucket: bucketOf(oldestAtMs),
  };

  const rollup = computeRollup(digestCounts, retention, indexedArtifacts, skippedInputs);
  const digestCountsOut: ReleaseIndexDigestCounts = digestCounts;
  const verdictCountsOut: ReleaseIndexVerdictCounts = verdictCounts;

  return {
    schema: RELEASE_INDEX_SCHEMA,
    generatedAt,
    metadata: buildMetadata(),
    rollup,
    retention,
    verdictCounts: verdictCountsOut,
    digestCounts: digestCountsOut,
    artifacts: entries,
    guidance: RELEASE_INDEX_GUIDANCE,
    caveats: RELEASE_INDEX_CAVEATS,
    receipt: buildReceipt(generatedAt, rollup, retention, digestCountsOut),
  };
}
