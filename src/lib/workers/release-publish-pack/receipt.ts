/**
 * The content-free **receipt** for one release evidence publish / handoff pack (Phase 57).
 *
 * A publish verdict is a thing a SIEM / handoff record wants to log verbatim: "the evidence package was <verdict>
 * (exit <code>), disclosure <classification>, over <sourcesUsable> usable of <sourcesSupplied> supplied source(s),
 * policy <id>@<version>, at <instant>". The receipt is exactly that — the verdict + disclosure + source count only,
 * as bounded enums + small integers + a stable policy id + the run's own stamp. It carries no ingested prose, no
 * path, no locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_PUBLISH_PACK_POLICY_ID,
  RELEASE_PUBLISH_PACK_POLICY_VERSION,
  type ReleasePublishPackCoverage,
  type ReleasePublishPackReceipt,
  type ReleasePublishPackRollup,
} from "./types";

/** Flatten the content-free receipt from the coverage + composite verdict (verdict + disclosure + source count). */
export function buildPublishPackReceipt(
  generatedAt: string,
  coverage: ReleasePublishPackCoverage,
  rollup: ReleasePublishPackRollup,
): ReleasePublishPackReceipt {
  return {
    category: "worker-release-publish-pack",
    policyId: RELEASE_PUBLISH_PACK_POLICY_ID,
    policyVersion: RELEASE_PUBLISH_PACK_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    disclosure: rollup.disclosure,
    sourcesSupplied: coverage.sourcesSupplied,
    sourcesUsable: coverage.sourcesUsable,
  };
}
