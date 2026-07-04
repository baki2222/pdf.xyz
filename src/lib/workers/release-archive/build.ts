import { buildArchiveReceipt } from "./receipt";
import { computeArchiveCoverage, reduceAuditRecord, reduceBundleRecord, reduceGovernanceRecord, reduceReportRecord, reduceTrendRecord } from "./reduce";
import { computeArchiveRollup } from "./rollup";
import type { IngestedArchiveRecords } from "./ingest";
import {
  RELEASE_ARCHIVE_CAVEATS,
  RELEASE_ARCHIVE_CHECKLIST_IDS,
  RELEASE_ARCHIVE_FOLLOWUP_DETAIL,
  RELEASE_ARCHIVE_FOLLOWUP_IDS,
  RELEASE_ARCHIVE_GUIDANCE,
  RELEASE_ARCHIVE_POLICY_ID,
  RELEASE_ARCHIVE_POLICY_VERSION,
  RELEASE_ARCHIVE_SCHEMA,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_TREND_SCHEMA,
  type ReleaseArchiveChecklist,
  type ReleaseArchiveChecklistId,
  type ReleaseArchiveFollowup,
  type ReleaseArchiveFollowupId,
  type ReleaseArchiveMetadata,
  type ReleaseArchivePolicy,
  type ReleaseArchiveReasonId,
  type ReleaseArchiveRecord,
  type ReleaseArchiveResult,
} from "./types";

const REASON_FOLLOWUPS: Record<ReleaseArchiveReasonId, readonly ReleaseArchiveFollowupId[]> = {
  "governance-tampered": ["recover-tampered-evidence"],
  "governance-blocked": ["investigate-blocked-archive"],
  "trend-tampered": ["recover-tampered-evidence"],
  "trend-failing": ["investigate-blocked-archive"],
  "report-tampered": ["recover-tampered-evidence"],
  "report-hold-fail": ["investigate-blocked-archive"],
  "audit-tampered": ["recover-tampered-evidence"],
  "audit-regressed": ["investigate-blocked-archive"],
  "bundle-tampered": ["recover-tampered-evidence"],
  "bundle-failed": ["investigate-blocked-archive"],
  "governance-missing": ["refresh-governance"],
  "governance-unreadable": ["refresh-governance"],
  "governance-incomplete": ["refresh-governance"],
  "trend-unreadable": ["supply-required-evidence"],
  "trend-unknown": ["supply-required-evidence"],
  "trend-missing": ["supply-required-evidence"],
  "report-unreadable": ["supply-required-evidence"],
  "report-needs-evidence": ["supply-required-evidence"],
  "report-missing": ["supply-required-evidence"],
  "audit-unreadable": ["supply-required-evidence"],
  "audit-inconclusive": ["supply-required-evidence"],
  "audit-missing": ["supply-required-evidence"],
  "bundle-unreadable": ["supply-required-evidence"],
  "bundle-unknown": ["supply-required-evidence"],
  "bundle-missing": ["supply-required-evidence"],
  "governance-watch": ["review-watch-archive"],
  "trend-warning": ["review-watch-archive"],
  "report-hold-warning": ["review-watch-archive"],
  "audit-drift": ["review-watch-archive"],
  "bundle-warning": ["review-watch-archive"],
  "trend-governance-mismatch": ["reconcile-evidence-mismatch"],
  "report-governance-mismatch": ["reconcile-evidence-mismatch"],
  "audit-governance-mismatch": ["reconcile-evidence-mismatch"],
};

export function buildArchiveMetadata(): ReleaseArchiveMetadata {
  return {
    schemaVersion: RELEASE_ARCHIVE_POLICY_VERSION,
    policyId: RELEASE_ARCHIVE_POLICY_ID,
    policyVersion: RELEASE_ARCHIVE_POLICY_VERSION,
    governanceSchema: RELEASE_GOVERNANCE_SCHEMA,
    trendSchema: RELEASE_TREND_SCHEMA,
    reportSchema: RELEASE_REPORT_SCHEMA,
    auditSchema: RELEASE_AUDIT_SCHEMA,
    bundleSchema: RELEASE_CI_BUNDLE_SCHEMA,
  };
}

export function buildFollowUps(fired: readonly ReleaseArchiveReasonId[]): ReleaseArchiveFollowup[] {
  const wanted = new Set<ReleaseArchiveFollowupId>();
  if (fired.length === 0) wanted.add("continue-archive-cadence");
  else for (const id of fired) for (const f of REASON_FOLLOWUPS[id]) wanted.add(f);
  wanted.add("archive-evidence-pack");
  return RELEASE_ARCHIVE_FOLLOWUP_IDS.filter((id) => wanted.has(id)).map((id) => ({ id, detail: RELEASE_ARCHIVE_FOLLOWUP_DETAIL[id] }));
}

export function buildChecklist(records: readonly ReleaseArchiveRecord[]): ReleaseArchiveChecklist {
  const present = new Set<ReleaseArchiveChecklistId>();
  for (const record of records) {
    if (!record.recognized) continue;
    if (record.id === "governance") present.add("governance-bundle");
    if (record.id === "trend") present.add("release-trend");
    if (record.id === "report") present.add("latest-report");
    if (record.id === "audit") present.add("latest-audit");
    if (record.id === "bundle") present.add("ci-bundle");
  }
  present.add("archive-pack");
  const items = RELEASE_ARCHIVE_CHECKLIST_IDS.filter((id) => present.has(id));
  return {
    items,
    recordClasses: Math.max(0, items.length - 1),
    note: items.length > 1
      ? "Archive each recognized content-free record class above, plus this pack manifest, as the release evidence review record. This pack never uploads, copies, zips, signs, or promotes them."
      : "No supplied evidence record was recognized, so only this pack manifest exists; supply a readable governance bundle and re-run before treating the review record as archivable.",
  };
}

export function buildArchiveResult(
  generatedAt: string,
  ingested: IngestedArchiveRecords,
  policy: ReleaseArchivePolicy,
): ReleaseArchiveResult {
  const governance = reduceGovernanceRecord(ingested.governance) as ReleaseArchiveRecord & { id: "governance" };
  const trend = reduceTrendRecord(ingested.trend) as ReleaseArchiveRecord & { id: "trend" };
  const report = reduceReportRecord(ingested.report) as ReleaseArchiveRecord & { id: "report" };
  const audit = reduceAuditRecord(ingested.audit) as ReleaseArchiveRecord & { id: "audit" };
  const bundle = reduceBundleRecord(ingested.bundle) as ReleaseArchiveRecord & { id: "bundle" };
  const coverage = computeArchiveCoverage(governance, trend, report, audit, bundle);
  const { rollup, reasons } = computeArchiveRollup({ governance, trend, report, audit, bundle }, policy);
  const records = [governance, trend, report, audit, bundle];
  const checklist = buildChecklist(records);
  return {
    schema: RELEASE_ARCHIVE_SCHEMA,
    generatedAt,
    metadata: buildArchiveMetadata(),
    policy,
    coverage,
    records,
    archive: rollup,
    reasons,
    checklist,
    followUps: buildFollowUps(rollup.reasons),
    guidance: RELEASE_ARCHIVE_GUIDANCE,
    caveats: RELEASE_ARCHIVE_CAVEATS,
    receipt: buildArchiveReceipt(generatedAt, policy, coverage, rollup, checklist.recordClasses),
  };
}
