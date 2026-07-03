/**
 * The content-free **audit receipt** for one release policy evaluation (Phase 49).
 *
 * A policy decision is a thing a SIEM / release record wants to log verbatim: "the release policy
 * resolved to <verdict> (exit <code>) over <source> evidence, effective archive-health <verdict>, under
 * <assertionsEvaluated> assertions of which <blocking>/<warning> were violated, policy <id>@<version>,
 * at <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id +
 * the run's own stamp. It carries no ingested prose, no path, no locator, and no digest, so it is safe
 * to forward to any downstream system.
 */

import {
  RELEASE_POLICY_POLICY_ID,
  RELEASE_POLICY_POLICY_VERSION,
  type ReleaseIndexVerdict,
  type ReleasePolicyReceipt,
  type ReleasePolicyRollup,
  type ReleasePolicySource,
} from "./types";

/** Flatten the content-free audit receipt from the rollup + source + effective archive verdict. */
export function buildReceipt(
  generatedAt: string,
  rollup: ReleasePolicyRollup,
  source: ReleasePolicySource,
  indexUsable: boolean,
  effectiveVerdict: ReleaseIndexVerdict | null,
  assertionsEvaluated: number,
): ReleasePolicyReceipt {
  return {
    category: "worker-release-policy",
    policyId: RELEASE_POLICY_POLICY_ID,
    policyVersion: RELEASE_POLICY_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    source,
    indexUsable,
    effectiveVerdict,
    assertionsEvaluated,
    blockingViolations: rollup.blockingViolations,
    warningViolations: rollup.warningViolations,
  };
}
