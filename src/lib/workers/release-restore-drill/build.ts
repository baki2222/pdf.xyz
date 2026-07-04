import { buildRestoreReceipt } from "./receipt";
import { computeRestoreCoverage, reduceArchiveAnchor, reduceRestoreRecords } from "./reduce";
import { computeRestoreRollup } from "./rollup";
import type { IngestedRestoreDrill } from "./ingest";
import {
  RELEASE_ARCHIVE_SCHEMA,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_RESTORE_DRILL_CAVEATS,
  RELEASE_RESTORE_DRILL_FOLLOWUP_DETAIL,
  RELEASE_RESTORE_DRILL_FOLLOWUP_IDS,
  RELEASE_RESTORE_DRILL_GUIDANCE,
  RELEASE_RESTORE_DRILL_POLICY_ID,
  RELEASE_RESTORE_DRILL_POLICY_VERSION,
  RELEASE_RESTORE_DRILL_SCHEMA,
  RELEASE_TREND_SCHEMA,
  type ReleaseRestoreDrillDigests,
  type ReleaseRestoreDrillFollowup,
  type ReleaseRestoreDrillFollowupId,
  type ReleaseRestoreDrillMetadata,
  type ReleaseRestoreDrillPolicy,
  type ReleaseRestoreDrillReasonId,
  type ReleaseRestoreDrillResult,
} from "./types";

const REASON_FOLLOWUPS: Record<ReleaseRestoreDrillReasonId, readonly ReleaseRestoreDrillFollowupId[]> = {
  "archive-tampered": ["investigate-failed-restore", "recover-tampered-evidence"],
  "archive-blocked": ["investigate-failed-restore"],
  "restore-mismatch": ["investigate-failed-restore", "reconcile-restore-mismatch"],
  "restore-corrupt": ["investigate-failed-restore", "recover-tampered-evidence"],
  "archive-unreadable": ["refresh-archive"],
  "archive-incomplete": ["refresh-archive"],
  "restore-unreadable": ["exercise-restore-drill"],
  "restore-coverage-incomplete": ["exercise-restore-drill"],
  "restore-not-exercised": ["exercise-restore-drill"],
  "archive-watch": ["review-restore-drift"],
  "restore-unexpected": ["reconcile-restore-mismatch"],
};

export function buildRestoreMetadata(): ReleaseRestoreDrillMetadata {
  return {
    schemaVersion: RELEASE_RESTORE_DRILL_POLICY_VERSION,
    policyId: RELEASE_RESTORE_DRILL_POLICY_ID,
    policyVersion: RELEASE_RESTORE_DRILL_POLICY_VERSION,
    archiveSchema: RELEASE_ARCHIVE_SCHEMA,
    governanceSchema: RELEASE_GOVERNANCE_SCHEMA,
    trendSchema: RELEASE_TREND_SCHEMA,
    reportSchema: RELEASE_REPORT_SCHEMA,
    auditSchema: RELEASE_AUDIT_SCHEMA,
    bundleSchema: RELEASE_CI_BUNDLE_SCHEMA,
  };
}

export function buildRestoreFollowUps(fired: readonly ReleaseRestoreDrillReasonId[]): ReleaseRestoreDrillFollowup[] {
  const wanted = new Set<ReleaseRestoreDrillFollowupId>();
  if (fired.length === 0) wanted.add("continue-restore-cadence");
  else for (const id of fired) for (const f of REASON_FOLLOWUPS[id]) wanted.add(f);
  wanted.add("record-restore-receipt");
  return RELEASE_RESTORE_DRILL_FOLLOWUP_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_RESTORE_DRILL_FOLLOWUP_DETAIL[id],
  }));
}

function buildDigests(ingested: IngestedRestoreDrill, hashed: boolean): ReleaseRestoreDrillDigests {
  return {
    algorithm: hashed ? "sha256" : "none",
    canonicalization: "pdfxyz-sorted-keys/1",
    archive: ingested.archive.digest,
    governance: ingested.governance.digest,
    trend: ingested.trend.digest,
    report: ingested.report.digest,
    audit: ingested.audit.digest,
    bundle: ingested.bundle.digest,
  };
}

export function buildRestoreResult(
  generatedAt: string,
  ingested: IngestedRestoreDrill,
  policy: ReleaseRestoreDrillPolicy,
  hashed: boolean,
): ReleaseRestoreDrillResult {
  const archive = reduceArchiveAnchor(ingested.archive);
  const records = reduceRestoreRecords(archive, ingested);
  const coverage = computeRestoreCoverage(archive, records);
  const { rollup, reasons } = computeRestoreRollup(archive, records, policy);
  const digests = buildDigests(ingested, hashed);
  return {
    schema: RELEASE_RESTORE_DRILL_SCHEMA,
    generatedAt,
    metadata: buildRestoreMetadata(),
    policy,
    coverage,
    archive,
    records,
    drill: rollup,
    reasons,
    digests,
    followUps: buildRestoreFollowUps(rollup.reasons),
    guidance: RELEASE_RESTORE_DRILL_GUIDANCE,
    caveats: RELEASE_RESTORE_DRILL_CAVEATS,
    receipt: buildRestoreReceipt(generatedAt, policy, coverage, rollup, digests.archive),
  };
}
