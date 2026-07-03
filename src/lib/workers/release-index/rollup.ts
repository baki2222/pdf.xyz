/**
 * Pure, node-free **rollup** for the release evidence index (Phase 48).
 *
 * Folds the manifest-wide digest-status counts + retention posture into the ONE composite
 * {@link ReleaseIndexVerdict} + exit code an operator/CI acts on. The ladder is deliberately about
 * ARCHIVE HEALTH — integrity first, then retention — NOT a re-judgement of each build's promotion
 * readiness (the archived artifacts already carry that; the manifest only tallies it as counts):
 *
 *  - `invalid` (worst) — ANY recognized artifact failed digest re-verification (`mismatch` /
 *    `malformed`). A tampered or corrupt artifact dominates everything: an intact-but-over-retention
 *    archive is a lesser concern than an archive you can no longer trust.
 *  - `warn`            — every digest verified, but a RETENTION concern was raised (over-count,
 *    over-age, stale) or a non-artifact input was skipped. Intact, needs a retention review.
 *  - `unknown`         — the archive is EMPTY / INSUFFICIENT (no recognized artifact was indexed), so
 *    there is nothing to certify. This is checked FIRST: with no artifacts, integrity/retention are
 *    vacuous, and "we have no history" is the honest signal, never a vacuous `ok`.
 *  - `ok` (best)       — ≥1 artifact indexed, every digest verified, within retention, not stale.
 *
 * Monotonic on the shared `0 ok / 2 insufficient / 3 warn / 4 invalid` exit ladder, and fail-closed:
 * absent evidence never yields `ok`, and any integrity failure forces `invalid`.
 */

import {
  RELEASE_INDEX_EXIT,
  RELEASE_INDEX_VERDICT_SUMMARY,
  type ReleaseIndexDigestCounts,
  type ReleaseIndexDriver,
  type ReleaseIndexExitCode,
  type ReleaseIndexRetention,
  type ReleaseIndexRollup,
  type ReleaseIndexVerdict,
} from "./types";

/** The authoritative verdict → exit code map. */
export const RELEASE_INDEX_EXIT_FOR_VERDICT: Record<ReleaseIndexVerdict, ReleaseIndexExitCode> = {
  ok: RELEASE_INDEX_EXIT.OK,
  unknown: RELEASE_INDEX_EXIT.INSUFFICIENT,
  warn: RELEASE_INDEX_EXIT.WARN,
  invalid: RELEASE_INDEX_EXIT.INVALID,
};

/**
 * Compute the composite rollup from the digest-status counts + retention posture over
 * `indexedArtifacts` recognized artifacts and `skippedInputs` unreadable inputs.
 *
 * Order of resolution: an EMPTY archive is `unknown` first (nothing to certify); otherwise an
 * integrity failure forces `invalid`; otherwise any retention/unreadable concern is `warn`; otherwise
 * a clean `ok`. Drivers are emitted in the stable {@link ReleaseIndexDriver} order so the reason set
 * is deterministic regardless of how the counts were accumulated.
 */
export function computeRollup(
  digestCounts: ReleaseIndexDigestCounts,
  retention: ReleaseIndexRetention,
  indexedArtifacts: number,
  skippedInputs: number,
): ReleaseIndexRollup {
  const drivers: ReleaseIndexDriver[] = [];
  let verdict: ReleaseIndexVerdict;

  if (indexedArtifacts <= 0) {
    // No usable artifact — the archive is empty/insufficient. Integrity/retention are vacuous.
    drivers.push("empty");
    verdict = "unknown";
  } else {
    if (digestCounts.mismatch > 0) drivers.push("tampered-artifact");
    if (digestCounts.malformed > 0) drivers.push("malformed-digest");
    if (retention.overCount) drivers.push("retention-count");
    if (retention.overAge) drivers.push("retention-age");
    if (retention.stale) drivers.push("stale");
    if (skippedInputs > 0) drivers.push("unreadable-input");

    const integrityFailed = digestCounts.mismatch > 0 || digestCounts.malformed > 0;
    if (integrityFailed) verdict = "invalid";
    else if (drivers.length > 0) verdict = "warn";
    else verdict = "ok";
  }

  return {
    verdict,
    exitCode: RELEASE_INDEX_EXIT_FOR_VERDICT[verdict],
    ready: verdict === "ok",
    drivers,
    detail: RELEASE_INDEX_VERDICT_SUMMARY[verdict],
  };
}
