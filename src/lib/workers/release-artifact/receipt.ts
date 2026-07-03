/**
 * The content-free **audit receipt** for one release evidence artifact (Phase 47).
 *
 * An archived release decision is a thing a SIEM / release record wants to log verbatim: "the
 * artifact resolved to <verdict> (exit <code>), archiving a <gateVerdict> gate on a <cleanliness>
 * tree, under policy <id>@<version>, at <instant>, with integrity <algorithm>:<digest>". The receipt
 * is exactly that — bounded enums + a small exit code + a stable policy id + the run's own stamp +
 * the content-free integrity digest. It carries no ingested prose, no path, no locator, and no
 * secret, so it is safe to forward to any downstream system.
 *
 * It references the digest, so it lives OUTSIDE the digest-covered body (it is not itself hashed).
 */

import {
  RELEASE_ARTIFACT_POLICY_ID,
  RELEASE_ARTIFACT_POLICY_VERSION,
  type ReleaseArtifactBody,
  type ReleaseArtifactIntegrity,
  type ReleaseArtifactReceipt,
} from "./types";

/** Flatten the content-free audit receipt from the body + its computed integrity block. */
export function buildReceipt(
  body: ReleaseArtifactBody,
  integrity: ReleaseArtifactIntegrity,
): ReleaseArtifactReceipt {
  return {
    category: "worker-release-artifact",
    policyId: RELEASE_ARTIFACT_POLICY_ID,
    policyVersion: RELEASE_ARTIFACT_POLICY_VERSION,
    at: body.generatedAt,
    verdict: body.rollup.verdict,
    exitCode: body.rollup.exitCode,
    gateVerdict: body.gate.verdict,
    cleanliness: body.metadata.git.cleanliness,
    algorithm: integrity.algorithm,
    digest: integrity.digest,
  };
}
