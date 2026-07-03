/**
 * The content-free **audit receipt** for one release evidence index run (Phase 48).
 *
 * A retention review is a thing a SIEM / release record wants to log verbatim: "the index resolved to
 * <verdict> (exit <code>), over <indexedArtifacts> artifacts of which <verifiedArtifacts> re-verified
 * and <integrityFailures> failed, retention-drift <bool>, under policy <id>@<version>, at <instant>".
 * The receipt is exactly that — bounded enums + small integers + a stable policy id + the run's own
 * stamp. It carries no ingested prose, no path, no locator, and no digest, so it is safe to forward to
 * any downstream system.
 */

import {
  RELEASE_INDEX_POLICY_ID,
  RELEASE_INDEX_POLICY_VERSION,
  type ReleaseIndexDigestCounts,
  type ReleaseIndexRetention,
  type ReleaseIndexReceipt,
  type ReleaseIndexRollup,
} from "./types";

/** Flatten the content-free audit receipt from the rollup + retention posture + digest counts. */
export function buildReceipt(
  generatedAt: string,
  rollup: ReleaseIndexRollup,
  retention: ReleaseIndexRetention,
  digestCounts: ReleaseIndexDigestCounts,
): ReleaseIndexReceipt {
  return {
    category: "worker-release-index",
    policyId: RELEASE_INDEX_POLICY_ID,
    policyVersion: RELEASE_INDEX_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    indexedArtifacts: retention.indexedArtifacts,
    verifiedArtifacts: digestCounts.verified,
    integrityFailures: digestCounts.mismatch + digestCounts.malformed,
    retentionDrift: retention.overCount || retention.overAge || retention.stale,
  };
}
