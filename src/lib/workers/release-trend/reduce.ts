/**
 * Pure, node-free **reducer** for the release evidence trend summary (Phase 53).
 *
 * Turns the ingested reports (the trust boundary's output, oldest → newest) into the bounded, content-free
 * sequence the result records and the rollup folds. It:
 *  - applies the `--max-reports` window cap (keeping the NEWEST N, never silently — the count dropped is
 *    surfaced), so the trend is over a bounded history;
 *  - reduces each considered report to a bounded {@link ReleaseTrendPoint} (a position, a coverage state, the
 *    trusted-or-claimed recommendation, a severity, an authored headline);
 *  - summarizes the window into a bounded {@link ReleaseTrendHistory} (counts by recommendation over the usable
 *    reports, the newest / oldest usable recommendation, and the arc direction).
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a
 * locator or a byte to enter — not even an ingested report's own stamp (the trend carries only its own).
 */

import {
  RECOMMENDATION_SEVERITY,
  RELEASE_REPORT_RECOMMENDATIONS,
  RELEASE_TREND_SEVERITY_RANK,
  type ReleaseReportRecommendation,
  type ReleaseTrendDirection,
  type ReleaseTrendHistory,
  type ReleaseTrendPoint,
  type ReleaseTrendReportState,
  type ReleaseTrendSeverity,
} from "./types";
import type { IngestedReport } from "./ingest";

/** The coverage state of one supplied report from its recognized / usable flags. */
export function pointState(recognized: boolean, usable: boolean): ReleaseTrendReportState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** The severity rank of a usable report's recommendation (for the direction arc + previous-vs-newest compare). */
export function recommendationRank(recommendation: ReleaseReportRecommendation): number {
  return RELEASE_TREND_SEVERITY_RANK[RECOMMENDATION_SEVERITY[recommendation]];
}

/** A one-line, content-free headline authored from the position + state + recommendation. */
function pointDetail(
  position: number,
  state: ReleaseTrendReportState,
  recommendation: ReleaseReportRecommendation | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release report (unreadable — never echoed). It contributes no trend evidence.`;
    case "tampered":
      return `#${n}: recognized, but its recorded recommendation does NOT re-derive from its own sources (tampered / corrupt — treated as a blocking failure). Claimed: ${recommendation ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${recommendation ?? "n/a"} (a self-consistent release report).`;
  }
}

/** Reduce one ingested report at `position` (oldest = 0) to the bounded {@link ReleaseTrendPoint}. */
export function reduceReport(position: number, ingested: IngestedReport): ReleaseTrendPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  // Trusted recommendation + severity only from a usable report; a tampered report surfaces its untrusted claim.
  const recommendation = ingested.recommendation;
  const severity: ReleaseTrendSeverity | null =
    state === "usable" && recommendation !== null ? RECOMMENDATION_SEVERITY[recommendation] : null;
  return {
    position,
    state,
    recommendation,
    severity,
    detail: pointDetail(position, state, recommendation),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) reports + how many older ones were dropped. */
export interface WindowedReports {
  /** The reports considered by the trend, oldest → newest (the newest `maxReports`). */
  readonly considered: readonly IngestedReport[];
  /** How many report inputs were supplied (before the cap). */
  readonly reportsSupplied: number;
  /** True iff the cap dropped older reports. */
  readonly truncated: boolean;
  /** How many older reports were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-reports` window cap to the supplied reports (oldest → newest): keep the NEWEST `maxReports`,
 * drop older ones, and surface how many were dropped (never a silent truncation). A `maxReports` of 0 or less
 * is treated as "no reports considered" (an empty, insufficient window).
 */
export function applyWindow(list: readonly IngestedReport[], maxReports: number): WindowedReports {
  const cap = Number.isSafeInteger(maxReports) && maxReports > 0 ? maxReports : 0;
  const considered = cap >= list.length ? list : list.slice(list.length - cap);
  const droppedOldest = list.length - considered.length;
  return {
    considered,
    reportsSupplied: list.length,
    truncated: droppedOldest > 0,
    droppedOldest,
  };
}

/** Zeroed recommendation counts (all four keys present) — the deterministic base for the histogram. */
function zeroCounts(): Record<ReleaseReportRecommendation, number> {
  const counts = {} as Record<ReleaseReportRecommendation, number>;
  for (const rec of RELEASE_REPORT_RECOMMENDATIONS) counts[rec] = 0;
  return counts;
}

/** The bounded arc from the oldest usable report to the newest, by severity rank. */
function directionOf(usable: readonly ReleaseReportRecommendation[]): ReleaseTrendDirection {
  if (usable.length < 2) return "n/a";
  const oldestRank = recommendationRank(usable[0] as ReleaseReportRecommendation);
  const newestRank = recommendationRank(usable[usable.length - 1] as ReleaseReportRecommendation);
  if (newestRank > oldestRank) return "degrading";
  if (newestRank < oldestRank) return "improving";
  return "flat";
}

/** The reduced trend sequence + its bounded history summary + the trusted usable-recommendation sequence. */
export interface ReducedTrend {
  /** One reduced point per considered report, oldest → newest. */
  readonly points: readonly ReleaseTrendPoint[];
  /** The bounded history summary. */
  readonly history: ReleaseTrendHistory;
  /** The usable reports' recommendations, oldest → newest (trusted) — what the rollup folds. */
  readonly usableRecommendations: readonly ReleaseReportRecommendation[];
}

/**
 * Reduce the supplied reports (oldest → newest) into the bounded points + history summary, under the window
 * cap. The counts / newest / oldest / direction are over the USABLE considered reports only (an unreadable /
 * tampered report contributes no trusted recommendation), so the summary never fabricates a posture.
 */
export function reduceTrend(list: readonly IngestedReport[], maxReports: number): ReducedTrend {
  const window = applyWindow(list, maxReports);
  const points = window.considered.map((ingested, i) => reduceReport(i, ingested));

  const usableRecommendations: ReleaseReportRecommendation[] = [];
  const counts = zeroCounts();
  let reportsUnreadable = 0;
  let reportsTampered = 0;
  for (const point of points) {
    if (point.state === "usable" && point.recommendation !== null) {
      usableRecommendations.push(point.recommendation);
      counts[point.recommendation] += 1;
    } else if (point.state === "unreadable") {
      reportsUnreadable += 1;
    } else if (point.state === "tampered") {
      reportsTampered += 1;
    }
  }

  const newest =
    usableRecommendations.length > 0
      ? (usableRecommendations[usableRecommendations.length - 1] as ReleaseReportRecommendation)
      : null;
  const oldest =
    usableRecommendations.length > 0 ? (usableRecommendations[0] as ReleaseReportRecommendation) : null;

  const history: ReleaseTrendHistory = {
    reportsSupplied: window.reportsSupplied,
    reportsConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    reportsUsable: usableRecommendations.length,
    reportsUnreadable,
    reportsTampered,
    counts,
    newest,
    oldest,
    direction: directionOf(usableRecommendations),
  };

  return { points, history, usableRecommendations };
}
