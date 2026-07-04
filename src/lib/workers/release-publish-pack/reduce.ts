/**
 * Pure, node-free **reducer** for the release evidence publish / handoff pack (Phase 57).
 *
 * Turns each ingested source (the trust boundary's output) plus whether a file was supplied for it into the
 * bounded, content-free {@link ReleasePublishPackSource} the result records and the rollup folds. It derives only
 * bounded fields — the coverage state, the common-ladder severity, a one-line authored headline, and safe defaults
 * for a not-usable / not-supplied source — and never reaches past the already-reduced facts, so there is nowhere
 * for a locator or a byte to enter.
 */

import type {
  IngestedGovernance,
  IngestedRestoreArchive,
  IngestedReport,
  IngestedRestoreDrill,
  IngestedTrend,
  PublishPackSourceIngest,
} from "./ingest";
import {
  ARCHIVE_SEVERITY,
  GOVERNANCE_SEVERITY,
  REPORT_SEVERITY,
  RESTORE_DRILL_SEVERITY,
  TREND_SEVERITY,
  type ReleasePublishPackCoverage,
  type ReleasePublishPackSeverity,
  type ReleasePublishPackSource,
  type ReleasePublishPackSourceId,
  type ReleasePublishPackSourceState,
} from "./types";

/** The coverage state of a source from its supplied / recognized / usable flags. */
export function sourceState(
  supplied: boolean,
  recognized: boolean,
  usable: boolean,
): ReleasePublishPackSourceState {
  if (!supplied) return "absent";
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** The common-ladder severity contribution of a source, given its state + (usable-only) verdict severity. */
function severityForState(
  state: ReleasePublishPackSourceState,
  usableSeverity: ReleasePublishPackSeverity | null,
): ReleasePublishPackSeverity | null {
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
const SOURCE_LABEL: Record<ReleasePublishPackSourceId, string> = {
  governance: "release governance bundle",
  archive: "release archive pack",
  "restore-drill": "release restore drill",
  report: "latest release report",
  trend: "release trend summary",
};

/** A one-line, content-free headline authored from the source id + state + verdict. */
function sourceDetail(
  id: ReleasePublishPackSourceId,
  state: ReleasePublishPackSourceState,
  verdict: string | null,
): string {
  const label = SOURCE_LABEL[id];
  switch (state) {
    case "absent":
      return `${id}: no ${label} supplied.`;
    case "unreadable":
      return `${id}: supplied, but not a recognized ${label} (unreadable — never echoed). It contributes no handoff evidence.`;
    case "tampered":
      return `${id}: recognized, but its recorded rollup does NOT re-derive from its own facts (tampered / corrupt — treated as a blocking failure). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `${id}: ${verdict ?? "n/a"} (a self-consistent ${label}).`;
  }
}

/** The uniform reducer over a source's coverage flags + native verdict token + verdict→severity map. */
function reduceSource(
  id: ReleasePublishPackSourceId,
  supplied: boolean,
  recognized: boolean,
  ingestedUsable: boolean,
  claimedVerdict: string | null,
  usableSeverityFor: (verdict: string) => ReleasePublishPackSeverity | undefined,
): ReleasePublishPackSource {
  const usable = supplied && ingestedUsable;
  const state = sourceState(supplied, recognized, usable);
  // Trusted verdict only from a usable source; a tampered source surfaces its untrusted claimed verdict.
  const verdict = supplied ? claimedVerdict : null;
  const usableSeverity =
    state === "usable" && verdict !== null ? (usableSeverityFor(verdict) ?? null) : null;
  return {
    id,
    state,
    supplied,
    recognized,
    usable,
    verdict,
    severity: severityForState(state, usableSeverity),
    detail: sourceDetail(id, state, verdict),
  };
}

/** Reduce the ingested governance source (the PRIMARY summary judgment) to the bounded source. */
export function reduceGovernanceSource(
  source: PublishPackSourceIngest<IngestedGovernance>,
): ReleasePublishPackSource {
  const { supplied, ingested } = source;
  return reduceSource(
    "governance",
    supplied,
    ingested.recognized,
    ingested.usable,
    ingested.verdict,
    (v) => GOVERNANCE_SEVERITY[v as keyof typeof GOVERNANCE_SEVERITY],
  );
}

/** Reduce the ingested archive source to the bounded source. */
export function reduceArchiveSource(
  source: PublishPackSourceIngest<IngestedRestoreArchive>,
): ReleasePublishPackSource {
  const { supplied, ingested } = source;
  return reduceSource(
    "archive",
    supplied,
    ingested.recognized,
    ingested.usable,
    ingested.posture,
    (v) => ARCHIVE_SEVERITY[v as keyof typeof ARCHIVE_SEVERITY],
  );
}

/** Reduce the ingested restore-drill source to the bounded source. */
export function reduceRestoreDrillSource(
  source: PublishPackSourceIngest<IngestedRestoreDrill>,
): ReleasePublishPackSource {
  const { supplied, ingested } = source;
  return reduceSource(
    "restore-drill",
    supplied,
    ingested.recognized,
    ingested.usable,
    ingested.verdict,
    (v) => RESTORE_DRILL_SEVERITY[v as keyof typeof RESTORE_DRILL_SEVERITY],
  );
}

/** Reduce the ingested latest-report source to the bounded source. */
export function reduceReportSource(
  source: PublishPackSourceIngest<IngestedReport>,
): ReleasePublishPackSource {
  const { supplied, ingested } = source;
  return reduceSource(
    "report",
    supplied,
    ingested.recognized,
    ingested.usable,
    ingested.recommendation,
    (v) => REPORT_SEVERITY[v as keyof typeof REPORT_SEVERITY],
  );
}

/** Reduce the ingested trend source to the bounded source. */
export function reduceTrendSource(
  source: PublishPackSourceIngest<IngestedTrend>,
): ReleasePublishPackSource {
  const { supplied, ingested } = source;
  return reduceSource(
    "trend",
    supplied,
    ingested.recognized,
    ingested.usable,
    ingested.verdict,
    (v) => TREND_SEVERITY[v as keyof typeof TREND_SEVERITY],
  );
}

/** Fold the five reduced sources into the bounded coverage summary. */
export function computeCoverage(
  governance: ReleasePublishPackSource,
  archive: ReleasePublishPackSource,
  restoreDrill: ReleasePublishPackSource,
  report: ReleasePublishPackSource,
  trend: ReleasePublishPackSource,
): ReleasePublishPackCoverage {
  const all = [governance, archive, restoreDrill, report, trend];
  const suppliedCount = all.filter((s) => s.supplied).length;
  const usableCount = all.filter((s) => s.usable).length;
  return {
    sourcesSupplied: suppliedCount,
    sourcesUsable: usableCount,
    governance: governance.state,
    archive: archive.state,
    restoreDrill: restoreDrill.state,
    report: report.state,
    trend: trend.state,
    hasGovernance: governance.usable,
    hasArchive: archive.usable,
    hasRestoreDrill: restoreDrill.usable,
    hasReport: report.usable,
    hasTrend: trend.usable,
  };
}
