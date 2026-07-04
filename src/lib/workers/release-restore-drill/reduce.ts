import {
  RELEASE_RESTORE_DRILL_RECORD_IDS,
  type ReleaseArchiveRecordState,
  type ReleaseRestoreCheckState,
  type ReleaseRestoreDrillArchive,
  type ReleaseRestoreDrillArchiveState,
  type ReleaseRestoreDrillCoverage,
  type ReleaseRestoreDrillRecord,
  type ReleaseRestoreDrillRecordId,
  type ReleaseRestoreDrillSeverity,
  type RestoreArchiveRecordPosture,
} from "./types";
import type {
  IngestedRestoreArchive,
  IngestedRestoreDrill,
  RestoredRecordIngest,
  IngestedGovernance,
  IngestedTrend,
  IngestedReport,
  IngestedAudit,
  IngestedBundle,
} from "./ingest";

/** The archive anchor's coverage state from its ingest flags. */
export function archiveState(supplied: boolean, recognized: boolean, usable: boolean): ReleaseRestoreDrillArchiveState {
  if (!supplied) return "absent";
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** The archive anchor's contribution on the common severity ladder. */
function archiveSeverity(state: ReleaseRestoreDrillArchiveState, posture: string | null): ReleaseRestoreDrillSeverity | null {
  if (state === "absent" || state === "unreadable") return "insufficient";
  if (state === "tampered") return "blocking";
  // usable — the pack's own posture governs.
  switch (posture) {
    case "archivable":
      return "ready";
    case "archive-watch":
      return "advisory";
    case "archive-incomplete":
      return "insufficient";
    case "archive-blocked":
      return "blocking";
    default:
      return "insufficient";
  }
}

function archiveDetail(state: ReleaseRestoreDrillArchiveState, posture: string | null): string {
  if (state === "absent") return "No archive pack was supplied to drill.";
  if (state === "unreadable") return "Archive pack was supplied but was not readable as a `pdfxyz.release-archive/1`.";
  if (state === "tampered") return "Archive pack was recognized but did not re-derive from its own reduced records.";
  return `Archive pack is usable with posture ${posture ?? "n/a"}.`;
}

export function reduceArchiveAnchor(
  input: { readonly supplied: boolean; readonly ingested: IngestedRestoreArchive; readonly digest: string | null },
): ReleaseRestoreDrillArchive {
  const { supplied, ingested } = input;
  const state = archiveState(supplied, ingested.recognized, ingested.usable);
  const posture = ingested.usable ? (ingested.facts?.posture ?? null) : ingested.posture;
  return {
    state,
    supplied,
    recognized: ingested.recognized,
    usable: ingested.usable,
    posture,
    severity: archiveSeverity(state, posture),
    detail: archiveDetail(state, posture),
    facts: ingested.usable ? ingested.facts : null,
  };
}

/** The archive pack's recorded posture for one record class (the cross-check baseline). */
function archivedPosture(
  facts: ReleaseRestoreDrillArchive["facts"],
  id: ReleaseRestoreDrillRecordId,
): RestoreArchiveRecordPosture {
  const record = facts?.records.find((r) => r.id === id);
  return record ?? { id, state: "absent", verdict: null };
}

/** The restore-check state comparing what was RESTORED against what the archive RECORDED. */
export function restoreCheckState(
  archived: RestoreArchiveRecordPosture,
  supplied: boolean,
  recognized: boolean,
  usable: boolean,
  restoredVerdict: string | null,
): ReleaseRestoreCheckState {
  if (!supplied) return archived.state === "usable" ? "not-restored" : "absent";
  if (!recognized) return "restored-unreadable";
  if (!usable) return "restored-tampered";
  // A usable restored record — cross-check against the archive's record.
  if (archived.state === "usable") {
    return restoredVerdict === archived.verdict ? "restored-match" : "restored-mismatch";
  }
  return "restored-unexpected";
}

const CHECK_SEVERITY: Record<ReleaseRestoreCheckState, ReleaseRestoreDrillSeverity | null> = {
  absent: null,
  "not-restored": "advisory",
  "restored-match": "ready",
  "restored-mismatch": "blocking",
  "restored-unexpected": "advisory",
  "restored-unreadable": "insufficient",
  "restored-tampered": "blocking",
};

function checkDetail(id: string, state: ReleaseRestoreCheckState): string {
  switch (state) {
    case "absent":
      return `${id} was neither archived nor restored (nothing to drill).`;
    case "not-restored":
      return `${id} was archived as usable but was not restored (the drill did not exercise it).`;
    case "restored-match":
      return `${id} restored and re-validated, matching the archive record.`;
    case "restored-mismatch":
      return `${id} restored but its posture does not match the archive record (a restore integrity failure).`;
    case "restored-unexpected":
      return `${id} restored, but the archive kept no usable record of this class (reconcile).`;
    case "restored-unreadable":
      return `${id} was supplied but was not readable as the expected schema.`;
    case "restored-tampered":
      return `${id} was recognized but no longer re-derives from its own facts (a corrupt restore).`;
  }
}

/** Extract a restored record's usable-only re-derived posture token (mirrors the Phase 55 archive reduce). */
function restoredVerdictOf(id: ReleaseRestoreDrillRecordId, ingest: IngestedRestoreDrill): string | null {
  switch (id) {
    case "governance": {
      const i = ingest.governance.ingested as IngestedGovernance;
      return i.usable ? i.verdict : null;
    }
    case "trend": {
      const i = ingest.trend.ingested as IngestedTrend;
      return i.usable ? i.verdict : null;
    }
    case "report": {
      const i = ingest.report.ingested as IngestedReport;
      return i.usable ? i.recommendation : null;
    }
    case "audit": {
      const i = ingest.audit.ingested as IngestedAudit;
      return i.usable ? i.verdict : null;
    }
    case "bundle": {
      const i = ingest.bundle.ingested as IngestedBundle;
      return i.usable ? (i.facts?.verdict ?? null) : null;
    }
  }
}

function restoredIngestOf(
  id: ReleaseRestoreDrillRecordId,
  ingest: IngestedRestoreDrill,
): RestoredRecordIngest<{ recognized: boolean; usable: boolean }> {
  switch (id) {
    case "governance":
      return ingest.governance;
    case "trend":
      return ingest.trend;
    case "report":
      return ingest.report;
    case "audit":
      return ingest.audit;
    case "bundle":
      return ingest.bundle;
  }
}

export function reduceRestoreRecord(
  id: ReleaseRestoreDrillRecordId,
  archive: ReleaseRestoreDrillArchive,
  ingest: IngestedRestoreDrill,
): ReleaseRestoreDrillRecord {
  const restored = restoredIngestOf(id, ingest);
  const archived = archivedPosture(archive.facts, id);
  const supplied = restored.supplied;
  const recognized = restored.ingested.recognized;
  const usable = restored.ingested.usable;
  const restoredVerdict = restoredVerdictOf(id, ingest);
  const restoreState = restoreCheckState(archived, supplied, recognized, usable, restoredVerdict);
  return {
    id,
    restoreState,
    supplied,
    recognized,
    usable,
    restoredVerdict,
    archivedState: archived.state,
    archivedVerdict: archived.verdict,
    severity: CHECK_SEVERITY[restoreState],
    digest: restored.digest,
    detail: checkDetail(id, restoreState),
  };
}

export function reduceRestoreRecords(
  archive: ReleaseRestoreDrillArchive,
  ingest: IngestedRestoreDrill,
): ReleaseRestoreDrillRecord[] {
  return RELEASE_RESTORE_DRILL_RECORD_IDS.map((id) => reduceRestoreRecord(id, archive, ingest));
}

export function computeRestoreCoverage(
  archive: ReleaseRestoreDrillArchive,
  records: readonly ReleaseRestoreDrillRecord[],
): ReleaseRestoreDrillCoverage {
  const restored = records.filter((r) => r.supplied);
  const matched = records.filter((r) => r.restoreState === "restored-match");
  const failed = records.filter(
    (r) =>
      r.restoreState === "restored-mismatch" ||
      r.restoreState === "restored-tampered" ||
      r.restoreState === "restored-unreadable",
  );
  const notRestored = records.filter((r) => r.restoreState === "not-restored");
  return {
    archive: archive.state,
    archivedUsable: archive.facts?.recordsUsable ?? 0,
    recordsRestored: restored.length,
    recordsMatched: matched.length,
    recordsFailed: failed.length,
    recordsNotRestored: notRestored.length,
    hasArchive: archive.usable,
    exercised: restored.length > 0,
  };
}

/** Re-export for the barrel (used by an archived record state discriminator in tests). */
export type { ReleaseArchiveRecordState };
