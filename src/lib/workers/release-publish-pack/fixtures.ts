/**
 * Test-support builders for the release evidence publish / handoff pack tests (Phase 57).
 *
 * The pack ingests a `pdfxyz.release-governance/1` bundle plus, optionally, the related `pdfxyz.release-archive/1`,
 * `pdfxyz.release-restore-drill/1`, `pdfxyz.release-report/1`, and/or `pdfxyz.release-trend/1`, so these helpers
 * build REAL, self-consistent documents of each posture — by composing the shipped Phase 52–56 tools over
 * genuinely coherent inputs (reusing the release-governance + release-restore-drill fixtures, which themselves
 * compose the shipped Phase 51–55 tools). A clean document re-derives its own rollup, so the pack's trust boundary
 * marks it `usable`; the `tamper*` helpers flip a recorded verdict / posture so it no longer re-derives (a
 * recognized-but-inconsistent document the pack catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is
 * never imported by any runtime module.
 */

import {
  failingTrend,
  holdFailReport,
  holdWarningReport,
  makeGovernance,
  needsEvidenceReport,
  passAudit,
  promoteReadyReport,
  stableTrend,
  unknownTrend,
  warningTrend,
} from "../release-governance/fixtures";
import type { ReleaseGovernanceResult } from "../release-governance/types";
import {
  archivablePack,
  blockedPack,
  defaultDrillPolicy,
  healthyPackObjects,
  incompletePack,
  ingestDrillFrom,
  makeArchivePack,
  tamperArchivePack,
  watchPack,
} from "../release-restore-drill/fixtures";
import { buildRestoreResult } from "../release-restore-drill/build";
import type { ReleaseArchiveResult } from "../release-archive/types";
import type { ReleaseReportResult } from "../release-report/types";
import type { ReleaseRestoreDrillResult } from "../release-restore-drill/types";
import type { ReleaseTrendResult } from "../release-trend/types";
import {
  ingestArchiveSource,
  ingestGovernanceSource,
  ingestReportSource,
  ingestRestoreDrill,
  ingestTrendSource,
  type IngestedPublishPackSources,
} from "./ingest";
import { buildPublishPackResult } from "./build";
import type { ReleasePublishPackArgs } from "./args";
import type { ReleasePublishPackProvider } from "./run";
import type { ReleasePublishPackPolicy, ReleasePublishPackResult } from "./types";

/** A fixed clock the publish-pack tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real governance builders (each self-consistent → usable by the pack)
 * ------------------------------------------------------------------ */

/** A HEALTHY governance bundle (a stable trend on its own → healthy). */
export function healthyGovernance(): ReleaseGovernanceResult {
  return makeGovernance({ trend: stableTrend() });
}

/** A WATCH governance bundle (a warning trend → watch). */
export function watchGovernance(): ReleaseGovernanceResult {
  return makeGovernance({ trend: warningTrend() });
}

/** An INCOMPLETE governance bundle (an unknown trend → incomplete). */
export function incompleteGovernance(): ReleaseGovernanceResult {
  return makeGovernance({ trend: unknownTrend() });
}

/** A BLOCKED governance bundle (a failing trend → blocked). */
export function blockedGovernance(): ReleaseGovernanceResult {
  return makeGovernance({ trend: failingTrend() });
}

/* ------------------------------------------------------------------ *
 *  Real archive builders (re-exported from the restore-drill fixtures)
 * ------------------------------------------------------------------ */

export { archivablePack, watchPack, incompletePack, blockedPack };

/* ------------------------------------------------------------------ *
 *  Real restore-drill builders (each self-consistent → usable by the pack)
 * ------------------------------------------------------------------ */

/** A RESTORE-VERIFIED drill: an archivable pack, every record restored + matched, a restore exercised. */
export function verifiedDrill(): ReleaseRestoreDrillResult {
  const objs = healthyPackObjects();
  const pack = makeArchivePack(objs);
  const ingested = ingestDrillFrom(pack, objs);
  return buildRestoreResult(NOW, ingested, defaultDrillPolicy(), false);
}

/** A RESTORE-DRIFT drill: an archive-watch pack (advisory anchor), its governance record restored + matched. */
export function driftDrill(): ReleaseRestoreDrillResult {
  const governance = makeGovernance({ trend: warningTrend() });
  const pack = makeArchivePack({ governance });
  const ingested = ingestDrillFrom(pack, { governance });
  return buildRestoreResult(NOW, ingested, defaultDrillPolicy(), false);
}

/** A RESTORE-INCOMPLETE drill: an archive-incomplete pack, nothing restored (insufficient). */
export function incompleteDrill(): ReleaseRestoreDrillResult {
  const pack = incompletePack();
  const ingested = ingestDrillFrom(pack, {});
  return buildRestoreResult(NOW, ingested, defaultDrillPolicy(), false);
}

/** A RESTORE-FAILED drill: a tampered archive pack anchor (blocking). */
export function failedDrill(): ReleaseRestoreDrillResult {
  const pack = tamperArchivePack(archivablePack());
  const ingested = ingestDrillFrom(pack, {});
  return buildRestoreResult(NOW, ingested, defaultDrillPolicy(), false);
}

/* ------------------------------------------------------------------ *
 *  Real report + trend builders (re-exported / aliased from the upstream fixtures)
 * ------------------------------------------------------------------ */

export {
  promoteReadyReport,
  holdWarningReport,
  needsEvidenceReport,
  holdFailReport,
  stableTrend,
  warningTrend,
  unknownTrend,
  failingTrend,
  passAudit,
};

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/** Flip a governance bundle's recorded verdict so it no longer re-derives (a tamper). */
export function tamperGovernance(gov: ReleaseGovernanceResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(gov)) as Record<string, unknown> & { governance: { verdict: string } };
  clone.governance.verdict = gov.governance.verdict === "healthy" ? "blocked" : "healthy";
  return clone;
}

/** A tampered governance bundle (a hand-flipped recorded verdict ⇒ a `tampered` governance source). */
export function tamperedGovernance(): Record<string, unknown> {
  return tamperGovernance(healthyGovernance());
}

/** Flip an archive pack's recorded posture so it no longer re-derives (a tamper). */
export function tamperArchive(pack: ReleaseArchiveResult): Record<string, unknown> {
  return tamperArchivePack(pack);
}

/** A tampered archive pack. */
export function tamperedArchive(): Record<string, unknown> {
  return tamperArchivePack(archivablePack());
}

/** Flip a restore drill's recorded verdict so it no longer re-derives (a tamper). */
export function tamperRestoreDrill(drill: ReleaseRestoreDrillResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(drill)) as Record<string, unknown> & { drill: { verdict: string } };
  clone.drill.verdict = drill.drill.verdict === "restore-verified" ? "restore-failed" : "restore-verified";
  return clone;
}

/** A tampered restore drill (a hand-flipped recorded verdict ⇒ a `tampered` restore-drill source). */
export function tamperedRestoreDrill(): Record<string, unknown> {
  return tamperRestoreDrill(verifiedDrill());
}

/** Flip a report's recorded recommendation so it no longer re-derives (a tamper). */
export function tamperReport(report: ReleaseReportResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(report)) as Record<string, unknown> & {
    recommendation: { recommendation: string };
  };
  clone.recommendation.recommendation =
    report.recommendation.recommendation === "promote-ready" ? "hold-fail" : "promote-ready";
  return clone;
}

/** Flip a trend's recorded verdict so it no longer re-derives (a tamper). */
export function tamperTrend(trend: ReleaseTrendResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & { trend: { verdict: string } };
  clone.trend.verdict = trend.trend.verdict === "stable" ? "failing" : "stable";
  return clone;
}

/** An input that is NOT a recognized release document (⇒ an `unreadable` source). */
export function notADocument(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release governance / archive / drill / report / trend" };
}

/* ------------------------------------------------------------------ *
 *  Publish-pack input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The document objects a test supplies to the pack (any subset; `undefined` ⇒ not supplied). */
export interface PublishPackObjects {
  governance?: unknown;
  archive?: unknown;
  restoreDrill?: unknown;
  report?: unknown;
  trend?: unknown;
}

/** The default policy (no requirements, no strict). */
export function defaultPolicy(over: Partial<ReleasePublishPackPolicy> = {}): ReleasePublishPackPolicy {
  return {
    requireArchive: false,
    requireRestoreDrill: false,
    strict: false,
    ...over,
  };
}

/** Reduce a subset of document objects to the {@link IngestedPublishPackSources} the fold consumes. */
export function ingestPublishPackFrom(objs: PublishPackObjects): IngestedPublishPackSources {
  return {
    governance: { supplied: objs.governance !== undefined, ingested: ingestGovernanceSource(objs.governance) },
    archive: { supplied: objs.archive !== undefined, ingested: ingestArchiveSource(objs.archive) },
    restoreDrill: { supplied: objs.restoreDrill !== undefined, ingested: ingestRestoreDrill(objs.restoreDrill) },
    report: { supplied: objs.report !== undefined, ingested: ingestReportSource(objs.report) },
    trend: { supplied: objs.trend !== undefined, ingested: ingestTrendSource(objs.trend) },
  };
}

/** Build a real {@link ReleasePublishPackResult} from a subset of document objects. */
export function makePublishPack(
  objs: PublishPackObjects,
  policy: Partial<ReleasePublishPackPolicy> = {},
): ReleasePublishPackResult {
  return buildPublishPackResult(NOW, ingestPublishPackFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied document object by its source-key "path" (used by the run tests). */
export function makeProvider(objs: PublishPackObjects, stdin = ""): ReleasePublishPackProvider {
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

/** Build {@link ReleasePublishPackArgs} that reference each supplied document by its source-key "path". */
export function makeArgs(
  objs: PublishPackObjects,
  over: Partial<ReleasePublishPackArgs> = {},
): ReleasePublishPackArgs {
  return {
    format: "json",
    pretty: true,
    requireArchive: false,
    requireRestoreDrill: false,
    strict: false,
    ...(objs.governance !== undefined ? { governancePath: "governance" } : {}),
    ...(objs.archive !== undefined ? { archivePath: "archive" } : {}),
    ...(objs.restoreDrill !== undefined ? { restoreDrillPath: "restoreDrill" } : {}),
    ...(objs.report !== undefined ? { reportPath: "report" } : {}),
    ...(objs.trend !== undefined ? { trendPath: "trend" } : {}),
    ...over,
  };
}

/** Re-export the real document result types as convenience aliases. */
export type { ReleaseGovernanceResult, ReleaseArchiveResult, ReleaseRestoreDrillResult, ReleaseReportResult, ReleaseTrendResult };
