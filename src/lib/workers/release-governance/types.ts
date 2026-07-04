/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence governance bundle** (Phase 54).
 *
 * Phases 46–53 built the release-evidence chain, one rung per phase: the release readiness gate folds the
 * content-free worker checks into ONE promotion verdict; the release artifact stamps it with bounded provenance
 * + an integrity digest; the release index re-verifies many artifacts into a retention manifest; the release
 * policy asserts bounded operator thresholds over that manifest; the release CI bundle
 * (`pdfxyz.release-ci-bundle/1`) composes a single release job's stage outputs and re-verifies their cross-stage
 * consistency; the release audit (`pdfxyz.release-audit/1`) diffs a baseline bundle against a current one; the
 * release operator report (`pdfxyz.release-report/1`, Phase 52) folds a bundle + optional audit into ONE
 * operator recommendation; and the release trend summary (`pdfxyz.release-trend/1`, Phase 53) summarizes a
 * bounded HISTORY of those reports into ONE governance verdict.
 *
 * This phase closes the *governance review* loop for a weekly / monthly release window. It INGESTS a
 * `pdfxyz.release-trend/1` summary (the PRIMARY, window-level governance signal) plus, optionally, the LATEST
 * `pdfxyz.release-report/1` (this window's point-in-time operator handoff) and/or the LATEST
 * `pdfxyz.release-audit/1` (this window's regression guard), RE-VALIDATES each against ITSELF through the
 * existing Phase 51/52/53 boundaries (so a hand-flipped verdict / recommendation / recommendation-distribution
 * is caught as a tamper), CROSS-CHECKS the latest report against the trend's own newest report, and folds them
 * into ONE stable, content-free `pdfxyz.release-governance/1` bundle a governance review archives —
 *
 *    "What is the governance posture for this review window, what bounded evidence should be archived, and what
 *     follow-up should be assigned?"
 *
 * — with a bounded governance verdict, a bounded reason set, a per-source posture, an archive checklist, and a
 * bounded follow-up assignment list, and it FAILS CLOSED when a document cannot be trusted or the primary trend
 * evidence is missing / insufficient.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the documents it
 * composes:
 *  - Every load-bearing token here is a bounded enum — a source id, a coverage state, a governance verdict, a
 *    severity, a reason id, a follow-up id, a checklist id — never a filename, path, object key, bucket, URL,
 *    endpoint, region, id, token, size, byte, raw ref, raw label, commit URL, or digest. The only non-enum
 *    values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested document (each — even one Phase 51/52/53 produced — is
 *    UNTRUSTED input here); it reduces every fact to a bounded enum, a small integer, or a boolean, it never
 *    echoes an ingested document's OWN stamp (the bundle carries only its own), and it never echoes an input
 *    file path, even on an error.
 *  - It never fabricates a "healthy". A `healthy` bundle REQUIRES a usable trend whose own verdict is `stable`:
 *    a trend only reports the recent posture over a report history — an absent / unreadable / unknown trend is
 *    INSUFFICIENT (never healthy), and a supplied-but-not-ready latest report / audit escalates or holds. A
 *    recognized-but-self-inconsistent document (a tamper), a failing trend, a hold-fail report, or a blocking
 *    audit regression is `blocked` (fail-closed).
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, NOT cloud
 * validation, NOT deployment approval, and NOT deployment promotion. It PROVES nothing the composed documents do
 * not already prove; it BUNDLES their content-free outputs for a governance review, RE-VALIDATES each one's
 * self-consistency, and rolls them up into one governance verdict + archive/follow-up checklists. Its authored
 * caveats (see {@link RELEASE_GOVERNANCE_CAVEATS}) say so out loud: it is local content-free GOVERNANCE BUNDLING
 * over evidence summaries — not signing, authentication, cloud validation, storage retention enforcement,
 * deployment approval, or deployment promotion.
 */

import { RELEASE_AUDIT_SCHEMA, type ReleaseAuditVerdict } from "../release-audit/types";
import {
  RELEASE_REPORT_SCHEMA,
  RELEASE_REPORT_RECOMMENDATIONS,
  type AuditSourceFacts,
  type ReleaseReportRecommendation,
} from "../release-report/types";
import {
  RELEASE_TREND_SCHEMA,
  type ReleaseTrendDirection,
  type ReleaseTrendVerdict,
  type TrendReportFacts,
} from "../release-trend/types";

/** The schema tag every release-governance result carries, so tooling can pin the shape it parses. */
export const RELEASE_GOVERNANCE_SCHEMA = "pdfxyz.release-governance/1" as const;

/** The upstream document schemas the bundle ingests. Re-exported so the result can pin each input shape. */
export { RELEASE_TREND_SCHEMA, RELEASE_REPORT_SCHEMA, RELEASE_AUDIT_SCHEMA };

/** Stable identity of the release-governance bundle — for docs / receipts / audit. */
export const RELEASE_GOVERNANCE_POLICY_ID = "pdfxyz-worker-release-governance";
/** Bump when the surface, the verdict ladder, the reason/follow-up/checklist sets, or the schema changes. */
export const RELEASE_GOVERNANCE_POLICY_VERSION = 1;

/** Re-exported for convenience (the reduced report/audit facts + the report recommendation distribution). */
export { RELEASE_REPORT_RECOMMENDATIONS };
export type { ReleaseReportRecommendation, ReleaseAuditVerdict, ReleaseTrendVerdict };

/**
 * The three evidence sources the governance bundle composes — the stable keys a reviewer routes on:
 *  - `trend`  — the `pdfxyz.release-trend/1` window summary (the PRIMARY governance signal; the window-level
 *               posture over the recent report history). Required for a `healthy` bundle;
 *  - `report` — the LATEST `pdfxyz.release-report/1` operator report (this window's point-in-time handoff; a
 *               SECONDARY signal that can BLOCK / FLAG, but can never, on its own, GRANT a healthy bundle);
 *  - `audit`  — the LATEST `pdfxyz.release-audit/1` regression diff (this window's regression guard; a SECONDARY
 *               signal that can BLOCK / FLAG, but can never, on its own, GRANT a healthy bundle).
 */
export const RELEASE_GOVERNANCE_SOURCE_IDS = ["trend", "report", "audit"] as const;
export type ReleaseGovernanceSourceId = (typeof RELEASE_GOVERNANCE_SOURCE_IDS)[number];

/**
 * The bounded coverage state of one evidence source:
 *  - `absent`     — no file was supplied for this source (the honest default; never a fault for an optional
 *                   source, but the PRIMARY trend being absent is an insufficiency, resolved by the rollup);
 *  - `unreadable` — a file was supplied but could not be read / parsed / recognized (never echoed);
 *  - `tampered`   — the document was recognized but its recorded rollup does NOT re-derive from its own facts
 *                   (a hand-edited / corrupt document — treated as a blocking failure);
 *  - `usable`     — recognized AND self-consistent (its recorded rollup re-derives): trustworthy evidence.
 */
export const RELEASE_GOVERNANCE_SOURCE_STATES = ["absent", "unreadable", "tampered", "usable"] as const;
export type ReleaseGovernanceSourceState = (typeof RELEASE_GOVERNANCE_SOURCE_STATES)[number];

/**
 * The single governance verdict a review / CI keys on — the answer to "what is this window's governance
 * posture?":
 *  - `healthy`    — the PRIMARY trend is usable and `stable`, and every supplied latest source is clean (a
 *                   usable report that is `promote-ready`, a usable audit that is `pass`): a coherent,
 *                   non-regressed, healthy governance window. Archive and continue;
 *  - `watch`      — no blocker and evidence is sufficient, but an ADVISORY concern was raised (a `warning`
 *                   trend, a `hold-warning` latest report, an audit `warn` drift, or the latest report drifting
 *                   from the trend's newest report): review, then decide;
 *  - `incomplete` — the evidence is INSUFFICIENT to certify the window: the PRIMARY trend is absent / unreadable
 *                   / `unknown`, a supplied latest document was unreadable / indeterminate (`needs-evidence`
 *                   report, `unknown` audit), or a `--require-report` / `--require-audit` document was missing.
 *                   Fail-closed, not a healthy;
 *  - `blocked`    — a BLOCKING issue: a supplied document is recognized but self-inconsistent (a tamper), the
 *                   trend is `failing`, the latest report is `hold-fail`, or the latest audit reported a blocking
 *                   regression. The strongest signal; it dominates. An `invalid` (tampered) document folds here.
 *
 * These are the exact bounded values the run-level `worker_release_governance_total` metric carries as its
 * `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_GOVERNANCE_VERDICTS = ["healthy", "watch", "incomplete", "blocked"] as const;
export type ReleaseGovernanceVerdict = (typeof RELEASE_GOVERNANCE_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape as the gate/artifact/index/policy/
 * ci-bundle/audit/report/trend ladders so the whole worker suite speaks one language:
 *  - `0` HEALTHY    — a coherent, non-regressed, healthy governance window;
 *  - `1` USAGE      — the CLI was misused (a bad flag, no document supplied, or an unwritable output). CLI-owned;
 *                     a governance RUN never resolves to it;
 *  - `2` INCOMPLETE — the evidence was insufficient to certify the window (an absent / unreadable / unknown
 *                     trend, an indeterminate latest, or a required-but-missing document);
 *  - `3` WATCH      — an advisory posture (a warning trend, a hold-warning report, an audit drift, or a drift
 *                     between the latest report and the trend);
 *  - `4` BLOCKED    — a blocking posture (a tampered / invalid document, a failing trend, a hold-fail report, or
 *                     a blocking audit regression).
 * Monotonic — a higher code is always a stronger "do not treat this governance window as healthy".
 */
export const RELEASE_GOVERNANCE_EXIT = {
  HEALTHY: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  WATCH: 3,
  BLOCKED: 4,
} as const;
export type ReleaseGovernanceExitCode =
  (typeof RELEASE_GOVERNANCE_EXIT)[keyof typeof RELEASE_GOVERNANCE_EXIT];

/**
 * The common **severity** each source's native posture, and each fired reason, maps onto so the bundle can fold
 * three different ladders (trend `stable|warning|unknown|failing`, report `promote-ready|hold-warning|
 * needs-evidence|hold-fail`, audit `pass|warn|unknown|fail`) plus the coverage states into one verdict:
 *  - `ready`        — a usable source at its best posture (best);
 *  - `advisory`     — a usable source carrying an advisory concern, or an advisory reason;
 *  - `insufficient` — an absent primary / unreadable / indeterminate document, or an insufficiency reason;
 *  - `blocking`     — a tampered document, a failing trend, a hold-fail report, or a blocking audit regression
 *                     (worst).
 *
 * Precedence when folding is `blocking > insufficient > advisory > ready` (checked in that order, exactly like
 * the Phase 50/52/53 rollups — so an insufficient posture never masquerades as a mere advisory, and a real
 * blocker is never masked). A source that is not supplied contributes no severity (`null`).
 */
export const RELEASE_GOVERNANCE_SEVERITIES = ["ready", "advisory", "insufficient", "blocking"] as const;
export type ReleaseGovernanceSeverity = (typeof RELEASE_GOVERNANCE_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence. */
export const RELEASE_GOVERNANCE_SEVERITY_RANK: Record<ReleaseGovernanceSeverity, number> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
};

/** A usable trend's verdict → common governance severity. */
export const TREND_SEVERITY: Record<ReleaseTrendVerdict, ReleaseGovernanceSeverity> = {
  stable: "ready",
  warning: "advisory",
  unknown: "insufficient",
  failing: "blocking",
};

/** A usable report's recommendation → common governance severity. */
export const REPORT_SEVERITY: Record<ReleaseReportRecommendation, ReleaseGovernanceSeverity> = {
  "promote-ready": "ready",
  "hold-warning": "advisory",
  "needs-evidence": "insufficient",
  "hold-fail": "blocking",
};

/** A usable audit's verdict → common governance severity. */
export const AUDIT_SEVERITY: Record<ReleaseAuditVerdict, ReleaseGovernanceSeverity> = {
  pass: "ready",
  warn: "advisory",
  unknown: "insufficient",
  fail: "blocking",
};

/**
 * The bounded reason ids — the closed set of REASONS the governance verdict resolved as it did, emitted in this
 * stable order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The
 * per-id severity is authored in {@link RELEASE_GOVERNANCE_REASON_DETAIL}:
 *  - `trend-tampered`         — the trend is recognized but self-inconsistent (a tamper). BLOCKING;
 *  - `trend-failing`          — a usable trend's verdict is `failing`. BLOCKING;
 *  - `report-tampered`        — the latest report is recognized but self-inconsistent (a tamper). BLOCKING;
 *  - `report-hold-fail`       — a usable latest report is `hold-fail` (a currently-held release). BLOCKING;
 *  - `audit-tampered`         — the latest audit is recognized but self-inconsistent (a tamper). BLOCKING;
 *  - `audit-regressed`        — a usable latest audit reported a blocking regression (verdict `fail`). BLOCKING;
 *  - `trend-missing`          — NO trend was supplied, so the window's PRIMARY posture is unproven. INSUFFICIENT;
 *  - `trend-unreadable`       — the supplied trend could not be read / recognized. INSUFFICIENT;
 *  - `trend-unknown`          — a usable trend's verdict is `unknown` (an insufficient report history). INSUFFICIENT;
 *  - `report-unreadable`      — the supplied latest report could not be read / recognized. INSUFFICIENT;
 *  - `report-needs-evidence`  — a usable latest report is `needs-evidence` (its release could not be certified). INSUFFICIENT;
 *  - `report-missing`         — `--require-report` was set but no latest report was supplied. INSUFFICIENT;
 *  - `audit-unreadable`       — the supplied latest audit could not be read / recognized. INSUFFICIENT;
 *  - `audit-inconclusive`     — a usable latest audit's verdict is `unknown` (too little comparable history). INSUFFICIENT;
 *  - `audit-missing`          — `--require-audit` was set but no latest audit was supplied. INSUFFICIENT;
 *  - `trend-warning`          — a usable trend's verdict is `warning` (an advisory recent posture). ADVISORY;
 *  - `report-hold-warning`    — a usable latest report is `hold-warning` (an advisory concern). ADVISORY;
 *  - `audit-drift`            — a usable latest audit's verdict is `warn` (a non-blocking drift). ADVISORY;
 *  - `report-trend-mismatch`  — a usable latest report's recommendation differs from the trend's own newest
 *                               report (the two independent evidence sources disagree — one may be stale, or the
 *                               latest release post-dates the trend window). ADVISORY.
 */
export const RELEASE_GOVERNANCE_REASON_IDS = [
  // Blocking
  "trend-tampered",
  "trend-failing",
  "report-tampered",
  "report-hold-fail",
  "audit-tampered",
  "audit-regressed",
  // Insufficient
  "trend-missing",
  "trend-unreadable",
  "trend-unknown",
  "report-unreadable",
  "report-needs-evidence",
  "report-missing",
  "audit-unreadable",
  "audit-inconclusive",
  "audit-missing",
  // Advisory
  "trend-warning",
  "report-hold-warning",
  "audit-drift",
  "report-trend-mismatch",
] as const;
export type ReleaseGovernanceReasonId = (typeof RELEASE_GOVERNANCE_REASON_IDS)[number];

/**
 * The bounded archive-checklist ids — which content-free files a reviewer should keep as the governance record:
 *  - `release-trend`     — the supplied trend summary (kept iff a trend was supplied + recognized);
 *  - `latest-report`     — the supplied latest operator report (kept iff a report was supplied + recognized);
 *  - `latest-audit`      — the supplied latest audit (kept iff an audit was supplied + recognized);
 *  - `governance-bundle` — THIS bundle (always kept — the content-free governance record for the window).
 */
export const RELEASE_GOVERNANCE_CHECKLIST_IDS = [
  "release-trend",
  "latest-report",
  "latest-audit",
  "governance-bundle",
] as const;
export type ReleaseGovernanceChecklistId = (typeof RELEASE_GOVERNANCE_CHECKLIST_IDS)[number];

/**
 * The bounded follow-up assignment ids — the closed set of concrete operator steps the bundle can assign, in
 * this canonical order (the checklist is emitted in this order, deduped):
 *  - `investigate-blocked-governance` — investigate the blocking governance issue (a failing trend, a hold-fail
 *                                       report, or a blocking audit regression) before the review closes;
 *  - `recover-tampered-evidence`      — recover the untampered document from the CI archive; a tampered document
 *                                       cannot anchor the governance record;
 *  - `refresh-trend`                  — the trend is missing / unreadable / unknown, or is stale versus the
 *                                       latest report; regenerate `worker:release-trend` and re-run;
 *  - `gate-latest-release`            — the latest release is not promote-ready; gate its coherence
 *                                       (`worker:release-ci-bundle` / `worker:release-report`) and resolve;
 *  - `review-watch-governance`        — review the advisory governance concern and record the decision;
 *  - `supply-required-evidence`       — a required (`--require-report` / `--require-audit`) document was not
 *                                       supplied; supply it and re-run;
 *  - `continue-governance-cadence`    — governance is healthy; keep composing reports / trends on the weekly /
 *                                       monthly cadence;
 *  - `archive-governance-bundle`      — archive this bundle (and the underlying trend / report / audit) as the
 *                                       governance record.
 */
export const RELEASE_GOVERNANCE_FOLLOWUP_IDS = [
  "investigate-blocked-governance",
  "recover-tampered-evidence",
  "refresh-trend",
  "gate-latest-release",
  "review-watch-governance",
  "supply-required-evidence",
  "continue-governance-cadence",
  "archive-governance-bundle",
] as const;
export type ReleaseGovernanceFollowupId = (typeof RELEASE_GOVERNANCE_FOLLOWUP_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-source bounded facts (one shape per source; all enums / small ints / booleans)
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-trend/1` (its rollup re-derived in ingest). */
export interface GovernanceTrendFacts {
  /** The trend's governance verdict (trusted — the trend re-derived its own rollup). */
  readonly verdict: ReleaseTrendVerdict;
  /** The trend's own exit code (context; the bundle has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "stable"`. */
  readonly stable: boolean;
  /** How many reports in the trend window were usable. */
  readonly reportsUsable: number;
  /** How many reports were considered by the trend (after its own window cap). */
  readonly reportsConsidered: number;
  /** The trend's newest usable report recommendation, or `null` if none was usable. */
  readonly newest: ReleaseReportRecommendation | null;
  /** The trend's oldest usable report recommendation, or `null` if none was usable. */
  readonly oldest: ReleaseReportRecommendation | null;
  /** The trend's bounded arc from oldest usable to newest usable. */
  readonly direction: ReleaseTrendDirection;
  /** How many blocking reasons the trend itself carried. */
  readonly blocking: number;
  /** How many insufficiency reasons the trend itself carried. */
  readonly insufficiencies: number;
  /** How many advisory reasons the trend itself carried. */
  readonly advisories: number;
}

/** The bounded facts reduced from a usable latest `pdfxyz.release-report/1` (reused from the Phase 53 ingest). */
export type GovernanceReportFacts = TrendReportFacts;

/** The bounded facts reduced from a usable latest `pdfxyz.release-audit/1` (reused from the Phase 52 ingest). */
export type GovernanceAuditFacts = AuditSourceFacts;

/** The common bounded fields every reduced source carries. */
interface ReleaseGovernanceSourceBase {
  readonly state: ReleaseGovernanceSourceState;
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
  readonly severity: ReleaseGovernanceSeverity | null;
  /** A one-line, content-free headline authored from the source id + state + verdict. */
  readonly detail: string;
}

/**
 * One reduced evidence source — a discriminated union on {@link ReleaseGovernanceSourceId} so each source's
 * `facts` are strongly typed. Every field is a bounded enum, a small integer, or a boolean; never a raw value
 * from the input.
 */
export type ReleaseGovernanceSource =
  | (ReleaseGovernanceSourceBase & { readonly id: "trend"; readonly facts: GovernanceTrendFacts | null })
  | (ReleaseGovernanceSourceBase & { readonly id: "report"; readonly facts: GovernanceReportFacts | null })
  | (ReleaseGovernanceSourceBase & { readonly id: "audit"; readonly facts: GovernanceAuditFacts | null });

/** The bounded coverage summary — which sources were supplied and which are trustworthy evidence. */
export interface ReleaseGovernanceCoverage {
  /** How many of the three sources were supplied (0–3). */
  readonly sourcesSupplied: number;
  /** How many of the three sources are usable (recognized + self-consistent) (0–3). */
  readonly sourcesUsable: number;
  /** The trend source's coverage state. */
  readonly trend: ReleaseGovernanceSourceState;
  /** The report source's coverage state. */
  readonly report: ReleaseGovernanceSourceState;
  /** The audit source's coverage state. */
  readonly audit: ReleaseGovernanceSourceState;
  /** True iff a usable trend was supplied (the primary window signal is present). */
  readonly hasTrend: boolean;
  /** True iff a usable latest report was supplied. */
  readonly hasReport: boolean;
  /** True iff a usable latest audit was supplied. */
  readonly hasAudit: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseGovernancePolicy {
  /** True iff `--require-report` was set (a latest report must be supplied). */
  readonly requireReport: boolean;
  /** True iff `--require-audit` was set (a latest audit must be supplied). */
  readonly requireAudit: boolean;
  /** True iff `--strict-watch` was set (escalate an advisory-only posture to `blocked`). */
  readonly strictWatch: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseGovernanceReason {
  readonly id: ReleaseGovernanceReasonId;
  readonly severity: ReleaseGovernanceSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One follow-up assignment, with its authored detail. */
export interface ReleaseGovernanceFollowup {
  readonly id: ReleaseGovernanceFollowupId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The bounded archive guidance — which content-free files a reviewer should keep as the governance record. */
export interface ReleaseGovernanceArchiveGuidance {
  /** The checklist ids to archive, in canonical order. */
  readonly items: readonly ReleaseGovernanceChecklistId[];
  /** Bounded, app-authored archive note. Never derived from an input. */
  readonly note: string;
}

/** The composite governance decision — the single verdict + exit code a review acts on. */
export interface ReleaseGovernanceRollup {
  readonly verdict: ReleaseGovernanceVerdict;
  readonly exitCode: ReleaseGovernanceExitCode;
  /** True iff `verdict === "healthy"`. */
  readonly healthy: boolean;
  /** The fired reason ids, in canonical order (empty on a clean healthy bundle). */
  readonly reasons: readonly ReleaseGovernanceReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--require-report` was applied. */
  readonly requireReport: boolean;
  /** True iff `--require-audit` was applied. */
  readonly requireAudit: boolean;
  /** True iff `--strict-watch` was applied. */
  readonly strictWatch: boolean;
  /**
   * True iff `--strict-watch` ESCALATED an advisory-only posture to `blocked` (would have been `watch`). The
   * bundle would be `watch` without the flag; surfaced so the summary explains the escalation.
   */
  readonly strictWatchEscalated: boolean;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream document schemas). */
export interface ReleaseGovernanceMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_GOVERNANCE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_GOVERNANCE_POLICY_VERSION;
  readonly trendSchema: typeof RELEASE_TREND_SCHEMA;
  readonly reportSchema: typeof RELEASE_REPORT_SCHEMA;
  readonly auditSchema: typeof RELEASE_AUDIT_SCHEMA;
}

/**
 * The stable, content-free release evidence governance bundle a weekly / monthly review archives. Every field is
 * a bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no locator, identifier,
 * size, path, or byte, even from a hostile input, and never echoes an ingested document's own stamp.
 */
export interface ReleaseGovernanceResult {
  readonly schema: typeof RELEASE_GOVERNANCE_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseGovernanceMetadata;
  readonly policy: ReleaseGovernancePolicy;
  readonly coverage: ReleaseGovernanceCoverage;
  /** One reduced summary per source, in canonical {@link RELEASE_GOVERNANCE_SOURCE_IDS} order. */
  readonly sources: readonly ReleaseGovernanceSource[];
  readonly governance: ReleaseGovernanceRollup;
  /** Every fired reason, in canonical {@link RELEASE_GOVERNANCE_REASON_IDS} order. */
  readonly reasons: readonly ReleaseGovernanceReason[];
  /** Which content-free files to archive as the governance record. */
  readonly archive: ReleaseGovernanceArchiveGuidance;
  /** The bounded, ordered follow-up assignment checklist. Never derived from an input. */
  readonly followUps: readonly ReleaseGovernanceFollowup[];
  /** Bounded, app-authored guidance (out-of-scope steps this bundle does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested document. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseGovernanceReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did
 * this governance bundle conclude, over how many usable sources, with how many blocking / insufficiency /
 * advisory reasons" for a SIEM / governance record. Bounded enums + small integers + a stable policy id + the
 * run's own stamp only; safe to log or forward verbatim.
 */
export interface ReleaseGovernanceReceipt {
  readonly category: "worker-release-governance";
  readonly policyId: typeof RELEASE_GOVERNANCE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_GOVERNANCE_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseGovernanceVerdict;
  readonly exitCode: ReleaseGovernanceExitCode;
  /** How many sources were supplied. */
  readonly sourcesSupplied: number;
  /** How many sources are usable. */
  readonly sourcesUsable: number;
  /** True iff a usable trend was supplied (primary window signal present). */
  readonly hasTrend: boolean;
  /** True iff a usable latest report was supplied. */
  readonly hasReport: boolean;
  /** True iff a usable latest audit was supplied. */
  readonly hasAudit: boolean;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  /** True iff `--require-report` was applied. */
  readonly requireReport: boolean;
  /** True iff `--require-audit` was applied. */
  readonly requireAudit: boolean;
  /** True iff `--strict-watch` was applied. */
  readonly strictWatch: boolean;
}

/** The process exit code for a governance result. */
export function releaseGovernanceExitCode(result: ReleaseGovernanceResult): number {
  return result.governance.exitCode;
}

/** The authoritative verdict → exit code map. */
export const RELEASE_GOVERNANCE_EXIT_FOR_VERDICT: Record<
  ReleaseGovernanceVerdict,
  ReleaseGovernanceExitCode
> = {
  healthy: RELEASE_GOVERNANCE_EXIT.HEALTHY,
  watch: RELEASE_GOVERNANCE_EXIT.WATCH,
  incomplete: RELEASE_GOVERNANCE_EXIT.INCOMPLETE,
  blocked: RELEASE_GOVERNANCE_EXIT.BLOCKED,
};

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested document)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_GOVERNANCE_VERDICT_SUMMARY: Record<ReleaseGovernanceVerdict, string> = {
  healthy:
    "HEALTHY: the governance window is coherent — the PRIMARY release trend is STABLE, and every supplied latest source is clean (a promote-ready report, a passing audit). Archive this bundle as the governance record and continue on your cadence. This bundle authorizes nothing on its own.",
  watch:
    "WATCH (advisory): no blocker and the evidence is sufficient, but an ADVISORY concern was raised — a warning trend, a hold-warning latest report, an audit drift, or a drift between the latest report and the trend's newest report. Review the flagged concern, then decide whether follow-up is warranted.",
  incomplete:
    "INCOMPLETE (insufficient): the content-free evidence is INSUFFICIENT to certify this governance window — the PRIMARY release trend is absent / unreadable / UNKNOWN, a supplied latest document was unreadable or indeterminate, or a required document was missing. This is a setup / coverage problem, not a healthy window.",
  blocked:
    "BLOCKED: a BLOCKING issue — a supplied document is recognized but self-inconsistent (a tamper), the release trend is FAILING, the latest report is HOLD-FAIL, or the latest audit reported a blocking regression. Do not treat this governance window as healthy until the failure or tamper is resolved.",
};

/**
 * The dedicated headline for a `blocked` bundle produced ONLY because `--strict-watch` escalated an
 * advisory-only posture (a warning trend / hold-warning report / audit drift / trend mismatch) — there was no
 * tamper, failing trend, hold-fail report, or blocking regression, so the generic `blocked` summary would
 * misrepresent the cause. Authored; selected by the rollup when `strictWatchEscalated`.
 */
export const RELEASE_GOVERNANCE_STRICT_WATCH_ESCALATED_SUMMARY =
  "BLOCKED (--strict-watch): the only concern was ADVISORY (a warning trend / a hold-warning report / an audit drift / a trend mismatch), which `--strict-watch` escalates to a blocking governance hold. Without `--strict-watch` this would be WATCH, exit 3. No tamper, failing trend, hold-fail report, or blocking audit regression was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_GOVERNANCE_REASON_DETAIL: Record<
  ReleaseGovernanceReasonId,
  { readonly severity: ReleaseGovernanceSeverity; readonly detail: string }
> = {
  "trend-tampered": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-trend/1` is recognized but its recorded verdict / history does NOT re-derive from its own per-report points — a hand-edited or corrupt trend. Recover the untampered trend from your CI archive; a tampered trend cannot anchor the governance record.",
  },
  "trend-failing": {
    severity: "blocking",
    detail:
      "The release trend's verdict is FAILING: the recent report history is failing (a tampered report, a hold-fail newest, or a breached threshold in the window). The window's primary posture is blocking — investigate the failing trend before treating governance as healthy.",
  },
  "report-tampered": {
    severity: "blocking",
    detail:
      "The supplied latest `pdfxyz.release-report/1` is recognized but its recorded recommendation does NOT re-derive from its own sources — a hand-edited or corrupt report. Recover the untampered report from your CI archive; a tampered report cannot be bundled.",
  },
  "report-hold-fail": {
    severity: "blocking",
    detail:
      "The latest operator report is HOLD-FAIL: the most recent release was held for a blocking issue (a tampered / failed / regressed evidence set). Investigate and resolve the latest release before treating this governance window as healthy.",
  },
  "audit-tampered": {
    severity: "blocking",
    detail:
      "The supplied latest `pdfxyz.release-audit/1` is recognized but its recorded rollup does NOT re-derive from its own findings — a hand-edited or corrupt audit. Recover the untampered audit from your CI archive; a tampered audit cannot be bundled.",
  },
  "audit-regressed": {
    severity: "blocking",
    detail:
      "The latest release audit reported a BLOCKING regression versus its baseline (the current bundle dropped to fail, a held link now mismatches, or the archive decision worsened). Investigate the regression before treating this governance window as healthy.",
  },
  "trend-missing": {
    severity: "insufficient",
    detail:
      "No release trend was supplied, so the window's PRIMARY posture is unproven. A latest report / audit is a point-in-time signal — it can never substitute for the trend's window-level governance summary. Generate `worker:release-trend` over the recent report history and supply it.",
  },
  "trend-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied trend could not be read / recognized as a `pdfxyz.release-trend/1` (wrong schema or unparseable — never echoed), so the window has no primary posture. Supply a readable trend produced by `worker:release-trend` and re-run.",
  },
  "trend-unknown": {
    severity: "insufficient",
    detail:
      "The release trend's verdict is UNKNOWN: its report history was insufficient (an unreadable / empty history, or a needs-evidence newest). The window's primary posture could not be summarized — supply a readable, sufficient report history to the trend and re-run.",
  },
  "report-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied latest report could not be read / recognized as a `pdfxyz.release-report/1` (wrong schema or unparseable — never echoed), so it contributes no latest-release evidence. Supply a readable report produced by `worker:release-report` and re-run.",
  },
  "report-needs-evidence": {
    severity: "insufficient",
    detail:
      "The latest operator report is NEEDS-EVIDENCE: the most recent release could not be certified (an unreadable / audit-only / indeterminate evidence set). Gate the latest release's own coherence and re-run its report before treating governance as healthy.",
  },
  "report-missing": {
    severity: "insufficient",
    detail:
      "`--require-report` was set but no latest `pdfxyz.release-report/1` was supplied. The governance policy requires the latest operator report for this window; supply it and re-run.",
  },
  "audit-unreadable": {
    severity: "insufficient",
    detail:
      "The supplied latest audit could not be read / recognized as a `pdfxyz.release-audit/1` (wrong schema or unparseable — never echoed), so it contributes no regression evidence. Supply a readable audit produced by `worker:release-audit` and re-run.",
  },
  "audit-inconclusive": {
    severity: "insufficient",
    detail:
      "The latest release audit's verdict is UNKNOWN: a supplied bundle was unreadable, or there was too little comparable history to diff. The regression check could not be performed — supply a readable baseline + current and re-run the audit.",
  },
  "audit-missing": {
    severity: "insufficient",
    detail:
      "`--require-audit` was set but no latest `pdfxyz.release-audit/1` was supplied. The governance policy requires the latest regression guard for this window; supply it and re-run.",
  },
  "trend-warning": {
    severity: "advisory",
    detail:
      "The release trend's verdict is WARNING: no blocker, but the recent report history carried an advisory concern (a hold-warning newest, warnings increased, or a breached warning threshold). Review the recent posture, then decide.",
  },
  "report-hold-warning": {
    severity: "advisory",
    detail:
      "The latest operator report is HOLD-WARNING: no blocker, but the most recent release carried an advisory concern (a bundle warn / a non-blocking audit drift). Review the flagged concern, then decide.",
  },
  "audit-drift": {
    severity: "advisory",
    detail:
      "The latest release audit reported a NON-blocking drift versus its baseline (the posture softened, a link / stage weakened, or advisory pressure rose). Review the drift; if expected, accept it deliberately in the audit and re-run.",
  },
  "report-trend-mismatch": {
    severity: "advisory",
    detail:
      "The latest operator report's recommendation differs from the release trend's own NEWEST report: the two independent evidence sources disagree, so one may be stale — or the latest release post-dates the trend's window. Regenerate the trend over the current report history so the governance record is consistent.",
  },
};

/** Per-follow-up authored detail, keyed by id. */
export const RELEASE_GOVERNANCE_FOLLOWUP_DETAIL: Record<ReleaseGovernanceFollowupId, string> = {
  "investigate-blocked-governance":
    "Investigate the blocking governance issue (a failing trend, a hold-fail latest report, or a blocking audit regression) and resolve the underlying release issue before the review closes; recover the untampered documents from your CI archive if needed.",
  "recover-tampered-evidence":
    "Recover the untampered document from your CI archive: a recorded verdict / recommendation that does not re-derive means the document was hand-edited or corrupted, and cannot anchor the governance record.",
  "refresh-trend":
    "Regenerate the release trend with `worker:release-trend` over the recent content-free `pdfxyz.release-report/1` history (oldest first, newest last) and re-run this bundle: an absent / unreadable / unknown trend, or a trend that is stale versus the latest report, cannot certify the window.",
  "gate-latest-release":
    "The latest release is not promote-ready (needs-evidence, or a hold): gate the latest release's own coherence with `worker:release-ci-bundle` / `worker:release-report` and resolve it before treating this governance window as healthy.",
  "review-watch-governance":
    "Review the advisory governance concern (a warning trend, a hold-warning latest report, an audit drift, or a drift between the latest report and the trend) and decide whether follow-up is warranted; archive this bundle as the record of that decision.",
  "supply-required-evidence":
    "Supply the missing / unreadable / indeterminate content-free document — the latest `pdfxyz.release-report/1` and/or `pdfxyz.release-audit/1` (required when `--require-report` / `--require-audit` is set) — and re-run this bundle; a missing or unreadable document leaves the window uncertified.",
  "continue-governance-cadence":
    "The governance window is healthy: keep composing operator reports per release, summarizing them with `worker:release-trend`, and bundling here on your weekly / monthly cadence. This bundle authorizes no promotion on its own.",
  "archive-governance-bundle":
    "Archive this governance bundle (and the underlying trend / report / audit) as CI artifacts: it is the content-free release-governance record for this review window. This bundle never uploads or promotes anything.",
};

/**
 * The honesty caveats every result carries and every text render prints. The bundle COMPOSES the chain's
 * already content-free evidence summaries for a governance review, RE-VALIDATES each one's self-consistency, and
 * rolls them up into one governance verdict; it must never be read as more than that.
 */
export const RELEASE_GOVERNANCE_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE GOVERNANCE BUNDLE: it INGESTS a content-free `pdfxyz.release-trend/1` window summary (the PRIMARY signal) plus, optionally, the latest content-free `pdfxyz.release-report/1` and/or `pdfxyz.release-audit/1` a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded governance verdict + archive / follow-up checklists. It is local content-free GOVERNANCE BUNDLING over evidence summaries — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / bundle / audit / report / trend itself, and NEVER deletes, prunes, uploads, promotes, approves, or mutates any document, trend, report, audit, artifact, index, policy, object, or deployment. A `healthy` bundle authorizes nothing; it only reports that the content-free evidence supplied on THIS host was coherent for the review window.",
  "A `healthy` bundle REQUIRES a usable release TREND whose own verdict is `stable`. The latest report / audit are point-in-time signals that can BLOCK or FLAG but can never, on their own, GRANT a healthy window — so a trend-absent (or trend-unusable) run is honestly `incomplete`, never a healthy. It FAILS CLOSED: a tampered / failing / regressed input blocks the window; an absent trend, an unreadable document, or an indeterminate posture is insufficient.",
  "It re-derives each ingested document's rollup from the document's OWN recorded facts (reusing the Phase 51/52/53 reducers) and treats a recorded verdict / recommendation that does not re-derive as a TAMPER (`blocked`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, commit URL, size, byte, digest, or document content, even from a hostile input; it never echoes an ingested document's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the bundle carries but does NOT itself perform — the honest edges of an offline
 * bundler. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_GOVERNANCE_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED governance-review artifact (weekly / monthly), NOT a per-release gate: run `worker:release-report` per release and archive each report, summarize the history with `worker:release-trend`, and hand that trend (plus, optionally, the LATEST report / audit) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked window or a tamper), surface exit 3 (a watch window) for review, and treat exit 2 (insufficient evidence) as a coverage gap, not a healthy window.",
  "Supply at least the release TREND: a `healthy` bundle requires a usable, stable trend (the primary window signal). Add the latest report / audit for point-in-time guards — a hold-fail report or a blocking audit regression blocks the window even when the trend is stable, and use `--require-report` / `--require-audit` to make either mandatory for your policy.",
  "Archive this governance bundle (and the underlying trend / report / audit) as CI artifacts: it is a content-free governance record, not a substitute for the documents it composes, nor for your storage-side retention, signing, and release-APPROVAL processes.",
  "Enforce promotion out of band: this bundle REPORTS a governance posture over the content-free evidence supplied, but signing a release, provisioning, approving, and promoting a deployment are operator / CI actions this offline bundler never performs.",
];
