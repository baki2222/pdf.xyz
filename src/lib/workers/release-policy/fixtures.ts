/**
 * Test-support builders for the release policy tests (Phase 49).
 *
 * The policy's input is a `pdfxyz.release-index/1` manifest, so these helpers build a REAL, valid,
 * internally-consistent index (via the same `../release-index` build the shipped index CLI uses) from a
 * set of artifact options — giving the policy tests trustworthy inputs to assert over, and a base to
 * deliberately corrupt (flip a count, a verdict) to prove the consistency check catches a tampered one.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from
 * `./index`), is never imported by any runtime module, and — like the index's own fixtures — uses
 * `node:crypto` so tests get a real digest without threading a hash seam.
 */

import { createHash } from "node:crypto";
import { buildIndex, type RetentionBounds } from "../release-index/build";
import { ingestArtifact } from "../release-index/ingest";
import type { ReleaseIndex } from "../release-index/types";
import { makeArtifact, type ArtifactOptions } from "../release-index/fixtures";

export { makeArtifact, type ArtifactOptions } from "../release-index/fixtures";

/** A real lowercase-hex sha256 of `s` — the same digest scheme the artifact/index use. */
export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** A fixed clock the index/policy tests stamp with (deterministic ages). */
export const NOW = "2026-07-03T00:00:00.000Z";

/** No retention bounds — the index tallies + buckets ages but flags no over-retention. */
export const NO_BOUNDS: RetentionBounds = { maxArtifacts: null, maxAgeDays: null };

/**
 * Build a REAL `pdfxyz.release-index/1` object by indexing the given artifact options at `now`, under
 * `bounds` — the exact shape the policy ingests. Every digest is a correct sha256, so the index is
 * valid + consistent; the policy tests then evaluate assertions over it (or corrupt a field first).
 */
export function makeIndex(
  artifacts: ArtifactOptions[],
  bounds: RetentionBounds = NO_BOUNDS,
  now: string = NOW,
): ReleaseIndex {
  const ingested = artifacts.map((o) => ingestArtifact(makeArtifact(o), sha256));
  return buildIndex(now, ingested, bounds);
}

/** Serialize an index object to the JSON text a `--index` file / stdin would carry. */
export function indexText(
  artifacts: ArtifactOptions[],
  bounds: RetentionBounds = NO_BOUNDS,
  now: string = NOW,
): string {
  return JSON.stringify(makeIndex(artifacts, bounds, now));
}

/** A convenient default policy with no assertions configured. */
export function emptyPolicy() {
  return {
    requireClean: false,
    requireLatestOk: false,
    maxInvalid: null,
    maxFail: null,
    minArtifacts: null,
    maxArtifacts: null,
    maxAgeBucket: null,
    maxWarn: null,
    maxSkipped: null,
    forbidOverRetention: false,
  } as const;
}
