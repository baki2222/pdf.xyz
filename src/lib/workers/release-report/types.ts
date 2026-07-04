/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence operator report**
 * (Phase 52).
 *
 * Phases 46–51 built the release-evidence chain, one rung per phase: the release readiness gate folds the
 * content-free worker checks into ONE promotion verdict; the release artifact stamps it with bounded
 * provenance + an integrity digest; the release index re-verifies many artifacts into a retention manifest;
 * the release policy asserts bounded operator thresholds over that manifest; the release CI bundle
 * (`pdfxyz.release-ci-bundle/1`, Phase 50) composes a single release job's stage outputs and re-verifies
 * their cross-stage consistency; and the release audit (`pdfxyz.release-audit/1`, Phase 51) diffs a baseline
 * bundle against a current one and reports whether the evidence posture REGRESSED.
 *
 * This phase closes the *operator handoff* loop over those two composite results. It INGESTS whichever of a
 * `pdfxyz.release-ci-bundle/1` (this release's coherence) and/or a `pdfxyz.release-audit/1` (regression vs a
 * baseline) a release job produced, RE-VALIDATES each against ITSELF (reusing the Phase 50/51 reducers, so a
 * hand-flipped verdict is caught as a tamper), and folds them into ONE stable, content-free
 * `pdfxyz.release-report/1` result that answers a single question a CI summary / deployment review / incident
 * handoff needs —
 *
 *    "What should the operator DO now, based ONLY on the content-free release evidence supplied — is this
 *     release promote-ready, should it be held, or is the evidence insufficient?"
 *
 * — with a bounded final recommendation, a bounded rationale, an archive checklist, and a bounded next-action
 * checklist, and it FAILS CLOSED when a document cannot be trusted or the primary coherence evidence is
 * missing.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the documents
 * it composes:
 *  - Every load-bearing token here is a bounded enum — a source id, a coverage state, a recommendation, a
 *    severity, a rationale id, an action id, a checklist id — never a filename, path, object key, bucket,
 *    URL, endpoint, region, id, token, size, byte, raw ref, raw label, commit URL, or digest. The only
 *    non-enum values are small integer counts/deltas, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested document (each — even one Phase 50/51 produced — is
 *    UNTRUSTED input here); it reduces every fact to a bounded enum, a small integer, or a boolean, and it
 *    never echoes an input file path, even on an error.
 *  - It never fabricates a "promote". A `promote-ready` REQUIRES a usable bundle whose own verdict is `pass`:
 *    an audit only reports *no regression versus a baseline*, never that the current release is acceptable, so
 *    an audit-only (or bundle-absent) run is honestly `needs-evidence`, never a promote. A missing / unreadable
 *    / not-recognized document is insufficient; a recognized-but-self-inconsistent document (a tamper), a
 *    failed bundle, or a blocking audit regression is `hold-fail` (fail-closed).
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, NOT cloud
 * validation, NOT deployment approval, and NOT deployment promotion. It PROVES nothing the composed documents
 * do not already prove; it REPORTS over their content-free outputs, RE-VALIDATES each one's self-consistency,
 * and rolls them up into one operator recommendation + checklists. Its authored caveats (see
 * {@link RELEASE_REPORT_CAVEATS}) say so out loud: it is local content-free reporting over evidence — not
 * signing, authentication, cloud validation, storage retention enforcement, deployment approval, or deployment
 * promotion.
 */

import {
  RELEASE_CI_BUNDLE_SCHEMA,
  type ReleaseCiBundleStageId,
  type ReleaseCiBundleVerdict,
} from "../release-ci-bundle/types";
import {
  RELEASE_AUDIT_SCHEMA,
  type ReleaseAuditMode,
  type ReleaseAuditRegressionId,
  type ReleaseAuditVerdict,
} from "../release-audit/types";
import type { ReleaseIndexVerdict } from "../release-index/types";

/** The schema tag every release-report result carries, so tooling can pin the shape it parses. */
export const RELEASE_REPORT_SCHEMA = "pdfxyz.release-report/1" as const;

/** The upstream document schemas the report ingests. Re-exported so the result can pin each input shape. */
export { RELEASE_CI_BUNDLE_SCHEMA, RELEASE_AUDIT_SCHEMA };

/** Stable identity of the release-report — for docs / receipts / audit. */
export const RELEASE_REPORT_POLICY_ID = "pdfxyz-worker-release-report";
/** Bump when the report surface, the recommendation ladder, the rationale/action sets, or the schema changes. */
export const RELEASE_REPORT_POLICY_VERSION = 1;

/**
 * The two evidence sources the report composes — the stable keys a reader routes on:
 *  - `bundle` — the `pdfxyz.release-ci-bundle/1` composite (THIS release's evidence coherence; the PRIMARY
 *               promote-ability signal);
 *  - `audit`  — the `pdfxyz.release-audit/1` diff (regression versus a baseline; a SECONDARY guard that can
 *               BLOCK or FLAG a release but can never, on its own, GRANT a promote).
 */
export const RELEASE_REPORT_SOURCE_IDS = ["bundle", "audit"] as const;
export type ReleaseReportSourceId = (typeof RELEASE_REPORT_SOURCE_IDS)[number];

/**
 * The bounded coverage state of one evidence source:
 *  - `absent`     — no file was supplied for this source (the honest default, never a fault);
 *  - `unreadable` — a file was supplied but could not be read / parsed / recognized (never echoed);
 *  - `tampered`   — the document was recognized but its recorded rollup does NOT re-derive from its own facts
 *                   (a hand-edited / corrupt document — treated as a blocking failure);
 *  - `usable`     — recognized AND self-consistent (its recorded rollup re-derives): trustworthy evidence.
 */
export const RELEASE_REPORT_SOURCE_STATES = ["absent", "unreadable", "tampered", "usable"] as const;
export type ReleaseReportSourceState = (typeof RELEASE_REPORT_SOURCE_STATES)[number];

/**
 * The single final recommendation an operator/CI keys on — the answer to "what should I do now?":
 *  - `promote-ready`  — the primary coherence evidence (a usable bundle) PASSED and the regression guard (an
 *                       audit, if supplied) reported no regression: coherent, non-regressed, promote-able under
 *                       the evidence supplied;
 *  - `hold-warning`   — no blocker and evidence is sufficient, but an ADVISORY concern was raised (a bundle
 *                       warn, or a non-blocking audit drift): review, then decide;
 *  - `needs-evidence` — the evidence is INSUFFICIENT to recommend a promotion: a document was unreadable, a
 *                       usable document was indeterminate (`unknown`), OR the primary coherence evidence (a
 *                       usable bundle) was not supplied at all (an audit-only run — a regression check can
 *                       never substitute for the release's own coherence check). Fail-closed, not a promote;
 *  - `hold-fail`      — a BLOCKING issue: a supplied document is recognized but self-inconsistent (a tamper),
 *                       the bundle's coherence verdict FAILED, or the audit reported a blocking regression. The
 *                       strongest signal; it dominates.
 *
 * These are the exact bounded values the run-level `worker_release_report_total` metric carries as its
 * `recommendation` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_REPORT_RECOMMENDATIONS = [
  "promote-ready",
  "hold-warning",
  "needs-evidence",
  "hold-fail",
] as const;
export type ReleaseReportRecommendation = (typeof RELEASE_REPORT_RECOMMENDATIONS)[number];

/**
 * The exit-code ladder a CI/release job routes on — the same shape as the gate/artifact/index/policy/
 * ci-bundle/audit ladders so the whole worker suite speaks one language:
 *  - `0` PROMOTE-READY — coherent and non-regressed under the evidence supplied;
 *  - `1` USAGE         — the CLI was misused (a bad flag, no document supplied, or an unwritable output).
 *                        CLI-owned; a report RUN never resolves to it;
 *  - `2` NEEDS-EVIDENCE— the evidence was insufficient to recommend a promotion (an unreadable / indeterminate
 *                        document, or no usable bundle);
 *  - `3` HOLD-WARNING  — an advisory concern was raised (a non-blocking bundle warn / audit drift);
 *  - `4` HOLD-FAIL     — a blocking issue (a tampered document, a failed bundle, or a blocking audit regression).
 * Monotonic — a higher code is always a stronger "do not promote on this evidence".
 */
export const RELEASE_REPORT_EXIT = {
  PROMOTE_READY: 0,
  USAGE: 1,
  NEEDS_EVIDENCE: 2,
  HOLD_WARNING: 3,
  HOLD_FAIL: 4,
} as const;
export type ReleaseReportExitCode = (typeof RELEASE_REPORT_EXIT)[keyof typeof RELEASE_REPORT_EXIT];

/**
 * The common **severity** each source's native verdict maps onto so the report can fold two different ladders
 * (bundle `pass|warn|unknown|fail`, audit `pass|warn|unknown|fail`) plus the coverage state (`tampered`,
 * `unreadable`) into one recommendation:
 *  - `ready`        — a usable document that PASSED (best);
 *  - `advisory`     — a usable document carrying an advisory `warn`;
 *  - `insufficient` — an unreadable / indeterminate (`unknown`) document, or missing primary coherence;
 *  - `blocking`     — a tampered document, a failed bundle, or a blocking audit regression (worst).
 *
 * Precedence when folding is `blocking > insufficient > advisory > ready` (checked in that order, exactly like
 * the Phase 50 bundle rollup — so an uncertifiable/insufficient posture never masquerades as a mere advisory,
 * and a real blocker is never masked). A source that is not supplied contributes no severity (`null`).
 */
export const RELEASE_REPORT_SEVERITIES = ["ready", "advisory", "insufficient", "blocking"] as const;
export type ReleaseReportSeverity = (typeof RELEASE_REPORT_SEVERITIES)[number];

/**
 * The bounded rationale ids — the closed set of REASONS the recommendation resolved as it did, emitted in this
 * stable order (a superset view, so a reader sees every condition that applied, not only the winning one):
 *  - `evidence-tampered`   — a supplied document is recognized but self-inconsistent (a tamper). BLOCKING;
 *  - `bundle-failed`       — a usable bundle's coherence verdict is `fail` (a failed / inconsistent chain). BLOCKING;
 *  - `audit-regressed`     — a usable audit reported a blocking regression (verdict `fail`). BLOCKING;
 *  - `evidence-unreadable` — a supplied document could not be read / recognized. INSUFFICIENT;
 *  - `bundle-uncertified`  — a usable bundle's verdict is `unknown` (an uncertified / decision-less chain). INSUFFICIENT;
 *  - `audit-inconclusive`  — a usable audit's verdict is `unknown` (an unreadable input / too little history). INSUFFICIENT;
 *  - `coherence-missing`   — NO bundle was supplied at all, so the release's OWN coherence is unproven (an
 *                            audit-only run — a regression check cannot substitute for the coherence check). INSUFFICIENT;
 *  - `bundle-advisory`     — a usable bundle's verdict is `warn` (an advisory concern). ADVISORY;
 *  - `audit-drift`         — a usable audit's verdict is `warn` (a non-blocking regression / drift). ADVISORY.
 */
export const RELEASE_REPORT_RATIONALE_IDS = [
  "evidence-tampered",
  "bundle-failed",
  "audit-regressed",
  "evidence-unreadable",
  "bundle-uncertified",
  "audit-inconclusive",
  "coherence-missing",
  "bundle-advisory",
  "audit-drift",
] as const;
export type ReleaseReportRationaleId = (typeof RELEASE_REPORT_RATIONALE_IDS)[number];

/**
 * The bounded next-action ids — the closed set of concrete operator steps the report can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `investigate-blocker`  — investigate the failed stage / blocking regression before promoting;
 *  - `recover-evidence`     — recover the untampered document from your CI archive; a tampered input cannot be trusted;
 *  - `supply-evidence`      — supply the missing / unreadable document (a bundle, or an audit + its baseline) and re-run;
 *  - `gate-current-release` — gate the current release's OWN coherence with `worker:release-ci-bundle` (needed
 *                             when only an audit was supplied, or the bundle was uncertified);
 *  - `review-advisory`      — review the advisory concern (a warn) and decide whether to proceed;
 *  - `record-accepted-drift`— if an audit drift is EXPECTED, re-run the audit with its acceptance flags to record it;
 *  - `promote-out-of-band`  — proceed with your out-of-band promotion process (this report authorizes nothing);
 *  - `archive-report`       — archive the bundle / audit / this report as the release evidence record.
 */
export const RELEASE_REPORT_ACTION_IDS = [
  "investigate-blocker",
  "recover-evidence",
  "supply-evidence",
  "gate-current-release",
  "review-advisory",
  "record-accepted-drift",
  "promote-out-of-band",
  "archive-report",
] as const;
export type ReleaseReportActionId = (typeof RELEASE_REPORT_ACTION_IDS)[number];

/**
 * The bounded archive-checklist ids — which content-free files an operator should keep as the release record:
 *  - `release-ci-bundle` — the supplied bundle (kept iff a bundle was supplied + recognized);
 *  - `release-audit`     — the supplied audit (kept iff an audit was supplied + recognized);
 *  - `operator-report`   — THIS report (always kept — the content-free handoff record).
 */
export const RELEASE_REPORT_CHECKLIST_IDS = [
  "release-ci-bundle",
  "release-audit",
  "operator-report",
] as const;
export type ReleaseReportChecklistId = (typeof RELEASE_REPORT_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-source bounded facts (one shape per source; all enums / small ints / booleans)
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-ci-bundle/1` (its rollup re-derived in ingest). */
export interface BundleSourceFacts {
  /** The bundle's coherence verdict (trusted — the bundle re-derived its own rollup). */
  readonly verdict: ReleaseCiBundleVerdict;
  readonly exitCode: number | null;
  readonly stagesPresent: number;
  readonly chainComplete: boolean;
  /** The most authoritative present stage (policy > index > artifact > gate), or `null`. */
  readonly decisionStage: ReleaseCiBundleStageId | null;
  readonly inconsistencies: number;
  /** Total advisory pressure the bundle carried (warn stages + index warn artifacts + policy warnings). */
  readonly warningSignals: number;
  /** The bundle's index archive-health verdict, or `null` if no index stage was present. */
  readonly archiveVerdict: ReleaseIndexVerdict | null;
}

/** The bounded facts reduced from a usable `pdfxyz.release-audit/1` (its rollup re-derived in ingest). */
export interface AuditSourceFacts {
  /** The audit's regression verdict (trusted — the audit re-derived its own rollup). */
  readonly verdict: ReleaseAuditVerdict;
  readonly mode: ReleaseAuditMode;
  /** True iff a real baseline↔current diff was performed (both compared bundles were usable). */
  readonly comparable: boolean;
  readonly blockingRegressions: number;
  readonly warningRegressions: number;
  /** The fired regression ids, in canonical audit order (bounded enums; never their prose). */
  readonly drivers: readonly ReleaseAuditRegressionId[];
  /** The baseline bundle's posture, or `null` (context for the operator; never load-bearing). */
  readonly baselineVerdict: ReleaseCiBundleVerdict | null;
  /** The current bundle's posture, or `null` (context; never load-bearing). */
  readonly currentVerdict: ReleaseCiBundleVerdict | null;
  /** `current − baseline` posture-rank delta (a positive value is a regression), or `null` if not comparable. */
  readonly postureRankDelta: number | null;
}

/** The common bounded fields every reduced source carries. */
interface ReleaseReportSourceBase {
  readonly state: ReleaseReportSourceState;
  /** True iff a file was supplied for this source (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  /** True iff the parsed input carried the expected document schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded rollup re-derives). */
  readonly usable: boolean;
  /**
   * The source's own native verdict token (a bounded enum), or `null`. Trusted only when `usable`; for a
   * `tampered` source it is the untrusted CLAIMED verdict (surfaced so the summary shows what was asserted).
   */
  readonly verdict: string | null;
  /** The source's contribution on the common severity ladder, or `null` when not supplied. */
  readonly severity: ReleaseReportSeverity | null;
  /** A one-line, content-free headline authored from the source id + state + verdict. */
  readonly detail: string;
}

/**
 * One reduced evidence source — a discriminated union on {@link ReleaseReportSourceId} so each source's
 * `facts` are strongly typed. Every field is a bounded enum, a small integer, or a boolean; never a raw value
 * from the input.
 */
export type ReleaseReportSource =
  | (ReleaseReportSourceBase & { readonly id: "bundle"; readonly facts: BundleSourceFacts | null })
  | (ReleaseReportSourceBase & { readonly id: "audit"; readonly facts: AuditSourceFacts | null });

/** The bounded coverage summary — which sources were supplied and which are trustworthy evidence. */
export interface ReleaseReportCoverage {
  /** How many of the two sources were supplied (0–2). */
  readonly sourcesSupplied: number;
  /** How many of the two sources are usable (recognized + self-consistent) (0–2). */
  readonly sourcesUsable: number;
  /** The bundle source's coverage state. */
  readonly bundle: ReleaseReportSourceState;
  /** The audit source's coverage state. */
  readonly audit: ReleaseReportSourceState;
  /** True iff a usable bundle was supplied (the primary coherence evidence is present). */
  readonly hasBundle: boolean;
  /** True iff a usable audit was supplied (the regression guard is present). */
  readonly hasAudit: boolean;
}

/** One fired rationale, with its resolved severity + authored detail. */
export interface ReleaseReportRationale {
  readonly id: ReleaseReportRationaleId;
  readonly severity: ReleaseReportSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist item, with its authored detail. */
export interface ReleaseReportAction {
  readonly id: ReleaseReportActionId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite recommendation — the single decision + exit code an operator/CI acts on. */
export interface ReleaseReportRollup {
  readonly recommendation: ReleaseReportRecommendation;
  readonly exitCode: ReleaseReportExitCode;
  /** True iff `recommendation === "promote-ready"`. */
  readonly ready: boolean;
  /** The fired rationale ids, in canonical order (empty on a clean promote-ready). */
  readonly rationale: readonly ReleaseReportRationaleId[];
  /** How many fired rationale were blocking. */
  readonly blocking: number;
  /** How many fired rationale were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired rationale were advisory. */
  readonly advisories: number;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
  /** True iff `--strict` ESCALATED an advisory-only posture to `hold-fail` (would have been `hold-warning`). */
  readonly strictEscalated: boolean;
  readonly detail: string;
}

/** The bounded archive guidance — which content-free files an operator should keep as the release record. */
export interface ReleaseReportArchiveGuidance {
  /** The checklist ids to archive, in canonical order. */
  readonly items: readonly ReleaseReportChecklistId[];
  /** Bounded, app-authored archive note. Never derived from an input. */
  readonly note: string;
}

/** The stable identity block the result records (with the pinned upstream document schemas). */
export interface ReleaseReportMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_REPORT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_REPORT_POLICY_VERSION;
  readonly bundleSchema: typeof RELEASE_CI_BUNDLE_SCHEMA;
  readonly auditSchema: typeof RELEASE_AUDIT_SCHEMA;
}

/**
 * The stable, content-free release evidence operator report a CI summary / deployment review / incident
 * handoff reads. Every field is a bounded enum, a small integer/delta, an ISO stamp, or app-authored prose —
 * so it carries no locator, identifier, size, path, or byte, even from a hostile input.
 */
export interface ReleaseReportResult {
  readonly schema: typeof RELEASE_REPORT_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseReportMetadata;
  readonly coverage: ReleaseReportCoverage;
  /** One reduced summary per source, in canonical {@link RELEASE_REPORT_SOURCE_IDS} order. */
  readonly sources: readonly ReleaseReportSource[];
  readonly recommendation: ReleaseReportRollup;
  /** Every fired rationale, in canonical {@link RELEASE_REPORT_RATIONALE_IDS} order. */
  readonly rationale: readonly ReleaseReportRationale[];
  /** Which content-free files to archive as the release record. */
  readonly archive: ReleaseReportArchiveGuidance;
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly nextActions: readonly ReleaseReportAction[];
  /** Bounded, app-authored guidance (out-of-scope steps this report does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested document. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log/forward verbatim). */
  readonly receipt: ReleaseReportReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did
 * this release report recommend, over how many usable sources, with how many blocking / insufficiency /
 * advisory reasons" for a SIEM / release record. Bounded enums + small integers + a stable policy id + the
 * run's own stamp only; safe to log or forward verbatim.
 */
export interface ReleaseReportReceipt {
  readonly category: "worker-release-report";
  readonly policyId: typeof RELEASE_REPORT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_REPORT_POLICY_VERSION;
  readonly at: string;
  readonly recommendation: ReleaseReportRecommendation;
  readonly exitCode: ReleaseReportExitCode;
  /** How many sources were supplied + usable. */
  readonly sourcesUsable: number;
  /** True iff a usable bundle was supplied (primary coherence evidence present). */
  readonly hasBundle: boolean;
  /** True iff a usable audit was supplied (regression guard present). */
  readonly hasAudit: boolean;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
}

/** The process exit code for a report result. */
export function releaseReportExitCode(result: ReleaseReportResult): number {
  return result.recommendation.exitCode;
}

/** The authoritative recommendation → exit code map. */
export const RELEASE_REPORT_EXIT_FOR_RECOMMENDATION: Record<
  ReleaseReportRecommendation,
  ReleaseReportExitCode
> = {
  "promote-ready": RELEASE_REPORT_EXIT.PROMOTE_READY,
  "needs-evidence": RELEASE_REPORT_EXIT.NEEDS_EVIDENCE,
  "hold-warning": RELEASE_REPORT_EXIT.HOLD_WARNING,
  "hold-fail": RELEASE_REPORT_EXIT.HOLD_FAIL,
};

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested document)
 * ------------------------------------------------------------------ */

/** The one-line recommendation headline. Authored here, keyed by the enum. */
export const RELEASE_REPORT_RECOMMENDATION_SUMMARY: Record<ReleaseReportRecommendation, string> = {
  "promote-ready":
    "PROMOTE-READY: the primary coherence evidence (a usable release CI bundle) PASSED, and the regression guard (an audit, if supplied) reported no regression. A coherent, non-regressed, content-free evidence set for handoff. This report authorizes nothing on its own — promotion remains an out-of-band operator/CI action.",
  "hold-warning":
    "HOLD (advisory): no blocker and the evidence is sufficient, but an ADVISORY concern was raised — the bundle carried a warn, or the audit reported a non-blocking drift. Review the flagged concern, then decide whether to proceed.",
  "needs-evidence":
    "HOLD (needs evidence): the content-free evidence is INSUFFICIENT to recommend a promotion — a document was unreadable or indeterminate, or the PRIMARY coherence evidence (a usable release CI bundle) was not supplied (an audit-only run cannot certify the release's own coherence). This is a setup problem, not a promote.",
  "hold-fail":
    "HOLD (blocking): a BLOCKING issue — a supplied document is recognized but self-inconsistent (a tamper), the bundle's coherence verdict FAILED, or the audit reported a blocking regression. Do not promote on this evidence until the failure or tamper is resolved.",
};

/**
 * The dedicated headline for a `hold-fail` produced ONLY because `--strict` escalated an advisory-only posture
 * (a bundle warn / audit drift) — there was no tamper, failed bundle, or blocking regression, so the generic
 * `hold-fail` summary would misrepresent the cause. Authored; selected by the rollup when `strictEscalated`.
 */
export const RELEASE_REPORT_STRICT_ESCALATED_SUMMARY =
  "HOLD (blocking, --strict): the only concern was ADVISORY (a bundle warn / a non-blocking audit drift), which `--strict` escalates to a blocking hold (warnings are treated as hold-fail). Without `--strict` this would be HOLD (advisory), exit 3. No tamper, failed bundle, or blocking regression was found.";

/** Per-rationale authored detail + resolved severity, keyed by id. */
export const RELEASE_REPORT_RATIONALE_DETAIL: Record<
  ReleaseReportRationaleId,
  { readonly severity: ReleaseReportSeverity; readonly detail: string }
> = {
  "evidence-tampered": {
    severity: "blocking",
    detail:
      "A supplied document is a recognized release CI bundle / audit whose recorded rollup does NOT re-derive from its own facts — a hand-edited or corrupt document. Recover the untampered document from your CI archive; a tampered input cannot be reported on.",
  },
  "bundle-failed": {
    severity: "blocking",
    detail:
      "The release CI bundle's coherence verdict is FAIL: a stage failed, or two stages describe different evidence (a cross-stage inconsistency / tamper). The release's own evidence chain is not coherent — do not promote until it is resolved.",
  },
  "audit-regressed": {
    severity: "blocking",
    detail:
      "The release audit reported a BLOCKING regression: the current bundle dropped to fail, a held consistency link now mismatches, or the archive decision worsened to a blocking state versus the baseline. Investigate the regression before promoting.",
  },
  "evidence-unreadable": {
    severity: "insufficient",
    detail:
      "A supplied document could not be read / recognized as the expected `pdfxyz.release-ci-bundle/1` or `pdfxyz.release-audit/1` (wrong schema or unparseable — never echoed), so it certifies nothing. Supply a readable document produced by `worker:release-ci-bundle` / `worker:release-audit` and re-run.",
  },
  "bundle-uncertified": {
    severity: "insufficient",
    detail:
      "The release CI bundle's verdict is UNKNOWN: an unreadable / indeterminate stage, or no archive-decision stage (index / policy) was bundled. A single build's signal is not an end-to-end chain decision — complete the chain and re-bundle.",
  },
  "audit-inconclusive": {
    severity: "insufficient",
    detail:
      "The release audit's verdict is UNKNOWN: a supplied bundle was unreadable, or there was too little comparable history to diff. The regression check could not be performed — supply a readable baseline + current and re-run.",
  },
  "coherence-missing": {
    severity: "insufficient",
    detail:
      "No release CI bundle was supplied, so the release's OWN evidence coherence is unproven. An audit only reports whether the release regressed versus a baseline — it can never certify that the current release is itself acceptable. Gate the current release with `worker:release-ci-bundle` and supply its bundle.",
  },
  "bundle-advisory": {
    severity: "advisory",
    detail:
      "The release CI bundle's verdict is WARN: no blocker, but a supplied stage raised an advisory concern (a dirty tree, a retention concern, or a warning-only policy assertion). Review the flagged stage, then decide.",
  },
  "audit-drift": {
    severity: "advisory",
    detail:
      "The release audit reported a NON-blocking drift: the posture softened, a consistency link or a stage weakened, or advisory pressure rose past the threshold versus the baseline. Review the drift; if expected, accept it deliberately in the audit and re-run.",
  },
};

/** Per-action authored detail, keyed by id. */
export const RELEASE_REPORT_ACTION_DETAIL: Record<ReleaseReportActionId, string> = {
  "investigate-blocker":
    "Investigate the blocking issue (a failed bundle stage or a blocking audit regression) and resolve it before promoting; recover the untampered evidence chain from your CI archive if needed.",
  "recover-evidence":
    "Recover the untampered document from your CI archive: a recorded verdict that does not re-derive means the document was hand-edited or corrupted, and cannot be trusted.",
  "supply-evidence":
    "Supply the missing / unreadable content-free document — at minimum a `pdfxyz.release-ci-bundle/1` for this release (and, for a regression check, a `pdfxyz.release-audit/1` over a baseline) — and re-run this report.",
  "gate-current-release":
    "Gate the current release's OWN coherence with `worker:release-ci-bundle` (and `worker:release-policy`) and supply its bundle: a regression audit alone cannot certify that this release is acceptable.",
  "review-advisory":
    "Review the advisory concern (a bundle warn or an audit drift) and decide whether to proceed; archive this report as the record of that decision either way.",
  "record-accepted-drift":
    "If the audit drift is EXPECTED (a new advisory, a stage dropped on purpose), re-run `worker:release-audit` with `--allow-warn-regression` / a raised `--max-new-warnings` to record the accepted baseline — do not silently ignore it.",
  "promote-out-of-band":
    "Proceed with your out-of-band promotion process (sign the release, provision, and promote the deployment): this report REPORTS over content-free evidence and authorizes nothing on its own.",
  "archive-report":
    "Archive the supplied bundle / audit — plus this report — as CI artifacts: they are the content-free release evidence handoff record for this build. This report never uploads or promotes them.",
};

/**
 * The honesty caveats every result carries and every text render prints. The report REPORTS over the chain's
 * already content-free composite outputs, RE-VALIDATES each one's self-consistency, and rolls them up into one
 * operator recommendation; it must never be read as more than that.
 */
export const RELEASE_REPORT_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE OPERATOR REPORT: it INGESTS a content-free `pdfxyz.release-ci-bundle/1` (this release's evidence coherence) and/or a `pdfxyz.release-audit/1` (regression versus a baseline) a release job produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded operator recommendation + checklists. It is local content-free REPORTING over evidence — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no stage / bundle / audit itself, and NEVER deletes, prunes, uploads, promotes, approves, or mutates any document, artifact, index, policy, bundle, audit, object, or deployment. A `promote-ready` authorizes nothing; it only reports that the content-free evidence supplied on THIS host was coherent and non-regressed.",
  "A `promote-ready` REQUIRES a usable release CI bundle whose own verdict is `pass`. An audit only reports whether the release REGRESSED versus a baseline — it can never, on its own, certify that the current release is acceptable — so an audit-only (or bundle-absent) run is honestly `needs-evidence`, never a promote. It FAILS CLOSED: a tampered / failed / regressed input holds the release; a missing coherence bundle or an unreadable document is insufficient.",
  "It re-derives each ingested document's rollup from the document's OWN recorded facts (reusing the Phase 50/51 reducers) and treats a recorded verdict that does not re-derive as a TAMPER (`hold-fail`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity.",
  "It emits only bounded enums, small counts / deltas, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, commit URL, size, byte, digest, or document content, even from a hostile input, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the report carries but does NOT itself perform — the honest edges of an offline
 * reporter. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_REPORT_GUIDANCE: readonly string[] = [
  "Wire this as a CI SUMMARY / handoff step AFTER `worker:release-ci-bundle` (and, optionally, `worker:release-audit`): run each to a file, hand those files here, and render `--text` into `$GITHUB_STEP_SUMMARY` (or archive `--json` as a CI artifact). Fail the pipeline on exit 4 (a blocking issue or a tamper), surface exit 3 (an advisory concern) for review, and treat exit 2 (insufficient evidence / no usable bundle) as a setup error, not a promote.",
  "Supply at least a release CI bundle: a `promote-ready` requires it (an audit-only run is `needs-evidence`, since a regression check cannot certify the release's own coherence). Add a release audit for a regression guard against a baseline — a blocking regression there holds the release even when the bundle itself passes.",
  "Archive the supplied bundle / audit — plus this report — as CI artifacts: this report is a content-free handoff record, not a substitute for the documents it composes, nor for your storage-side retention, signing, and release-APPROVAL processes.",
  "Enforce promotion out of band: this report RECOMMENDS based on the content-free evidence supplied, but signing a release, provisioning, approving, and promoting a deployment are operator/CI actions this offline reporter never performs.",
];
