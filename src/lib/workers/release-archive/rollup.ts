import {
  RELEASE_ARCHIVE_EXIT,
  RELEASE_ARCHIVE_POSTURE_SUMMARY,
  RELEASE_ARCHIVE_REASON_DETAIL,
  RELEASE_ARCHIVE_REASON_IDS,
  RELEASE_ARCHIVE_STRICT_WATCH_ESCALATED_SUMMARY,
  type ReleaseArchivePolicy,
  type ReleaseArchiveReason,
  type ReleaseArchiveReasonId,
  type ReleaseArchiveRecord,
  type ReleaseArchiveRollup,
  type ReleaseArchiveSeverity,
} from "./types";

export interface ArchiveRecordsById {
  readonly governance: ReleaseArchiveRecord & { readonly id: "governance" };
  readonly trend: ReleaseArchiveRecord & { readonly id: "trend" };
  readonly report: ReleaseArchiveRecord & { readonly id: "report" };
  readonly audit: ReleaseArchiveRecord & { readonly id: "audit" };
  readonly bundle: ReleaseArchiveRecord & { readonly id: "bundle" };
}

function hasUsable(record: ReleaseArchiveRecord): boolean {
  return record.state === "usable" && record.usable;
}

function reasonIds(records: ArchiveRecordsById, policy: ReleaseArchivePolicy): ReleaseArchiveReasonId[] {
  const ids = new Set<ReleaseArchiveReasonId>();
  const { governance, trend, report, audit, bundle } = records;

  if (!governance.supplied) ids.add("governance-missing");
  else if (governance.state === "unreadable") ids.add("governance-unreadable");
  else if (governance.state === "tampered") ids.add("governance-tampered");
  else if (governance.verdict === "blocked") ids.add("governance-blocked");
  else if (governance.verdict === "incomplete") ids.add("governance-incomplete");
  else if (governance.verdict === "watch") ids.add("governance-watch");

  if (trend.supplied) {
    if (trend.state === "unreadable") ids.add("trend-unreadable");
    else if (trend.state === "tampered") ids.add("trend-tampered");
    else if (trend.verdict === "failing") ids.add("trend-failing");
    else if (trend.verdict === "unknown") ids.add("trend-unknown");
    else if (trend.verdict === "warning") ids.add("trend-warning");
  } else if (policy.requireTrend) ids.add("trend-missing");

  if (report.supplied) {
    if (report.state === "unreadable") ids.add("report-unreadable");
    else if (report.state === "tampered") ids.add("report-tampered");
    else if (report.verdict === "hold-fail") ids.add("report-hold-fail");
    else if (report.verdict === "needs-evidence") ids.add("report-needs-evidence");
    else if (report.verdict === "hold-warning") ids.add("report-hold-warning");
  } else if (policy.requireReport) ids.add("report-missing");

  if (audit.supplied) {
    if (audit.state === "unreadable") ids.add("audit-unreadable");
    else if (audit.state === "tampered") ids.add("audit-tampered");
    else if (audit.verdict === "fail") ids.add("audit-regressed");
    else if (audit.verdict === "unknown") ids.add("audit-inconclusive");
    else if (audit.verdict === "warn") ids.add("audit-drift");
  } else if (policy.requireAudit) ids.add("audit-missing");

  if (bundle.supplied) {
    if (bundle.state === "unreadable") ids.add("bundle-unreadable");
    else if (bundle.state === "tampered") ids.add("bundle-tampered");
    else if (bundle.verdict === "fail") ids.add("bundle-failed");
    else if (bundle.verdict === "unknown") ids.add("bundle-unknown");
    else if (bundle.verdict === "warn") ids.add("bundle-warning");
  } else if (policy.requireBundle) ids.add("bundle-missing");

  const gf = governance.facts;
  if (hasUsable(governance) && gf !== null) {
    if (hasUsable(trend) && gf.trendVerdict !== null && trend.verdict !== gf.trendVerdict) ids.add("trend-governance-mismatch");
    if (hasUsable(report) && gf.reportVerdict !== null && report.verdict !== gf.reportVerdict) ids.add("report-governance-mismatch");
    if (hasUsable(audit) && gf.auditVerdict !== null && audit.verdict !== gf.auditVerdict) ids.add("audit-governance-mismatch");
  }

  return RELEASE_ARCHIVE_REASON_IDS.filter((id) => ids.has(id));
}

export function buildArchiveReasons(ids: readonly ReleaseArchiveReasonId[]): ReleaseArchiveReason[] {
  return ids.map((id) => ({ id, ...RELEASE_ARCHIVE_REASON_DETAIL[id] }));
}

export function computeArchiveRollup(
  records: ArchiveRecordsById,
  policy: ReleaseArchivePolicy,
): { rollup: ReleaseArchiveRollup; reasons: ReleaseArchiveReason[] } {
  const ids = reasonIds(records, policy);
  const reasons = buildArchiveReasons(ids);
  const count = (s: ReleaseArchiveSeverity) => reasons.filter((r) => r.severity === s).length;
  const blocking = count("blocking");
  const insufficiencies = count("insufficient");
  const advisories = count("advisory");
  const wouldWatch = blocking === 0 && insufficiencies === 0 && advisories > 0;
  const strictWatchEscalated = policy.strictWatch && wouldWatch;
  const posture = blocking > 0 || strictWatchEscalated
    ? "archive-blocked"
    : insufficiencies > 0
      ? "archive-incomplete"
      : advisories > 0
        ? "archive-watch"
        : "archivable";
  const exitCode = posture === "archivable"
    ? RELEASE_ARCHIVE_EXIT.ARCHIVABLE
    : posture === "archive-watch"
      ? RELEASE_ARCHIVE_EXIT.WATCH
      : posture === "archive-incomplete"
        ? RELEASE_ARCHIVE_EXIT.INCOMPLETE
        : RELEASE_ARCHIVE_EXIT.BLOCKED;
  return {
    reasons,
    rollup: {
      posture,
      exitCode,
      archivable: posture === "archivable",
      reasons: ids,
      blocking,
      insufficiencies,
      advisories,
      requireTrend: policy.requireTrend,
      requireReport: policy.requireReport,
      requireAudit: policy.requireAudit,
      requireBundle: policy.requireBundle,
      strictWatch: policy.strictWatch,
      strictWatchEscalated,
      detail: strictWatchEscalated ? RELEASE_ARCHIVE_STRICT_WATCH_ESCALATED_SUMMARY : RELEASE_ARCHIVE_POSTURE_SUMMARY[posture],
    },
  };
}
