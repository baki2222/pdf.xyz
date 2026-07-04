/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence publish / handoff pack** (Phase 57).
 *
 * Phases 46–56 built the release-evidence chain one rung per phase: the release gate folds the content-free worker
 * checks into ONE promotion verdict; the artifact stamps it with provenance + an integrity digest; the index
 * re-verifies many artifacts into a retention manifest; the policy asserts thresholds; the CI bundle composes a
 * single release job's stages; the audit diffs a baseline vs current bundle; the operator report
 * (`pdfxyz.release-report/1`) folds a bundle + audit into one recommendation; the trend summary
 * (`pdfxyz.release-trend/1`) summarizes a HISTORY of reports; the governance bundle
 * (`pdfxyz.release-governance/1`) composes a trend + latest report / audit for a review window; the archive pack
 * (`pdfxyz.release-archive/1`) indexes the governance bundle + related records for archival; and the restore drill
 * (`pdfxyz.release-restore-drill/1`) proves an archived pack can be restored and re-validated.
 *
 * This phase closes the *external handoff* loop. An operator often has to hand a release-evidence PACKAGE to an
 * EXTERNAL reviewer, an internal approver, an investor / partner, or an incident responder — and needs one
 * bounded, share-safe MANIFEST that says, at a glance, whether the package is safe to share and what to include.
 * This tool INGESTS the already content-free `pdfxyz.release-governance/1` bundle (the PRIMARY summary judgment)
 * plus, optionally, the related `pdfxyz.release-archive/1`, `pdfxyz.release-restore-drill/1`,
 * `pdfxyz.release-report/1`, and/or `pdfxyz.release-trend/1` records, RE-VALIDATES each against ITSELF through the
 * existing Phase 51–56 boundaries (so a hand-flipped verdict / posture / recommendation is caught as a tamper),
 * and folds them into ONE stable, content-free `pdfxyz.release-publish-pack/1` manifest an operator hands off —
 *
 *    "Is this release-evidence package safe to share, with whom, and what bounded evidence should it include?"
 *
 * — with a bounded publish verdict, a DISCLOSURE CLASSIFICATION (share-safe / internal-review / blocked), a
 * per-source posture, a handoff checklist, and honesty caveats, and it FAILS CLOSED when a document cannot be
 * trusted or the primary governance evidence is missing / insufficient.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the documents it
 * composes:
 *  - Every load-bearing token here is a bounded enum — a source id, a coverage state, a publish verdict, a
 *    disclosure classification, a severity, a reason id, a checklist id — never a filename, path, object key,
 *    bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, commit URL, or digest. The only
 *    non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested document (each — even one Phase 51–56 produced — is
 *    UNTRUSTED input here); it reduces every fact to a bounded enum, a small integer, or a boolean, it never
 *    echoes an ingested document's OWN stamp (the pack carries only its own), and it never echoes an input file
 *    path, even on an error.
 *  - It never fabricates a "publishable". A `publishable` (share-safe) pack REQUIRES a usable governance bundle
 *    whose own verdict is `healthy`: the archive / restore-drill / report / trend are point-in-time evidence that
 *    can BLOCK or FLAG the handoff but can never, on their own, GRANT a share-safe pack — so a governance-absent
 *    (or governance-unusable) run is honestly `incomplete` (internal-review), never a share-safe handoff. A
 *    recognized-but-self-inconsistent document (a tamper), a governance `blocked`, a restore drill `restore-failed`,
 *    a hold-fail report, or a failing trend is `blocked` (fail-closed, do NOT share).
 *
 * It is deliberately NOT external publishing, NOT a signature, NOT an approval, NOT legal / compliance sign-off,
 * NOT release promotion, NOT cloud validation, and NOT deletion. It PROVES nothing the composed documents do not
 * already prove; it CLASSIFIES their content-free postures for a handoff, RE-VALIDATES each one's self-consistency,
 * and rolls them up into one publish verdict + disclosure classification + a handoff checklist. Its authored
 * caveats (see {@link RELEASE_PUBLISH_PACK_CAVEATS}) say so out loud: it is local content-free HANDOFF PACKAGING
 * over evidence summaries — it never actually publishes, signs, approves, promotes, validates against a cloud, or
 * deletes anything.
 */

import { RELEASE_ARCHIVE_SCHEMA, type ReleaseArchivePosture } from "../release-archive/types";
import { RELEASE_GOVERNANCE_SCHEMA, type ReleaseGovernanceVerdict } from "../release-governance/types";
import { RELEASE_REPORT_SCHEMA, type ReleaseReportRecommendation } from "../release-report/types";
import {
  RELEASE_RESTORE_DRILL_SCHEMA,
  type ReleaseRestoreDrillVerdict,
} from "../release-restore-drill/types";
import { RELEASE_TREND_SCHEMA, type ReleaseTrendVerdict } from "../release-trend/types";

/** The schema tag every release-publish-pack result carries, so tooling can pin the shape it parses. */
export const RELEASE_PUBLISH_PACK_SCHEMA = "pdfxyz.release-publish-pack/1" as const;

/** The upstream document schemas the pack ingests. Re-exported so the result can pin each input shape. */
export {
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_ARCHIVE_SCHEMA,
  RELEASE_RESTORE_DRILL_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_TREND_SCHEMA,
};

/** Stable identity of the release-publish-pack — for docs / receipts / audit. */
export const RELEASE_PUBLISH_PACK_POLICY_ID = "pdfxyz-worker-release-publish-pack";
/** Bump when the surface, the verdict ladder, the disclosure / reason / checklist sets, or the schema changes. */
export const RELEASE_PUBLISH_PACK_POLICY_VERSION = 1;

/** Re-exported for convenience (the upstream verdict enums the reduced sources surface). */
export type {
  ReleaseGovernanceVerdict,
  ReleaseArchivePosture,
  ReleaseRestoreDrillVerdict,
  ReleaseReportRecommendation,
  ReleaseTrendVerdict,
};

/**
 * The five evidence sources the publish pack composes — the stable keys an operator routes on:
 *  - `governance`    — the `pdfxyz.release-governance/1` bundle (the PRIMARY summary judgment for the review
 *                      window). REQUIRED for a `publishable` pack;
 *  - `archive`       — the `pdfxyz.release-archive/1` pack (proof the evidence was ARCHIVED; a SECONDARY signal
 *                      that can BLOCK / FLAG, never GRANT a share-safe pack on its own);
 *  - `restore-drill` — the `pdfxyz.release-restore-drill/1` (proof the archive is RECOVERABLE; a SECONDARY signal);
 *  - `report`        — the latest `pdfxyz.release-report/1` (this window's point-in-time operator handoff; context);
 *  - `trend`         — the `pdfxyz.release-trend/1` window summary (governance-window context).
 */
export const RELEASE_PUBLISH_PACK_SOURCE_IDS = [
  "governance",
  "archive",
  "restore-drill",
  "report",
  "trend",
] as const;
export type ReleasePublishPackSourceId = (typeof RELEASE_PUBLISH_PACK_SOURCE_IDS)[number];

/**
 * The bounded coverage state of one evidence source:
 *  - `absent`     — no file was supplied for this source (the honest default; never a fault for an optional
 *                   source, but the PRIMARY governance bundle being absent is an insufficiency, resolved by the
 *                   rollup);
 *  - `unreadable` — a file was supplied but could not be read / parsed / recognized (never echoed);
 *  - `tampered`   — the document was recognized but its recorded rollup does NOT re-derive from its own facts
 *                   (a hand-edited / corrupt document — treated as a blocking failure);
 *  - `usable`     — recognized AND self-consistent (its recorded rollup re-derives): trustworthy evidence.
 */
export const RELEASE_PUBLISH_PACK_SOURCE_STATES = ["absent", "unreadable", "tampered", "usable"] as const;
export type ReleasePublishPackSourceState = (typeof RELEASE_PUBLISH_PACK_SOURCE_STATES)[number];

/**
 * The single publish verdict a handoff / CI keys on — the answer to "is this evidence package safe to hand off?":
 *  - `publishable` — the PRIMARY governance bundle is usable and `healthy`, and every supplied source is clean (a
 *                    usable `archivable` archive, a usable `restore-verified` drill, a usable `promote-ready`
 *                    report, a usable `stable` trend): a coherent, share-safe evidence package. Disclosure
 *                    `share-safe`;
 *  - `review`      — no blocker and evidence is sufficient, but an ADVISORY concern was raised (a `watch`
 *                    governance, an `archive-watch` pack, a `restore-drift` drill, a `hold-warning` report, or a
 *                    `warning` trend): share INTERNALLY / with review, not as a clean external bill. Disclosure
 *                    `internal-review`;
 *  - `incomplete`  — the evidence is INSUFFICIENT to certify a handoff: the PRIMARY governance bundle is absent /
 *                    unreadable / `incomplete`, a supplied source was unreadable / indeterminate, or a
 *                    `--require-archive` / `--require-restore-drill` document was missing. Disclosure
 *                    `internal-review` (fail-closed, not a share-safe pack);
 *  - `blocked`     — a BLOCKING issue: a supplied document is recognized but self-inconsistent (a tamper), the
 *                    governance is `blocked`, the restore drill `restore-failed`, the latest report is
 *                    `hold-fail`, or the trend is `failing`. Do NOT share. Disclosure `blocked`. It dominates.
 *
 * These are the exact bounded values the run-level `worker_release_publish_pack_total` metric carries as its
 * `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_PUBLISH_PACK_VERDICTS = ["publishable", "review", "incomplete", "blocked"] as const;
export type ReleasePublishPackVerdict = (typeof RELEASE_PUBLISH_PACK_VERDICTS)[number];

/**
 * The DISCLOSURE CLASSIFICATION — the coarse "who may this package be shared with?" answer, a deliberate
 * coarsening of the publish verdict so a reviewer sees the sharing decision at a glance:
 *  - `share-safe`      — the package is coherent and share-safe: it may be handed to an external reviewer /
 *                        approver / investor / incident responder as the content-free evidence manifest. (⟺ a
 *                        `publishable` verdict.)
 *  - `internal-review` — the package should be shared INTERNALLY / with a reviewer first — it carries an advisory
 *                        concern (`review`) or is missing / inconclusive (`incomplete`); it is NOT a clean
 *                        external bill of health as-is. (⟺ a `review` or `incomplete` verdict.)
 *  - `blocked`         — do NOT share the package: a tamper / failure / block would misrepresent the release's
 *                        posture to whoever receives it. (⟺ a `blocked` verdict.)
 *
 * This is a SHARING classification over content-free evidence, NOT a legal / regulatory data-classification, an
 * NDA, an access grant, or a redaction verdict (the evidence is already content-free by construction).
 */
export const RELEASE_PUBLISH_PACK_DISCLOSURES = ["share-safe", "internal-review", "blocked"] as const;
export type ReleasePublishPackDisclosure = (typeof RELEASE_PUBLISH_PACK_DISCLOSURES)[number];

/** The authoritative verdict → disclosure classification map (a deterministic coarsening). */
export const RELEASE_PUBLISH_PACK_DISCLOSURE_FOR_VERDICT: Record<
  ReleasePublishPackVerdict,
  ReleasePublishPackDisclosure
> = {
  publishable: "share-safe",
  review: "internal-review",
  incomplete: "internal-review",
  blocked: "blocked",
};

/**
 * The exit-code ladder a CI / handoff job routes on — the same shape as the whole release-evidence suite so the
 * tools speak one language:
 *  - `0` PUBLISHABLE — a coherent, share-safe evidence package;
 *  - `1` USAGE       — the CLI was misused (a bad flag, no document supplied, or an unwritable output). CLI-owned;
 *                      a pack RUN never resolves to it;
 *  - `2` INCOMPLETE  — the evidence was insufficient to certify a handoff (an absent / unreadable / incomplete
 *                      governance bundle, an indeterminate source, or a required-but-missing document);
 *  - `3` REVIEW      — an advisory posture (a watch governance, an archive-watch pack, a restore-drift drill, a
 *                      hold-warning report, or a warning trend);
 *  - `4` BLOCKED     — a blocking posture (a tampered document, a blocked governance, a failed restore drill, a
 *                      hold-fail report, or a failing trend).
 * Monotonic — a higher code is always a stronger "do not hand this package off as-is".
 */
export const RELEASE_PUBLISH_PACK_EXIT = {
  PUBLISHABLE: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  REVIEW: 3,
  BLOCKED: 4,
} as const;
export type ReleasePublishPackExitCode =
  (typeof RELEASE_PUBLISH_PACK_EXIT)[keyof typeof RELEASE_PUBLISH_PACK_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_PUBLISH_PACK_EXIT_FOR_VERDICT: Record<
  ReleasePublishPackVerdict,
  ReleasePublishPackExitCode
> = {
  publishable: RELEASE_PUBLISH_PACK_EXIT.PUBLISHABLE,
  review: RELEASE_PUBLISH_PACK_EXIT.REVIEW,
  incomplete: RELEASE_PUBLISH_PACK_EXIT.INCOMPLETE,
  blocked: RELEASE_PUBLISH_PACK_EXIT.BLOCKED,
};

/**
 * The common **severity** each source's native posture, and each fired reason, maps onto so the pack can fold five
 * different ladders (governance `healthy|watch|incomplete|blocked`, archive `archivable|archive-watch|
 * archive-incomplete|archive-blocked`, restore-drill `restore-verified|restore-drift|restore-incomplete|
 * restore-failed`, report `promote-ready|hold-warning|needs-evidence|hold-fail`, trend `stable|warning|unknown|
 * failing`) plus the coverage states into one verdict:
 *  - `ready`        — a usable source at its best posture (best);
 *  - `advisory`     — a usable source carrying an advisory concern, or an advisory reason;
 *  - `insufficient` — an absent primary / unreadable / indeterminate document, or an insufficiency reason;
 *  - `blocking`     — a tampered document, a blocked governance, a failed restore drill, a hold-fail report, or a
 *                     failing trend (worst).
 *
 * Precedence when folding is `blocking > insufficient > advisory > ready` (checked in that order, exactly like the
 * Phase 50/52/53/54/55/56 rollups — so an insufficient posture never masquerades as a mere advisory, and a real
 * blocker is never masked). A source that is not supplied contributes no severity (`null`).
 */
export const RELEASE_PUBLISH_PACK_SEVERITIES = ["ready", "advisory", "insufficient", "blocking"] as const;
export type ReleasePublishPackSeverity = (typeof RELEASE_PUBLISH_PACK_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence. */
export const RELEASE_PUBLISH_PACK_SEVERITY_RANK: Record<ReleasePublishPackSeverity, number> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
};

/** A usable governance bundle's verdict → common publish severity. */
export const GOVERNANCE_SEVERITY: Record<ReleaseGovernanceVerdict, ReleasePublishPackSeverity> = {
  healthy: "ready",
  watch: "advisory",
  incomplete: "insufficient",
  blocked: "blocking",
};

/** A usable archive pack's posture → common publish severity. */
export const ARCHIVE_SEVERITY: Record<ReleaseArchivePosture, ReleasePublishPackSeverity> = {
  archivable: "ready",
  "archive-watch": "advisory",
  "archive-incomplete": "insufficient",
  "archive-blocked": "blocking",
};

/** A usable restore drill's verdict → common publish severity. */
export const RESTORE_DRILL_SEVERITY: Record<ReleaseRestoreDrillVerdict, ReleasePublishPackSeverity> = {
  "restore-verified": "ready",
  "restore-drift": "advisory",
  "restore-incomplete": "insufficient",
  "restore-failed": "blocking",
};

/** A usable report's recommendation → common publish severity. */
export const REPORT_SEVERITY: Record<ReleaseReportRecommendation, ReleasePublishPackSeverity> = {
  "promote-ready": "ready",
  "hold-warning": "advisory",
  "needs-evidence": "insufficient",
  "hold-fail": "blocking",
};

/** A usable trend's verdict → common publish severity. */
export const TREND_SEVERITY: Record<ReleaseTrendVerdict, ReleasePublishPackSeverity> = {
  stable: "ready",
  warning: "advisory",
  unknown: "insufficient",
  failing: "blocking",
};

/**
 * The bounded reason ids — the closed set of REASONS the publish verdict resolved as it did, emitted in this
 * stable order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The
 * per-id severity is authored in {@link RELEASE_PUBLISH_PACK_REASON_DETAIL}:
 *
 * Blocking:
 *  - `governance-tampered`   — the governance bundle is recognized but self-inconsistent (a tamper);
 *  - `governance-blocked`    — a usable governance bundle's verdict is `blocked`;
 *  - `archive-tampered`      — the archive pack is recognized but self-inconsistent (a tamper);
 *  - `archive-blocked`       — a usable archive pack's posture is `archive-blocked`;
 *  - `restore-tampered`      — the restore drill is recognized but self-inconsistent (a tamper);
 *  - `restore-failed`        — a usable restore drill's verdict is `restore-failed`;
 *  - `report-tampered`       — the latest report is recognized but self-inconsistent (a tamper);
 *  - `report-hold-fail`      — a usable latest report is `hold-fail`;
 *  - `trend-tampered`        — the trend is recognized but self-inconsistent (a tamper);
 *  - `trend-failing`         — a usable trend's verdict is `failing`.
 *
 * Insufficient:
 *  - `governance-missing`    — NO governance bundle was supplied, so the PRIMARY posture is unproven;
 *  - `governance-unreadable` — the supplied governance bundle could not be read / recognized;
 *  - `governance-incomplete` — a usable governance bundle's verdict is `incomplete`;
 *  - `archive-unreadable`    — the supplied archive pack could not be read / recognized;
 *  - `archive-incomplete`    — a usable archive pack's posture is `archive-incomplete`;
 *  - `archive-missing`       — `--require-archive` was set but no archive pack was supplied;
 *  - `restore-unreadable`    — the supplied restore drill could not be read / recognized;
 *  - `restore-incomplete`    — a usable restore drill's verdict is `restore-incomplete`;
 *  - `restore-missing`       — `--require-restore-drill` was set but no restore drill was supplied;
 *  - `report-unreadable`     — the supplied latest report could not be read / recognized;
 *  - `report-needs-evidence` — a usable latest report is `needs-evidence`;
 *  - `trend-unreadable`      — the supplied trend could not be read / recognized;
 *  - `trend-unknown`         — a usable trend's verdict is `unknown`.
 *
 * Advisory:
 *  - `governance-watch`      — a usable governance bundle's verdict is `watch`;
 *  - `archive-watch`         — a usable archive pack's posture is `archive-watch`;
 *  - `restore-drift`         — a usable restore drill's verdict is `restore-drift`;
 *  - `report-hold-warning`   — a usable latest report is `hold-warning`;
 *  - `trend-warning`         — a usable trend's verdict is `warning`.
 */
export const RELEASE_PUBLISH_PACK_REASON_IDS = [
  // Blocking
  "governance-tampered",
  "governance-blocked",
  "archive-tampered",
  "archive-blocked",
  "restore-tampered",
  "restore-failed",
  "report-tampered",
  "report-hold-fail",
  "trend-tampered",
  "trend-failing",
  // Insufficient
  "governance-missing",
  "governance-unreadable",
  "governance-incomplete",
  "archive-unreadable",
  "archive-incomplete",
  "archive-missing",
  "restore-unreadable",
  "restore-incomplete",
  "restore-missing",
  "report-unreadable",
  "report-needs-evidence",
  "trend-unreadable",
  "trend-unknown",
  // Advisory
  "governance-watch",
  "archive-watch",
  "restore-drift",
  "report-hold-warning",
  "trend-warning",
] as const;
export type ReleasePublishPackReasonId = (typeof RELEASE_PUBLISH_PACK_REASON_IDS)[number];

/**
 * The bounded handoff-checklist ids — the closed set of concrete steps to complete (or hold) the handoff, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `resolve-blockers-before-sharing` — a BLOCKING issue is present; resolve it before ANY sharing;
 *  - `recover-tampered-evidence`       — recover the untampered document from a second copy; a tampered document
 *                                        cannot anchor a handoff;
 *  - `complete-missing-evidence`       — supply the missing / unreadable / indeterminate (or required) document
 *                                        and re-run before an external handoff;
 *  - `mark-internal-review-only`       — label the package internal-review; it is NOT a clean external bill of
 *                                        health as-is;
 *  - `include-governance-summary`      — include the governance bundle (the summary judgment) in the handoff;
 *  - `include-archive-manifest`        — include the archive pack (proof the evidence is archived);
 *  - `include-restore-drill`           — include the restore drill (proof the archive is recoverable);
 *  - `include-supporting-evidence`     — include the latest report / trend for point-in-time + window context;
 *  - `hand-off-share-safe-pack`        — the package is share-safe; hand THIS content-free manifest (plus the
 *                                        included documents) to the external reviewer / approver;
 *  - `keep-publish-pack-record`        — keep this pack as the content-free handoff record (always).
 */
export const RELEASE_PUBLISH_PACK_CHECKLIST_IDS = [
  "resolve-blockers-before-sharing",
  "recover-tampered-evidence",
  "complete-missing-evidence",
  "mark-internal-review-only",
  "include-governance-summary",
  "include-archive-manifest",
  "include-restore-drill",
  "include-supporting-evidence",
  "hand-off-share-safe-pack",
  "keep-publish-pack-record",
] as const;
export type ReleasePublishPackChecklistId = (typeof RELEASE_PUBLISH_PACK_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Reduced source, coverage, rollup, disclosure, receipt, result
 * ------------------------------------------------------------------ */

/**
 * One reduced evidence source — a uniform, bounded summary over all five sources. Every field is a bounded enum, a
 * small integer, or a boolean; never a raw value from the input.
 */
export interface ReleasePublishPackSource {
  readonly id: ReleasePublishPackSourceId;
  readonly state: ReleasePublishPackSourceState;
  /** True iff a file was supplied for this source (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  /** True iff the parsed input carried the expected document schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded rollup re-derives). */
  readonly usable: boolean;
  /**
   * The source's own native posture token (a bounded enum), or `null`. Trusted only when `usable`; for a
   * `tampered` source it is the untrusted CLAIMED posture (surfaced so the summary shows what was asserted).
   */
  readonly verdict: string | null;
  /** The source's contribution on the common severity ladder, or `null` when not supplied. */
  readonly severity: ReleasePublishPackSeverity | null;
  /** A one-line, content-free headline authored from the source id + state + verdict. */
  readonly detail: string;
}

/** The bounded coverage summary — which sources were supplied and which are trustworthy evidence. */
export interface ReleasePublishPackCoverage {
  /** How many of the five sources were supplied (0–5). */
  readonly sourcesSupplied: number;
  /** How many of the five sources are usable (recognized + self-consistent) (0–5). */
  readonly sourcesUsable: number;
  /** The governance source's coverage state. */
  readonly governance: ReleasePublishPackSourceState;
  /** The archive source's coverage state. */
  readonly archive: ReleasePublishPackSourceState;
  /** The restore-drill source's coverage state. */
  readonly restoreDrill: ReleasePublishPackSourceState;
  /** The report source's coverage state. */
  readonly report: ReleasePublishPackSourceState;
  /** The trend source's coverage state. */
  readonly trend: ReleasePublishPackSourceState;
  /** True iff a usable governance bundle was supplied (the primary summary judgment is present). */
  readonly hasGovernance: boolean;
  /** True iff a usable archive pack was supplied. */
  readonly hasArchive: boolean;
  /** True iff a usable restore drill was supplied. */
  readonly hasRestoreDrill: boolean;
  /** True iff a usable latest report was supplied. */
  readonly hasReport: boolean;
  /** True iff a usable trend was supplied. */
  readonly hasTrend: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleasePublishPackPolicy {
  /** True iff `--require-archive` was set (an archive pack must be supplied, else the handoff is incomplete). */
  readonly requireArchive: boolean;
  /** True iff `--require-restore-drill` was set (a restore drill must be supplied, else the handoff is incomplete). */
  readonly requireRestoreDrill: boolean;
  /** True iff `--strict` was set (escalate a `review` OR `incomplete` posture to `blocked`). */
  readonly strict: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleasePublishPackReason {
  readonly id: ReleasePublishPackReasonId;
  readonly severity: ReleasePublishPackSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One handoff-checklist step, with its authored detail. */
export interface ReleasePublishPackChecklistItem {
  readonly id: ReleasePublishPackChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The bounded disclosure classification — the coarse sharing decision + an authored note. */
export interface ReleasePublishPackDisclosureBlock {
  /** The sharing classification (a coarsening of the verdict). */
  readonly classification: ReleasePublishPackDisclosure;
  /** Bounded, app-authored disclosure note. Never derived from an input. */
  readonly note: string;
}

/** The composite publish decision — the single verdict + exit code + disclosure a handoff acts on. */
export interface ReleasePublishPackRollup {
  readonly verdict: ReleasePublishPackVerdict;
  readonly exitCode: ReleasePublishPackExitCode;
  /** True iff `verdict === "publishable"`. */
  readonly publishable: boolean;
  /** The disclosure classification (share-safe / internal-review / blocked). */
  readonly disclosure: ReleasePublishPackDisclosure;
  /** The fired reason ids, in canonical order (empty on a clean publishable pack). */
  readonly reasons: readonly ReleasePublishPackReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--require-archive` was applied. */
  readonly requireArchive: boolean;
  /** True iff `--require-restore-drill` was applied. */
  readonly requireRestoreDrill: boolean;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
  /**
   * True iff `--strict` ESCALATED a `review` or `incomplete` posture to `blocked`. Surfaced so the summary
   * explains the escalation (the pack would be `review` / `incomplete` without the flag).
   */
  readonly strictEscalated: boolean;
  /** Which posture `--strict` escalated FROM (`review` or `incomplete`), or `null` when no escalation applied. */
  readonly strictEscalatedFrom: "review" | "incomplete" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream document schemas). */
export interface ReleasePublishPackMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_PUBLISH_PACK_POLICY_ID;
  readonly policyVersion: typeof RELEASE_PUBLISH_PACK_POLICY_VERSION;
  readonly governanceSchema: typeof RELEASE_GOVERNANCE_SCHEMA;
  readonly archiveSchema: typeof RELEASE_ARCHIVE_SCHEMA;
  readonly restoreDrillSchema: typeof RELEASE_RESTORE_DRILL_SCHEMA;
  readonly reportSchema: typeof RELEASE_REPORT_SCHEMA;
  readonly trendSchema: typeof RELEASE_TREND_SCHEMA;
}

/**
 * The stable, content-free release evidence publish / handoff pack an operator hands to an external reviewer /
 * approver / investor / incident responder. Every field is a bounded enum, a small integer, an ISO stamp, or
 * app-authored prose — so it carries no locator, identifier, size, path, or byte, even from a hostile input, and
 * never echoes an ingested document's own stamp.
 */
export interface ReleasePublishPackResult {
  readonly schema: typeof RELEASE_PUBLISH_PACK_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleasePublishPackMetadata;
  readonly policy: ReleasePublishPackPolicy;
  readonly coverage: ReleasePublishPackCoverage;
  /** One reduced summary per source, in canonical {@link RELEASE_PUBLISH_PACK_SOURCE_IDS} order. */
  readonly sources: readonly ReleasePublishPackSource[];
  readonly pack: ReleasePublishPackRollup;
  /** The disclosure classification — the coarse sharing decision. */
  readonly disclosure: ReleasePublishPackDisclosureBlock;
  /** Every fired reason, in canonical {@link RELEASE_PUBLISH_PACK_REASON_IDS} order. */
  readonly reasons: readonly ReleasePublishPackReason[];
  /** The bounded, ordered handoff checklist. Never derived from an input. */
  readonly checklist: readonly ReleasePublishPackChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this pack does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested document. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleasePublishPackReceipt;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this
 * publish pack conclude, and over how many sources" for a SIEM / handoff record. Bounded enums + small integers +
 * a stable policy id + the run's own stamp only (verdict + disclosure + source count); safe to log or forward
 * verbatim.
 */
export interface ReleasePublishPackReceipt {
  readonly category: "worker-release-publish-pack";
  readonly policyId: typeof RELEASE_PUBLISH_PACK_POLICY_ID;
  readonly policyVersion: typeof RELEASE_PUBLISH_PACK_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleasePublishPackVerdict;
  readonly exitCode: ReleasePublishPackExitCode;
  /** The disclosure classification (share-safe / internal-review / blocked). */
  readonly disclosure: ReleasePublishPackDisclosure;
  /** How many sources were supplied (0–5). */
  readonly sourcesSupplied: number;
  /** How many sources are usable (0–5). */
  readonly sourcesUsable: number;
}

/** The process exit code for a publish-pack result. */
export function releasePublishPackExitCode(result: ReleasePublishPackResult): number {
  return result.pack.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested document)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_PUBLISH_PACK_VERDICT_SUMMARY: Record<ReleasePublishPackVerdict, string> = {
  publishable:
    "PUBLISHABLE (share-safe): the release-evidence package is coherent — the PRIMARY governance bundle is HEALTHY and every supplied source is clean (an archivable archive, a verified restore drill, a promote-ready report, a stable trend). This content-free manifest is safe to hand to an external reviewer / approver. It publishes, signs, and approves nothing on its own.",
  review:
    "REVIEW (internal-review): no blocker and the evidence is sufficient, but an ADVISORY concern was raised — a watch governance, an archive-watch pack, a restore-drift drill, a hold-warning report, or a warning trend. Share the package INTERNALLY / with a reviewer first; it is not a clean external bill of health as-is.",
  incomplete:
    "INCOMPLETE (internal-review): the content-free evidence is INSUFFICIENT to certify a handoff — the PRIMARY governance bundle is absent / unreadable / INCOMPLETE, a supplied source was unreadable or indeterminate, or a required document was missing. This is a coverage problem, not a share-safe package.",
  blocked:
    "BLOCKED (do not share): a BLOCKING issue — a supplied document is recognized but self-inconsistent (a tamper), the governance is BLOCKED, the restore drill FAILED, the latest report is HOLD-FAIL, or the trend is FAILING. Do not hand this package off until the failure or tamper is resolved.",
};

/**
 * The dedicated headline for a `blocked` pack produced ONLY because `--strict` escalated a `review` or
 * `incomplete` posture — there was no tamper, blocked governance, failed drill, hold-fail report, or failing
 * trend, so the generic `blocked` summary would misrepresent the cause. Authored; selected by the rollup when
 * `strictEscalated`.
 */
export const RELEASE_PUBLISH_PACK_STRICT_ESCALATED_SUMMARY: Record<"review" | "incomplete", string> = {
  review:
    "BLOCKED (--strict): the only concern was ADVISORY (a watch governance / an archive-watch pack / a restore-drift drill / a hold-warning report / a warning trend), which `--strict` escalates to a blocking hold. Without `--strict` this would be REVIEW (internal-review), exit 3. No tamper, blocked governance, failed restore drill, hold-fail report, or failing trend was found.",
  incomplete:
    "BLOCKED (--strict): the evidence was INSUFFICIENT (an absent / unreadable / incomplete governance bundle, an indeterminate source, or a required-but-missing document), which `--strict` escalates to a blocking hold. Without `--strict` this would be INCOMPLETE (internal-review), exit 2. No tamper or blocking failure was found — supply the missing / readable evidence to reach a share-safe pack.",
};

/** The authored disclosure note, keyed by classification. */
export const RELEASE_PUBLISH_PACK_DISCLOSURE_NOTE: Record<ReleasePublishPackDisclosure, string> = {
  "share-safe":
    "SHARE-SAFE: this content-free evidence manifest may be shared with an external reviewer, approver, investor / partner, or incident responder. It carries no document content, path, object key, bucket, URL, secret, raw log, or provider detail — only bounded verdicts + counts. It is NOT an approval, a signature, or a promotion.",
  "internal-review":
    "INTERNAL-REVIEW: share this package INTERNALLY / with a reviewer first — it carries an advisory concern or is missing / inconclusive evidence, so it is not a clean external bill of health. Resolve or accept the concern, or supply the missing evidence, before an external handoff.",
  blocked:
    "BLOCKED: do NOT share this package — a tamper, a blocked governance posture, a failed restore drill, a hold-fail report, or a failing trend would misrepresent the release's posture to whoever receives it. Resolve the blocking issue and re-run before any handoff.",
};

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_PUBLISH_PACK_REASON_DETAIL: Record<
  ReleasePublishPackReasonId,
  { readonly severity: ReleasePublishPackSeverity; readonly detail: string }
> = {
  "governance-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-governance/1` bundle is recognized but its recorded verdict does NOT re-derive from its own sources — a hand-edited or corrupt bundle. Recover the untampered governance bundle from a second copy; a tampered bundle cannot anchor a handoff.",
  },
  "governance-blocked": {
    severity: "blocking",
    detail:
      "The governance bundle's verdict is BLOCKED: the review window carried a blocking issue (a tampered document, a failing trend, a hold-fail report, or a blocking audit regression). Do not hand off this package until the governance block is resolved.",
  },
  "archive-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-archive/1` pack is recognized but its recorded posture does NOT re-derive from its own records — a hand-edited or corrupt pack. Recover the untampered archive pack from a second copy before handoff.",
  },
  "archive-blocked": {
    severity: "blocking",
    detail:
      "The archive pack's posture is ARCHIVE-BLOCKED: the record it indexed carried a blocking issue. Investigate the archive block before handing off the package.",
  },
  "restore-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-restore-drill/1` is recognized but its recorded verdict does NOT re-derive from its own restore checks — a hand-edited or corrupt drill. Recover the untampered restore drill from a second copy before handoff.",
  },
  "restore-failed": {
    severity: "blocking",
    detail:
      "The restore drill's verdict is RESTORE-FAILED: a restored record mismatched the archive record, a restored record was corrupt, or the pack was tampered. The archive could not be trusted to restore — do not hand off the package until it is resolved.",
  },
  "report-tampered": {
    severity: "blocking",
    detail:
      "The supplied latest `pdfxyz.release-report/1` is recognized but its recorded recommendation does NOT re-derive from its own sources — a hand-edited or corrupt report. Recover the untampered report from a second copy before handoff.",
  },
  "report-hold-fail": {
    severity: "blocking",
    detail:
      "The latest operator report is HOLD-FAIL: the most recent release was held for a blocking issue. Investigate and resolve the latest release before handing off the package.",
  },
  "trend-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-trend/1` is recognized but its recorded verdict does NOT re-derive from its own points — a hand-edited or corrupt trend. Recover the untampered trend from a second copy before handoff.",
  },
  "trend-failing": {
    severity: "blocking",
    detail:
      "The release trend's verdict is FAILING: the recent report history is failing (a tampered report, a hold-fail newest, or a breached threshold). Do not hand off the package until the failing trend is investigated.",
  },
  "governance-missing": {
    severity: "insufficient",
    detail:
      "No governance bundle was supplied, so the PRIMARY summary judgment for the review window is unproven. An archive / restore-drill / report / trend is a supporting signal — it can never substitute for the governance bundle's window-level verdict. Generate `worker:release-governance` and supply it.",
  },
  "governance-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied governance bundle could not be read / recognized as a `pdfxyz.release-governance/1` (wrong schema or unparseable — never echoed), so the package has no primary summary. Supply a readable bundle produced by `worker:release-governance` and re-run.",
  },
  "governance-incomplete": {
    severity: "insufficient",
    detail:
      "The governance bundle's verdict is INCOMPLETE: its evidence was insufficient to certify the review window (an absent / unreadable / unknown trend, or an indeterminate latest). The package cannot be certified share-safe — resolve the governance coverage gap and re-run.",
  },
  "archive-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied archive pack could not be read / recognized as a `pdfxyz.release-archive/1` (wrong schema or unparseable — never echoed), so it contributes no archival evidence. Supply a readable pack produced by `worker:release-archive` and re-run.",
  },
  "archive-incomplete": {
    severity: "insufficient",
    detail:
      "The archive pack's posture is ARCHIVE-INCOMPLETE: the record it indexed was insufficient / governance-absent. The archival evidence could not be certified — resolve the archive coverage gap and re-run.",
  },
  "archive-missing": {
    severity: "insufficient",
    detail:
      "`--require-archive` was set but no `pdfxyz.release-archive/1` pack was supplied. The handoff policy requires proof the evidence was archived; supply the archive pack and re-run.",
  },
  "restore-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied restore drill could not be read / recognized as a `pdfxyz.release-restore-drill/1` (wrong schema or unparseable — never echoed), so it contributes no recoverability evidence. Supply a readable drill produced by `worker:release-restore-drill` and re-run.",
  },
  "restore-incomplete": {
    severity: "insufficient",
    detail:
      "The restore drill's verdict is RESTORE-INCOMPLETE: the pack was unreadable / incomplete, a restored record was unreadable, a required record was not restored, or no restore was exercised. Recoverability could not be certified — resolve the drill coverage gap and re-run.",
  },
  "restore-missing": {
    severity: "insufficient",
    detail:
      "`--require-restore-drill` was set but no `pdfxyz.release-restore-drill/1` was supplied. The handoff policy requires proof the archive is recoverable; supply the restore drill and re-run.",
  },
  "report-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied latest report could not be read / recognized as a `pdfxyz.release-report/1` (wrong schema or unparseable — never echoed), so it contributes no latest-release evidence. Supply a readable report produced by `worker:release-report` and re-run.",
  },
  "report-needs-evidence": {
    severity: "insufficient",
    detail:
      "The latest operator report is NEEDS-EVIDENCE: the most recent release could not be certified (an unreadable / audit-only / indeterminate evidence set). Gate the latest release's own coherence and re-run its report before an external handoff.",
  },
  "trend-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied trend could not be read / recognized as a `pdfxyz.release-trend/1` (wrong schema or unparseable — never echoed), so it contributes no window context. Supply a readable trend produced by `worker:release-trend` and re-run.",
  },
  "trend-unknown": {
    severity: "insufficient",
    detail:
      "The release trend's verdict is UNKNOWN: its report history was insufficient (an unreadable / empty history, or a needs-evidence newest). The window context could not be summarized — supply a readable, sufficient report history to the trend and re-run.",
  },
  "governance-watch": {
    severity: "advisory",
    detail:
      "The governance bundle's verdict is WATCH: no blocker, but the review window carried an advisory concern (a warning trend, a hold-warning report, an audit drift, or a trend mismatch). Review the concern before an external handoff, then decide.",
  },
  "archive-watch": {
    severity: "advisory",
    detail:
      "The archive pack's posture is ARCHIVE-WATCH: no blocker, but the archived record carried an advisory concern. Review the concern before an external handoff, then decide.",
  },
  "restore-drift": {
    severity: "advisory",
    detail:
      "The restore drill's verdict is RESTORE-DRIFT: no blocker, but an advisory concern was raised (a watch pack, or an unexpected out-of-band restored record). Review the drift before an external handoff, then decide.",
  },
  "report-hold-warning": {
    severity: "advisory",
    detail:
      "The latest operator report is HOLD-WARNING: no blocker, but the most recent release carried an advisory concern (a bundle warn / a non-blocking audit drift). Review the flagged concern before an external handoff, then decide.",
  },
  "trend-warning": {
    severity: "advisory",
    detail:
      "The release trend's verdict is WARNING: no blocker, but the recent report history carried an advisory concern. Review the recent posture before an external handoff, then decide.",
  },
};

/** Per-checklist-item authored detail, keyed by id. */
export const RELEASE_PUBLISH_PACK_CHECKLIST_DETAIL: Record<ReleasePublishPackChecklistId, string> = {
  "resolve-blockers-before-sharing":
    "A BLOCKING posture is present (a tamper, a blocked governance, a failed restore drill, a hold-fail report, or a failing trend — or a `--strict` escalation of an advisory / insufficient posture): resolve the underlying release issue (or drop `--strict`) and re-run before ANY sharing — an external handoff of a blocked package would misrepresent the release.",
  "recover-tampered-evidence":
    "Recover the untampered document from a second copy: a recorded verdict / posture / recommendation that does not re-derive means the document was hand-edited or corrupted, and cannot anchor a handoff.",
  "complete-missing-evidence":
    "Supply the missing / unreadable / indeterminate content-free document — the governance bundle (primary), and the archive / restore-drill / report / trend (required when `--require-archive` / `--require-restore-drill` is set) — and re-run; a missing or unreadable document leaves the handoff uncertified.",
  "mark-internal-review-only":
    "Label the package INTERNAL-REVIEW: it carries an advisory concern or is missing / inconclusive evidence, so it is not a clean external bill of health. Share it internally / with a reviewer, resolve or accept the concern, and re-run before an external handoff.",
  "include-governance-summary":
    "Include the content-free `pdfxyz.release-governance/1` bundle in the handoff — it is the summary judgment for the review window and the primary evidence a reviewer reads.",
  "include-archive-manifest":
    "Include the content-free `pdfxyz.release-archive/1` pack in the handoff — it is the proof the release evidence was archived for the review window.",
  "include-restore-drill":
    "Include the content-free `pdfxyz.release-restore-drill/1` in the handoff — it is the proof the archived evidence can be restored and re-validated.",
  "include-supporting-evidence":
    "Include the content-free latest `pdfxyz.release-report/1` and/or `pdfxyz.release-trend/1` for point-in-time + window context alongside the governance summary.",
  "hand-off-share-safe-pack":
    "The package is SHARE-SAFE: hand THIS content-free manifest (plus the included content-free documents) to the external reviewer / approver / investor / incident responder. This manifest publishes, signs, approves, and promotes nothing on its own.",
  "keep-publish-pack-record":
    "Keep this publish pack as the content-free handoff record: it is a bounded manifest of what was shared and its posture, not a substitute for the documents it composes, nor for your signing / approval / promotion processes.",
};

/**
 * The honesty caveats every result carries and every text render prints. The pack CLASSIFIES the chain's already
 * content-free evidence summaries for a handoff, RE-VALIDATES each one's self-consistency, and rolls them up into
 * one publish verdict + disclosure classification; it must never be read as more than that.
 */
export const RELEASE_PUBLISH_PACK_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE PUBLISH / HANDOFF PACK: it INGESTS a content-free `pdfxyz.release-governance/1` bundle (the PRIMARY signal) plus, optionally, the related content-free `pdfxyz.release-archive/1`, `pdfxyz.release-restore-drill/1`, `pdfxyz.release-report/1`, and/or `pdfxyz.release-trend/1` a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded publish verdict + DISCLOSURE CLASSIFICATION + a handoff checklist. It is local content-free HANDOFF PACKAGING over evidence summaries — NOT external publishing, a signature, an approval, legal / compliance sign-off, release promotion, cloud validation, or deletion.",
  "It NEVER actually publishes, shares, sends, uploads, signs, approves, promotes, or discloses anything to anyone: it only CLASSIFIES whether the supplied content-free evidence is safe to hand off and assembles a checklist. A `share-safe` classification is a RECOMMENDATION over the evidence on THIS host, not a grant, an NDA, an access control, or a claim that a handoff occurred. The operator performs the actual handoff out of band.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / bundle / audit / report / trend / governance / archive / restore-drill itself, and NEVER deletes, prunes, uploads, promotes, approves, or mutates any document, artifact, object, or deployment.",
  "A `publishable` (share-safe) pack REQUIRES a usable governance BUNDLE whose own verdict is `healthy`. The archive / restore-drill / report / trend are point-in-time signals that can BLOCK or FLAG but can never, on their own, GRANT a share-safe pack — so a governance-absent (or governance-unusable) run is honestly `incomplete` (internal-review), never a share-safe handoff. It FAILS CLOSED: a tampered / blocked / failed input blocks the handoff; an absent governance, an unreadable document, or an indeterminate posture is insufficient.",
  "It re-derives each ingested document's rollup from the document's OWN recorded facts (reusing the Phase 51–56 reducers) and treats a recorded verdict / posture / recommendation that does not re-derive as a TAMPER (`blocked`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so a `share-safe` classification is not proof of authenticity or provenance.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, commit URL, size, byte, digest, raw log, provider error, or document / OCR content, even from a hostile input; it never echoes an ingested document's own stamp, and it never echoes an input file path, even on an error.",
];

/**
 * Out-of-band reminders the pack carries but does NOT itself perform — the honest edges of an offline packager.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_PUBLISH_PACK_GUIDANCE: readonly string[] = [
  "Hand the package off OUT OF BAND: this pack CLASSIFIES whether the content-free evidence is safe to share and lists what to include, but attaching it to an email / ticket / data room, sending it to the reviewer, and tracking the handoff are operator actions this offline packager never performs.",
  "Sign / approve / promote separately: a `share-safe` pack is not a signature, an approval, a legal / compliance sign-off, or a release promotion. Obtain the sign-offs and promote the deployment through your own processes; this manifest authorizes none of them.",
  "Supply at least the governance BUNDLE: a `publishable` pack requires a usable, healthy governance bundle (the primary summary). Add the archive pack (proof archived), the restore drill (proof recoverable), and the latest report / trend for a complete handoff, and use `--require-archive` / `--require-restore-drill` to make either mandatory for your policy.",
  "The evidence is already content-free: the governance / archive / restore-drill / report / trend documents this pack composes carry no document content, path, object key, bucket, URL, or secret by construction — so no additional redaction is needed before sharing them. This pack re-validates and classifies; it does not re-redact.",
];
