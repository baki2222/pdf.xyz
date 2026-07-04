import {
  RELEASE_RESTORE_DRILL_POLICY_ID,
  RELEASE_RESTORE_DRILL_POLICY_VERSION,
  type ReleaseRestoreDrillCoverage,
  type ReleaseRestoreDrillPolicy,
  type ReleaseRestoreDrillReceipt,
  type ReleaseRestoreDrillRollup,
} from "./types";

export function buildRestoreReceipt(
  at: string,
  policy: ReleaseRestoreDrillPolicy,
  coverage: ReleaseRestoreDrillCoverage,
  rollup: ReleaseRestoreDrillRollup,
  archiveDigest: string | null,
): ReleaseRestoreDrillReceipt {
  return {
    category: "worker-release-restore-drill",
    policyId: RELEASE_RESTORE_DRILL_POLICY_ID,
    policyVersion: RELEASE_RESTORE_DRILL_POLICY_VERSION,
    at,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    archiveState: coverage.archive,
    hasArchive: coverage.hasArchive,
    recordsRestored: coverage.recordsRestored,
    recordsMatched: coverage.recordsMatched,
    recordsFailed: coverage.recordsFailed,
    blocking: rollup.blocking,
    insufficiencies: rollup.insufficiencies,
    advisories: rollup.advisories,
    archiveOnly: policy.archiveOnly,
    requireFullRestore: policy.requireFullRestore,
    strictDrift: policy.strictDrift,
    archiveDigest,
  };
}
