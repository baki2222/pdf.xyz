import {
  AUDIT_SEVERITY,
  BUNDLE_SEVERITY,
  GOVERNANCE_SEVERITY,
  REPORT_SEVERITY,
  TREND_SEVERITY,
  type ArchiveAuditFacts,
  type ArchiveBundleFacts,
  type ArchiveGovernanceFacts,
  type ArchiveReportFacts,
  type ArchiveTrendFacts,
  type ReleaseArchiveCoverage,
  type ReleaseArchiveRecord,
  type ReleaseArchiveRecordState,
} from "./types";
import type {
  ArchiveRecordIngest,
  IngestedGovernance,
  IngestedTrend,
  IngestedReport,
  IngestedAudit,
  IngestedBundle,
} from "./ingest";

export function recordState(supplied: boolean, recognized: boolean, usable: boolean): ReleaseArchiveRecordState {
  if (!supplied) return "absent";
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

function detail(id: string, state: ReleaseArchiveRecordState, verdict: string | null): string {
  if (state === "absent") return `${id} record was not supplied.`;
  if (state === "unreadable") return `${id} record was supplied but was not readable as the expected schema.`;
  if (state === "tampered") return `${id} record was recognized but did not re-derive from its own bounded facts.`;
  return `${id} record is usable with posture ${verdict ?? "n/a"}.`;
}

export function reduceGovernanceRecord(input: ArchiveRecordIngest<IngestedGovernance>): ReleaseArchiveRecord {
  const { supplied, ingested } = input;
  const state = recordState(supplied, ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  return {
    id: "governance",
    state,
    supplied,
    recognized: ingested.recognized,
    usable: ingested.usable,
    verdict,
    severity: state === "usable" && verdict ? GOVERNANCE_SEVERITY[verdict] : state === "tampered" ? "blocking" : supplied ? "insufficient" : null,
    detail: detail("governance", state, verdict),
    facts: ingested.usable ? (ingested.facts as ArchiveGovernanceFacts) : null,
  };
}

export function reduceTrendRecord(input: ArchiveRecordIngest<IngestedTrend>): ReleaseArchiveRecord {
  const { supplied, ingested } = input;
  const state = recordState(supplied, ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  return {
    id: "trend",
    state,
    supplied,
    recognized: ingested.recognized,
    usable: ingested.usable,
    verdict,
    severity: state === "usable" && verdict ? TREND_SEVERITY[verdict] : state === "tampered" ? "blocking" : supplied ? "insufficient" : null,
    detail: detail("trend", state, verdict),
    facts: ingested.usable ? (ingested.facts as ArchiveTrendFacts) : null,
  };
}

export function reduceReportRecord(input: ArchiveRecordIngest<IngestedReport>): ReleaseArchiveRecord {
  const { supplied, ingested } = input;
  const state = recordState(supplied, ingested.recognized, ingested.usable);
  const verdict = ingested.recommendation;
  return {
    id: "report",
    state,
    supplied,
    recognized: ingested.recognized,
    usable: ingested.usable,
    verdict,
    severity: state === "usable" && verdict ? REPORT_SEVERITY[verdict] : state === "tampered" ? "blocking" : supplied ? "insufficient" : null,
    detail: detail("report", state, verdict),
    facts: ingested.usable ? (ingested.facts as ArchiveReportFacts) : null,
  };
}

export function reduceAuditRecord(input: ArchiveRecordIngest<IngestedAudit>): ReleaseArchiveRecord {
  const { supplied, ingested } = input;
  const state = recordState(supplied, ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  return {
    id: "audit",
    state,
    supplied,
    recognized: ingested.recognized,
    usable: ingested.usable,
    verdict,
    severity: state === "usable" && verdict ? AUDIT_SEVERITY[verdict] : state === "tampered" ? "blocking" : supplied ? "insufficient" : null,
    detail: detail("audit", state, verdict),
    facts: ingested.usable ? (ingested.facts as ArchiveAuditFacts) : null,
  };
}

export function reduceBundleRecord(input: ArchiveRecordIngest<IngestedBundle>): ReleaseArchiveRecord {
  const { supplied, ingested } = input;
  const state = recordState(supplied, ingested.recognized, ingested.usable);
  const verdict = ingested.facts?.verdict ?? null;
  return {
    id: "bundle",
    state,
    supplied,
    recognized: ingested.recognized,
    usable: ingested.usable,
    verdict,
    severity: state === "usable" && verdict ? BUNDLE_SEVERITY[verdict] : state === "tampered" ? "blocking" : supplied ? "insufficient" : null,
    detail: detail("bundle", state, verdict),
    facts: ingested.usable ? (ingested.facts as ArchiveBundleFacts) : null,
  };
}

export function computeArchiveCoverage(
  governance: ReleaseArchiveRecord,
  trend: ReleaseArchiveRecord,
  report: ReleaseArchiveRecord,
  audit: ReleaseArchiveRecord,
  bundle: ReleaseArchiveRecord,
): ReleaseArchiveCoverage {
  const records = [governance, trend, report, audit, bundle];
  return {
    recordsSupplied: records.filter((r) => r.supplied).length,
    recordsRecognized: records.filter((r) => r.recognized).length,
    recordsUsable: records.filter((r) => r.usable).length,
    governance: governance.state,
    trend: trend.state,
    report: report.state,
    audit: audit.state,
    bundle: bundle.state,
    hasGovernance: governance.usable,
    hasTrend: trend.usable,
    hasReport: report.usable,
    hasAudit: audit.usable,
    hasBundle: bundle.usable,
  };
}
