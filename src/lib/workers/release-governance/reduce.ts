/**
 * Pure, node-free **reducer** for the release evidence governance bundle (Phase 54).
 *
 * Turns each ingested source (the trust boundary's output) plus whether a file was supplied for it into the
 * bounded, content-free {@link ReleaseGovernanceSource} the result records and the rollup folds. It derives only
 * bounded fields — the coverage state, the common-ladder severity, a one-line authored headline, and safe
 * defaults for a not-usable / not-supplied source — and never reaches past the already-reduced facts, so there
 * is nowhere for a locator or a byte to enter.
 */

import type { ReleaseAuditVerdict } from "../release-audit/types";
import type { ReleaseReportRecommendation } from "../release-report/types";
import type { ReleaseTrendVerdict } from "../release-trend/types";
import type {
  GovernanceSourceIngest,
  IngestedAudit,
  IngestedReport,
  IngestedTrend,
} from "./ingest";
import {
  AUDIT_SEVERITY,
  REPORT_SEVERITY,
  TREND_SEVERITY,
  type ReleaseGovernanceCoverage,
  type ReleaseGovernanceSeverity,
  type ReleaseGovernanceSource,
  type ReleaseGovernanceSourceId,
  type ReleaseGovernanceSourceState,
} from "./types";

/** The coverage state of a source from its supplied / recognized / usable flags. */
export function sourceState(
  supplied: boolean,
  recognized: boolean,
  usable: boolean,
): ReleaseGovernanceSourceState {
  if (!supplied) return "absent";
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** The common-ladder severity contribution of a source, given its state + (usable-only) verdict severity. */
function severityForState(
  state: ReleaseGovernanceSourceState,
  usableSeverity: ReleaseGovernanceSeverity | null,
): ReleaseGovernanceSeverity | null {
  switch (state) {
    case "absent":
      return null; // no evidence supplied ⇒ no severity contribution (the rollup handles a missing primary)
    case "unreadable":
      return "insufficient";
    case "tampered":
      return "blocking";
    case "usable":
      return usableSeverity;
  }
}

/** The human label for each source id (used only in authored detail prose; never a locator). */
const SOURCE_LABEL: Record<ReleaseGovernanceSourceId, string> = {
  trend: "release trend summary",
  report: "latest release report",
  audit: "latest release audit",
};

/** A one-line, content-free headline authored from the source id + state + verdict. */
function sourceDetail(
  id: ReleaseGovernanceSourceId,
  state: ReleaseGovernanceSourceState,
  verdict: string | null,
): string {
  const label = SOURCE_LABEL[id];
  switch (state) {
    case "absent":
      return `${id}: no ${label} supplied.`;
    case "unreadable":
      return `${id}: supplied, but not a recognized ${label} (unreadable — never echoed). It contributes no governance evidence.`;
    case "tampered":
      return `${id}: recognized, but its recorded rollup does NOT re-derive from its own facts (tampered / corrupt — treated as a blocking failure). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `${id}: ${verdict ?? "n/a"} (a self-consistent ${label}).`;
  }
}

/** Reduce the ingested trend source (the PRIMARY window signal) to the bounded {@link ReleaseGovernanceSource}. */
export function reduceTrendSource(source: GovernanceSourceIngest<IngestedTrend>): ReleaseGovernanceSource {
  const { supplied, ingested } = source;
  const recognized = ingested.recognized;
  const usable = supplied && ingested.usable;
  const state = sourceState(supplied, recognized, usable);
  // Trusted verdict + facts only from a usable trend; a tampered trend surfaces its untrusted claimed verdict.
  const verdict: ReleaseTrendVerdict | null = supplied ? ingested.verdict : null;
  const usableSeverity = state === "usable" && verdict !== null ? TREND_SEVERITY[verdict] : null;
  const facts = state === "usable" ? ingested.facts : null;
  return {
    id: "trend",
    state,
    supplied,
    recognized,
    usable,
    verdict,
    severity: severityForState(state, usableSeverity),
    facts,
    detail: sourceDetail("trend", state, verdict),
  };
}

/** Reduce the ingested latest-report source to the bounded {@link ReleaseGovernanceSource}. */
export function reduceReportSource(source: GovernanceSourceIngest<IngestedReport>): ReleaseGovernanceSource {
  const { supplied, ingested } = source;
  const recognized = ingested.recognized;
  const usable = supplied && ingested.usable;
  const state = sourceState(supplied, recognized, usable);
  const verdict: ReleaseReportRecommendation | null = supplied ? ingested.recommendation : null;
  const usableSeverity = state === "usable" && verdict !== null ? REPORT_SEVERITY[verdict] : null;
  const facts = state === "usable" ? ingested.facts : null;
  return {
    id: "report",
    state,
    supplied,
    recognized,
    usable,
    verdict,
    severity: severityForState(state, usableSeverity),
    facts,
    detail: sourceDetail("report", state, verdict),
  };
}

/** Reduce the ingested latest-audit source to the bounded {@link ReleaseGovernanceSource}. */
export function reduceAuditSource(source: GovernanceSourceIngest<IngestedAudit>): ReleaseGovernanceSource {
  const { supplied, ingested } = source;
  const recognized = ingested.recognized;
  const usable = supplied && ingested.usable;
  const state = sourceState(supplied, recognized, usable);
  const verdict: ReleaseAuditVerdict | null = supplied ? ingested.verdict : null;
  const usableSeverity = state === "usable" && verdict !== null ? AUDIT_SEVERITY[verdict] : null;
  const facts = state === "usable" ? ingested.facts : null;
  return {
    id: "audit",
    state,
    supplied,
    recognized,
    usable,
    verdict,
    severity: severityForState(state, usableSeverity),
    facts,
    detail: sourceDetail("audit", state, verdict),
  };
}

/** Fold the three reduced sources into the bounded coverage summary. */
export function computeCoverage(
  trend: ReleaseGovernanceSource,
  report: ReleaseGovernanceSource,
  audit: ReleaseGovernanceSource,
): ReleaseGovernanceCoverage {
  const suppliedCount =
    (trend.supplied ? 1 : 0) + (report.supplied ? 1 : 0) + (audit.supplied ? 1 : 0);
  const usableCount = (trend.usable ? 1 : 0) + (report.usable ? 1 : 0) + (audit.usable ? 1 : 0);
  return {
    sourcesSupplied: suppliedCount,
    sourcesUsable: usableCount,
    trend: trend.state,
    report: report.state,
    audit: audit.state,
    hasTrend: trend.usable,
    hasReport: report.usable,
    hasAudit: audit.usable,
  };
}
