/**
 * Pure, node-free **release-index ingest** for the release policy CLI (Phase 49) — the trust boundary
 * and the no-leak core.
 *
 * The policy evaluates a `pdfxyz.release-index/1` manifest. Even though the index is already
 * content-free, it is UNTRUSTED input here (a CI archive an operator points us at, or a hand-crafted /
 * tampered file), and this module turns one parsed root into the bounded {@link IngestedIndex} the
 * policy is built from, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of an index. Every recorded
 *    fact is validated against a bounded enum (the archive verdict, an artifact verdict, an age bucket)
 *    or a non-negative integer / boolean. Prose, caveats, guidance, stamps, digest prefixes, and any
 *    stray extra field are all DROPPED.
 *  - **Fail-closed consistency.** A recognized index is `usable` only if its own counts add up AND its
 *    archive-health verdict, RECOMPUTED from those counts via the SAME `../release-index/rollup`, equals
 *    its self-report. A manifest whose numbers or rollup contradict each other is a tampered / hand-
 *    edited file: `usable = false` (⇒ the policy `fail`s with `index-invalid`).
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ the policy
 *    `unknown`s — insufficient input); a recognized-but-inconsistent input is `recognized = true,
 *    usable = false`; a valid, consistent input is `usable = true` with reduced {@link ReleasePolicyFacts}.
 *    The offending content is never echoed.
 */

import { computeRollup } from "../release-index/rollup";
import {
  RELEASE_INDEX_AGE_BUCKETS,
  RELEASE_INDEX_SCHEMA,
  RELEASE_INDEX_VERDICTS,
  type ReleaseIndex,
  type ReleaseIndexAgeBucket,
  type ReleaseIndexDigestCounts,
  type ReleaseIndexEntry,
  type ReleaseIndexRetention,
  type ReleaseIndexVerdict,
} from "../release-index/types";
import { RELEASE_ARTIFACT_VERDICTS, type ReleaseArtifactVerdict } from "../release-artifact/types";
import type { ReleasePolicyFacts } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A strict non-negative safe integer, or `undefined` (never coerces a float / string / negative). */
function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Strictly `true` or `false`, or `undefined` for anything else. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * The outcome of ingesting one parsed release-index root — a tri-state the rollup routes on:
 *  - `recognized = false`              → the input was not a `pdfxyz.release-index/1` (⇒ policy `unknown`);
 *  - `recognized = true, usable = false` → it claimed to be one but is malformed / inconsistent (⇒ `fail`);
 *  - `usable = true`                   → a valid, consistent index; `facts` carries the reduced facts.
 */
export interface IngestedIndex {
  readonly recognized: boolean;
  readonly usable: boolean;
  /** The index's SELF-REPORTED archive-health verdict (present iff a valid enum was read). */
  readonly reportedVerdict: ReleaseIndexVerdict | null;
  /** The archive-health verdict RECOMPUTED from the index's own counts (present iff usable). */
  readonly effectiveVerdict: ReleaseIndexVerdict | null;
  /** The reduced, content-free facts the policy evaluates (present iff usable). */
  readonly facts: ReleasePolicyFacts | null;
}

/** The bounded outcome for an input that was not a recognized release-index (nothing to evaluate). */
export const UNRECOGNIZED_INDEX: IngestedIndex = {
  recognized: false,
  usable: false,
  reportedVerdict: null,
  effectiveVerdict: null,
  facts: null,
};

/** A recognized-but-unusable outcome (malformed / inconsistent index), carrying its self-report only. */
function unusableIndex(reportedVerdict: ReleaseIndexVerdict | null): IngestedIndex {
  return { recognized: true, usable: false, reportedVerdict, effectiveVerdict: null, facts: null };
}

/** The four bounded per-verdict counts, each a strict non-negative integer, or `undefined` if malformed. */
function verdictCountsOf(value: unknown): ReleasePolicyFacts["verdictCounts"] | undefined {
  if (!isObject(value)) return undefined;
  const pass = intOf(value.pass);
  const warn = intOf(value.warn);
  const fail = intOf(value.fail);
  const unknown = intOf(value.unknown);
  if (pass === undefined || warn === undefined || fail === undefined || unknown === undefined) {
    return undefined;
  }
  return { pass, warn, fail, unknown };
}

/** The four bounded per-digest-status counts, each a strict non-negative integer, or `undefined`. */
function digestCountsOf(value: unknown): ReleaseIndexDigestCounts | undefined {
  if (!isObject(value)) return undefined;
  const verified = intOf(value.verified);
  const mismatch = intOf(value.mismatch);
  const malformed = intOf(value.malformed);
  const unreadable = intOf(value.unreadable);
  if (
    verified === undefined ||
    mismatch === undefined ||
    malformed === undefined ||
    unreadable === undefined
  ) {
    return undefined;
  }
  return { verified, mismatch, malformed, unreadable };
}

/** The bounded retention posture facts the rollup + policy need, or `undefined` if malformed. */
interface RetentionFacts {
  readonly totalInputs: number;
  readonly indexedArtifacts: number;
  readonly skippedInputs: number;
  readonly overRetentionCount: number;
  readonly overCount: boolean;
  readonly overAge: boolean;
  readonly stale: boolean;
  readonly newestAgeBucket: ReleaseIndexAgeBucket;
  readonly oldestAgeBucket: ReleaseIndexAgeBucket;
}

function retentionOf(value: unknown): RetentionFacts | undefined {
  if (!isObject(value)) return undefined;
  const totalInputs = intOf(value.totalInputs);
  const indexedArtifacts = intOf(value.indexedArtifacts);
  const skippedInputs = intOf(value.skippedInputs);
  const overRetentionCount = intOf(value.overRetentionCount);
  const overCount = boolOf(value.overCount);
  const overAge = boolOf(value.overAge);
  const stale = boolOf(value.stale);
  const newestAgeBucket = oneOf(value.newestAgeBucket, RELEASE_INDEX_AGE_BUCKETS);
  const oldestAgeBucket = oneOf(value.oldestAgeBucket, RELEASE_INDEX_AGE_BUCKETS);
  if (
    totalInputs === undefined ||
    indexedArtifacts === undefined ||
    skippedInputs === undefined ||
    overRetentionCount === undefined ||
    overCount === undefined ||
    overAge === undefined ||
    stale === undefined ||
    newestAgeBucket === undefined ||
    oldestAgeBucket === undefined
  ) {
    return undefined;
  }
  return {
    totalInputs,
    indexedArtifacts,
    skippedInputs,
    overRetentionCount,
    overCount,
    overAge,
    stale,
    newestAgeBucket,
    oldestAgeBucket,
  };
}

/**
 * Read the newest recognized artifact's verdict from the manifest's (newest-first) artifacts array —
 * the first entry whose `digestStatus` is not `unreadable`, reduced to a bounded verdict (or `null` if
 * that entry carried no valid verdict, or none was recognized). Never echoes a field.
 */
function latestVerdictOf(artifacts: readonly unknown[]): ReleaseArtifactVerdict | null {
  for (const entry of artifacts) {
    if (!isObject(entry)) continue;
    if (entry.digestStatus === "unreadable") continue;
    // A recognized entry (any non-`unreadable` digest status) — its verdict is the latest, if valid.
    return oneOf(entry.verdict, RELEASE_ARTIFACT_VERDICTS) ?? null;
  }
  return null;
}

/**
 * Reduce one parsed release-index `root` to the bounded {@link IngestedIndex}. A non-object /
 * wrong-schema input is `UNRECOGNIZED_INDEX`; a recognized-but-malformed/inconsistent input is
 * `unusableIndex(...)`; a valid, consistent index yields reduced facts. Never throws and never echoes
 * the input.
 */
export function ingestIndex(root: unknown): IngestedIndex {
  if (!isObject(root) || root.schema !== RELEASE_INDEX_SCHEMA) {
    return UNRECOGNIZED_INDEX;
  }

  // It claims to be a release-index. Read its self-reported archive-health verdict up front so an
  // unusable outcome can still surface it (for the reader's transparency), then validate structure.
  const rollup = isObject(root.rollup) ? root.rollup : undefined;
  const reportedVerdict = rollup ? (oneOf(rollup.verdict, RELEASE_INDEX_VERDICTS) ?? null) : null;

  const retention = retentionOf(root.retention);
  const digestCounts = digestCountsOf(root.digestCounts);
  const verdictCounts = verdictCountsOf(root.verdictCounts);
  const artifacts = Array.isArray(root.artifacts) ? root.artifacts : undefined;
  if (
    reportedVerdict === null ||
    retention === undefined ||
    digestCounts === undefined ||
    verdictCounts === undefined ||
    artifacts === undefined
  ) {
    return unusableIndex(reportedVerdict);
  }

  // Internal consistency — a manifest that does not verify against itself is tampered / hand-edited.
  const digestSum =
    digestCounts.verified + digestCounts.mismatch + digestCounts.malformed + digestCounts.unreadable;
  const recognizedByDigest = digestCounts.verified + digestCounts.mismatch + digestCounts.malformed;
  const verdictSum = verdictCounts.pass + verdictCounts.warn + verdictCounts.fail + verdictCounts.unknown;
  const consistent =
    digestSum === retention.totalInputs &&
    recognizedByDigest === retention.indexedArtifacts &&
    digestCounts.unreadable === retention.skippedInputs &&
    artifacts.length === retention.totalInputs &&
    verdictSum <= retention.indexedArtifacts &&
    retention.overRetentionCount <= retention.indexedArtifacts;
  if (!consistent) {
    return unusableIndex(reportedVerdict);
  }

  // Recompute the archive-health verdict from the index's OWN counts, via the same rollup the index
  // used, and reject a self-report that disagrees. This catches a flipped `rollup.verdict` (e.g. an
  // `invalid` archive relabeled `ok` to smuggle a tampered artifact past the gate).
  const indexRetention: Pick<ReleaseIndexRetention, "overCount" | "overAge" | "stale"> = {
    overCount: retention.overCount,
    overAge: retention.overAge,
    stale: retention.stale,
  };
  const recomputed = computeRollup(
    digestCounts,
    indexRetention as ReleaseIndexRetention,
    retention.indexedArtifacts,
    retention.skippedInputs,
  );
  if (recomputed.verdict !== reportedVerdict) {
    return unusableIndex(reportedVerdict);
  }

  const facts: ReleasePolicyFacts = {
    archiveVerdict: recomputed.verdict,
    indexedArtifacts: retention.indexedArtifacts,
    skippedInputs: retention.skippedInputs,
    totalInputs: retention.totalInputs,
    integrityFailures: digestCounts.mismatch + digestCounts.malformed,
    verdictCounts,
    overRetentionCount: retention.overRetentionCount,
    overCount: retention.overCount,
    overAge: retention.overAge,
    stale: retention.stale,
    newestAgeBucket: retention.newestAgeBucket,
    oldestAgeBucket: retention.oldestAgeBucket,
    latestVerdict: latestVerdictOf(artifacts),
  };

  return {
    recognized: true,
    usable: true,
    reportedVerdict,
    effectiveVerdict: recomputed.verdict,
    facts,
  };
}

/**
 * Reduce a TRUSTED, in-process-built {@link ReleaseIndex} (from the `--artifact` mode, where every
 * digest was re-verified here) to the same bounded {@link IngestedIndex}. No validation is needed — we
 * built it — so it is always `recognized` + `usable`; this only projects it onto the policy facts.
 */
export function ingestBuiltIndex(index: ReleaseIndex): IngestedIndex {
  const { retention, digestCounts, verdictCounts, rollup } = index;
  const facts: ReleasePolicyFacts = {
    archiveVerdict: rollup.verdict,
    indexedArtifacts: retention.indexedArtifacts,
    skippedInputs: retention.skippedInputs,
    totalInputs: retention.totalInputs,
    integrityFailures: digestCounts.mismatch + digestCounts.malformed,
    verdictCounts: {
      pass: verdictCounts.pass,
      warn: verdictCounts.warn,
      fail: verdictCounts.fail,
      unknown: verdictCounts.unknown,
    },
    overRetentionCount: retention.overRetentionCount,
    overCount: retention.overCount,
    overAge: retention.overAge,
    stale: retention.stale,
    newestAgeBucket: retention.newestAgeBucket,
    oldestAgeBucket: retention.oldestAgeBucket,
    latestVerdict: latestVerdictOf(index.artifacts as readonly ReleaseIndexEntry[]),
  };
  return {
    recognized: true,
    usable: true,
    reportedVerdict: rollup.verdict,
    effectiveVerdict: rollup.verdict,
    facts,
  };
}
