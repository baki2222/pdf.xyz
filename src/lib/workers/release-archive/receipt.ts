import {
  RELEASE_ARCHIVE_POLICY_ID,
  RELEASE_ARCHIVE_POLICY_VERSION,
  type ReleaseArchiveCoverage,
  type ReleaseArchivePolicy,
  type ReleaseArchiveReceipt,
  type ReleaseArchiveRollup,
} from "./types";

export function buildArchiveReceipt(
  at: string,
  policy: ReleaseArchivePolicy,
  coverage: ReleaseArchiveCoverage,
  rollup: ReleaseArchiveRollup,
  recordClasses: number,
): ReleaseArchiveReceipt {
  return {
    category: "worker-release-archive",
    policyId: RELEASE_ARCHIVE_POLICY_ID,
    policyVersion: RELEASE_ARCHIVE_POLICY_VERSION,
    at,
    posture: rollup.posture,
    exitCode: rollup.exitCode,
    recordsSupplied: coverage.recordsSupplied,
    recordsUsable: coverage.recordsUsable,
    recordClasses,
    hasGovernance: coverage.hasGovernance,
    hasTrend: coverage.hasTrend,
    hasReport: coverage.hasReport,
    hasAudit: coverage.hasAudit,
    hasBundle: coverage.hasBundle,
    blocking: rollup.blocking,
    insufficiencies: rollup.insufficiencies,
    advisories: rollup.advisories,
    requireTrend: policy.requireTrend,
    requireReport: policy.requireReport,
    requireAudit: policy.requireAudit,
    requireBundle: policy.requireBundle,
    strictWatch: policy.strictWatch,
  };
}
