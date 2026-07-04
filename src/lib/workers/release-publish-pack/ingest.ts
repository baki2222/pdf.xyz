/**
 * Pure, node-free **document ingest** for the release evidence publish / handoff pack (Phase 57) — the trust
 * boundary and the no-leak core.
 *
 * The pack composes up to five release-evidence outputs — a `pdfxyz.release-governance/1` (the PRIMARY summary),
 * a `pdfxyz.release-archive/1`, a `pdfxyz.release-restore-drill/1`, a `pdfxyz.release-report/1`, and a
 * `pdfxyz.release-trend/1`. Even though each is already content-free, every one is UNTRUSTED input here (a CI
 * archive an operator points us at, a committed record, or a hand-crafted / tampered file), and this module turns
 * each parsed root into a bounded ingested shape, in the same paranoid spirit as the rest of the worker ingest
 * layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a document. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance,
 *    stamps, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundaries.** Four of the five sources reuse the SHIPPED, tested ingest boundaries that
 *    already re-derive each document's own rollup: {@link ingestGovernance} (Phase 55, re-derives the governance
 *    Phase 54 rollup), {@link ingestRestoreArchive} (Phase 56, re-derives the archive Phase 55 rollup),
 *    {@link ingestReport} (Phase 53, re-derives the report Phase 52 recommendation), and {@link ingestTrend}
 *    (Phase 54, re-derives the trend Phase 53 rollup). Only the restore-drill boundary is NEW here — Phase 56 is
 *    the newest producer and nothing has ingested a `pdfxyz.release-restore-drill/1` before — so {@link ingestRestoreDrill}
 *    reconstructs the drill's OWN reduced anchor + per-record restore checks and RE-RUNS the Phase 56
 *    {@link computeRestoreCoverage} + {@link computeRestoreRollup} over them, exactly as `ingestRestoreArchive`
 *    does for the archive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` source);
 *    a recognized-but-inconsistent document is `recognized = true, usable = false` (⇒ a `tampered` source,
 *    blocking); a coherent document yields a trusted bounded verdict. The offending content is never echoed.
 *
 * A NOTE ON RESTORE-DRILL DEPTH: a restore-drill's own record keeps only its bounded per-record restore CHECKS
 * (each check's `restoreState` + an optional opaque digest, never the underlying record's raw facts) — it already
 * reduced the restored records away. So the DEEPEST self-consistency check available over a restore-drill is
 * reconstructing those checks + the reduced archive anchor and re-deriving the coverage + verdict from them; that
 * is exactly what {@link computeRestoreCoverage} + {@link computeRestoreRollup} read, so re-running them is
 * faithful tamper-evidence at this boundary (the CHECK is the atom of a drill, as the point was for a trend and
 * the record for an archive). SAFETY of the stripped reconstruction: {@link computeRestoreRollup} reads ONLY the
 * anchor's `recognized` / `state` / `posture` / `usable` and each record's `restoreState` / `supplied` (+ policy),
 * and {@link computeRestoreCoverage} reads ONLY the anchor's `state` / `usable` / `facts.recordsUsable` and each
 * record's `restoreState` / `supplied` — never the unread `severity` / `detail` / `digest` / `restoredVerdict` —
 * so filling those with deterministic filler cannot change the recompute (verified against
 * `release-restore-drill/rollup.ts` + `release-restore-drill/reduce.ts`; re-verify those field reads before
 * trusting this reconstruction).
 */

import { ingestGovernance, type IngestedGovernance } from "../release-archive/ingest";
import {
  computeRestoreCoverage,
  archiveState as restoreArchiveState,
} from "../release-restore-drill/reduce";
import { computeRestoreRollup } from "../release-restore-drill/rollup";
import { ingestRestoreArchive, type IngestedRestoreArchive } from "../release-restore-drill/ingest";
import { ingestReport, type IngestedReport } from "../release-trend/ingest";
import { ingestTrend, type IngestedTrend } from "../release-governance/ingest";
import {
  RELEASE_ARCHIVE_POSTURES,
  type ReleaseArchivePosture,
} from "../release-archive/types";
import {
  RELEASE_RESTORE_CHECK_STATES,
  RELEASE_RESTORE_DRILL_ARCHIVE_STATES,
  RELEASE_RESTORE_DRILL_RECORD_IDS,
  RELEASE_RESTORE_DRILL_REASON_IDS,
  RELEASE_RESTORE_DRILL_SCHEMA,
  RELEASE_RESTORE_DRILL_VERDICTS,
  type ReleaseRestoreCheckState,
  type ReleaseRestoreDrillArchive,
  type ReleaseRestoreDrillArchiveState,
  type ReleaseRestoreDrillCoverage,
  type ReleaseRestoreDrillPolicy,
  type ReleaseRestoreDrillReasonId,
  type ReleaseRestoreDrillRecord,
  type ReleaseRestoreDrillVerdict,
  type RestoreArchiveFacts,
} from "../release-restore-drill/types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A strict non-negative safe integer, or `undefined`. */
function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Strictly `true` or `false`, or `undefined`. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** An archive posture token, or `null` if the value is `null`, or `undefined` if off-enum. */
function postureOrNull(value: unknown): ReleaseArchivePosture | null | undefined {
  if (value === null) return null;
  return oneOf(value, RELEASE_ARCHIVE_POSTURES);
}

/* ------------------------------------------------------------------ *
 *  Restore-drill source — reconstruct the reduced anchor + per-record checks, re-run the Phase 56 coverage + rollup
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.release-restore-drill/1` document. */
export interface IngestedRestoreDrill {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-restore-drill/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded coverage + rollup RE-DERIVE from its own reduced checks (self-consistent). */
  readonly usable: boolean;
  /** The drill's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseRestoreDrillVerdict | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-restore-drill/1`. */
export const UNRECOGNIZED_RESTORE_DRILL: IngestedRestoreDrill = {
  recognized: false,
  usable: false,
  verdict: null,
};

/** A recognized-but-inconsistent (tampered) restore drill, carrying only its untrusted claimed verdict. */
function inconsistentRestoreDrill(verdict: ReleaseRestoreDrillVerdict | null): IngestedRestoreDrill {
  return { recognized: true, usable: false, verdict };
}

/** The recorded drill rollup fields the recompute must reproduce for the drill to be `usable`. */
interface RecordedDrillRollup {
  readonly verdict: ReleaseRestoreDrillVerdict;
  readonly exitCode: number;
  readonly verified: boolean;
  readonly reasons: readonly ReleaseRestoreDrillReasonId[];
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly archiveOnly: boolean;
  readonly requireFullRestore: boolean;
  readonly strictDrift: boolean;
  readonly strictDriftEscalated: boolean;
}

/** Validate the drill's `drill` rollup block into the bounded {@link RecordedDrillRollup}, or `undefined`. */
function readDrillRollup(value: unknown): RecordedDrillRollup | undefined {
  if (!isObject(value)) return undefined;
  const verdict = oneOf(value.verdict, RELEASE_RESTORE_DRILL_VERDICTS);
  const exitCode = intOf(value.exitCode);
  const verified = boolOf(value.verified);
  const blocking = intOf(value.blocking);
  const insufficiencies = intOf(value.insufficiencies);
  const advisories = intOf(value.advisories);
  const archiveOnly = boolOf(value.archiveOnly);
  const requireFullRestore = boolOf(value.requireFullRestore);
  const strictDrift = boolOf(value.strictDrift);
  const strictDriftEscalated = boolOf(value.strictDriftEscalated);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    verified === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    archiveOnly === undefined ||
    requireFullRestore === undefined ||
    strictDrift === undefined ||
    strictDriftEscalated === undefined ||
    !Array.isArray(value.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseRestoreDrillReasonId[] = [];
  for (const r of value.reasons) {
    const id = oneOf(r, RELEASE_RESTORE_DRILL_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    verified,
    reasons,
    blocking,
    insufficiencies,
    advisories,
    archiveOnly,
    requireFullRestore,
    strictDrift,
    strictDriftEscalated,
  };
}

/** Validate the drill's `coverage` block into the bounded {@link ReleaseRestoreDrillCoverage}, or `undefined`. */
function readDrillCoverage(value: unknown): ReleaseRestoreDrillCoverage | undefined {
  if (!isObject(value)) return undefined;
  const archive = oneOf(value.archive, RELEASE_RESTORE_DRILL_ARCHIVE_STATES);
  const archivedUsable = intOf(value.archivedUsable);
  const recordsRestored = intOf(value.recordsRestored);
  const recordsMatched = intOf(value.recordsMatched);
  const recordsFailed = intOf(value.recordsFailed);
  const recordsNotRestored = intOf(value.recordsNotRestored);
  const hasArchive = boolOf(value.hasArchive);
  const exercised = boolOf(value.exercised);
  if (
    archive === undefined ||
    archivedUsable === undefined ||
    recordsRestored === undefined ||
    recordsMatched === undefined ||
    recordsFailed === undefined ||
    recordsNotRestored === undefined ||
    hasArchive === undefined ||
    exercised === undefined
  ) {
    return undefined;
  }
  return {
    archive,
    archivedUsable,
    recordsRestored,
    recordsMatched,
    recordsFailed,
    recordsNotRestored,
    hasArchive,
    exercised,
  };
}

/** Validate the drill's `policy` block into a bounded {@link ReleaseRestoreDrillPolicy}, or `undefined`. */
function readDrillPolicy(value: unknown): ReleaseRestoreDrillPolicy | undefined {
  if (!isObject(value)) return undefined;
  const archiveOnly = boolOf(value.archiveOnly);
  const requireFullRestore = boolOf(value.requireFullRestore);
  const strictDrift = boolOf(value.strictDrift);
  if (archiveOnly === undefined || requireFullRestore === undefined || strictDrift === undefined) {
    return undefined;
  }
  return { archiveOnly, requireFullRestore, strictDrift };
}

/**
 * A type-valid {@link RestoreArchiveFacts} whose only load-bearing field is `recordsUsable` (the recompute's
 * `computeRestoreCoverage` reads nothing else from the anchor facts); every other field is a deterministic filler.
 */
function archiveFactsFiller(recordsUsable: number): RestoreArchiveFacts {
  return {
    posture: "archivable",
    exitCode: 0,
    archivable: true,
    recordsSupplied: 0,
    recordsUsable,
    blocking: 0,
    insufficiencies: 0,
    advisories: 0,
    records: [],
  };
}

/**
 * Reconstruct the recorded reduced archive ANCHOR (`root.archive`) into the minimal {@link ReleaseRestoreDrillArchive}
 * the Phase 56 coverage + rollup read. Returns `undefined` if the anchor is malformed, off-enum, or violates the
 * reduce invariant `state === archiveState(supplied, recognized, usable)`. Only the load-bearing fields are
 * reconstructed faithfully; `severity` / `detail` are unread filler, and `facts` carries only `recordsUsable`.
 */
function reconstructAnchor(value: unknown): ReleaseRestoreDrillArchive | undefined {
  if (!isObject(value)) return undefined;
  const state = oneOf(value.state, RELEASE_RESTORE_DRILL_ARCHIVE_STATES);
  const supplied = boolOf(value.supplied);
  const recognized = boolOf(value.recognized);
  const usable = boolOf(value.usable);
  if (state === undefined || supplied === undefined || recognized === undefined || usable === undefined) {
    return undefined;
  }
  if (state !== restoreArchiveState(supplied, recognized, usable)) return undefined; // Phase 56 reduce invariant
  const posture = postureOrNull(value.posture);
  if (posture === undefined) return undefined;

  // The recompute's coverage reads `facts.recordsUsable` only for a USABLE anchor (else facts is null, per the
  // Phase 56 reduce rule). Reconstruct exactly that: a usable anchor carries a recordsUsable count.
  let facts: RestoreArchiveFacts | null = null;
  if (usable) {
    if (!isObject(value.facts)) return undefined;
    const recordsUsable = intOf(value.facts.recordsUsable);
    if (recordsUsable === undefined) return undefined;
    facts = archiveFactsFiller(recordsUsable);
  }
  return {
    state: state as ReleaseRestoreDrillArchiveState,
    supplied,
    recognized,
    usable,
    posture,
    severity: null,
    detail: "",
    facts,
  };
}

/**
 * Reconstruct one recorded restore CHECK at `index` (`root.records[i]`) into the minimal
 * {@link ReleaseRestoreDrillRecord} the Phase 56 coverage + rollup read (`restoreState` + `supplied` only).
 * Returns `undefined` if the record is malformed, out of position, or off-enum — any of which is a corrupt /
 * tampered drill. `restoredVerdict` / `archivedState` / `archivedVerdict` / `severity` / `digest` / `detail` are
 * unread filler.
 */
function reconstructRecord(raw: unknown, index: number): ReleaseRestoreDrillRecord | undefined {
  const id = RELEASE_RESTORE_DRILL_RECORD_IDS[index];
  if (id === undefined) return undefined; // more than five records ⇒ corrupt
  if (!isObject(raw) || raw.id !== id) return undefined;
  const restoreState = oneOf(raw.restoreState, RELEASE_RESTORE_CHECK_STATES);
  const supplied = boolOf(raw.supplied);
  const recognized = boolOf(raw.recognized);
  const usable = boolOf(raw.usable);
  if (
    restoreState === undefined ||
    supplied === undefined ||
    recognized === undefined ||
    usable === undefined
  ) {
    return undefined;
  }
  return {
    id,
    restoreState: restoreState as ReleaseRestoreCheckState,
    supplied,
    recognized,
    usable,
    restoredVerdict: null,
    archivedState: "absent",
    archivedVerdict: null,
    severity: null,
    digest: null,
    detail: "",
  };
}

/** Compare two `ReleaseRestoreDrillReasonId` lists as sets (order-independent, exact membership). */
function sameReasons(
  a: readonly ReleaseRestoreDrillReasonId[],
  b: readonly ReleaseRestoreDrillReasonId[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

/** Whether the re-derived coverage matches the recorded coverage on every field. */
function sameCoverage(a: ReleaseRestoreDrillCoverage, b: ReleaseRestoreDrillCoverage): boolean {
  return (
    a.archive === b.archive &&
    a.archivedUsable === b.archivedUsable &&
    a.recordsRestored === b.recordsRestored &&
    a.recordsMatched === b.recordsMatched &&
    a.recordsFailed === b.recordsFailed &&
    a.recordsNotRestored === b.recordsNotRestored &&
    a.hasArchive === b.hasArchive &&
    a.exercised === b.exercised
  );
}

/**
 * Reduce one parsed `pdfxyz.release-restore-drill/1` `root` to the bounded {@link IngestedRestoreDrill}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_RESTORE_DRILL}. For a recognized drill it reconstructs
 * the reduced archive anchor + the five per-record restore checks, RE-RUNS the Phase 56 {@link computeRestoreCoverage}
 * + {@link computeRestoreRollup} over them, and marks the drill `usable` only if the recorded coverage and the
 * recorded verdict (verdict, exit code, verified flag, reason set, blocking / insufficiency / advisory counts,
 * policy + escalation flags) equal the re-derived ones — so a hand-flipped verdict / lied coverage / hidden check
 * is caught. Never throws and never echoes the input.
 */
export function ingestRestoreDrill(root: unknown): IngestedRestoreDrill {
  if (!isObject(root) || root.schema !== RELEASE_RESTORE_DRILL_SCHEMA) return UNRECOGNIZED_RESTORE_DRILL;

  const rollupObj = isObject(root.drill) ? root.drill : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_RESTORE_DRILL_VERDICTS) ?? null) : null;

  const recordedRollup = readDrillRollup(root.drill);
  const recordedCoverage = readDrillCoverage(root.coverage);
  const policy = readDrillPolicy(root.policy);
  if (recordedRollup === undefined || recordedCoverage === undefined || policy === undefined) {
    return inconsistentRestoreDrill(claimed);
  }
  const anchor = reconstructAnchor(root.archive);
  if (anchor === undefined) return inconsistentRestoreDrill(recordedRollup.verdict);
  if (!Array.isArray(root.records) || root.records.length !== RELEASE_RESTORE_DRILL_RECORD_IDS.length) {
    return inconsistentRestoreDrill(recordedRollup.verdict);
  }

  const records: ReleaseRestoreDrillRecord[] = [];
  for (let i = 0; i < root.records.length; i++) {
    const record = reconstructRecord(root.records[i], i);
    if (record === undefined) return inconsistentRestoreDrill(recordedRollup.verdict);
    records.push(record);
  }

  const rederivedCoverage = computeRestoreCoverage(anchor, records);
  const { rollup: rederivedRollup } = computeRestoreRollup(anchor, records, policy);

  const consistent =
    sameCoverage(recordedCoverage, rederivedCoverage) &&
    rederivedRollup.verdict === recordedRollup.verdict &&
    rederivedRollup.exitCode === recordedRollup.exitCode &&
    rederivedRollup.verified === recordedRollup.verified &&
    rederivedRollup.blocking === recordedRollup.blocking &&
    rederivedRollup.insufficiencies === recordedRollup.insufficiencies &&
    rederivedRollup.advisories === recordedRollup.advisories &&
    rederivedRollup.archiveOnly === recordedRollup.archiveOnly &&
    rederivedRollup.requireFullRestore === recordedRollup.requireFullRestore &&
    rederivedRollup.strictDrift === recordedRollup.strictDrift &&
    rederivedRollup.strictDriftEscalated === recordedRollup.strictDriftEscalated &&
    sameReasons(rederivedRollup.reasons, recordedRollup.reasons);
  if (!consistent) return inconsistentRestoreDrill(recordedRollup.verdict);

  return { recognized: true, usable: true, verdict: recordedRollup.verdict };
}

/* ------------------------------------------------------------------ *
 *  Governance / archive / report / trend sources — reuse the shipped tested boundaries verbatim
 * ------------------------------------------------------------------ */

/**
 * Reduce one parsed `pdfxyz.release-governance/1` `root` to the bounded {@link IngestedGovernance}, reusing the
 * tested Phase 55 boundary (which re-derives the governance Phase 54 rollup from its own sources). A non-object /
 * wrong-schema input is not recognized (⇒ an `unreadable` source); a recognized-but-self-inconsistent bundle is
 * `usable = false` (⇒ a `tampered` source). Never throws / echoes.
 */
export function ingestGovernanceSource(root: unknown): IngestedGovernance {
  return ingestGovernance(root);
}

/**
 * Reduce one parsed `pdfxyz.release-archive/1` `root` to the bounded {@link IngestedRestoreArchive}, reusing the
 * tested Phase 56 boundary (which re-runs the archive Phase 55 coverage + rollup over its own records). A
 * non-object / wrong-schema input is not recognized (⇒ an `unreadable` source); a recognized-but-self-inconsistent
 * pack is `usable = false` (⇒ a `tampered` source). Never throws / echoes.
 */
export function ingestArchiveSource(root: unknown): IngestedRestoreArchive {
  return ingestRestoreArchive(root);
}

/**
 * Reduce one parsed `pdfxyz.release-report/1` `root` to the bounded {@link IngestedReport}, reusing the tested
 * Phase 53 boundary (which re-derives the report's Phase 52 recommendation). Never throws / echoes.
 */
export function ingestReportSource(root: unknown): IngestedReport {
  return ingestReport(root);
}

/**
 * Reduce one parsed `pdfxyz.release-trend/1` `root` to the bounded {@link IngestedTrend}, reusing the tested
 * Phase 54 boundary (which re-runs the trend Phase 53 reduce + rollup over its own points). Never throws / echoes.
 */
export function ingestTrendSource(root: unknown): IngestedTrend {
  return ingestTrend(root);
}

export type { IngestedGovernance } from "../release-archive/ingest";
export type { IngestedRestoreArchive } from "../release-restore-drill/ingest";
export type { IngestedReport } from "../release-trend/ingest";
export type { IngestedTrend } from "../release-governance/ingest";

/* ------------------------------------------------------------------ *
 *  The pack's five ingested sources
 * ------------------------------------------------------------------ */

/** One ingested source `I`, plus whether a file was SUPPLIED for it. */
export interface PublishPackSourceIngest<I> {
  /** True iff a `--governance` / `--archive` / … input was provided for this slot. */
  readonly supplied: boolean;
  readonly ingested: I;
}

/** The five ingested sources the reducer + rollup fold. */
export interface IngestedPublishPackSources {
  readonly governance: PublishPackSourceIngest<IngestedGovernance>;
  readonly archive: PublishPackSourceIngest<IngestedRestoreArchive>;
  readonly restoreDrill: PublishPackSourceIngest<IngestedRestoreDrill>;
  readonly report: PublishPackSourceIngest<IngestedReport>;
  readonly trend: PublishPackSourceIngest<IngestedTrend>;
}
