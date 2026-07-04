/**
 * Test-support builders for the release evidence governance bundle tests (Phase 54).
 *
 * The bundle ingests a `pdfxyz.release-trend/1` window summary plus, optionally, the latest
 * `pdfxyz.release-report/1` and/or `pdfxyz.release-audit/1`, so these helpers build REAL, self-consistent
 * documents of each posture — by composing the shipped Phase 53 trend over genuinely coherent report histories
 * (reusing the release-trend fixtures), the shipped Phase 52 report over coherent bundles / audits, and the
 * shipped Phase 51 audit over coherent bundles (reusing the release-report fixtures). A stable / warning /
 * unknown / failing trend re-derives its own verdict, so the bundle's trust boundary marks it `usable`;
 * {@link tamperTrend} flips a recorded verdict so it no longer re-derives (a recognized-but-inconsistent trend
 * the bundle catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and
 * is never imported by any runtime module.
 */

import {
  holdFailReport,
  holdWarningReport,
  makeTrend,
  needsEvidenceReport,
  promoteReadyReport,
} from "../release-trend/fixtures";
import type { ReleaseAuditResult } from "../release-audit/types";
import type { ReleaseReportResult } from "../release-report/types";
import type { ReleaseTrendResult } from "../release-trend/types";
import {
  ingestAuditSource,
  ingestReportSource,
  ingestTrend,
  type IngestedGovernanceSources,
} from "./ingest";
import { buildGovernanceResult } from "./build";
import type { ReleaseGovernanceArgs } from "./args";
import type { ReleaseGovernanceProvider } from "./run";
import type { ReleaseGovernancePolicy, ReleaseGovernanceResult } from "./types";

export {
  holdFailReport,
  holdWarningReport,
  needsEvidenceReport,
  notAReport,
  promoteReadyReport,
  tamperReport,
} from "../release-trend/fixtures";
export { failAudit, passAudit, unknownAudit, warnAudit, tamperAudit } from "../release-report/fixtures";

/** A fixed clock the governance tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real trend builders (each self-consistent → usable by the bundle)
 * ------------------------------------------------------------------ */

/** A STABLE trend: a clean window of promote-ready reports (newest promote-ready, no threshold breach). */
export function stableTrend(): ReleaseTrendResult {
  return makeTrend([promoteReadyReport(), promoteReadyReport(), promoteReadyReport()]);
}

/** A WARNING trend: a hold-warning newest report (an advisory recent posture). */
export function warningTrend(): ReleaseTrendResult {
  return makeTrend([promoteReadyReport(), holdWarningReport()], { maxHoldWarning: 5 });
}

/** An UNKNOWN trend: a needs-evidence newest report (an insufficient recent posture). */
export function unknownTrend(): ReleaseTrendResult {
  return makeTrend([promoteReadyReport(), needsEvidenceReport()]);
}

/** A FAILING trend: a hold-fail newest report (a blocking recent posture). */
export function failingTrend(): ReleaseTrendResult {
  return makeTrend([promoteReadyReport(), holdFailReport()], { maxHoldFail: 5 });
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/** Flip a trend's recorded verdict so it no longer re-derives from its own points (a tamper). */
export function tamperTrend(trend: ReleaseTrendResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    trend: { verdict: string };
  };
  clone.trend.verdict = trend.trend.verdict === "stable" ? "failing" : "stable";
  return clone;
}

/** A tampered trend (a hand-flipped recorded verdict ⇒ a `tampered` trend source). */
export function tamperedTrend(): Record<string, unknown> {
  return tamperTrend(stableTrend());
}

/** An input that is NOT a recognized release document (⇒ an `unreadable` source). */
export function notADocument(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release trend / report / audit" };
}

/* ------------------------------------------------------------------ *
 *  Governance input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The document objects a test supplies to the bundle (any subset; `undefined` ⇒ not supplied). */
export interface GovernanceObjects {
  trend?: unknown;
  report?: unknown;
  audit?: unknown;
}

/** The default policy (no requirements, no strict-watch). */
export function defaultPolicy(over: Partial<ReleaseGovernancePolicy> = {}): ReleaseGovernancePolicy {
  return {
    requireReport: false,
    requireAudit: false,
    strictWatch: false,
    ...over,
  };
}

/** Reduce a subset of document objects to the {@link IngestedGovernanceSources} the fold consumes. */
export function ingestGovernanceFrom(objs: GovernanceObjects): IngestedGovernanceSources {
  return {
    trend: { supplied: objs.trend !== undefined, ingested: ingestTrend(objs.trend) },
    report: { supplied: objs.report !== undefined, ingested: ingestReportSource(objs.report) },
    audit: { supplied: objs.audit !== undefined, ingested: ingestAuditSource(objs.audit) },
  };
}

/** Build a real {@link ReleaseGovernanceResult} from a subset of document objects. */
export function makeGovernance(
  objs: GovernanceObjects,
  policy: Partial<ReleaseGovernancePolicy> = {},
): ReleaseGovernanceResult {
  return buildGovernanceResult(NOW, ingestGovernanceFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied document object by its source-key "path" (used by the run tests). */
export function makeProvider(objs: GovernanceObjects, stdin = ""): ReleaseGovernanceProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      const obj = (objs as Record<string, unknown>)[path];
      if (obj === undefined) throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseGovernanceArgs} that reference each supplied document by its source-key "path". */
export function makeArgs(objs: GovernanceObjects, over: Partial<ReleaseGovernanceArgs> = {}): ReleaseGovernanceArgs {
  return {
    format: "json",
    pretty: true,
    requireReport: false,
    requireAudit: false,
    strictWatch: false,
    ...(objs.trend !== undefined ? { trendPath: "trend" } : {}),
    ...(objs.report !== undefined ? { reportPath: "report" } : {}),
    ...(objs.audit !== undefined ? { auditPath: "audit" } : {}),
    ...over,
  };
}

/** Re-export the real document builders as convenience aliases for report / audit postures. */
export type { ReleaseAuditResult, ReleaseReportResult, ReleaseTrendResult };
