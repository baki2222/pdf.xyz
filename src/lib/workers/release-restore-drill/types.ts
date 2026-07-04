/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence restore drill** (Phase 56).
 *
 * Phases 46–55 built the release-evidence chain, one rung per phase: the release readiness gate folds the
 * content-free worker checks into ONE promotion verdict; the release artifact stamps it with bounded provenance
 * + an integrity digest; the release index re-verifies many artifacts into a retention manifest; the release
 * policy asserts bounded operator thresholds over that manifest; the release CI bundle composes a single release
 * job's stage outputs and re-verifies their cross-stage consistency; the release audit diffs a baseline bundle
 * against a current one; the release operator report folds a bundle + optional audit into ONE operator
 * recommendation; the release trend summary summarizes a bounded HISTORY of those reports; the release governance
 * bundle folds a trend window + the latest report / audit into ONE governance verdict; and the release archive
 * pack (`pdfxyz.release-archive/1`, Phase 55) INDEXES the governance bundle plus the related records into ONE
 * content-free manifest a periodic review keeps as its record.
 *
 * This phase closes the *restore* loop. An archive pack is only worth keeping if it can be RESTORED and TRUSTED
 * when an operator needs it — after cold storage, a retention move, or an incident. So this rung is an offline
 * **restore drill**: it INGESTS a `pdfxyz.release-archive/1` pack (the PRIMARY anchor — the archive record being
 * drilled), RE-VALIDATES the pack against ITSELF (re-deriving its Phase-55 rollup + coverage from its own reduced
 * records, so a hand-flipped archive posture is caught as a tamper), and — for each underlying evidence record an
 * operator RESTORED alongside the pack (the `pdfxyz.release-governance/1` / `pdfxyz.release-trend/1` /
 * `pdfxyz.release-report/1` / `pdfxyz.release-audit/1` / `pdfxyz.release-ci-bundle/1` the pack indexed) — proves
 * the restore is intact by RE-VALIDATING each restored record against ITSELF (reusing the Phase 50–54 boundaries)
 * AND CROSS-CHECKING its re-derived posture against what the archive pack RECORDED for that record. A restored
 * record whose posture no longer matches the archive's record is a RESTORE INTEGRITY failure (the restored bytes
 * are not the ones that were archived, or the pack was tampered); a restored record that no longer re-derives is
 * corrupt. It folds them into ONE stable, content-free `pdfxyz.release-restore-drill/1` receipt an operator reads
 * before relying on the archive —
 *
 *    "Can this archived release-evidence pack be restored and trusted — does the pack still re-derive, and do the
 *     records it indexed still restore intact and match what was archived?"
 *
 * — with a bounded drill verdict, a bounded reason set, a per-record restore check, a bounded follow-up
 * assignment list, and (for each supplied input) a canonical content digest an operator can compare across drills
 * or against their own store. It FAILS CLOSED when the pack cannot be trusted, when a restored record does not
 * match, or when the drill exercised no restore at all.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it
 * drills:
 *  - Every load-bearing token here is a bounded enum — a record id, a coverage state, a restore-check state, a
 *    drill verdict, a severity, a reason id, a follow-up id — never a filename, path, object key, bucket, URL,
 *    endpoint, region, id, token, size, byte, raw ref, raw label, commit URL, or record content. The only
 *    non-enum values are small integer counts, an ISO stamp, an opaque lowercase-hex sha256 digest (over safe
 *    canonical content-free data), and app-authored prose.
 *  - It never copies a free-text field out of an ingested record (the pack and every restored record — even one
 *    Phase 50–55 produced — is UNTRUSTED input here); it reduces every fact to a bounded enum, a small integer,
 *    a boolean, or an opaque digest, and it never echoes an ingested record's OWN stamp or an input file path,
 *    even on an error.
 *  - It never fabricates a `restore-verified`. That REQUIRES a usable archive pack whose OWN posture is
 *    `archivable`, every supplied restored record intact AND matching the archive's record, and at least one
 *    restore actually exercised (a drill that restored nothing proves no restorability — that is honestly
 *    `restore-incomplete`, unless `--archive-only` scopes the drill to the manifest). A tampered pack, a blocked
 *    archive, a restored record that mismatches / is corrupt, an unreadable pack, or an insufficient drill is
 *    fail-closed.
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage retrieval, NOT a cloud / bucket read,
 * NOT a deployment or promotion, and NOT an unzip / copy of raw files: it does not fetch anything from cold
 * storage — the operator restores the files out of band and hands them here. It PROVES nothing the composed
 * records do not already prove; it RE-VALIDATES that a restored archive record and its underlying evidence are
 * self-consistent and mutually coherent, and rolls them up into one restore posture + follow-up checklist. Its
 * authored caveats (see {@link RELEASE_RESTORE_DRILL_CAVEATS}) say so out loud.
 */

import {
  RELEASE_ARCHIVE_SCHEMA,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_TREND_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
  type ReleaseArchivePosture,
  type ReleaseArchiveRecordState,
} from "../release-archive/types";

export {
  RELEASE_ARCHIVE_SCHEMA,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_TREND_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
};
export type { ReleaseArchivePosture, ReleaseArchiveRecordState };

/** The schema tag every restore-drill result carries, so tooling can pin the shape it parses. */
export const RELEASE_RESTORE_DRILL_SCHEMA = "pdfxyz.release-restore-drill/1" as const;

/** Stable identity of the restore drill — for docs / receipts / audit. */
export const RELEASE_RESTORE_DRILL_POLICY_ID = "pdfxyz-worker-release-restore-drill";
/** Bump when the surface, the verdict ladder, the reason/follow-up sets, or the schema changes. */
export const RELEASE_RESTORE_DRILL_POLICY_VERSION = 1;

/**
 * The five underlying evidence records an archive pack indexed — the record classes a restore drill can exercise
 * restoring, in canonical order (the SAME classes {@link import("../release-archive/types").RELEASE_ARCHIVE_RECORD_IDS}
 * the pack keeps). Each is an OPTIONAL restored input to the drill (`--governance` / `--trend` / `--report` /
 * `--audit` / `--bundle`); the archive pack itself is the required anchor, not one of these.
 */
export const RELEASE_RESTORE_DRILL_RECORD_IDS = ["governance", "trend", "report", "audit", "bundle"] as const;
export type ReleaseRestoreDrillRecordId = (typeof RELEASE_RESTORE_DRILL_RECORD_IDS)[number];

/** The digest slots the receipt records — the archive anchor plus each restored record class. */
export const RELEASE_RESTORE_DRILL_DIGEST_IDS = ["archive", ...RELEASE_RESTORE_DRILL_RECORD_IDS] as const;
export type ReleaseRestoreDrillDigestId = (typeof RELEASE_RESTORE_DRILL_DIGEST_IDS)[number];

/**
 * The bounded coverage state of the PRIMARY archive pack anchor:
 *  - `absent`     — no `--archive` was supplied (a CLI misuse the parser rejects; never reached at run);
 *  - `unreadable` — an archive file was supplied but could not be read / parsed / recognized (never echoed);
 *  - `tampered`   — the pack was recognized but its recorded rollup / coverage does NOT re-derive from its own
 *                   reduced records (a hand-edited / corrupt pack — a blocking failure);
 *  - `usable`     — recognized AND self-consistent (its recorded rollup re-derives): a trustworthy anchor.
 */
export const RELEASE_RESTORE_DRILL_ARCHIVE_STATES = ["absent", "unreadable", "tampered", "usable"] as const;
export type ReleaseRestoreDrillArchiveState = (typeof RELEASE_RESTORE_DRILL_ARCHIVE_STATES)[number];

/**
 * The bounded restore-check state of ONE underlying record — the drill's core per-record signal, comparing what
 * the operator RESTORED against what the archive pack RECORDED:
 *  - `absent`             — the archive kept no usable record of this class and none was restored (nothing to
 *                           drill; neutral);
 *  - `not-restored`       — the archive kept a usable record of this class but none was restored (the drill did
 *                           not exercise restoring it; advisory — or, under `--require-full-restore`, insufficient);
 *  - `restored-match`     — a restored record was supplied, re-derives self-consistently, AND its posture matches
 *                           what the archive recorded: the restore is verified for this class (ready);
 *  - `restored-mismatch`  — a restored record re-derives, but its posture DIFFERS from the archive's record: a
 *                           RESTORE INTEGRITY failure (the restored evidence is not the archived evidence, or the
 *                           pack was tampered) (blocking);
 *  - `restored-unexpected`— a restored record re-derives, but the archive did NOT keep a usable record of this
 *                           class (an extra / out-of-band restore to reconcile) (advisory);
 *  - `restored-unreadable`— a restored file was supplied but could not be read / recognized (insufficient);
 *  - `restored-tampered`  — a restored file was recognized but no longer re-derives (a corrupt restore) (blocking).
 */
export const RELEASE_RESTORE_CHECK_STATES = [
  "absent",
  "not-restored",
  "restored-match",
  "restored-mismatch",
  "restored-unexpected",
  "restored-unreadable",
  "restored-tampered",
] as const;
export type ReleaseRestoreCheckState = (typeof RELEASE_RESTORE_CHECK_STATES)[number];

/**
 * The single drill verdict a review / CI keys on — the answer to "can this archived pack be restored and
 * trusted?":
 *  - `restore-verified`   — the archive pack is usable and `archivable`, every supplied restored record is intact
 *                           AND matches the archive's record, and at least one restore was exercised (or the drill
 *                           was scoped to the manifest with `--archive-only`). The restore drill passed;
 *  - `restore-drift`      — no blocker and the evidence is sufficient, but an ADVISORY concern was raised (an
 *                           `archive-watch` pack, or an unexpected out-of-band restored record): trust with review;
 *  - `restore-incomplete` — the evidence is INSUFFICIENT to certify the restore: the pack is unreadable /
 *                           `archive-incomplete`, a restored record was unreadable, a required record was not
 *                           restored (`--require-full-restore`), or NO restore was exercised at all;
 *  - `restore-failed`     — a BLOCKING issue: the pack is tampered, the archive is `archive-blocked`, or a restored
 *                           record mismatches / is corrupt. Do not rely on this archive until it is resolved.
 *
 * These are the exact bounded values the run-level `worker_release_restore_drill_total` metric carries as its
 * `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_RESTORE_DRILL_VERDICTS = [
  "restore-verified",
  "restore-drift",
  "restore-incomplete",
  "restore-failed",
] as const;
export type ReleaseRestoreDrillVerdict = (typeof RELEASE_RESTORE_DRILL_VERDICTS)[number];

/**
 * The exit-code ladder a CI / review job routes on — the same shape as the whole release-evidence suite so the
 * tools speak one language:
 *  - `0` VERIFIED   — the restore drill passed (a usable archivable pack + every restored record matched + a
 *                     restore exercised);
 *  - `1` USAGE      — the CLI was misused (a bad flag, no `--archive`, two stdin inputs, or an unwritable output).
 *                     CLI-owned; a drill RUN never resolves to it;
 *  - `2` INCOMPLETE — the drill was insufficient (an unreadable / incomplete pack, an unreadable restored record,
 *                     a required-but-not-restored record, or no restore exercised);
 *  - `3` DRIFT      — an advisory posture (a watch pack, or an unexpected out-of-band restored record);
 *  - `4` FAILED     — a blocking posture (a tampered pack, a blocked archive, a restored mismatch, or a corrupt
 *                     restore).
 * Monotonic — a higher code is always a stronger "do not rely on this restored archive".
 */
export const RELEASE_RESTORE_DRILL_EXIT = {
  VERIFIED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  DRIFT: 3,
  FAILED: 4,
} as const;
export type ReleaseRestoreDrillExitCode =
  (typeof RELEASE_RESTORE_DRILL_EXIT)[keyof typeof RELEASE_RESTORE_DRILL_EXIT];

/**
 * The common **severity** each anchor state, each restore-check state, and each fired reason maps onto so the
 * drill can fold the archive posture + the five per-record checks into one verdict:
 *  - `ready`        — a matched restore or a clean anchor (best);
 *  - `advisory`     — a watch pack, an unexpected out-of-band restore, or an un-exercised class;
 *  - `insufficient` — an unreadable pack / record, an incomplete archive, a missing required restore, or an
 *                     un-exercised drill;
 *  - `blocking`     — a tampered pack, a blocked archive, a restore mismatch, or a corrupt restore (worst).
 *
 * Precedence when folding is `blocking > insufficient > advisory > ready` (checked in that order, exactly like
 * the Phase 50/52/53/54/55 rollups).
 */
export const RELEASE_RESTORE_DRILL_SEVERITIES = ["ready", "advisory", "insufficient", "blocking"] as const;
export type ReleaseRestoreDrillSeverity = (typeof RELEASE_RESTORE_DRILL_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence. */
export const RELEASE_RESTORE_DRILL_SEVERITY_RANK: Record<ReleaseRestoreDrillSeverity, number> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
};

/**
 * The bounded reason ids — the closed set of REASONS the drill verdict resolved as it did, emitted in this stable
 * order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The
 * per-record class is carried by the per-record restore check, so these reasons are GENERIC over the record set:
 *
 * Blocking:
 *  - `archive-tampered`           — the archive pack is recognized but its rollup does NOT re-derive (a tamper);
 *  - `archive-blocked`            — a usable pack's own posture is `archive-blocked`;
 *  - `restore-mismatch`           — a restored record re-derives but its posture DIFFERS from the archive record;
 *  - `restore-corrupt`            — a restored record was recognized but no longer re-derives (a corrupt restore).
 *
 * Insufficient:
 *  - `archive-unreadable`         — the supplied archive could not be read / recognized as a `pdfxyz.release-archive/1`;
 *  - `archive-incomplete`         — a usable pack's own posture is `archive-incomplete`;
 *  - `restore-unreadable`         — a supplied restored record could not be read / recognized;
 *  - `restore-coverage-incomplete`— `--require-full-restore` was set but a usable archived record was not restored;
 *  - `restore-not-exercised`      — the pack is usable but NO restored record was supplied (and not `--archive-only`).
 *
 * Advisory:
 *  - `archive-watch`              — a usable pack's own posture is `archive-watch`;
 *  - `restore-unexpected`         — a restored record re-derives but the archive kept no usable record of its class.
 */
export const RELEASE_RESTORE_DRILL_REASON_IDS = [
  // Blocking
  "archive-tampered",
  "archive-blocked",
  "restore-mismatch",
  "restore-corrupt",
  // Insufficient
  "archive-unreadable",
  "archive-incomplete",
  "restore-unreadable",
  "restore-coverage-incomplete",
  "restore-not-exercised",
  // Advisory
  "archive-watch",
  "restore-unexpected",
] as const;
export type ReleaseRestoreDrillReasonId = (typeof RELEASE_RESTORE_DRILL_REASON_IDS)[number];

/**
 * The bounded follow-up assignment ids — the closed set of concrete operator steps the drill can assign, in this
 * canonical order (deduped):
 *  - `investigate-failed-restore` — investigate the blocking restore issue (a blocked archive, a restore mismatch,
 *                                   or a corrupt restore) before relying on the archive;
 *  - `recover-tampered-evidence`  — recover the untampered pack / record from a second copy; a tampered / corrupt
 *                                   record cannot anchor a restore;
 *  - `refresh-archive`            — the archive pack is unreadable / incomplete; regenerate `worker:release-archive`
 *                                   over the current governance record and re-run the drill;
 *  - `reconcile-restore-mismatch` — a restored record's posture differs from the archive's record (a stale / wrong
 *                                   restore, or an out-of-band record); reconcile them before relying on the archive;
 *  - `exercise-restore-drill`     — supply the restored underlying records so the drill actually proves
 *                                   restorability (or scope it with `--archive-only` to re-validate only the pack);
 *  - `review-restore-drift`       — review the advisory concern and record the decision;
 *  - `continue-restore-cadence`   — the restore is verified; keep drilling the archive on the review / DR cadence;
 *  - `record-restore-receipt`     — keep this restore-drill receipt alongside the archive as the DR evidence.
 */
export const RELEASE_RESTORE_DRILL_FOLLOWUP_IDS = [
  "investigate-failed-restore",
  "recover-tampered-evidence",
  "refresh-archive",
  "reconcile-restore-mismatch",
  "exercise-restore-drill",
  "review-restore-drift",
  "continue-restore-cadence",
  "record-restore-receipt",
] as const;
export type ReleaseRestoreDrillFollowupId = (typeof RELEASE_RESTORE_DRILL_FOLLOWUP_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Reduced archive anchor + per-record facts
 * ------------------------------------------------------------------ */

/** The archive pack's OWN recorded posture for one underlying record class (the cross-check target). */
export interface RestoreArchiveRecordPosture {
  readonly id: ReleaseRestoreDrillRecordId;
  /** The archive's recorded coverage state for this record class. */
  readonly state: ReleaseArchiveRecordState;
  /** The archive's recorded posture token for this record class (usable-only; else its untrusted claim / null). */
  readonly verdict: string | null;
}

/**
 * The bounded facts reduced from a usable `pdfxyz.release-archive/1` pack (its rollup re-derived in ingest).
 * Beyond the archive posture + counts, it surfaces the pack's OWN recorded per-record postures — so the drill can
 * CROSS-CHECK each separately-restored record against them.
 */
export interface RestoreArchiveFacts {
  /** The archive pack's own posture (trusted — the pack re-derived its own rollup). */
  readonly posture: ReleaseArchivePosture;
  /** The archive pack's own exit code (context; the drill has its own). */
  readonly exitCode: number;
  /** True iff `posture === "archivable"`. */
  readonly archivable: boolean;
  /** How many of the pack's five records were supplied (0–5). */
  readonly recordsSupplied: number;
  /** How many of the pack's five records were usable (0–5). */
  readonly recordsUsable: number;
  /** How many blocking reasons the pack itself carried. */
  readonly blocking: number;
  /** How many insufficiency reasons the pack itself carried. */
  readonly insufficiencies: number;
  /** How many advisory reasons the pack itself carried. */
  readonly advisories: number;
  /** The pack's own recorded per-record postures, in canonical order (for the restore cross-check). */
  readonly records: readonly RestoreArchiveRecordPosture[];
}

/** The bounded reduced archive anchor the drill folds. */
export interface ReleaseRestoreDrillArchive {
  /** The anchor's coverage state. */
  readonly state: ReleaseRestoreDrillArchiveState;
  /** True iff a `--archive` file was supplied. */
  readonly supplied: boolean;
  /** True iff the parsed input carried the `pdfxyz.release-archive/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded rollup re-derives). */
  readonly usable: boolean;
  /** The pack's own posture token (trusted only when usable; else the untrusted claim / null). */
  readonly posture: ReleaseArchivePosture | null;
  /** The anchor's contribution on the common severity ladder, or `null` when not supplied. */
  readonly severity: ReleaseRestoreDrillSeverity | null;
  /** A one-line, content-free headline. */
  readonly detail: string;
  /** The reduced bounded facts (present only when usable; `null` otherwise). */
  readonly facts: RestoreArchiveFacts | null;
}

/** One reduced restored record — the per-record restore check. Every field is bounded / a small int / a boolean / a digest. */
export interface ReleaseRestoreDrillRecord {
  readonly id: ReleaseRestoreDrillRecordId;
  /** The restore-check state (the drill's core per-record signal). */
  readonly restoreState: ReleaseRestoreCheckState;
  /** True iff a restored file was supplied for this record class. */
  readonly supplied: boolean;
  /** True iff the restored input carried the expected record schema tag. */
  readonly recognized: boolean;
  /** True iff the restored record re-derives self-consistently. */
  readonly usable: boolean;
  /** The restored record's re-derived posture token (usable-only; else null). Never the raw claim of a tampered file. */
  readonly restoredVerdict: string | null;
  /** The archive pack's recorded coverage state for this record class (the cross-check baseline). */
  readonly archivedState: ReleaseArchiveRecordState;
  /** The archive pack's recorded posture token for this record class (usable-only; else null). */
  readonly archivedVerdict: string | null;
  /** The record's contribution on the common severity ladder, or `null` when neutral. */
  readonly severity: ReleaseRestoreDrillSeverity | null;
  /** An opaque lowercase-hex sha256 of the restored record's canonical content, or `null` when not supplied / not hashed. */
  readonly digest: string | null;
  /** A one-line, content-free headline authored from the record id + restore-check state. */
  readonly detail: string;
}

/** The bounded coverage summary — what the drill exercised. */
export interface ReleaseRestoreDrillCoverage {
  /** The archive anchor's coverage state. */
  readonly archive: ReleaseRestoreDrillArchiveState;
  /** How many usable records the archive pack kept (0–5). */
  readonly archivedUsable: number;
  /** How many underlying records were restored (supplied to the drill) (0–5). */
  readonly recordsRestored: number;
  /** How many restored records MATCHED the archive record (0–5). */
  readonly recordsMatched: number;
  /** How many restored records MISMATCHED / were corrupt / unreadable (0–5). */
  readonly recordsFailed: number;
  /** How many usable archived records were NOT restored (0–5). */
  readonly recordsNotRestored: number;
  /** True iff a usable archive pack anchored the drill. */
  readonly hasArchive: boolean;
  /** True iff at least one restore was exercised (a restored record supplied). */
  readonly exercised: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseRestoreDrillPolicy {
  /** True iff `--archive-only` was set (scope the drill to the manifest; a restore need not be exercised). */
  readonly archiveOnly: boolean;
  /** True iff `--require-full-restore` was set (every usable archived record must be restored + matched). */
  readonly requireFullRestore: boolean;
  /** True iff `--strict-drift` was set (escalate an advisory-only posture to `restore-failed`). */
  readonly strictDrift: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseRestoreDrillReason {
  readonly id: ReleaseRestoreDrillReasonId;
  readonly severity: ReleaseRestoreDrillSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One follow-up assignment, with its authored detail. */
export interface ReleaseRestoreDrillFollowup {
  readonly id: ReleaseRestoreDrillFollowupId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite drill decision — the single verdict + exit code an operator acts on. */
export interface ReleaseRestoreDrillRollup {
  readonly verdict: ReleaseRestoreDrillVerdict;
  readonly exitCode: ReleaseRestoreDrillExitCode;
  /** True iff `verdict === "restore-verified"`. */
  readonly verified: boolean;
  /** The fired reason ids, in canonical order (empty on a clean verified drill). */
  readonly reasons: readonly ReleaseRestoreDrillReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--archive-only` was applied. */
  readonly archiveOnly: boolean;
  /** True iff `--require-full-restore` was applied. */
  readonly requireFullRestore: boolean;
  /** True iff `--strict-drift` was applied. */
  readonly strictDrift: boolean;
  /** True iff `--strict-drift` ESCALATED an advisory-only posture to `restore-failed` (would have been `restore-drift`). */
  readonly strictDriftEscalated: boolean;
  readonly detail: string;
}

/** The opaque content digests recorded for the anchor + each restored record (or `null` when not supplied / hashed). */
export interface ReleaseRestoreDrillDigests {
  readonly algorithm: "sha256" | "none";
  readonly canonicalization: "pdfxyz-sorted-keys/1";
  readonly archive: string | null;
  readonly governance: string | null;
  readonly trend: string | null;
  readonly report: string | null;
  readonly audit: string | null;
  readonly bundle: string | null;
}

/** The stable identity block the result records (with the pinned upstream schemas). */
export interface ReleaseRestoreDrillMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_RESTORE_DRILL_POLICY_ID;
  readonly policyVersion: typeof RELEASE_RESTORE_DRILL_POLICY_VERSION;
  readonly archiveSchema: typeof RELEASE_ARCHIVE_SCHEMA;
  readonly governanceSchema: typeof RELEASE_GOVERNANCE_SCHEMA;
  readonly trendSchema: typeof RELEASE_TREND_SCHEMA;
  readonly reportSchema: typeof RELEASE_REPORT_SCHEMA;
  readonly auditSchema: typeof RELEASE_AUDIT_SCHEMA;
  readonly bundleSchema: typeof RELEASE_CI_BUNDLE_SCHEMA;
}

/**
 * The stable, content-free release evidence restore-drill receipt an operator keeps as DR evidence. Every field
 * is a bounded enum, a small integer, an ISO stamp, an opaque digest, or app-authored prose — so it carries no
 * locator, identifier, size, path, or byte, even from a hostile input, and never echoes an ingested record's own
 * stamp.
 */
export interface ReleaseRestoreDrillResult {
  readonly schema: typeof RELEASE_RESTORE_DRILL_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseRestoreDrillMetadata;
  readonly policy: ReleaseRestoreDrillPolicy;
  readonly coverage: ReleaseRestoreDrillCoverage;
  /** The reduced archive anchor. */
  readonly archive: ReleaseRestoreDrillArchive;
  /** One reduced restore check per record, in canonical {@link RELEASE_RESTORE_DRILL_RECORD_IDS} order. */
  readonly records: readonly ReleaseRestoreDrillRecord[];
  readonly drill: ReleaseRestoreDrillRollup;
  /** Every fired reason, in canonical {@link RELEASE_RESTORE_DRILL_REASON_IDS} order. */
  readonly reasons: readonly ReleaseRestoreDrillReason[];
  /** The opaque content digests of the drilled inputs (safe hex; for cross-drill / cross-store comparison). */
  readonly digests: ReleaseRestoreDrillDigests;
  /** The bounded, ordered follow-up assignment checklist. Never derived from an input. */
  readonly followUps: readonly ReleaseRestoreDrillFollowup[];
  /** Bounded, app-authored guidance (out-of-scope steps this drill does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseRestoreDrillReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this
 * restore drill conclude, over how many restored records, with how many blocking / insufficiency / advisory
 * reasons" for a SIEM / DR record. Bounded enums + small integers + a stable policy id + the run's own stamp +
 * the anchor digest only; safe to log or forward verbatim.
 */
export interface ReleaseRestoreDrillReceipt {
  readonly category: "worker-release-restore-drill";
  readonly policyId: typeof RELEASE_RESTORE_DRILL_POLICY_ID;
  readonly policyVersion: typeof RELEASE_RESTORE_DRILL_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseRestoreDrillVerdict;
  readonly exitCode: ReleaseRestoreDrillExitCode;
  readonly archiveState: ReleaseRestoreDrillArchiveState;
  /** True iff a usable archive pack anchored the drill. */
  readonly hasArchive: boolean;
  /** How many underlying records were restored. */
  readonly recordsRestored: number;
  /** How many restored records matched the archive record. */
  readonly recordsMatched: number;
  /** How many restored records failed (mismatch / corrupt / unreadable). */
  readonly recordsFailed: number;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly archiveOnly: boolean;
  readonly requireFullRestore: boolean;
  readonly strictDrift: boolean;
  /** The opaque anchor digest (sha256 hex), or `null` when not hashed. */
  readonly archiveDigest: string | null;
}

/** The process exit code for a drill result. */
export function releaseRestoreDrillExitCode(result: ReleaseRestoreDrillResult): number {
  return result.drill.exitCode;
}

/** The authoritative verdict → exit code map. */
export const RELEASE_RESTORE_DRILL_EXIT_FOR_VERDICT: Record<ReleaseRestoreDrillVerdict, ReleaseRestoreDrillExitCode> = {
  "restore-verified": RELEASE_RESTORE_DRILL_EXIT.VERIFIED,
  "restore-drift": RELEASE_RESTORE_DRILL_EXIT.DRIFT,
  "restore-incomplete": RELEASE_RESTORE_DRILL_EXIT.INCOMPLETE,
  "restore-failed": RELEASE_RESTORE_DRILL_EXIT.FAILED,
};

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_RESTORE_DRILL_VERDICT_SUMMARY: Record<ReleaseRestoreDrillVerdict, string> = {
  "restore-verified":
    "RESTORE-VERIFIED: the archive pack re-derives and is ARCHIVABLE, every supplied restored record is intact and matches the archive's record, and a restore was exercised. This archived release evidence can be restored and trusted. This drill fetched nothing — the operator restored the files out of band; it only re-validated them.",
  "restore-drift":
    "RESTORE-DRIFT (advisory): no blocker and the restore is sufficient, but an ADVISORY concern was raised — the archive pack's own posture is a WATCH, or a restored record was not indexed by the archive (an out-of-band restore to reconcile). Trust the restore, but review the flagged concern.",
  "restore-incomplete":
    "RESTORE-INCOMPLETE (insufficient): the restore drill could not be certified — the archive pack is unreadable / INCOMPLETE, a supplied restored record was unreadable, a required record was not restored, or NO restore was exercised at all. This is a setup / coverage problem, not a proven restore.",
  "restore-failed":
    "RESTORE-FAILED: a BLOCKING issue — the archive pack is TAMPERED, its own posture is BLOCKED, a restored record's posture DOES NOT MATCH the archive's record (a restore integrity failure), or a restored record is CORRUPT. Do not rely on this archived evidence until the failure or tamper is resolved.",
};

/**
 * The dedicated headline for a `restore-failed` drill produced ONLY because `--strict-drift` escalated an
 * advisory-only posture. Authored; selected by the rollup when `strictDriftEscalated`.
 */
export const RELEASE_RESTORE_DRILL_STRICT_DRIFT_ESCALATED_SUMMARY =
  "RESTORE-FAILED (--strict-drift): the only concern was ADVISORY (a watch archive pack, or an out-of-band restored record the archive did not index), which `--strict-drift` escalates to a blocking restore hold. Without `--strict-drift` this would be RESTORE-DRIFT, exit 3. No tampered pack, blocked archive, restore mismatch, or corrupt restore was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_RESTORE_DRILL_REASON_DETAIL: Record<
  ReleaseRestoreDrillReasonId,
  { readonly severity: ReleaseRestoreDrillSeverity; readonly detail: string }
> = {
  "archive-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-archive/1` pack is recognized but its recorded posture / coverage does NOT re-derive from its own reduced records — a hand-edited or corrupt pack. Recover the untampered pack from a second copy; a tampered pack cannot anchor a restore.",
  },
  "archive-blocked": {
    severity: "blocking",
    detail:
      "The archive pack's OWN posture is ARCHIVE-BLOCKED: the record it archives contains a blocking issue (a tampered / blocked / failing / regressed underlying record). The restore is intact, but the archived evidence itself is not clean — resolve the blocking archive issue before relying on it.",
  },
  "restore-mismatch": {
    severity: "blocking",
    detail:
      "A restored record re-derives self-consistently but its posture DIFFERS from what the archive pack recorded for that record class: the restored evidence is not the evidence that was archived, or the pack was tampered. Recover the correct record (or regenerate the archive over the current records) before relying on the restore.",
  },
  "restore-corrupt": {
    severity: "blocking",
    detail:
      "A restored record was recognized as its schema but no longer re-derives from its own bounded facts — a corrupt restore (bit rot, a truncated copy, or a hand-edit). Recover the untampered record from a second copy and re-run the drill.",
  },
  "archive-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied archive pack could not be read / recognized as a `pdfxyz.release-archive/1` (wrong schema or unparseable — never echoed), so there is no anchor to drill. Supply a readable pack produced by `worker:release-archive` and re-run.",
  },
  "archive-incomplete": {
    severity: "insufficient",
    detail:
      "The archive pack's OWN posture is ARCHIVE-INCOMPLETE: the record it archives had insufficient evidence (an absent / unreadable / incomplete governance, or a missing required record). The restore cannot be certified over an incomplete record — regenerate the archive over a complete governance record and re-run.",
  },
  "restore-unreadable": {
    severity: "insufficient",
    detail:
      "A supplied restored record could not be read / recognized as its expected schema (never echoed), so the drill could not verify it against the archive record. Supply the correct readable record and re-run.",
  },
  "restore-coverage-incomplete": {
    severity: "insufficient",
    detail:
      "`--require-full-restore` was set but at least one record the archive pack kept as usable was NOT restored, so the drill did not exercise a full restore. Restore every underlying record the pack indexed and re-run, or drop `--require-full-restore` for a spot-check drill.",
  },
  "restore-not-exercised": {
    severity: "insufficient",
    detail:
      "The archive pack is usable, but NO underlying record was restored, so the drill proved nothing about restorability — only that the manifest re-derives. Restore the underlying records (`--governance` / `--trend` / `--report` / `--audit` / `--bundle`) and re-run, or pass `--archive-only` to scope the drill to the pack's own integrity.",
  },
  "archive-watch": {
    severity: "advisory",
    detail:
      "The archive pack's OWN posture is ARCHIVE-WATCH: no blocker, but the archived record carried an advisory concern. The restore is intact; review the flagged concern in the archive, then rely on it with the decision recorded.",
  },
  "restore-unexpected": {
    severity: "advisory",
    detail:
      "A restored record re-derives, but the archive pack kept NO usable record of that class: you restored a record the archive did not index (an out-of-band record, or a class the pack did not keep). Reconcile the restore set with the archive record so the DR evidence is consistent.",
  },
};

/** Per-follow-up authored detail, keyed by id. */
export const RELEASE_RESTORE_DRILL_FOLLOWUP_DETAIL: Record<ReleaseRestoreDrillFollowupId, string> = {
  "investigate-failed-restore":
    "Investigate the blocking restore issue (a blocked archive pack, a restored record that mismatches the archive record, or a corrupt restore) and resolve it before relying on the archived evidence; recover the untampered records from a second copy if needed.",
  "recover-tampered-evidence":
    "Recover the untampered pack / record from a second copy: a recorded posture / rollup that no longer re-derives means the file was hand-edited or corrupted, and cannot anchor a restore.",
  "refresh-archive":
    "Regenerate the release archive pack with `worker:release-archive` over the current governance record (plus the related trend / report / audit / CI bundle) and re-run this drill: an unreadable / incomplete pack cannot anchor a restore.",
  "reconcile-restore-mismatch":
    "A restored record's posture differs from what the archive pack recorded (a stale / wrong restore, or an out-of-band record). Confirm you restored the record that was archived — or regenerate the archive over the current records — so the restore drill is internally consistent, then re-run.",
  "exercise-restore-drill":
    "Restore the underlying records the archive pack indexed (`--governance` / `--trend` / `--report` / `--audit` / `--bundle`) from your archive store and hand them to the drill so it can prove restorability — or pass `--archive-only` to scope the drill to the pack's own integrity when a full restore is not intended.",
  "review-restore-drift":
    "Review the advisory restore concern (a watch archive pack, or an out-of-band restored record the archive did not index) and decide whether follow-up is warranted; keep this receipt as the record of that decision.",
  "continue-restore-cadence":
    "The restore is verified: keep drilling the archived release evidence on your review / disaster-recovery cadence (restore the pack + its records and re-run this drill), so a silent bit-rot or a broken archive store is caught before an operator needs the evidence.",
  "record-restore-receipt":
    "Keep this restore-drill receipt (and the anchor digest) alongside the archive pack as the disaster-recovery evidence for this window: it records that the archived evidence was restored and re-validated on this host. This drill uploads, copies, and promotes nothing.",
};

/**
 * The honesty caveats every result carries and every text render prints. The drill RE-VALIDATES a restored
 * archive pack and its underlying evidence and rolls them up into one restore posture; it must never be read as
 * more than that.
 */
export const RELEASE_RESTORE_DRILL_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE RESTORE DRILL: it INGESTS a content-free `pdfxyz.release-archive/1` pack (the PRIMARY anchor) plus, optionally, the underlying `pdfxyz.release-governance/1` / `pdfxyz.release-trend/1` / `pdfxyz.release-report/1` / `pdfxyz.release-audit/1` / `pdfxyz.release-ci-bundle/1` records an operator RESTORED out of band, RE-VALIDATES each against ITSELF, CROSS-CHECKS each restored record against the pack's OWN recorded posture, and folds them into ONE bounded restore posture + follow-up checklist. It is local content-free RESTORE VERIFICATION over evidence summaries — NOT storage retrieval, a cloud / bucket read, signing, authentication, cloud validation, deployment approval, deployment promotion, or an unzip / copy of raw files.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, FETCHES nothing from cold storage (the operator restores the files out of band and hands them here), RUNS no gate / bundle / audit / report / trend / governance / archive itself, and NEVER deletes, prunes, uploads, zips, tars, copies, promotes, approves, or mutates any record, pack, artifact, object, or deployment. A `restore-verified` drill authorizes nothing; it only reports that the content-free evidence restored on THIS host was self-consistent and coherent with the archive record.",
  "A `restore-verified` drill REQUIRES a usable archive pack whose own posture is `archivable`, every supplied restored record intact AND matching the pack's record, and at least one restore actually exercised (or `--archive-only` to scope the drill to the manifest). A drill that restored nothing proves no restorability — it is honestly `restore-incomplete`, never a fabricated verified. It FAILS CLOSED: a tampered pack, a blocked archive, a restored mismatch / corrupt record blocks the drill; an unreadable pack, an incomplete archive, or an un-exercised drill is insufficient.",
  "It re-derives the pack's rollup from the pack's OWN reduced records (reusing the Phase 55 reducer) and each restored record's rollup from its OWN recorded facts (reusing the Phase 50–54 reducers), and treats a recorded posture / verdict that does not re-derive as a TAMPER, and a restored posture that disagrees with the pack's record as a RESTORE MISMATCH. This re-derivation + cross-check is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity.",
  "The recorded digests are content-free canonical sha256 fingerprints of the exact restored bytes (safe hex over bounded, content-free data), useful for comparing one restore against another or against your own store's record; they are NOT signatures, and the archive pack records no digest to compare against, so integrity here is proven by the semantic re-derivation + cross-check, not by matching a stored hash.",
  "It emits only bounded enums, small counts, an ISO stamp, opaque hex digests, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, commit URL, size, byte, or record content, even from a hostile input; it never echoes an ingested record's own stamp, and it never echoes an input file path, even on an error.",
];

/**
 * Out-of-band reminders the drill carries but does NOT itself perform — the honest edges of an offline verifier.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_RESTORE_DRILL_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED disaster-recovery / review drill (weekly / monthly), NOT a per-release gate: RESTORE the archived pack (and, ideally, the underlying records it indexed) from your archive store to a scratch dir, hand the pack here with `--archive` and each restored record with `--governance` / `--trend` / `--report` / `--audit` / `--bundle`, and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the drill on exit 4 (a tamper / mismatch / blocked archive), surface exit 3 (a drift) for review, and treat exit 2 (insufficient) as a coverage gap, not a proven restore.",
  "Restore the underlying records to prove restorability: re-validating the pack alone (with `--archive-only`) proves the manifest re-derives, but the DRILL's value is CROSS-CHECKING the separately-restored records against the pack — a restored record whose posture no longer matches surfaces a broken archive store or a corrupt copy. Use `--require-full-restore` to require every record the pack kept.",
  "This drill fetches nothing: it does NOT read your archive store, bucket, or object. The operator RESTORES the pack + records out of band (a bucket copy, a tar extract, a git checkout) and hands the files here; the drill only re-validates what it is given. Storage retrieval, retention, immutability, signing, and deployment promotion are operator / CI / storage actions this offline verifier never performs.",
  "Keep the receipt (and the anchor digest) alongside the archive as the DR evidence: it records that the archived release evidence was restored and re-validated on this host on this date — a content-free proof of a successful (or failed) drill, not a substitute for the records it drills nor for your storage-side backup, retention, and restore-testing processes.",
];
