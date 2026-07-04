/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence archive pack** (Phase 55).
 *
 * Phases 46–54 built the release-evidence chain, one rung per phase: the release readiness gate folds the
 * content-free worker checks into ONE promotion verdict; the release artifact stamps it with bounded provenance
 * + an integrity digest; the release index re-verifies many artifacts into a retention manifest; the release
 * policy asserts bounded operator thresholds over that manifest; the release CI bundle
 * (`pdfxyz.release-ci-bundle/1`) composes a single release job's stage outputs and re-verifies their cross-stage
 * consistency; the release audit (`pdfxyz.release-audit/1`) diffs a baseline bundle against a current one; the
 * release operator report (`pdfxyz.release-report/1`) folds a bundle + optional audit into ONE operator
 * recommendation; the release trend summary (`pdfxyz.release-trend/1`) summarizes a bounded HISTORY of those
 * reports; and the release governance bundle (`pdfxyz.release-governance/1`, Phase 54) folds a trend window +
 * the latest report / audit into ONE governance verdict for a review window.
 *
 * This phase closes the *archive record* loop for a periodic review. It INGESTS a `pdfxyz.release-governance/1`
 * bundle (the PRIMARY governance posture for the review window) plus, optionally, the related content-free
 * records an operator wants to keep together — the `pdfxyz.release-trend/1` window it summarized, the LATEST
 * `pdfxyz.release-report/1`, the LATEST `pdfxyz.release-audit/1`, and the LATEST `pdfxyz.release-ci-bundle/1`
 * job evidence — RE-VALIDATES each against ITSELF through the existing Phase 50–54 boundaries (so a hand-flipped
 * verdict / recommendation / rollup is caught as a tamper), CROSS-CHECKS the related records against the
 * governance bundle's OWN recorded per-source postures (so a stale trend / report / audit that disagrees with
 * the governance record is surfaced), and folds them into ONE stable, content-free `pdfxyz.release-archive/1`
 * pack manifest a review keeps as its record —
 *
 *    "What bounded content-free release evidence records should be archived together, what is their governance
 *     posture, and what caveats / follow-up remain?"
 *
 * — with a bounded archive posture, a bounded reason set, a per-record posture, an archive checklist (the
 * bounded record classes to keep), and a bounded follow-up assignment list, and it FAILS CLOSED when a record
 * cannot be trusted or the primary governance evidence is missing / insufficient.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it
 * indexes:
 *  - Every load-bearing token here is a bounded enum — a record id, a coverage state, an archive posture, a
 *    severity, a reason id, a follow-up id, a checklist id — never a filename, path, object key, bucket, URL,
 *    endpoint, region, id, token, size, byte, raw ref, raw label, commit URL, or digest. The only non-enum
 *    values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested record (each — even one Phase 50–54 produced — is
 *    UNTRUSTED input here); it reduces every fact to a bounded enum, a small integer, or a boolean, it never
 *    echoes an ingested record's OWN stamp (the pack carries only its own), and it never echoes an input file
 *    path, even on an error.
 *  - It never fabricates an "archivable". An `archivable` pack REQUIRES a usable governance bundle whose own
 *    verdict is `healthy`: the governance bundle only reports the review window's posture — an absent /
 *    unreadable / incomplete governance is INSUFFICIENT (never archivable), and a supplied-but-not-clean related
 *    record escalates or holds. A recognized-but-self-inconsistent record (a tamper), a blocked governance, a
 *    failing trend, a hold-fail report, a blocking audit regression, or a failed CI bundle is `archive-blocked`
 *    (fail-closed).
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, NOT immutable
 * archive STORAGE, NOT cloud validation, NOT deployment approval, and NOT deployment promotion; and it is NOT a
 * ZIP / tar / copy of the raw files — it is a content-free INDEX of which records should be kept together. It
 * PROVES nothing the composed records do not already prove; it INDEXES their content-free outputs for a review
 * record, RE-VALIDATES each one's self-consistency, cross-checks their coherence, and rolls them up into one
 * archive posture + record/follow-up checklists. Its authored caveats (see {@link RELEASE_ARCHIVE_CAVEATS}) say
 * so out loud: it is local content-free ARCHIVE INDEXING over evidence summaries — not signing, authentication,
 * cloud validation, storage retention enforcement, immutable archive storage, deployment approval, deployment
 * promotion, or raw-file packing.
 */

import { RELEASE_AUDIT_SCHEMA, type ReleaseAuditVerdict } from "../release-audit/types";
import type { AuditBundleFacts } from "../release-audit/types";
import { RELEASE_CI_BUNDLE_SCHEMA, type ReleaseCiBundleVerdict } from "../release-ci-bundle/types";
import { RELEASE_REPORT_SCHEMA, type ReleaseReportRecommendation } from "../release-report/types";
import type { AuditSourceFacts } from "../release-report/types";
import { RELEASE_TREND_SCHEMA, type ReleaseTrendVerdict } from "../release-trend/types";
import type { TrendReportFacts } from "../release-trend/types";
import {
  RELEASE_GOVERNANCE_SCHEMA,
  type GovernanceTrendFacts,
  type ReleaseGovernanceVerdict,
} from "../release-governance/types";

/** The schema tag every release-archive result carries, so tooling can pin the shape it parses. */
export const RELEASE_ARCHIVE_SCHEMA = "pdfxyz.release-archive/1" as const;

/** The upstream record schemas the pack indexes. Re-exported so the result can pin each input shape. */
export {
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_TREND_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
};

/** Stable identity of the release-archive pack — for docs / receipts / audit. */
export const RELEASE_ARCHIVE_POLICY_ID = "pdfxyz-worker-release-archive";
/** Bump when the surface, the posture ladder, the reason/follow-up/checklist sets, or the schema changes. */
export const RELEASE_ARCHIVE_POLICY_VERSION = 1;

/** Re-exported for convenience (the native posture tokens each ingested record carries). */
export type {
  ReleaseGovernanceVerdict,
  ReleaseTrendVerdict,
  ReleaseReportRecommendation,
  ReleaseAuditVerdict,
  ReleaseCiBundleVerdict,
};

/**
 * The five evidence records the archive pack indexes — the stable keys a reviewer routes on:
 *  - `governance` — the `pdfxyz.release-governance/1` bundle (the PRIMARY signal; the review window's governance
 *                   posture over the trend + latest report / audit). Required for an `archivable` pack;
 *  - `trend`      — the `pdfxyz.release-trend/1` window summary the governance bundle summarized (a SECONDARY
 *                   record that can BLOCK / FLAG, but can never, on its own, GRANT an archivable pack);
 *  - `report`     — the LATEST `pdfxyz.release-report/1` operator report (SECONDARY);
 *  - `audit`      — the LATEST `pdfxyz.release-audit/1` regression diff (SECONDARY);
 *  - `bundle`     — the LATEST `pdfxyz.release-ci-bundle/1` CI job evidence (SECONDARY).
 */
export const RELEASE_ARCHIVE_RECORD_IDS = ["governance", "trend", "report", "audit", "bundle"] as const;
export type ReleaseArchiveRecordId = (typeof RELEASE_ARCHIVE_RECORD_IDS)[number];

/**
 * The bounded coverage state of one evidence record:
 *  - `absent`     — no file was supplied for this record (the honest default; never a fault for an optional
 *                   record, but the PRIMARY governance being absent is an insufficiency, resolved by the rollup);
 *  - `unreadable` — a file was supplied but could not be read / parsed / recognized (never echoed);
 *  - `tampered`   — the record was recognized but its recorded rollup does NOT re-derive from its own facts
 *                   (a hand-edited / corrupt record — treated as a blocking failure);
 *  - `usable`     — recognized AND self-consistent (its recorded rollup re-derives): trustworthy evidence.
 */
export const RELEASE_ARCHIVE_RECORD_STATES = ["absent", "unreadable", "tampered", "usable"] as const;
export type ReleaseArchiveRecordState = (typeof RELEASE_ARCHIVE_RECORD_STATES)[number];

/**
 * The single archive posture a review / CI keys on — the answer to "should this evidence be archived together,
 * and in what state?":
 *  - `archivable`         — the PRIMARY governance bundle is usable and `healthy`, and every supplied related
 *                           record is clean AND coherent with the governance record: a self-consistent review
 *                           record. Keep the pack (and the underlying records) as the archive;
 *  - `archive-watch`      — no blocker and the evidence is sufficient, but an ADVISORY concern was raised (a
 *                           `watch` governance, a `warning` trend, a `hold-warning` report, an audit / bundle
 *                           drift, or a related record that DISAGREES with the governance record — a stale /
 *                           mismatched record): archive, but review the flagged concern;
 *  - `archive-incomplete` — the evidence is INSUFFICIENT to certify the record: the PRIMARY governance is absent
 *                           / unreadable / `incomplete`, a supplied related record was unreadable / indeterminate,
 *                           or a required record was missing. Fail-closed, not an archivable pack;
 *  - `archive-blocked`    — a BLOCKING issue: a supplied record is recognized but self-inconsistent (a tamper),
 *                           the governance is `blocked`, the trend is `failing`, the report is `hold-fail`, the
 *                           audit reported a blocking regression, or the CI bundle `fail`ed. The strongest
 *                           signal; it dominates. An `invalid` (tampered) record folds here.
 *
 * These are the exact bounded values the run-level `worker_release_archive_total` metric carries as its
 * `posture` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_ARCHIVE_POSTURES = [
  "archivable",
  "archive-watch",
  "archive-incomplete",
  "archive-blocked",
] as const;
export type ReleaseArchivePosture = (typeof RELEASE_ARCHIVE_POSTURES)[number];

/**
 * The exit-code ladder a CI / review job routes on — the same shape as the gate/artifact/index/policy/
 * ci-bundle/audit/report/trend/governance ladders so the whole worker suite speaks one language:
 *  - `0` ARCHIVABLE — a coherent review record (a healthy governance, and every supplied related record clean +
 *                     coherent);
 *  - `1` USAGE      — the CLI was misused (a bad flag, no governance supplied, or an unwritable output). CLI-owned;
 *                     an archive RUN never resolves to it;
 *  - `2` INCOMPLETE — the evidence was insufficient to certify the record (an absent / unreadable / incomplete
 *                     governance, an indeterminate related record, or a required-but-missing record);
 *  - `3` WATCH      — an advisory posture (a watch governance, a warning trend, a hold-warning report, an audit /
 *                     bundle drift, or a related record that disagrees with the governance record);
 *  - `4` BLOCKED    — a blocking posture (a tampered / invalid record, a blocked governance, a failing trend, a
 *                     hold-fail report, a blocking audit regression, or a failed CI bundle).
 * Monotonic — a higher code is always a stronger "do not treat this evidence as an archivable clean record".
 */
export const RELEASE_ARCHIVE_EXIT = {
  ARCHIVABLE: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  WATCH: 3,
  BLOCKED: 4,
} as const;
export type ReleaseArchiveExitCode = (typeof RELEASE_ARCHIVE_EXIT)[keyof typeof RELEASE_ARCHIVE_EXIT];

/**
 * The common **severity** each record's native posture, and each fired reason, maps onto so the pack can fold
 * five different ladders (governance `healthy|watch|incomplete|blocked`, trend `stable|warning|unknown|failing`,
 * report `promote-ready|hold-warning|needs-evidence|hold-fail`, audit + bundle `pass|warn|unknown|fail`) plus
 * the coverage states into one posture:
 *  - `ready`        — a usable record at its best posture (best);
 *  - `advisory`     — a usable record carrying an advisory concern, an advisory reason, or a coherence mismatch;
 *  - `insufficient` — an absent primary / unreadable / indeterminate record, or an insufficiency reason;
 *  - `blocking`     — a tampered record, a blocked governance, a failing trend, a hold-fail report, a blocking
 *                     audit regression, or a failed CI bundle (worst).
 *
 * Precedence when folding is `blocking > insufficient > advisory > ready` (checked in that order, exactly like
 * the Phase 50/52/53/54 rollups — so an insufficient posture never masquerades as a mere advisory, and a real
 * blocker is never masked). A record that is not supplied contributes no severity (`null`).
 */
export const RELEASE_ARCHIVE_SEVERITIES = ["ready", "advisory", "insufficient", "blocking"] as const;
export type ReleaseArchiveSeverity = (typeof RELEASE_ARCHIVE_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence. */
export const RELEASE_ARCHIVE_SEVERITY_RANK: Record<ReleaseArchiveSeverity, number> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
};

/** A usable governance's verdict → common archive severity. */
export const GOVERNANCE_SEVERITY: Record<ReleaseGovernanceVerdict, ReleaseArchiveSeverity> = {
  healthy: "ready",
  watch: "advisory",
  incomplete: "insufficient",
  blocked: "blocking",
};

/** A usable trend's verdict → common archive severity. */
export const TREND_SEVERITY: Record<ReleaseTrendVerdict, ReleaseArchiveSeverity> = {
  stable: "ready",
  warning: "advisory",
  unknown: "insufficient",
  failing: "blocking",
};

/** A usable report's recommendation → common archive severity. */
export const REPORT_SEVERITY: Record<ReleaseReportRecommendation, ReleaseArchiveSeverity> = {
  "promote-ready": "ready",
  "hold-warning": "advisory",
  "needs-evidence": "insufficient",
  "hold-fail": "blocking",
};

/** A usable audit's verdict → common archive severity. */
export const AUDIT_SEVERITY: Record<ReleaseAuditVerdict, ReleaseArchiveSeverity> = {
  pass: "ready",
  warn: "advisory",
  unknown: "insufficient",
  fail: "blocking",
};

/** A usable CI bundle's verdict → common archive severity. */
export const BUNDLE_SEVERITY: Record<ReleaseCiBundleVerdict, ReleaseArchiveSeverity> = {
  pass: "ready",
  warn: "advisory",
  unknown: "insufficient",
  fail: "blocking",
};

/**
 * The bounded reason ids — the closed set of REASONS the archive posture resolved as it did, emitted in this
 * stable order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The
 * per-id severity is authored in {@link RELEASE_ARCHIVE_REASON_DETAIL}:
 *
 * Blocking:
 *  - `governance-tampered`         — the governance bundle is recognized but self-inconsistent (a tamper);
 *  - `governance-blocked`          — a usable governance's verdict is `blocked`;
 *  - `trend-tampered`              — the supplied trend is recognized but self-inconsistent (a tamper);
 *  - `trend-failing`              — a usable trend's verdict is `failing`;
 *  - `report-tampered`             — the supplied latest report is recognized but self-inconsistent (a tamper);
 *  - `report-hold-fail`            — a usable latest report is `hold-fail`;
 *  - `audit-tampered`              — the supplied latest audit is recognized but self-inconsistent (a tamper);
 *  - `audit-regressed`             — a usable latest audit reported a blocking regression (verdict `fail`);
 *  - `bundle-tampered`             — the supplied latest CI bundle is recognized but self-inconsistent (a tamper);
 *  - `bundle-failed`               — a usable latest CI bundle's verdict is `fail`.
 *
 * Insufficient:
 *  - `governance-missing`          — NO governance was supplied, so the review window's posture is unproven;
 *  - `governance-unreadable`       — the supplied governance could not be read / recognized;
 *  - `governance-incomplete`       — a usable governance's verdict is `incomplete` (insufficient window evidence);
 *  - `trend-unreadable`            — the supplied trend could not be read / recognized;
 *  - `trend-unknown`               — a usable trend's verdict is `unknown` (an insufficient report history);
 *  - `trend-missing`               — `--require-trend` was set but no trend was supplied;
 *  - `report-unreadable`           — the supplied latest report could not be read / recognized;
 *  - `report-needs-evidence`       — a usable latest report is `needs-evidence`;
 *  - `report-missing`              — `--require-report` was set but no latest report was supplied;
 *  - `audit-unreadable`            — the supplied latest audit could not be read / recognized;
 *  - `audit-inconclusive`          — a usable latest audit's verdict is `unknown`;
 *  - `audit-missing`               — `--require-audit` was set but no latest audit was supplied;
 *  - `bundle-unreadable`           — the supplied latest CI bundle could not be read / recognized;
 *  - `bundle-unknown`              — a usable latest CI bundle's verdict is `unknown`;
 *  - `bundle-missing`              — `--require-bundle` was set but no latest CI bundle was supplied.
 *
 * Advisory:
 *  - `governance-watch`            — a usable governance's verdict is `watch` (an advisory window posture);
 *  - `trend-warning`               — a usable trend's verdict is `warning`;
 *  - `report-hold-warning`         — a usable latest report is `hold-warning`;
 *  - `audit-drift`                 — a usable latest audit's verdict is `warn`;
 *  - `bundle-warning`              — a usable latest CI bundle's verdict is `warn`;
 *  - `trend-governance-mismatch`   — the supplied trend's posture DISAGREES with the governance bundle's OWN
 *                                    recorded trend posture (a stale / mismatched record);
 *  - `report-governance-mismatch`  — the supplied latest report DISAGREES with the governance bundle's OWN
 *                                    recorded latest-report posture;
 *  - `audit-governance-mismatch`   — the supplied latest audit DISAGREES with the governance bundle's OWN
 *                                    recorded latest-audit posture.
 */
export const RELEASE_ARCHIVE_REASON_IDS = [
  // Blocking
  "governance-tampered",
  "governance-blocked",
  "trend-tampered",
  "trend-failing",
  "report-tampered",
  "report-hold-fail",
  "audit-tampered",
  "audit-regressed",
  "bundle-tampered",
  "bundle-failed",
  // Insufficient
  "governance-missing",
  "governance-unreadable",
  "governance-incomplete",
  "trend-unreadable",
  "trend-unknown",
  "trend-missing",
  "report-unreadable",
  "report-needs-evidence",
  "report-missing",
  "audit-unreadable",
  "audit-inconclusive",
  "audit-missing",
  "bundle-unreadable",
  "bundle-unknown",
  "bundle-missing",
  // Advisory
  "governance-watch",
  "trend-warning",
  "report-hold-warning",
  "audit-drift",
  "bundle-warning",
  "trend-governance-mismatch",
  "report-governance-mismatch",
  "audit-governance-mismatch",
] as const;
export type ReleaseArchiveReasonId = (typeof RELEASE_ARCHIVE_REASON_IDS)[number];

/**
 * The bounded archive-checklist ids — the bounded RECORD CLASSES to keep together as the review record:
 *  - `governance-bundle` — the supplied governance bundle (kept iff supplied + recognized);
 *  - `release-trend`     — the supplied trend summary (kept iff supplied + recognized);
 *  - `latest-report`     — the supplied latest operator report (kept iff supplied + recognized);
 *  - `latest-audit`      — the supplied latest audit (kept iff supplied + recognized);
 *  - `ci-bundle`         — the supplied latest CI bundle (kept iff supplied + recognized);
 *  - `archive-pack`      — THIS pack manifest (always kept — the content-free archive record for the window).
 */
export const RELEASE_ARCHIVE_CHECKLIST_IDS = [
  "governance-bundle",
  "release-trend",
  "latest-report",
  "latest-audit",
  "ci-bundle",
  "archive-pack",
] as const;
export type ReleaseArchiveChecklistId = (typeof RELEASE_ARCHIVE_CHECKLIST_IDS)[number];

/**
 * The bounded follow-up assignment ids — the closed set of concrete operator steps the pack can assign, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `investigate-blocked-archive`   — investigate the blocking archive issue (a blocked governance, a failing
 *                                      trend, a hold-fail report, a blocking audit regression, or a failed CI
 *                                      bundle) before the review closes;
 *  - `recover-tampered-evidence`     — recover the untampered record from the CI archive; a tampered record
 *                                      cannot anchor the archive record;
 *  - `refresh-governance`            — the governance bundle is missing / unreadable / incomplete; regenerate
 *                                      `worker:release-governance` over the current window and re-run;
 *  - `reconcile-evidence-mismatch`   — a related record disagrees with the governance bundle's own posture (one
 *                                      is stale, or post-dates the window); reconcile them before archiving;
 *  - `review-watch-archive`          — review the advisory archive concern and record the decision;
 *  - `supply-required-evidence`      — a required (`--require-trend` / `--require-report` / `--require-audit` /
 *                                      `--require-bundle`) record was not supplied; supply it and re-run;
 *  - `continue-archive-cadence`      — the record is archivable; keep composing governance bundles and archiving
 *                                      the pack on the review cadence;
 *  - `archive-evidence-pack`         — archive this pack (and the underlying records) as the review record.
 */
export const RELEASE_ARCHIVE_FOLLOWUP_IDS = [
  "investigate-blocked-archive",
  "recover-tampered-evidence",
  "refresh-governance",
  "reconcile-evidence-mismatch",
  "review-watch-archive",
  "supply-required-evidence",
  "continue-archive-cadence",
  "archive-evidence-pack",
] as const;
export type ReleaseArchiveFollowupId = (typeof RELEASE_ARCHIVE_FOLLOWUP_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-record bounded facts (one shape per record; all enums / small ints / booleans)
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable `pdfxyz.release-governance/1` (its rollup re-derived in ingest). Beyond
 * the governance verdict + counts, it surfaces the governance bundle's OWN recorded per-source postures — the
 * trend / report / audit verdicts it folded — so the archive pack can CROSS-CHECK the separately-supplied related
 * records against them (a stale / mismatched record). Each is `null` when the governance bundle's corresponding
 * source was not usable.
 */
export interface ArchiveGovernanceFacts {
  /** The governance bundle's verdict (trusted — the bundle re-derived its own rollup). */
  readonly verdict: ReleaseGovernanceVerdict;
  /** The governance bundle's own exit code (context; the pack has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "healthy"`. */
  readonly healthy: boolean;
  /** How many of the governance bundle's three sources were supplied (0–3). */
  readonly sourcesSupplied: number;
  /** How many of the governance bundle's three sources were usable (0–3). */
  readonly sourcesUsable: number;
  /** The governance bundle's OWN recorded trend-source posture (usable-only), or `null`. */
  readonly trendVerdict: ReleaseTrendVerdict | null;
  /** The governance bundle's OWN recorded latest-report posture (usable-only), or `null`. */
  readonly reportVerdict: ReleaseReportRecommendation | null;
  /** The governance bundle's OWN recorded latest-audit posture (usable-only), or `null`. */
  readonly auditVerdict: ReleaseAuditVerdict | null;
  /** How many blocking reasons the governance bundle itself carried. */
  readonly blocking: number;
  /** How many insufficiency reasons the governance bundle itself carried. */
  readonly insufficiencies: number;
  /** How many advisory reasons the governance bundle itself carried. */
  readonly advisories: number;
}

/** The bounded facts reduced from a usable `pdfxyz.release-trend/1` (reused from the Phase 54 trend ingest). */
export type ArchiveTrendFacts = GovernanceTrendFacts;

/** The bounded facts reduced from a usable latest `pdfxyz.release-report/1` (reused from the Phase 53 ingest). */
export type ArchiveReportFacts = TrendReportFacts;

/** The bounded facts reduced from a usable latest `pdfxyz.release-audit/1` (reused from the Phase 52 ingest). */
export type ArchiveAuditFacts = AuditSourceFacts;

/** The bounded facts reduced from a usable latest `pdfxyz.release-ci-bundle/1` (reused from the Phase 51 ingest). */
export type ArchiveBundleFacts = AuditBundleFacts;

/** The common bounded fields every reduced record carries. */
interface ReleaseArchiveRecordBase {
  readonly state: ReleaseArchiveRecordState;
  /** True iff a file was supplied for this record (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  /** True iff the parsed input carried the expected record schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded rollup re-derives). */
  readonly usable: boolean;
  /**
   * The record's own native posture token (a bounded enum), or `null`. Trusted only when `usable`; for a
   * `tampered` record it is the untrusted CLAIMED posture (surfaced so the summary shows what was asserted).
   */
  readonly verdict: string | null;
  /** The record's contribution on the common severity ladder, or `null` when not supplied. */
  readonly severity: ReleaseArchiveSeverity | null;
  /** A one-line, content-free headline authored from the record id + state + verdict. */
  readonly detail: string;
}

/**
 * One reduced evidence record — a discriminated union on {@link ReleaseArchiveRecordId} so each record's `facts`
 * are strongly typed. Every field is a bounded enum, a small integer, or a boolean; never a raw value from the
 * input.
 */
export type ReleaseArchiveRecord =
  | (ReleaseArchiveRecordBase & { readonly id: "governance"; readonly facts: ArchiveGovernanceFacts | null })
  | (ReleaseArchiveRecordBase & { readonly id: "trend"; readonly facts: ArchiveTrendFacts | null })
  | (ReleaseArchiveRecordBase & { readonly id: "report"; readonly facts: ArchiveReportFacts | null })
  | (ReleaseArchiveRecordBase & { readonly id: "audit"; readonly facts: ArchiveAuditFacts | null })
  | (ReleaseArchiveRecordBase & { readonly id: "bundle"; readonly facts: ArchiveBundleFacts | null });

/** The bounded coverage summary — which records were supplied and which are trustworthy evidence. */
export interface ReleaseArchiveCoverage {
  /** How many of the five records were supplied (0–5). */
  readonly recordsSupplied: number;
  /** How many of the five records were recognized (parsed to the expected schema) (0–5). */
  readonly recordsRecognized: number;
  /** How many of the five records are usable (recognized + self-consistent) (0–5). */
  readonly recordsUsable: number;
  /** The governance record's coverage state. */
  readonly governance: ReleaseArchiveRecordState;
  /** The trend record's coverage state. */
  readonly trend: ReleaseArchiveRecordState;
  /** The report record's coverage state. */
  readonly report: ReleaseArchiveRecordState;
  /** The audit record's coverage state. */
  readonly audit: ReleaseArchiveRecordState;
  /** The CI bundle record's coverage state. */
  readonly bundle: ReleaseArchiveRecordState;
  /** True iff a usable governance bundle was supplied (the primary posture is present). */
  readonly hasGovernance: boolean;
  /** True iff a usable trend was supplied. */
  readonly hasTrend: boolean;
  /** True iff a usable latest report was supplied. */
  readonly hasReport: boolean;
  /** True iff a usable latest audit was supplied. */
  readonly hasAudit: boolean;
  /** True iff a usable latest CI bundle was supplied. */
  readonly hasBundle: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseArchivePolicy {
  /** True iff `--require-trend` was set (a trend must be supplied). */
  readonly requireTrend: boolean;
  /** True iff `--require-report` was set (a latest report must be supplied). */
  readonly requireReport: boolean;
  /** True iff `--require-audit` was set (a latest audit must be supplied). */
  readonly requireAudit: boolean;
  /** True iff `--require-bundle` was set (a latest CI bundle must be supplied). */
  readonly requireBundle: boolean;
  /** True iff `--strict-watch` was set (escalate an advisory-only posture to `archive-blocked`). */
  readonly strictWatch: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseArchiveReason {
  readonly id: ReleaseArchiveReasonId;
  readonly severity: ReleaseArchiveSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One follow-up assignment, with its authored detail. */
export interface ReleaseArchiveFollowup {
  readonly id: ReleaseArchiveFollowupId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The bounded archive checklist — the record classes to keep together as the review record. */
export interface ReleaseArchiveChecklist {
  /** The record-class ids to archive, in canonical order. */
  readonly items: readonly ReleaseArchiveChecklistId[];
  /** How many record classes are present besides this pack itself (0–5). */
  readonly recordClasses: number;
  /** Bounded, app-authored archive note. Never derived from an input. */
  readonly note: string;
}

/** The composite archive decision — the single posture + exit code a review acts on. */
export interface ReleaseArchiveRollup {
  readonly posture: ReleaseArchivePosture;
  readonly exitCode: ReleaseArchiveExitCode;
  /** True iff `posture === "archivable"`. */
  readonly archivable: boolean;
  /** The fired reason ids, in canonical order (empty on a clean archivable pack). */
  readonly reasons: readonly ReleaseArchiveReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--require-trend` was applied. */
  readonly requireTrend: boolean;
  /** True iff `--require-report` was applied. */
  readonly requireReport: boolean;
  /** True iff `--require-audit` was applied. */
  readonly requireAudit: boolean;
  /** True iff `--require-bundle` was applied. */
  readonly requireBundle: boolean;
  /** True iff `--strict-watch` was applied. */
  readonly strictWatch: boolean;
  /**
   * True iff `--strict-watch` ESCALATED an advisory-only posture to `archive-blocked` (would have been
   * `archive-watch`). The pack would be `archive-watch` without the flag; surfaced so the summary explains it.
   */
  readonly strictWatchEscalated: boolean;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream record schemas). */
export interface ReleaseArchiveMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_ARCHIVE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_ARCHIVE_POLICY_VERSION;
  readonly governanceSchema: typeof RELEASE_GOVERNANCE_SCHEMA;
  readonly trendSchema: typeof RELEASE_TREND_SCHEMA;
  readonly reportSchema: typeof RELEASE_REPORT_SCHEMA;
  readonly auditSchema: typeof RELEASE_AUDIT_SCHEMA;
  readonly bundleSchema: typeof RELEASE_CI_BUNDLE_SCHEMA;
}

/**
 * The stable, content-free release evidence archive pack a periodic review keeps as its record. Every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no locator, identifier,
 * size, path, or byte, even from a hostile input, and never echoes an ingested record's own stamp.
 */
export interface ReleaseArchiveResult {
  readonly schema: typeof RELEASE_ARCHIVE_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseArchiveMetadata;
  readonly policy: ReleaseArchivePolicy;
  readonly coverage: ReleaseArchiveCoverage;
  /** One reduced summary per record, in canonical {@link RELEASE_ARCHIVE_RECORD_IDS} order. */
  readonly records: readonly ReleaseArchiveRecord[];
  readonly archive: ReleaseArchiveRollup;
  /** Every fired reason, in canonical {@link RELEASE_ARCHIVE_REASON_IDS} order. */
  readonly reasons: readonly ReleaseArchiveReason[];
  /** Which content-free record classes to keep together as the review record. */
  readonly checklist: ReleaseArchiveChecklist;
  /** The bounded, ordered follow-up assignment checklist. Never derived from an input. */
  readonly followUps: readonly ReleaseArchiveFollowup[];
  /** Bounded, app-authored guidance (out-of-scope steps this pack does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseArchiveReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did
 * this archive pack conclude, over how many usable records, with how many blocking / insufficiency / advisory
 * reasons" for a SIEM / review record. Bounded enums + small integers + a stable policy id + the run's own stamp
 * only; safe to log or forward verbatim.
 */
export interface ReleaseArchiveReceipt {
  readonly category: "worker-release-archive";
  readonly policyId: typeof RELEASE_ARCHIVE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_ARCHIVE_POLICY_VERSION;
  readonly at: string;
  readonly posture: ReleaseArchivePosture;
  readonly exitCode: ReleaseArchiveExitCode;
  /** How many records were supplied. */
  readonly recordsSupplied: number;
  /** How many records are usable. */
  readonly recordsUsable: number;
  /** How many record classes the checklist keeps (besides this pack). */
  readonly recordClasses: number;
  /** True iff a usable governance bundle was supplied (primary posture present). */
  readonly hasGovernance: boolean;
  /** True iff a usable trend was supplied. */
  readonly hasTrend: boolean;
  /** True iff a usable latest report was supplied. */
  readonly hasReport: boolean;
  /** True iff a usable latest audit was supplied. */
  readonly hasAudit: boolean;
  /** True iff a usable latest CI bundle was supplied. */
  readonly hasBundle: boolean;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  /** True iff `--require-trend` was applied. */
  readonly requireTrend: boolean;
  /** True iff `--require-report` was applied. */
  readonly requireReport: boolean;
  /** True iff `--require-audit` was applied. */
  readonly requireAudit: boolean;
  /** True iff `--require-bundle` was applied. */
  readonly requireBundle: boolean;
  /** True iff `--strict-watch` was applied. */
  readonly strictWatch: boolean;
}

/** The process exit code for an archive result. */
export function releaseArchiveExitCode(result: ReleaseArchiveResult): number {
  return result.archive.exitCode;
}

/** The authoritative posture → exit code map. */
export const RELEASE_ARCHIVE_EXIT_FOR_POSTURE: Record<ReleaseArchivePosture, ReleaseArchiveExitCode> = {
  archivable: RELEASE_ARCHIVE_EXIT.ARCHIVABLE,
  "archive-watch": RELEASE_ARCHIVE_EXIT.WATCH,
  "archive-incomplete": RELEASE_ARCHIVE_EXIT.INCOMPLETE,
  "archive-blocked": RELEASE_ARCHIVE_EXIT.BLOCKED,
};

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line posture headline. Authored here, keyed by the enum. */
export const RELEASE_ARCHIVE_POSTURE_SUMMARY: Record<ReleaseArchivePosture, string> = {
  archivable:
    "ARCHIVABLE: the review record is coherent — the PRIMARY governance bundle is HEALTHY, and every supplied related record is clean and coherent with it. Keep this pack (and the underlying records) as the content-free archive for this review window. This pack archives nothing on its own; it only indexes what to keep together.",
  "archive-watch":
    "ARCHIVE-WATCH (advisory): no blocker and the evidence is sufficient, but an ADVISORY concern was raised — a watch governance, a warning trend, a hold-warning report, an audit / bundle drift, or a related record that DISAGREES with the governance record (a stale / mismatched record). Archive the pack, but review the flagged concern.",
  "archive-incomplete":
    "ARCHIVE-INCOMPLETE (insufficient): the content-free evidence is INSUFFICIENT to certify this review record — the PRIMARY governance bundle is absent / unreadable / INCOMPLETE, a supplied related record was unreadable or indeterminate, or a required record was missing. This is a setup / coverage problem, not an archivable record.",
  "archive-blocked":
    "ARCHIVE-BLOCKED: a BLOCKING issue — a supplied record is recognized but self-inconsistent (a tamper), the governance is BLOCKED, the trend is FAILING, the latest report is HOLD-FAIL, the latest audit reported a blocking regression, or the latest CI bundle FAILED. Do not treat this evidence as an archivable clean record until the failure or tamper is resolved.",
};

/**
 * The dedicated headline for an `archive-blocked` pack produced ONLY because `--strict-watch` escalated an
 * advisory-only posture — there was no tamper, blocked governance, failing trend, hold-fail report, blocking
 * regression, or failed bundle, so the generic `archive-blocked` summary would misrepresent the cause. Authored;
 * selected by the rollup when `strictWatchEscalated`.
 */
export const RELEASE_ARCHIVE_STRICT_WATCH_ESCALATED_SUMMARY =
  "ARCHIVE-BLOCKED (--strict-watch): the only concern was ADVISORY (a watch governance / a warning trend / a hold-warning report / an audit / bundle drift / a record that disagrees with the governance record), which `--strict-watch` escalates to a blocking archive hold. Without `--strict-watch` this would be ARCHIVE-WATCH, exit 3. No tamper, blocked governance, failing trend, hold-fail report, blocking audit regression, or failed CI bundle was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_ARCHIVE_REASON_DETAIL: Record<
  ReleaseArchiveReasonId,
  { readonly severity: ReleaseArchiveSeverity; readonly detail: string }
> = {
  "governance-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-governance/1` is recognized but its recorded verdict / coverage does NOT re-derive from its own per-source postures — a hand-edited or corrupt bundle. Recover the untampered governance bundle from your CI archive; a tampered bundle cannot anchor the archive record.",
  },
  "governance-blocked": {
    severity: "blocking",
    detail:
      "The governance bundle's verdict is BLOCKED: the review window was blocked (a tampered document, a failing trend, a hold-fail report, or a blocking audit regression). Do not archive this as a clean record — investigate and resolve the blocking governance issue first.",
  },
  "trend-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-trend/1` is recognized but its recorded verdict / history does NOT re-derive from its own per-report points — a hand-edited or corrupt trend. Recover the untampered trend from your CI archive.",
  },
  "trend-failing": {
    severity: "blocking",
    detail:
      "The supplied release trend's verdict is FAILING: the recent report history is failing (a tampered report, a hold-fail newest, or a breached threshold in the window). Investigate the failing trend before archiving this as a clean record.",
  },
  "report-tampered": {
    severity: "blocking",
    detail:
      "The supplied latest `pdfxyz.release-report/1` is recognized but its recorded recommendation does NOT re-derive from its own sources — a hand-edited or corrupt report. Recover the untampered report from your CI archive.",
  },
  "report-hold-fail": {
    severity: "blocking",
    detail:
      "The supplied latest operator report is HOLD-FAIL: the most recent release was held for a blocking issue. Resolve the latest release before archiving this as a clean record.",
  },
  "audit-tampered": {
    severity: "blocking",
    detail:
      "The supplied latest `pdfxyz.release-audit/1` is recognized but its recorded rollup does NOT re-derive from its own findings — a hand-edited or corrupt audit. Recover the untampered audit from your CI archive.",
  },
  "audit-regressed": {
    severity: "blocking",
    detail:
      "The supplied latest release audit reported a BLOCKING regression versus its baseline (the current bundle dropped to fail, a held link now mismatches, or the archive decision worsened). Investigate the regression before archiving this as a clean record.",
  },
  "bundle-tampered": {
    severity: "blocking",
    detail:
      "The supplied latest `pdfxyz.release-ci-bundle/1` is recognized but its recorded rollup does NOT re-derive from its own stages + links — a hand-edited or corrupt bundle. Recover the untampered CI bundle from your CI archive.",
  },
  "bundle-failed": {
    severity: "blocking",
    detail:
      "The supplied latest CI bundle's verdict is FAIL: the most recent release job failed or its stages DISAGREE (a cross-stage inconsistency / tamper). Resolve the failing CI bundle before archiving this as a clean record.",
  },
  "governance-missing": {
    severity: "insufficient",
    detail:
      "No governance bundle was supplied, so the review window's PRIMARY posture is unproven. A trend / report / audit / CI bundle is a component record — it can never substitute for the governance bundle's window-level posture. Generate `worker:release-governance` for this window and supply it with `--governance`.",
  },
  "governance-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied governance bundle could not be read / recognized as a `pdfxyz.release-governance/1` (wrong schema or unparseable — never echoed), so the record has no primary posture. Supply a readable governance bundle produced by `worker:release-governance` and re-run.",
  },
  "governance-incomplete": {
    severity: "insufficient",
    detail:
      "The governance bundle's verdict is INCOMPLETE: its review window had insufficient evidence (an absent / unreadable / unknown trend, an indeterminate latest, or a required document missing). The window's posture could not be certified — resolve the governance bundle's coverage gap and re-run.",
  },
  "trend-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied trend could not be read / recognized as a `pdfxyz.release-trend/1` (wrong schema or unparseable — never echoed), so it contributes no window-history evidence. Supply a readable trend produced by `worker:release-trend` and re-run.",
  },
  "trend-unknown": {
    severity: "insufficient",
    detail:
      "The supplied release trend's verdict is UNKNOWN: its report history was insufficient (an unreadable / empty history, or a needs-evidence newest). The window's history could not be summarized — supply a readable, sufficient report history to the trend and re-run.",
  },
  "trend-missing": {
    severity: "insufficient",
    detail:
      "`--require-trend` was set but no `pdfxyz.release-trend/1` was supplied. The archive policy requires the trend the governance bundle summarized for this record; supply it and re-run.",
  },
  "report-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied latest report could not be read / recognized as a `pdfxyz.release-report/1` (wrong schema or unparseable — never echoed), so it contributes no latest-release evidence. Supply a readable report produced by `worker:release-report` and re-run.",
  },
  "report-needs-evidence": {
    severity: "insufficient",
    detail:
      "The supplied latest operator report is NEEDS-EVIDENCE: the most recent release could not be certified (an unreadable / audit-only / indeterminate evidence set). Gate the latest release's own coherence and re-run its report before archiving this as a clean record.",
  },
  "report-missing": {
    severity: "insufficient",
    detail:
      "`--require-report` was set but no latest `pdfxyz.release-report/1` was supplied. The archive policy requires the latest operator report for this record; supply it and re-run.",
  },
  "audit-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied latest audit could not be read / recognized as a `pdfxyz.release-audit/1` (wrong schema or unparseable — never echoed), so it contributes no regression evidence. Supply a readable audit produced by `worker:release-audit` and re-run.",
  },
  "audit-inconclusive": {
    severity: "insufficient",
    detail:
      "The supplied latest release audit's verdict is UNKNOWN: a supplied bundle was unreadable, or there was too little comparable history to diff. The regression check could not be performed — supply a readable baseline + current and re-run the audit.",
  },
  "audit-missing": {
    severity: "insufficient",
    detail:
      "`--require-audit` was set but no latest `pdfxyz.release-audit/1` was supplied. The archive policy requires the latest regression guard for this record; supply it and re-run.",
  },
  "bundle-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied latest CI bundle could not be read / recognized as a `pdfxyz.release-ci-bundle/1` (wrong schema or unparseable — never echoed), so it contributes no job evidence. Supply a readable bundle produced by `worker:release-ci-bundle` and re-run.",
  },
  "bundle-unknown": {
    severity: "insufficient",
    detail:
      "The supplied latest CI bundle's verdict is UNKNOWN: an unreadable / decision-less stage chain. The job's coherence could not be summarized — supply a readable, complete CI bundle and re-run.",
  },
  "bundle-missing": {
    severity: "insufficient",
    detail:
      "`--require-bundle` was set but no latest `pdfxyz.release-ci-bundle/1` was supplied. The archive policy requires the latest CI job evidence for this record; supply it and re-run.",
  },
  "governance-watch": {
    severity: "advisory",
    detail:
      "The governance bundle's verdict is WATCH: no blocker, but the review window carried an advisory concern (a warning trend, a hold-warning report, an audit drift, or a trend mismatch). Review the window posture, then archive with the decision recorded.",
  },
  "trend-warning": {
    severity: "advisory",
    detail:
      "The supplied release trend's verdict is WARNING: no blocker, but the recent report history carried an advisory concern. Review the recent posture, then decide.",
  },
  "report-hold-warning": {
    severity: "advisory",
    detail:
      "The supplied latest operator report is HOLD-WARNING: no blocker, but the most recent release carried an advisory concern (a bundle warn / a non-blocking audit drift). Review the flagged concern, then decide.",
  },
  "audit-drift": {
    severity: "advisory",
    detail:
      "The supplied latest release audit reported a NON-blocking drift versus its baseline (the posture softened, a link / stage weakened, or advisory pressure rose). Review the drift; if expected, accept it deliberately in the audit and re-run.",
  },
  "bundle-warning": {
    severity: "advisory",
    detail:
      "The supplied latest CI bundle's verdict is WARN: no blocker, but a stage sat at an advisory level (a warn artifact / a policy warning). Review the flagged stage, then decide.",
  },
  "trend-governance-mismatch": {
    severity: "advisory",
    detail:
      "The supplied trend's posture DISAGREES with the governance bundle's OWN recorded trend posture: the two independent records differ, so one may be stale — or the supplied trend post-dates the governance bundle's window. Reconcile them (regenerate the governance bundle over the current trend) so the archive record is consistent.",
  },
  "report-governance-mismatch": {
    severity: "advisory",
    detail:
      "The supplied latest report DISAGREES with the governance bundle's OWN recorded latest-report posture: the two independent records differ, so one may be stale — or the supplied report post-dates the governance bundle's window. Reconcile them so the archive record is consistent.",
  },
  "audit-governance-mismatch": {
    severity: "advisory",
    detail:
      "The supplied latest audit DISAGREES with the governance bundle's OWN recorded latest-audit posture: the two independent records differ, so one may be stale — or the supplied audit post-dates the governance bundle's window. Reconcile them so the archive record is consistent.",
  },
};

/** Per-follow-up authored detail, keyed by id. */
export const RELEASE_ARCHIVE_FOLLOWUP_DETAIL: Record<ReleaseArchiveFollowupId, string> = {
  "investigate-blocked-archive":
    "Investigate the blocking archive issue (a blocked governance, a failing trend, a hold-fail latest report, a blocking audit regression, or a failed CI bundle) and resolve the underlying release issue before the review closes; recover the untampered records from your CI archive if needed.",
  "recover-tampered-evidence":
    "Recover the untampered record from your CI archive: a recorded verdict / recommendation / rollup that does not re-derive means the record was hand-edited or corrupted, and cannot anchor the archive record.",
  "refresh-governance":
    "Regenerate the release governance bundle with `worker:release-governance` over the current review window (its trend + the latest report / audit) and re-run this pack: an absent / unreadable / incomplete governance bundle cannot certify the record.",
  "reconcile-evidence-mismatch":
    "A supplied related record (trend / report / audit) disagrees with the governance bundle's OWN recorded posture: one is stale, or post-dates the governance window. Regenerate the governance bundle over the current records so the archive record is internally consistent, then re-run.",
  "review-watch-archive":
    "Review the advisory archive concern (a watch governance, a warning trend, a hold-warning report, an audit / bundle drift, or a record mismatch) and decide whether follow-up is warranted; archive this pack as the record of that decision.",
  "supply-required-evidence":
    "Supply the missing / unreadable / indeterminate content-free record — the `pdfxyz.release-trend/1`, latest `pdfxyz.release-report/1`, `pdfxyz.release-audit/1`, and/or `pdfxyz.release-ci-bundle/1` (required when `--require-trend` / `--require-report` / `--require-audit` / `--require-bundle` is set) — and re-run this pack.",
  "continue-archive-cadence":
    "The review record is archivable: keep composing governance bundles per review window and archiving this pack (plus the underlying records) on your weekly / monthly cadence. This pack archives nothing on its own.",
  "archive-evidence-pack":
    "Archive this pack (and the underlying governance / trend / report / audit / CI bundle records) as CI artifacts: it is the content-free release-evidence archive record for this review window. This pack never uploads, zips, or promotes anything.",
};

/**
 * The honesty caveats every result carries and every text render prints. The pack INDEXES the chain's already
 * content-free evidence summaries for a review record, RE-VALIDATES each one's self-consistency, cross-checks
 * their coherence, and rolls them up into one archive posture; it must never be read as more than that.
 */
export const RELEASE_ARCHIVE_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE ARCHIVE PACK: it INGESTS a content-free `pdfxyz.release-governance/1` bundle (the PRIMARY signal) plus, optionally, the related content-free `pdfxyz.release-trend/1` / `pdfxyz.release-report/1` / `pdfxyz.release-audit/1` / `pdfxyz.release-ci-bundle/1` records a release pipeline produced, RE-VALIDATES each against ITSELF, cross-checks their coherence, and folds them into ONE bounded archive posture + record / follow-up checklists. It is local content-free ARCHIVE INDEXING over evidence summaries — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, immutable archive STORAGE, deployment APPROVAL, deployment PROMOTION, or a ZIP / tar / copy of raw files.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / bundle / audit / report / trend / governance itself, and NEVER deletes, prunes, uploads, zips, tars, copies, promotes, approves, or mutates any record, governance, trend, report, audit, bundle, artifact, index, policy, object, or deployment. An `archivable` pack authorizes nothing; it only reports that the content-free evidence supplied on THIS host was coherent for the review record.",
  "An `archivable` pack REQUIRES a usable governance bundle whose own verdict is `healthy`. The related trend / report / audit / CI bundle are component records that can BLOCK or FLAG but can never, on their own, GRANT an archivable record — so a governance-absent (or governance-unusable) run is honestly `archive-incomplete`, never an archivable. It FAILS CLOSED: a tampered / blocked / failing / regressed record blocks the pack; an absent governance, an unreadable record, or an indeterminate posture is insufficient.",
  "It re-derives each ingested record's rollup from the record's OWN recorded facts (reusing the Phase 50–54 reducers) and treats a recorded verdict / recommendation / rollup that does not re-derive as a TAMPER (`archive-blocked`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, commit URL, size, byte, digest, or record content, even from a hostile input; it never echoes an ingested record's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, deletion proof, or storage retention enforcement of any request or object, and it deletes, uploads, zips, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the pack carries but does NOT itself perform — the honest edges of an offline indexer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_ARCHIVE_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED archive-record artifact (weekly / monthly), NOT a per-release gate: run `worker:release-governance` per review window and archive its bundle, then hand that bundle (plus, optionally, the related LATEST trend / report / audit / CI bundle) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked pack or a tamper), surface exit 3 (a watch pack) for review, and treat exit 2 (insufficient evidence) as a coverage gap, not an archivable record.",
  "Supply at least the governance bundle: an `archivable` pack requires a usable, healthy governance bundle (the primary window signal). Add the related trend / report / audit / CI bundle to index them together and cross-check coherence — a stale record that disagrees with the governance record surfaces as a watch, and use `--require-trend` / `--require-report` / `--require-audit` / `--require-bundle` to make any of them mandatory for your policy.",
  "Archive this pack (and the underlying records) as CI artifacts: it is a content-free INDEX of which records to keep together, not a substitute for the records it indexes, nor for your storage-side retention, signing, and release-APPROVAL processes, nor an immutable archive store.",
  "Enforce retention and immutability out of band: this pack REPORTS which content-free evidence to keep together, but zipping / copying the files, storing them immutably, enforcing retention, signing a release, and promoting a deployment are operator / CI / storage actions this offline indexer never performs.",
];
