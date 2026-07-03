/**
 * The content-free **audit receipt** for one release CI bundle (Phase 50).
 *
 * A bundle decision is a thing a SIEM / release record wants to log verbatim: "the release CI bundle
 * resolved to <verdict> (exit <code>) over <stagesPresent> stages (chain complete: <bool>, decision
 * stage <stage>), with <inconsistencies> cross-stage inconsistencies, policy <id>@<version>, at
 * <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id + the
 * run's own stamp. It carries no ingested prose, no path, no locator, and no digest, so it is safe to
 * forward to any downstream system.
 */

import {
  RELEASE_CI_BUNDLE_POLICY_ID,
  RELEASE_CI_BUNDLE_POLICY_VERSION,
  type ReleaseCiBundleReceipt,
  type ReleaseCiBundleRollup,
} from "./types";

/** Flatten the content-free audit receipt from the composite rollup. */
export function buildReceipt(
  generatedAt: string,
  rollup: ReleaseCiBundleRollup,
): ReleaseCiBundleReceipt {
  return {
    category: "worker-release-ci-bundle",
    policyId: RELEASE_CI_BUNDLE_POLICY_ID,
    policyVersion: RELEASE_CI_BUNDLE_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    stagesPresent: rollup.stagesPresent,
    chainComplete: rollup.chainComplete,
    decisionStage: rollup.decisionStage,
    inconsistencies: rollup.inconsistencies,
  };
}
