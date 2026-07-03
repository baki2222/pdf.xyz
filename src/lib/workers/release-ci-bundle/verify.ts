/**
 * Pure, node-free **consistency verification** for the release CI bundle (Phase 50).
 *
 * This is the heart of the bundle: given the ingested stages, it evaluates the closed set of
 * {@link ReleaseCiBundleCheckId} links — each a bounded, deterministic comparison over the stages'
 * already content-free facts — and emits one {@link ReleaseCiBundleConsistencyCheck} per link, in the
 * stable {@link RELEASE_CI_BUNDLE_CHECK_IDS} order. Every link is BLOCKING: a `mismatch` (two stages
 * that describe different evidence, or a stage that does not verify against itself) forces the bundle to
 * `fail`. A link whose stages were not all supplied / usable is `skipped` — never a silent pass, since
 * an un-evaluable link cannot certify agreement.
 *
 * The three self-consistency links (`artifact-digest`, `index-self-consistent`, `policy-self-consistent`)
 * re-derive a stage against ITSELF (the artifact's integrity digest was re-hashed in ingest; the index +
 * policy verdicts were recomputed from their own counts). The three cross-stage links
 * (`gate-artifact-agreement`, `artifact-index-inclusion`, `index-policy-agreement`) confirm that adjacent
 * stages describe the SAME evidence. Together they defeat a mixed/stale/tampered bundle where an
 * individual stage looks clean but the stages do not cohere.
 */

import {
  RELEASE_CI_BUNDLE_CHECK_DETAIL,
  RELEASE_CI_BUNDLE_CHECK_IDS,
  type ReleaseCiBundleCheckId,
  type ReleaseCiBundleCheckStatus,
  type ReleaseCiBundleConsistencyCheck,
} from "./types";
import type { IngestedStages } from "./ingest";

/** Assemble one bounded consistency-check record from an id + status (detail authored, keyed by both). */
function check(
  id: ReleaseCiBundleCheckId,
  status: ReleaseCiBundleCheckStatus,
): ReleaseCiBundleConsistencyCheck {
  return { id, severity: "block", status, detail: RELEASE_CI_BUNDLE_CHECK_DETAIL[id][status] };
}

/** `artifact-digest`: the supplied artifact re-verified its own integrity digest in-process. */
function artifactDigest(stages: IngestedStages): ReleaseCiBundleCheckStatus {
  const { supplied, ingested } = stages.artifact;
  if (!supplied || ingested.digestStatus === "unreadable") return "skipped";
  return ingested.digestStatus === "verified" ? "ok" : "mismatch";
}

/** `index-self-consistent`: the supplied index recomputed its archive verdict from its own counts. */
function indexSelfConsistent(stages: IngestedStages): ReleaseCiBundleCheckStatus {
  const { supplied, ingested } = stages.index;
  if (!supplied || !ingested.recognized) return "skipped";
  return ingested.usable ? "ok" : "mismatch";
}

/** `policy-self-consistent`: the supplied policy result re-derived its rollup verdict from its own facts. */
function policySelfConsistent(stages: IngestedStages): ReleaseCiBundleCheckStatus {
  const { supplied, ingested } = stages.policy;
  if (!supplied || !ingested.recognized) return "skipped";
  return ingested.usable ? "ok" : "mismatch";
}

/** `gate-artifact-agreement`: the artifact archived the SAME gate verdict as the standalone gate. */
function gateArtifactAgreement(stages: IngestedStages): ReleaseCiBundleCheckStatus {
  const gate = stages.gate;
  const artifact = stages.artifact;
  const gateVerdict = gate.supplied ? gate.ingested.verdict : null;
  const artifactGateVerdict =
    artifact.supplied && artifact.ingested.digestStatus !== "unreadable"
      ? artifact.ingested.gateVerdict
      : null;
  // Both sides must carry a comparable verdict; otherwise there is nothing to compare (skipped).
  if (gateVerdict === null || artifactGateVerdict === null) return "skipped";
  return gateVerdict === artifactGateVerdict ? "ok" : "mismatch";
}

/**
 * `artifact-index-inclusion`: the artifact's recomputed digest prefix + verdict appear among the index's
 * VERIFIED entries — the index reflects THIS artifact and it re-verified there too.
 */
function artifactIndexInclusion(stages: IngestedStages): ReleaseCiBundleCheckStatus {
  const artifact = stages.artifact;
  const index = stages.index;
  const artifactRecognized = artifact.supplied && artifact.ingested.digestStatus !== "unreadable";
  if (!artifactRecognized || !index.supplied || !index.ingested.usable) return "skipped";
  const prefix = artifact.ingested.digestPrefix;
  if (prefix === null) return "skipped";
  const found = index.ingested.verifiedEntries.some(
    (e) => e.prefix === prefix && e.verdict === artifact.ingested.verdict,
  );
  return found ? "ok" : "mismatch";
}

/**
 * `index-policy-agreement`: the policy's effective archive verdict + indexed-artifact count equal the
 * index's — the policy was evaluated over the SAME index.
 */
function indexPolicyAgreement(stages: IngestedStages): ReleaseCiBundleCheckStatus {
  const index = stages.index;
  const policy = stages.policy;
  if (!index.supplied || !index.ingested.usable || !policy.supplied || !policy.ingested.usable) {
    return "skipped";
  }
  const indexFacts = index.ingested.facts;
  const policyFacts = policy.ingested.facts;
  if (indexFacts === null || policyFacts === null) return "skipped";
  const agree =
    policyFacts.effectiveVerdict === indexFacts.archiveVerdict &&
    policyFacts.indexedArtifacts === indexFacts.indexedArtifacts;
  return agree ? "ok" : "mismatch";
}

/** The per-check evaluators, keyed by id (kept in sync with the closed check-id set by a test). */
const EVALUATORS: Record<ReleaseCiBundleCheckId, (stages: IngestedStages) => ReleaseCiBundleCheckStatus> = {
  "artifact-digest": artifactDigest,
  "index-self-consistent": indexSelfConsistent,
  "policy-self-consistent": policySelfConsistent,
  "gate-artifact-agreement": gateArtifactAgreement,
  "artifact-index-inclusion": artifactIndexInclusion,
  "index-policy-agreement": indexPolicyAgreement,
};

/**
 * Evaluate every consistency link over the ingested stages, in the stable
 * {@link RELEASE_CI_BUNDLE_CHECK_IDS} order. Deterministic; each link reduces to a bounded status.
 */
export function verifyConsistency(stages: IngestedStages): ReleaseCiBundleConsistencyCheck[] {
  return RELEASE_CI_BUNDLE_CHECK_IDS.map((id) => check(id, EVALUATORS[id](stages)));
}
