/**
 * Pure, node-free **record ingest** for the release evidence restore drill (Phase 56) — the trust boundary and
 * the no-leak core.
 *
 * The drill anchors on a `pdfxyz.release-archive/1` pack (PRIMARY) and, optionally, the underlying evidence
 * records an operator restored (a `pdfxyz.release-governance/1` / `pdfxyz.release-trend/1` /
 * `pdfxyz.release-report/1` / `pdfxyz.release-audit/1` / `pdfxyz.release-ci-bundle/1`). Even though each is
 * already content-free, every one is UNTRUSTED input here (a restored file from a cold store, a committed record,
 * or a hand-crafted / corrupt file), and this module turns each parsed root into a bounded ingested shape:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a record. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance,
 *    stamps, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundaries.** Each restored underlying record reuses the SAME Phase-55 archive ingest
 *    wrappers ({@link import("../release-archive/ingest")}) that re-run the Phase 50–54 reducers over the record's
 *    own facts. The archive pack (new here) RECONSTRUCTS the pack's five reduced records and RE-RUNS the Phase 55
 *    {@link computeArchiveCoverage} + {@link computeArchiveRollup} over them, marking the pack `usable` only if
 *    the recorded coverage + rollup re-derive — so a hand-flipped archive posture / lied coverage / hidden
 *    tampered record is caught as self-inconsistent.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` anchor);
 *    a recognized-but-inconsistent pack is `recognized = true, usable = false` (⇒ a `tampered` anchor, blocking);
 *    a coherent pack yields reduced bounded facts + the pack's OWN recorded per-record postures for the restore
 *    cross-check. The offending content is never echoed.
 *
 * A NOTE ON ARCHIVE DEPTH: an archive pack keeps only its bounded per-record POSTURES (each record's coverage
 * state + its usable-only verdict) — it already reduced the underlying documents away. So the DEEPEST
 * self-consistency check available over a pack is reconstructing those per-record postures and re-deriving the
 * coverage + rollup from them; that is exactly what {@link computeArchiveCoverage} + {@link computeArchiveRollup}
 * read, so re-running them is faithful tamper-evidence at this boundary (the archive RECORD is the atom of a pack,
 * as the governance SOURCE was of a governance bundle at Phase 55). SAFETY of the stripped reconstruction:
 * {@link computeArchiveCoverage} reads ONLY each record's `supplied` / `recognized` / `usable` / `state`, and
 * {@link computeArchiveRollup} reads ONLY each record's `supplied` / `state` / `verdict` / `usable` (+ the
 * governance record's `facts.trendVerdict` / `facts.reportVerdict` / `facts.auditVerdict`, for the pack's own
 * cross-checks) + the policy — never any other `facts` field — so filling the other governance-facts fields with
 * type-valid defaults cannot change the recompute (verified against `release-archive/reduce.ts` +
 * `release-archive/rollup.ts`; re-verify those field reads before trusting this reconstruction). We ADDITIONALLY
 * enforce `state === recordState(supplied, recognized, usable)` per record (the Phase 55 reduce invariant), so a
 * state-only flip that the coverage/rollup recompute would otherwise echo is still caught.
 */

import { computeArchiveCoverage, recordState } from "../release-archive/reduce";
import { computeArchiveRollup, type ArchiveRecordsById } from "../release-archive/rollup";
import {
  RELEASE_ARCHIVE_POSTURES,
  RELEASE_ARCHIVE_RECORD_IDS,
  RELEASE_ARCHIVE_RECORD_STATES,
  RELEASE_ARCHIVE_SCHEMA,
  type ArchiveGovernanceFacts,
  type ReleaseArchiveCoverage,
  type ReleaseArchivePolicy,
  type ReleaseArchivePosture,
  type ReleaseArchiveReasonId,
  type ReleaseArchiveRecord,
  RELEASE_ARCHIVE_REASON_IDS,
} from "../release-archive/types";
import {
  ingestAuditRecord,
  ingestBundleRecord,
  ingestGovernance,
  ingestReportRecord,
  ingestTrendRecord,
  type IngestedAudit,
  type IngestedBundle,
  type IngestedGovernance,
  type IngestedReport,
  type IngestedTrend,
} from "../release-archive/ingest";
import type { RestoreArchiveFacts, RestoreArchiveRecordPosture } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** A string or `null`, or `undefined` if neither (a posture token — validated only as string|null here). */
function strOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

/* ------------------------------------------------------------------ *
 *  Archive anchor — reconstruct the pack's per-record postures, re-run the Phase 55 coverage + rollup
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.release-archive/1` document (the drill anchor). */
export interface IngestedRestoreArchive {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-archive/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded coverage + rollup RE-DERIVE from its own per-record postures. */
  readonly usable: boolean;
  /** The pack's recorded posture (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly posture: ReleaseArchivePosture | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: RestoreArchiveFacts | null;
}

export const UNRECOGNIZED_ARCHIVE: IngestedRestoreArchive = {
  recognized: false,
  usable: false,
  posture: null,
  facts: null,
};

function inconsistentArchive(posture: ReleaseArchivePosture | null): IngestedRestoreArchive {
  return { recognized: true, usable: false, posture, facts: null };
}

/** The recorded archive rollup fields the recompute must reproduce for the pack to be `usable`. */
interface RecordedArchiveRollup {
  readonly posture: ReleaseArchivePosture;
  readonly exitCode: number;
  readonly archivable: boolean;
  readonly reasons: readonly ReleaseArchiveReasonId[];
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly requireTrend: boolean;
  readonly requireReport: boolean;
  readonly requireAudit: boolean;
  readonly requireBundle: boolean;
  readonly strictWatch: boolean;
  readonly strictWatchEscalated: boolean;
}

function readArchiveRollup(value: unknown): RecordedArchiveRollup | undefined {
  if (!isObject(value)) return undefined;
  const posture = oneOf(value.posture, RELEASE_ARCHIVE_POSTURES);
  const exitCode = intOf(value.exitCode);
  const archivable = boolOf(value.archivable);
  const blocking = intOf(value.blocking);
  const insufficiencies = intOf(value.insufficiencies);
  const advisories = intOf(value.advisories);
  const requireTrend = boolOf(value.requireTrend);
  const requireReport = boolOf(value.requireReport);
  const requireAudit = boolOf(value.requireAudit);
  const requireBundle = boolOf(value.requireBundle);
  const strictWatch = boolOf(value.strictWatch);
  const strictWatchEscalated = boolOf(value.strictWatchEscalated);
  if (
    posture === undefined ||
    exitCode === undefined ||
    archivable === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    requireTrend === undefined ||
    requireReport === undefined ||
    requireAudit === undefined ||
    requireBundle === undefined ||
    strictWatch === undefined ||
    strictWatchEscalated === undefined ||
    !Array.isArray(value.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseArchiveReasonId[] = [];
  for (const r of value.reasons) {
    const id = oneOf(r, RELEASE_ARCHIVE_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    posture,
    exitCode,
    archivable,
    reasons,
    blocking,
    insufficiencies,
    advisories,
    requireTrend,
    requireReport,
    requireAudit,
    requireBundle,
    strictWatch,
    strictWatchEscalated,
  };
}

/** The recorded archive `coverage` block validated into a bounded {@link ReleaseArchiveCoverage}. */
function readArchiveCoverage(value: unknown): ReleaseArchiveCoverage | undefined {
  if (!isObject(value)) return undefined;
  const recordsSupplied = intOf(value.recordsSupplied);
  const recordsRecognized = intOf(value.recordsRecognized);
  const recordsUsable = intOf(value.recordsUsable);
  const governance = oneOf(value.governance, RELEASE_ARCHIVE_RECORD_STATES);
  const trend = oneOf(value.trend, RELEASE_ARCHIVE_RECORD_STATES);
  const report = oneOf(value.report, RELEASE_ARCHIVE_RECORD_STATES);
  const audit = oneOf(value.audit, RELEASE_ARCHIVE_RECORD_STATES);
  const bundle = oneOf(value.bundle, RELEASE_ARCHIVE_RECORD_STATES);
  const hasGovernance = boolOf(value.hasGovernance);
  const hasTrend = boolOf(value.hasTrend);
  const hasReport = boolOf(value.hasReport);
  const hasAudit = boolOf(value.hasAudit);
  const hasBundle = boolOf(value.hasBundle);
  if (
    recordsSupplied === undefined ||
    recordsRecognized === undefined ||
    recordsUsable === undefined ||
    governance === undefined ||
    trend === undefined ||
    report === undefined ||
    audit === undefined ||
    bundle === undefined ||
    hasGovernance === undefined ||
    hasTrend === undefined ||
    hasReport === undefined ||
    hasAudit === undefined ||
    hasBundle === undefined
  ) {
    return undefined;
  }
  return {
    recordsSupplied,
    recordsRecognized,
    recordsUsable,
    governance,
    trend,
    report,
    audit,
    bundle,
    hasGovernance,
    hasTrend,
    hasReport,
    hasAudit,
    hasBundle,
  };
}

/** The recorded archive `policy` block validated into a bounded {@link ReleaseArchivePolicy}. */
function readArchivePolicy(value: unknown): ReleaseArchivePolicy | undefined {
  if (!isObject(value)) return undefined;
  const requireTrend = boolOf(value.requireTrend);
  const requireReport = boolOf(value.requireReport);
  const requireAudit = boolOf(value.requireAudit);
  const requireBundle = boolOf(value.requireBundle);
  const strictWatch = boolOf(value.strictWatch);
  if (
    requireTrend === undefined ||
    requireReport === undefined ||
    requireAudit === undefined ||
    requireBundle === undefined ||
    strictWatch === undefined
  ) {
    return undefined;
  }
  return { requireTrend, requireReport, requireAudit, requireBundle, strictWatch };
}

/** A reconstructed record plus its recorded posture (for the restore cross-check). */
interface ReconstructedRecord {
  readonly record: ReleaseArchiveRecord;
  readonly posture: RestoreArchiveRecordPosture;
}

/**
 * Reconstruct one recorded archive record at `index` into the minimal {@link ReleaseArchiveRecord} the Phase 55
 * coverage + rollup read. Returns `undefined` if the record is malformed, out of position, off-enum, or violates
 * the reduce invariant `state === recordState(...)`, any of which is a corrupt / tampered pack. Only the
 * load-bearing fields are reconstructed faithfully; `severity` / `detail` are unread filler, and for governance
 * only `facts.trendVerdict` / `facts.reportVerdict` / `facts.auditVerdict` are reconstructed (the recompute reads
 * nothing else).
 */
function reconstructRecord(raw: unknown, index: number): ReconstructedRecord | undefined {
  const id = RELEASE_ARCHIVE_RECORD_IDS[index];
  if (id === undefined) return undefined; // more than five records ⇒ corrupt
  if (!isObject(raw) || raw.id !== id) return undefined;

  const state = oneOf(raw.state, RELEASE_ARCHIVE_RECORD_STATES);
  const supplied = boolOf(raw.supplied);
  const recognized = boolOf(raw.recognized);
  const usable = boolOf(raw.usable);
  if (state === undefined || supplied === undefined || recognized === undefined || usable === undefined) {
    return undefined;
  }
  if (state !== recordState(supplied, recognized, usable)) return undefined; // Phase 55 reduce invariant

  const verdict = strOrNull(raw.verdict);
  if (verdict === undefined) return undefined;

  const posture: RestoreArchiveRecordPosture = {
    id,
    state,
    // Trust the recorded verdict only for a usable record; else surface null (never the untrusted claim).
    verdict: state === "usable" ? verdict : null,
  };

  const common = { state, supplied, recognized, usable, verdict, severity: null, detail: "" } as const;

  if (id === "governance") {
    // The recompute reads governance.facts.{trendVerdict,reportVerdict,auditVerdict}; reconstruct them faithfully
    // for a usable record (else facts is null, per the Phase 55 reduce rule).
    let facts: ArchiveGovernanceFacts | null = null;
    if (state === "usable") {
      if (!isObject(raw.facts)) return undefined;
      const trendVerdict = strOrNull(raw.facts.trendVerdict);
      const reportVerdict = strOrNull(raw.facts.reportVerdict);
      const auditVerdict = strOrNull(raw.facts.auditVerdict);
      if (trendVerdict === undefined || reportVerdict === undefined || auditVerdict === undefined) {
        return undefined;
      }
      facts = governanceFactsFiller(trendVerdict, reportVerdict, auditVerdict);
    } else if (raw.facts !== null && raw.facts !== undefined && !isObject(raw.facts)) {
      return undefined;
    }
    return { record: { id, ...common, facts } as ReleaseArchiveRecord, posture };
  }
  return { record: { id, ...common, facts: null } as ReleaseArchiveRecord, posture };
}

/**
 * A type-valid {@link ArchiveGovernanceFacts} whose only load-bearing fields are the three related-source
 * verdicts (the recompute reads nothing else); every other field is a deterministic filler.
 */
function governanceFactsFiller(
  trendVerdict: string | null,
  reportVerdict: string | null,
  auditVerdict: string | null,
): ArchiveGovernanceFacts {
  return {
    verdict: "healthy",
    exitCode: 0,
    healthy: true,
    sourcesSupplied: 0,
    sourcesUsable: 0,
    trendVerdict: trendVerdict as ArchiveGovernanceFacts["trendVerdict"],
    reportVerdict: reportVerdict as ArchiveGovernanceFacts["reportVerdict"],
    auditVerdict: auditVerdict as ArchiveGovernanceFacts["auditVerdict"],
    blocking: 0,
    insufficiencies: 0,
    advisories: 0,
  };
}

function sameReasons(a: readonly ReleaseArchiveReasonId[], b: readonly ReleaseArchiveReasonId[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

function sameCoverage(a: ReleaseArchiveCoverage, b: ReleaseArchiveCoverage): boolean {
  return (
    a.recordsSupplied === b.recordsSupplied &&
    a.recordsRecognized === b.recordsRecognized &&
    a.recordsUsable === b.recordsUsable &&
    a.governance === b.governance &&
    a.trend === b.trend &&
    a.report === b.report &&
    a.audit === b.audit &&
    a.bundle === b.bundle &&
    a.hasGovernance === b.hasGovernance &&
    a.hasTrend === b.hasTrend &&
    a.hasReport === b.hasReport &&
    a.hasAudit === b.hasAudit &&
    a.hasBundle === b.hasBundle
  );
}

/**
 * Reduce one parsed `pdfxyz.release-archive/1` `root` to the bounded {@link IngestedRestoreArchive}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_ARCHIVE}. For a recognized pack it reconstructs the
 * five per-record postures, RE-RUNS the Phase 55 {@link computeArchiveCoverage} + {@link computeArchiveRollup}
 * over them, and marks the pack `usable` only if the recorded coverage (per-record states + counts) and the
 * recorded rollup (posture, exit code, archivable flag, reason set, counts, require / strict flags, escalation
 * flag) equal the re-derived ones — so a hand-flipped posture / lied coverage / hidden record is caught. Never
 * throws and never echoes the input.
 */
export function ingestRestoreArchive(root: unknown): IngestedRestoreArchive {
  if (!isObject(root) || root.schema !== RELEASE_ARCHIVE_SCHEMA) return UNRECOGNIZED_ARCHIVE;

  const rollupObj = isObject(root.archive) ? root.archive : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.posture, RELEASE_ARCHIVE_POSTURES) ?? null) : null;

  const recordedRollup = readArchiveRollup(root.archive);
  const recordedCoverage = readArchiveCoverage(root.coverage);
  const policy = readArchivePolicy(root.policy);
  if (recordedRollup === undefined || recordedCoverage === undefined || policy === undefined) {
    return inconsistentArchive(claimed);
  }
  if (!Array.isArray(root.records) || root.records.length !== RELEASE_ARCHIVE_RECORD_IDS.length) {
    return inconsistentArchive(recordedRollup.posture);
  }

  const reconstructed: ReconstructedRecord[] = [];
  for (let i = 0; i < RELEASE_ARCHIVE_RECORD_IDS.length; i++) {
    const rec = reconstructRecord(root.records[i], i);
    if (rec === undefined) return inconsistentArchive(recordedRollup.posture);
    reconstructed.push(rec);
  }
  const [governance, trend, report, audit, bundle] = reconstructed.map((r) => r.record) as [
    ReleaseArchiveRecord & { id: "governance" },
    ReleaseArchiveRecord & { id: "trend" },
    ReleaseArchiveRecord & { id: "report" },
    ReleaseArchiveRecord & { id: "audit" },
    ReleaseArchiveRecord & { id: "bundle" },
  ];
  const byId: ArchiveRecordsById = { governance, trend, report, audit, bundle };

  const rederivedCoverage = computeArchiveCoverage(governance, trend, report, audit, bundle);
  const { rollup: rederivedRollup } = computeArchiveRollup(byId, policy);

  const consistent =
    sameCoverage(recordedCoverage, rederivedCoverage) &&
    rederivedRollup.posture === recordedRollup.posture &&
    rederivedRollup.exitCode === recordedRollup.exitCode &&
    rederivedRollup.archivable === recordedRollup.archivable &&
    rederivedRollup.blocking === recordedRollup.blocking &&
    rederivedRollup.insufficiencies === recordedRollup.insufficiencies &&
    rederivedRollup.advisories === recordedRollup.advisories &&
    rederivedRollup.requireTrend === recordedRollup.requireTrend &&
    rederivedRollup.requireReport === recordedRollup.requireReport &&
    rederivedRollup.requireAudit === recordedRollup.requireAudit &&
    rederivedRollup.requireBundle === recordedRollup.requireBundle &&
    rederivedRollup.strictWatch === recordedRollup.strictWatch &&
    rederivedRollup.strictWatchEscalated === recordedRollup.strictWatchEscalated &&
    sameReasons(rederivedRollup.reasons, recordedRollup.reasons);
  if (!consistent) return inconsistentArchive(recordedRollup.posture);

  const facts: RestoreArchiveFacts = {
    posture: recordedRollup.posture,
    exitCode: recordedRollup.exitCode,
    archivable: recordedRollup.archivable,
    recordsSupplied: rederivedCoverage.recordsSupplied,
    recordsUsable: rederivedCoverage.recordsUsable,
    blocking: recordedRollup.blocking,
    insufficiencies: recordedRollup.insufficiencies,
    advisories: recordedRollup.advisories,
    records: reconstructed.map((r) => r.posture),
  };
  return { recognized: true, usable: true, posture: recordedRollup.posture, facts };
}

/* ------------------------------------------------------------------ *
 *  Restored underlying records — reuse the Phase 55 archive ingest wrappers verbatim
 * ------------------------------------------------------------------ */

export function ingestRestoredGovernance(root: unknown): IngestedGovernance {
  return ingestGovernance(root);
}
export function ingestRestoredTrend(root: unknown): IngestedTrend {
  return ingestTrendRecord(root);
}
export function ingestRestoredReport(root: unknown): IngestedReport {
  return ingestReportRecord(root);
}
export function ingestRestoredAudit(root: unknown): IngestedAudit {
  return ingestAuditRecord(root);
}
export function ingestRestoredBundle(root: unknown): IngestedBundle {
  return ingestBundleRecord(root);
}

export type { IngestedGovernance, IngestedTrend, IngestedReport, IngestedAudit, IngestedBundle };

/** One restored record `I`, plus whether a file was SUPPLIED for it and its optional canonical digest. */
export interface RestoredRecordIngest<I> {
  readonly supplied: boolean;
  readonly ingested: I;
  /** Opaque lowercase-hex sha256 of the restored record's canonical content, or `null` when not supplied / hashed. */
  readonly digest: string | null;
}

/** The archive anchor plus the five restored records the reducer + rollup fold. */
export interface IngestedRestoreDrill {
  readonly archive: { readonly supplied: boolean; readonly ingested: IngestedRestoreArchive; readonly digest: string | null };
  readonly governance: RestoredRecordIngest<IngestedGovernance>;
  readonly trend: RestoredRecordIngest<IngestedTrend>;
  readonly report: RestoredRecordIngest<IngestedReport>;
  readonly audit: RestoredRecordIngest<IngestedAudit>;
  readonly bundle: RestoredRecordIngest<IngestedBundle>;
}
