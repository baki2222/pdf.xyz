/**
 * Test-support builders for the release evidence trend summary tests (Phase 53).
 *
 * The trend ingests `pdfxyz.release-report/1` reports, so these helpers build REAL, self-consistent reports of
 * each recommendation — by composing the shipped Phase 52 report over genuinely coherent bundles / audits
 * (reusing the release-report fixtures). A promote-ready / hold-warning / needs-evidence / hold-fail report
 * re-derives its own recommendation, so the trend's trust boundary marks it `usable`; {@link tamperReport} flips
 * a recorded recommendation so it no longer re-derives (a recognized-but-inconsistent report the trend catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and
 * is never imported by any runtime module.
 */

import {
  failBundle,
  makeReport,
  passAudit,
  passBundle,
  warnBundle,
} from "../release-report/fixtures";
import type { ReleaseReportRecommendation, ReleaseReportResult } from "../release-report/types";
import { ingestReport, type IngestedReport } from "./ingest";
import { DEFAULT_MAX_REPORTS, type ReleaseTrendArgs } from "./args";
import { buildTrendResult } from "./build";
import type { ReleaseTrendProvider } from "./run";
import type { ReleaseTrendPolicy, ReleaseTrendResult } from "./types";

/** A fixed clock the trend tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real report builders (each self-consistent → usable by the trend)
 * ------------------------------------------------------------------ */

/** A PROMOTE-READY report: a passing bundle + a passing audit (coherent, non-regressed). */
export function promoteReadyReport(): ReleaseReportResult {
  return makeReport({ bundle: passBundle(), audit: passAudit() });
}

/** A HOLD-WARNING report: a warn bundle (an advisory concern, no blocker). */
export function holdWarningReport(): ReleaseReportResult {
  return makeReport({ bundle: warnBundle() });
}

/** A NEEDS-EVIDENCE report: an audit-only run (no bundle → the release's coherence is unproven). */
export function needsEvidenceReport(): ReleaseReportResult {
  return makeReport({ audit: passAudit() });
}

/** A HOLD-FAIL report: a failed bundle (a blocking coherence failure). */
export function holdFailReport(): ReleaseReportResult {
  return makeReport({ bundle: failBundle() });
}

/** Build a real report for the given recommendation (a small dispatcher for table-driven tests). */
export function reportFor(recommendation: ReleaseReportRecommendation): ReleaseReportResult {
  switch (recommendation) {
    case "promote-ready":
      return promoteReadyReport();
    case "hold-warning":
      return holdWarningReport();
    case "needs-evidence":
      return needsEvidenceReport();
    case "hold-fail":
      return holdFailReport();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/** Flip a report's recorded recommendation so it no longer re-derives from its own sources (a tamper). */
export function tamperReport(
  report: ReleaseReportResult,
  to: ReleaseReportRecommendation,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(report)) as Record<string, unknown> & {
    recommendation: { recommendation: string };
  };
  clone.recommendation.recommendation = to;
  return clone;
}

/** A tampered report (a hand-flipped recorded recommendation ⇒ a `tampered` point). */
export function tamperedReport(): Record<string, unknown> {
  return tamperReport(promoteReadyReport(), "hold-fail");
}

/** An input that is NOT a recognized release report (⇒ an `unreadable` point). */
export function notAReport(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release report" };
}

/* ------------------------------------------------------------------ *
 *  Trend input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (full-strict thresholds): a stable trend needs a clean window. */
export function defaultPolicy(over: Partial<ReleaseTrendPolicy> = {}): ReleaseTrendPolicy {
  return {
    maxReports: DEFAULT_MAX_REPORTS,
    maxHoldWarning: 0,
    maxHoldFail: 0,
    requireLatestReady: false,
    ...over,
  };
}

/** Reduce a list of report objects (oldest → newest) to the ingested reports the fold consumes. */
export function ingestReportsFrom(objs: readonly unknown[]): IngestedReport[] {
  return objs.map((obj) => ingestReport(obj));
}

/** Build a real {@link ReleaseTrendResult} from a list of report objects (oldest → newest). */
export function makeTrend(
  objs: readonly unknown[],
  policy: Partial<ReleaseTrendPolicy> = {},
): ReleaseTrendResult {
  return buildTrendResult(NOW, ingestReportsFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied report object by its positional "path" (`report-<i>`). */
export function makeProvider(objs: readonly unknown[], stdin = ""): ReleaseTrendProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`report-${i}`, obj));
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (!byPath.has(path)) throw new Error("enoent");
      const obj = byPath.get(path);
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseTrendArgs} that reference each supplied report by its positional "path". */
export function makeArgs(objs: readonly unknown[], over: Partial<ReleaseTrendArgs> = {}): ReleaseTrendArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxReports: DEFAULT_MAX_REPORTS,
    maxHoldWarning: 0,
    maxHoldFail: 0,
    requireLatestReady: false,
    reportPaths: objs.map((_, i) => `report-${i}`),
    ...over,
  };
}
