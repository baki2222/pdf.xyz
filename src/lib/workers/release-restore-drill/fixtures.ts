/**
 * Test-support builders for the release evidence restore drill tests (Phase 56).
 *
 * The drill anchors on a real `pdfxyz.release-archive/1` pack plus the underlying records an operator restored, so
 * these helpers build REAL, self-consistent documents by composing the shipped Phase 55 archive over genuinely
 * coherent governance / trend / report / audit / CI-bundle inputs (reusing the release-governance fixtures, which
 * themselves compose the shipped Phase 51–54 tools). A clean pack re-derives its own rollup, so the drill's trust
 * boundary marks it `usable`; {@link tamperArchivePack} flips a recorded posture so it no longer re-derives.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is
 * never imported by any runtime module.
 */

import {
  failingTrend,
  makeGovernance,
  passAudit,
  promoteReadyReport,
  stableTrend,
  tamperReport,
  unknownTrend,
  warningTrend,
} from "../release-governance/fixtures";
import { buildArchiveResult } from "../release-archive/build";
import {
  ingestAuditRecord,
  ingestBundleRecord,
  ingestGovernance,
  ingestReportRecord,
  ingestTrendRecord,
  type IngestedArchiveRecords,
} from "../release-archive/ingest";
import type { ReleaseArchivePolicy, ReleaseArchiveResult } from "../release-archive/types";
import { ingestRestoreArchive } from "./ingest";
import type { IngestedRestoreDrill } from "./ingest";
import type { ReleaseRestoreDrillPolicy } from "./types";

/** A fixed clock the drill tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

const ABSENT = { schema: "not-a-release-document/1" };

const DEFAULT_ARCHIVE_POLICY: ReleaseArchivePolicy = {
  requireTrend: false,
  requireReport: false,
  requireAudit: false,
  requireBundle: false,
  strictWatch: false,
};

/** The document objects a pack indexes (any subset; `undefined` ⇒ not supplied). */
export interface PackObjects {
  governance?: unknown;
  trend?: unknown;
  report?: unknown;
  audit?: unknown;
  bundle?: unknown;
}

function packRecords(objs: PackObjects): IngestedArchiveRecords {
  return {
    governance: { supplied: objs.governance !== undefined, ingested: ingestGovernance(objs.governance ?? ABSENT) },
    trend: { supplied: objs.trend !== undefined, ingested: ingestTrendRecord(objs.trend ?? ABSENT) },
    report: { supplied: objs.report !== undefined, ingested: ingestReportRecord(objs.report ?? ABSENT) },
    audit: { supplied: objs.audit !== undefined, ingested: ingestAuditRecord(objs.audit ?? ABSENT) },
    bundle: { supplied: objs.bundle !== undefined, ingested: ingestBundleRecord(objs.bundle ?? ABSENT) },
  };
}

/** Build a real {@link ReleaseArchiveResult} pack from a subset of document objects. */
export function makeArchivePack(objs: PackObjects, policy: Partial<ReleaseArchivePolicy> = {}): ReleaseArchiveResult {
  return buildArchiveResult(NOW, packRecords(objs), { ...DEFAULT_ARCHIVE_POLICY, ...policy });
}

/** A HEALTHY governance bundle + coherent related records (the default archivable set). */
export function healthyPackObjects(): Required<Pick<PackObjects, "governance" | "trend" | "report" | "audit">> {
  const trend = stableTrend();
  const report = promoteReadyReport();
  const audit = passAudit();
  const governance = makeGovernance({ trend, report, audit });
  return { governance, trend, report, audit };
}

/** A clean archivable pack over a healthy governance + related records. */
export function archivablePack(): ReleaseArchiveResult {
  const { governance, trend, report, audit } = healthyPackObjects();
  return makeArchivePack({ governance, trend, report, audit });
}

/** A WATCH pack (a warning trend on its own → archive-watch). */
export function watchPack(): ReleaseArchiveResult {
  return makeArchivePack({ governance: makeGovernance({ trend: warningTrend() }) });
}

/** A BLOCKED pack (a failing trend → archive-blocked). */
export function blockedPack(): ReleaseArchiveResult {
  return makeArchivePack({ governance: makeGovernance({ trend: failingTrend() }) });
}

/** An INCOMPLETE pack (an unknown trend → archive-incomplete). */
export function incompletePack(): ReleaseArchiveResult {
  return makeArchivePack({ governance: makeGovernance({ trend: unknownTrend() }) });
}

/** Flip a pack's recorded archive posture so it no longer re-derives (a tamper). */
export function tamperArchivePack(pack: ReleaseArchiveResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(pack)) as Record<string, unknown> & { archive: { posture: string } };
  clone.archive.posture = pack.archive.posture === "archivable" ? "archive-blocked" : "archivable";
  return clone;
}

/** An input that is NOT a recognized release document (⇒ an `unreadable` anchor / record). */
export function notADocument(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release pack / record" };
}

export { promoteReadyReport, stableTrend, warningTrend, passAudit, tamperReport, makeGovernance };

/** The default drill policy (no scoping, no strictness). */
export function defaultDrillPolicy(over: Partial<ReleaseRestoreDrillPolicy> = {}): ReleaseRestoreDrillPolicy {
  return { archiveOnly: false, requireFullRestore: false, strictDrift: false, ...over };
}

/** The restored underlying records a drill supplies (any subset; `undefined` ⇒ not restored). */
export interface RestoredObjects {
  governance?: unknown;
  trend?: unknown;
  report?: unknown;
  audit?: unknown;
  bundle?: unknown;
}

/** Reduce a pack + a subset of restored records into the {@link IngestedRestoreDrill} the build/reduce/rollup fold. */
export function ingestDrillFrom(pack: unknown, restored: RestoredObjects = {}, digests = false): IngestedRestoreDrill {
  const digestOf = (obj: unknown): string | null =>
    digests && obj !== undefined ? `deadbeef${String(Object.keys(obj as object).length).padStart(2, "0")}` : null;
  const rec = <I,>(obj: unknown, ingest: (root: unknown) => I) => ({
    supplied: obj !== undefined,
    ingested: ingest(obj),
    digest: digestOf(obj),
  });
  return {
    archive: { supplied: true, ingested: ingestRestoreArchive(pack), digest: digestOf(pack) },
    governance: rec(restored.governance, ingestGovernance),
    trend: rec(restored.trend, ingestTrendRecord),
    report: rec(restored.report, ingestReportRecord),
    audit: rec(restored.audit, ingestAuditRecord),
    bundle: rec(restored.bundle, ingestBundleRecord),
  };
}
