/**
 * The content-free **audit receipt** for one release evidence governance bundle (Phase 54).
 *
 * A governance verdict is a thing a SIEM / governance record wants to log verbatim: "the governance window was
 * <verdict> (exit <code>) over <sourcesUsable> usable of <sourcesSupplied> supplied source(s) (trend present:
 * <bool>, report present: <bool>, audit present: <bool>), with <blocking> blocking / <insufficiencies>
 * insufficiency / <advisories> advisory reason(s), policy <id>@<version>, at <instant>". The receipt is exactly
 * that — bounded enums + small integers + a stable policy id + the run's own stamp. It carries no ingested
 * prose, no path, no locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_GOVERNANCE_POLICY_ID,
  RELEASE_GOVERNANCE_POLICY_VERSION,
  type ReleaseGovernanceCoverage,
  type ReleaseGovernancePolicy,
  type ReleaseGovernanceReceipt,
  type ReleaseGovernanceRollup,
} from "./types";

/** Flatten the content-free audit receipt from the policy + coverage + composite verdict. */
export function buildGovernanceReceipt(
  generatedAt: string,
  policy: ReleaseGovernancePolicy,
  coverage: ReleaseGovernanceCoverage,
  rollup: ReleaseGovernanceRollup,
): ReleaseGovernanceReceipt {
  return {
    category: "worker-release-governance",
    policyId: RELEASE_GOVERNANCE_POLICY_ID,
    policyVersion: RELEASE_GOVERNANCE_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    sourcesSupplied: coverage.sourcesSupplied,
    sourcesUsable: coverage.sourcesUsable,
    hasTrend: coverage.hasTrend,
    hasReport: coverage.hasReport,
    hasAudit: coverage.hasAudit,
    blocking: rollup.blocking,
    insufficiencies: rollup.insufficiencies,
    advisories: rollup.advisories,
    requireReport: policy.requireReport,
    requireAudit: policy.requireAudit,
    strictWatch: policy.strictWatch,
  };
}
