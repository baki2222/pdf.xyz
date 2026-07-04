/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence trend summary** (Phase 53).
 *
 * Phases 46–52 built the release-evidence chain, one rung per phase: the release readiness gate folds the
 * content-free worker checks into ONE promotion verdict; the release artifact stamps it with bounded provenance
 * + an integrity digest; the release index re-verifies many artifacts into a retention manifest; the release
 * policy asserts bounded operator thresholds over that manifest; the release CI bundle
 * (`pdfxyz.release-ci-bundle/1`) composes a single release job's stage outputs and re-verifies their cross-stage
 * consistency; the release audit (`pdfxyz.release-audit/1`) diffs a baseline bundle against a current one; and
 * the release operator report (`pdfxyz.release-report/1`, Phase 52) folds a bundle + optional audit into ONE
 * operator recommendation (`promote-ready` / `hold-warning` / `needs-evidence` / `hold-fail`).
 *
 * This phase closes the *governance review* loop over a BOUNDED HISTORY of those operator reports. It INGESTS
 * multiple `pdfxyz.release-report/1` outputs (a week/month of release handoffs), RE-VALIDATES each against
 * ITSELF (reusing the Phase 52 recommendation reducer, so a hand-flipped recommendation is caught as a tamper),
 * and folds them into ONE stable, content-free `pdfxyz.release-trend/1` summary that answers a single question a
 * weekly/monthly release-governance review needs —
 *
 *    "How has release evidence posture changed over the recent report history, and what bounded operator
 *     follow-up is warranted?"
 *
 * — with a bounded trend verdict, a bounded rationale, a per-report posture sequence, and a bounded follow-up
 * checklist, and it FAILS CLOSED when a report cannot be trusted or the history is insufficient.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the reports it
 * summarizes:
 *  - Every load-bearing token here is a bounded enum — a report state, a recommendation, a severity, a trend
 *    verdict, a reason id, a follow-up id, a direction — never a filename, path, object key, bucket, URL,
 *    endpoint, region, id, token, size, byte, raw ref, raw label, commit URL, or digest. The only non-enum
 *    values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested report (each — even one Phase 52 produced — is
 *    UNTRUSTED input here); it reduces every report to a bounded enum, a small integer, or a boolean, it never
 *    echoes an ingested report's OWN stamp (the trend carries only its own), and it never echoes an input file
 *    path, even on an error.
 *  - It never fabricates a "stable". A `stable` trend REQUIRES a clean bounded window: no tampered / unreadable
 *    report, a usable newest report that is `promote-ready`, and no history threshold breached. A tampered
 *    report, or a newest that is `hold-fail`, holds the trend `failing`; an unreadable report, an empty history,
 *    or a newest that is `needs-evidence` is `unknown` (insufficient); an advisory newest / threshold is `warning`.
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, NOT cloud
 * validation, NOT deployment approval, and NOT deployment promotion. It PROVES nothing the reports do not
 * already prove; it SUMMARIZES a bounded history of their content-free recommendations, RE-VALIDATES each one's
 * self-consistency, and rolls them up into one governance verdict + follow-up checklist. Its authored caveats
 * (see {@link RELEASE_TREND_CAVEATS}) say so out loud: it is local content-free TREND REPORTING over evidence
 * reports — not signing, authentication, cloud validation, storage retention enforcement, deployment approval,
 * or deployment promotion.
 */

import {
  RELEASE_REPORT_RECOMMENDATIONS,
  RELEASE_REPORT_SCHEMA,
  type ReleaseReportRecommendation,
} from "../release-report/types";

/** The schema tag every release-trend result carries, so tooling can pin the shape it parses. */
export const RELEASE_TREND_SCHEMA = "pdfxyz.release-trend/1" as const;

/** The upstream document schema the trend ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_REPORT_SCHEMA };

/** Stable identity of the release-trend — for docs / receipts / audit. */
export const RELEASE_TREND_POLICY_ID = "pdfxyz-worker-release-trend";
/** Bump when the trend surface, the verdict ladder, the reason/follow-up sets, or the schema changes. */
export const RELEASE_TREND_POLICY_VERSION = 1;

/** The recommendations the trend summarizes, re-exported for convenience (counts + per-report posture). */
export { RELEASE_REPORT_RECOMMENDATIONS };
export type { ReleaseReportRecommendation };

/**
 * The bounded coverage state of one ingested report — every supplied `--report` / `--file` / stdin element is
 * SUPPLIED (unlike the report's per-source `absent`), so a point is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-report/1` (never echoed). It certifies nothing → INSUFFICIENT;
 *  - `tampered`   — recognized as a report but its recorded recommendation does NOT re-derive from its own
 *                   sources + strict flag (a hand-edited / corrupt report — treated as a blocking failure);
 *  - `usable`     — recognized AND self-consistent (its recorded recommendation re-derives): trustworthy.
 */
export const RELEASE_TREND_REPORT_STATES = ["unreadable", "tampered", "usable"] as const;
export type ReleaseTrendReportState = (typeof RELEASE_TREND_REPORT_STATES)[number];

/**
 * The single trend verdict a governance review / CI keys on — the answer to "how is the recent posture, and is
 * follow-up warranted?":
 *  - `stable`  — a clean bounded window: no tampered / unreadable report, the newest usable report is
 *                `promote-ready`, and no history threshold was breached. The recent trend is healthy;
 *  - `warning` — no blocker and the history is sufficient, but an ADVISORY concern was raised: the newest usable
 *                report is `hold-warning`, warnings increased versus the previous report, or the hold-warning
 *                count exceeded the policy threshold. Review, then decide;
 *  - `unknown` — the history is INSUFFICIENT to summarize a trend: a report was unreadable, no report was
 *                usable, or the newest usable report is `needs-evidence`. Fail-closed, not a stable;
 *  - `failing` — a BLOCKING issue: a supplied report is recognized but self-inconsistent (a tamper), the newest
 *                usable report is `hold-fail`, the hold-fail count exceeded the policy threshold, or
 *                `--require-latest-ready` was set and the newest report is not `promote-ready`. The strongest
 *                signal; it dominates.
 *
 * These are the exact bounded values the run-level `worker_release_trend_total` metric carries as its `verdict`
 * label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_TREND_VERDICTS = ["stable", "warning", "unknown", "failing"] as const;
export type ReleaseTrendVerdict = (typeof RELEASE_TREND_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape as the gate/artifact/index/policy/
 * ci-bundle/audit/report ladders so the whole worker suite speaks one language:
 *  - `0` STABLE  — a clean, healthy recent trend;
 *  - `1` USAGE   — the CLI was misused (a bad flag, no report supplied, or an unwritable output). CLI-owned; a
 *                  trend RUN never resolves to it;
 *  - `2` UNKNOWN — the history was insufficient to summarize (an unreadable / empty history / needs-evidence newest);
 *  - `3` WARNING — an advisory trend (a hold-warning newest, warnings increased, or a threshold breach);
 *  - `4` FAILING — a blocking trend (a tampered report, a hold-fail newest / threshold, or a required-not-ready newest).
 * Monotonic — a higher code is always a stronger "do not treat this trend as healthy".
 */
export const RELEASE_TREND_EXIT = {
  STABLE: 0,
  USAGE: 1,
  UNKNOWN: 2,
  WARNING: 3,
  FAILING: 4,
} as const;
export type ReleaseTrendExitCode = (typeof RELEASE_TREND_EXIT)[keyof typeof RELEASE_TREND_EXIT];

/**
 * The common **severity** each usable report's recommendation, and each fired trend reason, maps onto so the
 * trend can fold a history of recommendations + coverage states into one verdict:
 *  - `ready`        — a usable report that is `promote-ready` (best);
 *  - `advisory`     — a usable report that is `hold-warning`, or an advisory trend reason;
 *  - `insufficient` — an unreadable / `needs-evidence` report, an empty history, or an insufficiency reason;
 *  - `blocking`     — a tampered report, a `hold-fail` report, a breached hold-fail threshold, or an enforced
 *                     not-ready newest (worst).
 *
 * Precedence when folding is `blocking > insufficient > advisory > ready` (checked in that order, exactly like
 * the Phase 50/52 rollups — so an insufficient posture never masquerades as a mere advisory, and a real blocker
 * is never masked).
 */
export const RELEASE_TREND_SEVERITIES = ["ready", "advisory", "insufficient", "blocking"] as const;
export type ReleaseTrendSeverity = (typeof RELEASE_TREND_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence and the trend direction. */
export const RELEASE_TREND_SEVERITY_RANK: Record<ReleaseTrendSeverity, number> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
};

/** A usable report's recommendation → common trend severity. */
export const RECOMMENDATION_SEVERITY: Record<ReleaseReportRecommendation, ReleaseTrendSeverity> = {
  "promote-ready": "ready",
  "hold-warning": "advisory",
  "needs-evidence": "insufficient",
  "hold-fail": "blocking",
};

/**
 * The bounded direction of the recent trend — the arc from the OLDEST usable report to the NEWEST, by severity
 * rank: `improving` (posture got better), `flat` (unchanged), `degrading` (got worse), or `n/a` (fewer than two
 * usable reports, so there is no arc). Never load-bearing for the verdict; a bounded facet for the summary.
 */
export const RELEASE_TREND_DIRECTIONS = ["improving", "flat", "degrading", "n/a"] as const;
export type ReleaseTrendDirection = (typeof RELEASE_TREND_DIRECTIONS)[number];

/**
 * The bounded reason ids — the closed set of REASONS the trend verdict resolved as it did, emitted in this
 * stable order (a superset view, so a reader sees every condition that applied, not only the winning one):
 *  - `report-tampered`       — a supplied report is recognized but self-inconsistent (a tamper). BLOCKING;
 *  - `latest-hold-fail`      — the newest usable report is `hold-fail` (a currently-held release). BLOCKING;
 *  - `repeated-hold-fail`    — the `hold-fail` count in the window exceeded `--max-hold-fail`. BLOCKING;
 *  - `latest-not-ready`      — `--require-latest-ready` was set and the newest usable report is not
 *                              `promote-ready` (an enforced not-ready tip). BLOCKING;
 *  - `report-unreadable`     — a supplied report could not be read / recognized. INSUFFICIENT;
 *  - `no-usable-reports`     — the window has zero usable reports (nothing to summarize). INSUFFICIENT;
 *  - `latest-needs-evidence` — the newest usable report is `needs-evidence` (its release could not be certified). INSUFFICIENT;
 *  - `latest-hold-warning`   — the newest usable report is `hold-warning` (an advisory concern). ADVISORY;
 *  - `repeated-hold-warning` — the `hold-warning` count in the window exceeded `--max-hold-warning`. ADVISORY;
 *  - `trend-degraded`        — the newest usable report's posture is worse than the previous usable report's
 *                              (warnings increased between the two most recent reports). ADVISORY.
 */
export const RELEASE_TREND_REASON_IDS = [
  "report-tampered",
  "latest-hold-fail",
  "repeated-hold-fail",
  "latest-not-ready",
  "report-unreadable",
  "no-usable-reports",
  "latest-needs-evidence",
  "latest-hold-warning",
  "repeated-hold-warning",
  "trend-degraded",
] as const;
export type ReleaseTrendReasonId = (typeof RELEASE_TREND_REASON_IDS)[number];

/**
 * The bounded follow-up ids — the closed set of concrete operator steps the trend can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `investigate-failing-trend` — investigate the failing trend (a hold-fail newest / repeated fails) before promoting;
 *  - `recover-tampered-report`   — recover the untampered report from your CI archive; a tampered report cannot be trusted;
 *  - `supply-report-history`     — supply more / readable `pdfxyz.release-report/1` reports and re-run (thin / unreadable history);
 *  - `gate-latest-release`       — the latest release is not promote-ready; gate it (bundle / report) and resolve before promoting;
 *  - `review-warning-trend`      — review the advisory warning trend and decide whether follow-up is warranted;
 *  - `continue-monitoring`       — the trend is stable; keep summarizing on your weekly / monthly cadence;
 *  - `archive-trend`             — archive this trend summary (and the underlying reports) as the governance record.
 */
export const RELEASE_TREND_FOLLOWUP_IDS = [
  "investigate-failing-trend",
  "recover-tampered-report",
  "supply-report-history",
  "gate-latest-release",
  "review-warning-trend",
  "continue-monitoring",
  "archive-trend",
] as const;
export type ReleaseTrendFollowupId = (typeof RELEASE_TREND_FOLLOWUP_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-report bounded facts + the reduced trend point
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-report/1` (its recommendation re-derived in ingest). */
export interface TrendReportFacts {
  /** The report's final recommendation (trusted — the report re-derived its own recommendation). */
  readonly recommendation: ReleaseReportRecommendation;
  /** The report's own exit code (context; the trend has its own). */
  readonly exitCode: number;
  /** True iff `recommendation === "promote-ready"`. */
  readonly ready: boolean;
  /** How many blocking reasons the report itself carried. */
  readonly blocking: number;
  /** How many insufficiency reasons the report itself carried. */
  readonly insufficiencies: number;
  /** How many advisory reasons the report itself carried. */
  readonly advisories: number;
  /** True iff the report had a usable release CI bundle (primary coherence evidence present). */
  readonly hasBundle: boolean;
  /** True iff the report had a usable release audit (regression guard present). */
  readonly hasAudit: boolean;
  /** True iff the report was produced under `--strict`. */
  readonly strict: boolean;
}

/**
 * One reduced report in the trend sequence — a bounded point ordered oldest → newest. Every field is a bounded
 * enum, a small integer, or app-authored prose; never a raw value from the input (not even the report's stamp).
 */
export interface ReleaseTrendPoint {
  /** 0-based position in the considered window, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The report's coverage state. */
  readonly state: ReleaseTrendReportState;
  /**
   * The report's own recommendation token (a bounded enum), or `null` when unreadable. Trusted only when
   * `usable`; for a `tampered` report it is the untrusted CLAIMED recommendation (surfaced so the sequence
   * shows what was asserted).
   */
  readonly recommendation: ReleaseReportRecommendation | null;
  /** The report's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseTrendSeverity | null;
  /** A one-line, content-free headline authored from the position + state + recommendation. */
  readonly detail: string;
}

/** The bounded history summary — how many reports were supplied / usable, and the recommendation distribution. */
export interface ReleaseTrendHistory {
  /** How many report inputs were supplied (before any cap). */
  readonly reportsSupplied: number;
  /** How many reports were considered after the `--max-reports` window cap (the newest N). */
  readonly reportsConsidered: number;
  /** True iff `--max-reports` dropped older reports from the window. */
  readonly truncated: boolean;
  /** How many older reports were dropped by the window cap (`reportsSupplied − reportsConsidered`). */
  readonly droppedOldest: number;
  /** How many considered reports are usable (recognized + self-consistent). */
  readonly reportsUsable: number;
  /** How many considered reports were unreadable (not recognized as a report). */
  readonly reportsUnreadable: number;
  /** How many considered reports were tampered (recognized but self-inconsistent). */
  readonly reportsTampered: number;
  /** The count of each recommendation across the usable considered reports (all four keys present). */
  readonly counts: Readonly<Record<ReleaseReportRecommendation, number>>;
  /** The newest usable report's recommendation, or `null` if none is usable. */
  readonly newest: ReleaseReportRecommendation | null;
  /** The oldest usable report's recommendation, or `null` if none is usable. */
  readonly oldest: ReleaseReportRecommendation | null;
  /** The bounded arc from oldest usable to newest usable, by severity rank. */
  readonly direction: ReleaseTrendDirection;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseTrendPolicy {
  /** The maximum number of newest reports considered (the window cap). */
  readonly maxReports: number;
  /** The maximum tolerated `hold-warning` count in the window before `repeated-hold-warning` fires. */
  readonly maxHoldWarning: number;
  /** The maximum tolerated `hold-fail` count in the window before `repeated-hold-fail` fires. */
  readonly maxHoldFail: number;
  /** True iff `--require-latest-ready` was set (the newest report must be `promote-ready`). */
  readonly requireLatestReady: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseTrendReason {
  readonly id: ReleaseTrendReasonId;
  readonly severity: ReleaseTrendSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One follow-up checklist item, with its authored detail. */
export interface ReleaseTrendFollowup {
  readonly id: ReleaseTrendFollowupId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite trend decision — the single verdict + exit code a governance review acts on. */
export interface ReleaseTrendRollup {
  readonly verdict: ReleaseTrendVerdict;
  readonly exitCode: ReleaseTrendExitCode;
  /** True iff `verdict === "stable"`. */
  readonly stable: boolean;
  /** The fired reason ids, in canonical order (empty on a clean stable trend). */
  readonly reasons: readonly ReleaseTrendReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--require-latest-ready` was applied. */
  readonly requireLatestReady: boolean;
  /**
   * True iff the ONLY blocker was the enforced not-ready tip (`--require-latest-ready` over a newest that was
   * advisory / insufficient, with no tamper / hold-fail / threshold breach). The trend would be `warning` /
   * `unknown` without the flag; surfaced so the summary explains the escalation.
   */
  readonly readyEscalated: boolean;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream report schema). */
export interface ReleaseTrendMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_TREND_POLICY_VERSION;
  readonly reportSchema: typeof RELEASE_REPORT_SCHEMA;
}

/**
 * The stable, content-free release evidence trend summary a governance review / CI reads. Every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no locator, identifier,
 * size, path, or byte, even from a hostile input, and never echoes an ingested report's own stamp.
 */
export interface ReleaseTrendResult {
  readonly schema: typeof RELEASE_TREND_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseTrendMetadata;
  readonly policy: ReleaseTrendPolicy;
  readonly history: ReleaseTrendHistory;
  /** One reduced point per considered report, ordered oldest → newest. */
  readonly points: readonly ReleaseTrendPoint[];
  readonly trend: ReleaseTrendRollup;
  /** Every fired reason, in canonical {@link RELEASE_TREND_REASON_IDS} order. */
  readonly reasons: readonly ReleaseTrendReason[];
  /** The bounded, ordered follow-up checklist. Never derived from an input. */
  readonly followUps: readonly ReleaseTrendFollowup[];
  /** Bounded, app-authored guidance (out-of-scope steps this summary does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested report. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseTrendReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did
 * this trend summary conclude, over how many usable reports, with how many blocking / insufficiency / advisory
 * reasons" for a SIEM / governance record. Bounded enums + small integers + a stable policy id + the run's own
 * stamp only; safe to log or forward verbatim.
 */
export interface ReleaseTrendReceipt {
  readonly category: "worker-release-trend";
  readonly policyId: typeof RELEASE_TREND_POLICY_ID;
  readonly policyVersion: typeof RELEASE_TREND_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseTrendVerdict;
  readonly exitCode: ReleaseTrendExitCode;
  /** How many report inputs were supplied. */
  readonly reportsSupplied: number;
  /** How many reports were considered after the window cap. */
  readonly reportsConsidered: number;
  /** How many considered reports are usable. */
  readonly reportsUsable: number;
  /** The newest usable report's recommendation, or `null`. */
  readonly newest: ReleaseReportRecommendation | null;
  /** The oldest usable report's recommendation, or `null`. */
  readonly oldest: ReleaseReportRecommendation | null;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  /** True iff `--require-latest-ready` was applied. */
  readonly requireLatestReady: boolean;
}

/** The process exit code for a trend result. */
export function releaseTrendExitCode(result: ReleaseTrendResult): number {
  return result.trend.exitCode;
}

/** The authoritative verdict → exit code map. */
export const RELEASE_TREND_EXIT_FOR_VERDICT: Record<ReleaseTrendVerdict, ReleaseTrendExitCode> = {
  stable: RELEASE_TREND_EXIT.STABLE,
  warning: RELEASE_TREND_EXIT.WARNING,
  unknown: RELEASE_TREND_EXIT.UNKNOWN,
  failing: RELEASE_TREND_EXIT.FAILING,
};

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested report)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_TREND_VERDICT_SUMMARY: Record<ReleaseTrendVerdict, string> = {
  stable:
    "STABLE: the recent release-report history is healthy — no tampered or unreadable report, the newest usable report is PROMOTE-READY, and no history threshold was breached. Keep summarizing on your governance cadence. This summary authorizes nothing on its own.",
  warning:
    "WARNING: no blocker and the history is sufficient, but an ADVISORY concern was raised — the newest usable report is HOLD-WARNING, warnings increased versus the previous report, or the hold-warning count exceeded the policy threshold. Review the recent posture, then decide whether follow-up is warranted.",
  unknown:
    "UNKNOWN (insufficient): the report history is INSUFFICIENT to summarize a trend — a report was unreadable, no report was usable, or the newest usable report is NEEDS-EVIDENCE (its release could not be certified). This is a setup / coverage problem, not a healthy trend.",
  failing:
    "FAILING: a BLOCKING issue — a supplied report is recognized but self-inconsistent (a tamper), the newest usable report is HOLD-FAIL, the hold-fail count exceeded the policy threshold, or the newest report is not PROMOTE-READY under `--require-latest-ready`. Do not treat this trend as healthy until the failure or tamper is resolved.",
};

/**
 * The dedicated headline for a `failing` trend produced ONLY because `--require-latest-ready` escalated a
 * non-ready newest (a `hold-warning` / `needs-evidence` tip) — there was no tamper, hold-fail, or threshold
 * breach, so the generic `failing` summary would misrepresent the cause. Authored; selected when `readyEscalated`.
 */
export const RELEASE_TREND_READY_ESCALATED_SUMMARY =
  "FAILING (--require-latest-ready): the only blocker is the enforced not-ready tip — the newest usable report is not PROMOTE-READY, and `--require-latest-ready` escalates that to a failing trend. Without the flag this would be WARNING / UNKNOWN. No tampered report, hold-fail newest, or breached threshold was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_TREND_REASON_DETAIL: Record<
  ReleaseTrendReasonId,
  { readonly severity: ReleaseTrendSeverity; readonly detail: string }
> = {
  "report-tampered": {
    severity: "blocking",
    detail:
      "A supplied report is a recognized `pdfxyz.release-report/1` whose recorded recommendation does NOT re-derive from its own sources + strict flag — a hand-edited or corrupt report. Recover the untampered report from your CI archive; a tampered report cannot be summarized.",
  },
  "latest-hold-fail": {
    severity: "blocking",
    detail:
      "The newest usable report is HOLD-FAIL: the most recent release was held for a blocking issue (a tampered / failed / regressed evidence set). The current tip of the trend is failing — investigate before promoting.",
  },
  "repeated-hold-fail": {
    severity: "blocking",
    detail:
      "The number of HOLD-FAIL reports in the window exceeded the `--max-hold-fail` threshold: repeated blocking releases across the recent history, not an isolated blip. Investigate the pattern before promoting.",
  },
  "latest-not-ready": {
    severity: "blocking",
    detail:
      "`--require-latest-ready` was set and the newest usable report is NOT promote-ready. The policy requires the tip of the trend to be a clean promote-ready; escalate the non-ready newest to a failing trend and resolve the latest release before promoting.",
  },
  "report-unreadable": {
    severity: "insufficient",
    detail:
      "A supplied report could not be read / recognized as a `pdfxyz.release-report/1` (wrong schema or unparseable — never echoed), so it contributes no trend evidence. Supply readable reports produced by `worker:release-report` and re-run.",
  },
  "no-usable-reports": {
    severity: "insufficient",
    detail:
      "The window has zero usable reports — every supplied report was unreadable or the history was empty. There is nothing to summarize; supply a bounded history of readable `pdfxyz.release-report/1` reports and re-run.",
  },
  "latest-needs-evidence": {
    severity: "insufficient",
    detail:
      "The newest usable report is NEEDS-EVIDENCE: the most recent release could not be certified (an unreadable / audit-only / indeterminate evidence set). Gate the latest release's own coherence and re-run its report before treating the trend as healthy.",
  },
  "latest-hold-warning": {
    severity: "advisory",
    detail:
      "The newest usable report is HOLD-WARNING: no blocker, but the most recent release carried an advisory concern (a bundle warn / a non-blocking audit drift). Review the recent posture, then decide.",
  },
  "repeated-hold-warning": {
    severity: "advisory",
    detail:
      "The number of HOLD-WARNING reports in the window exceeded the `--max-hold-warning` threshold: advisory concerns are recurring across the recent history. Review the pattern and decide whether it warrants follow-up.",
  },
  "trend-degraded": {
    severity: "advisory",
    detail:
      "The newest usable report's posture is WORSE than the previous usable report's (the recent trend degraded / warnings increased between the two most recent reports). Review what changed between the last two releases.",
  },
};

/** Per-follow-up authored detail, keyed by id. */
export const RELEASE_TREND_FOLLOWUP_DETAIL: Record<ReleaseTrendFollowupId, string> = {
  "investigate-failing-trend":
    "Investigate the failing trend (a hold-fail newest report, or repeated hold-fail reports across the window) and resolve the underlying release issue before promoting; recover the untampered reports from your CI archive if needed.",
  "recover-tampered-report":
    "Recover the untampered report from your CI archive: a recorded recommendation that does not re-derive means the report was hand-edited or corrupted, and cannot be trusted in the trend.",
  "supply-report-history":
    "Supply more / readable content-free `pdfxyz.release-report/1` reports (a bounded chronological history, oldest first) and re-run this summary: an unreadable or empty history cannot be summarized.",
  "gate-latest-release":
    "The latest usable report is not promote-ready (needs-evidence, or a not-ready tip under `--require-latest-ready`): gate the latest release's own coherence with `worker:release-ci-bundle` / `worker:release-report` and resolve it before treating the trend as healthy.",
  "review-warning-trend":
    "Review the advisory warning trend (a hold-warning newest, warnings increased, or a breached warning threshold) and decide whether follow-up is warranted; archive this summary as the record of that decision.",
  "continue-monitoring":
    "The recent trend is stable: keep composing operator reports per release and summarizing them here on your weekly / monthly governance cadence. This summary authorizes no promotion on its own.",
  "archive-trend":
    "Archive this trend summary (and the underlying reports) as CI artifacts: it is the content-free release-governance record for this review window. This summary never uploads or promotes anything.",
};

/**
 * The honesty caveats every result carries and every text render prints. The trend SUMMARIZES a bounded history
 * of the chain's already content-free operator reports, RE-VALIDATES each one's self-consistency, and rolls
 * them up into one governance verdict; it must never be read as more than that.
 */
export const RELEASE_TREND_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE TREND SUMMARY: it INGESTS a bounded history of content-free `pdfxyz.release-report/1` operator reports a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded governance verdict + follow-up checklist. It is local content-free TREND REPORTING over evidence reports — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / bundle / audit / report itself, and NEVER deletes, prunes, uploads, promotes, approves, or mutates any report, bundle, audit, artifact, index, policy, object, or deployment. A `stable` trend authorizes nothing; it only reports that the content-free reports supplied on THIS host trended healthy over the review window.",
  "A `stable` trend REQUIRES a clean bounded window: no tampered / unreadable report, a newest usable report that is `promote-ready`, and no breached history threshold. It FAILS CLOSED: a tampered report, a hold-fail newest, or a breached hold-fail threshold makes the trend `failing`; an unreadable report, an empty history, or a needs-evidence newest is `unknown` (insufficient); it never fabricates a stable trend from thin or untrusted history.",
  "It re-derives each ingested report's recommendation from the report's OWN recorded sources + strict flag (reusing the Phase 52 reducer) and treats a recorded recommendation that does not re-derive as a TAMPER (`failing`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested report's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the trend carries but does NOT itself perform — the honest edges of an offline
 * summarizer. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_TREND_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED governance SUMMARY (weekly / monthly), NOT a per-release gate: run `worker:release-report` per release and archive each report, then hand a bounded chronological history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a failing trend or a tampered report), surface exit 3 (a warning trend) for review, and treat exit 2 (insufficient history) as a coverage gap, not a healthy trend.",
  "Keep the window bounded and explicit: `--max-reports=N` caps the newest N reports; `--max-hold-warning=N` / `--max-hold-fail=N` set how many advisory / blocking releases the window tolerates before the trend flags them; `--require-latest-ready` demands the newest report be promote-ready. The NEWEST report is always authoritative — a currently-failing tip fails the trend even within a tolerated threshold.",
  "Archive this trend summary (and the underlying reports) as CI artifacts: it is a content-free governance record, not a substitute for the reports it summarizes, nor for your storage-side retention, signing, and release-APPROVAL processes.",
  "Enforce promotion out of band: this summary REPORTS a trend over the content-free reports supplied, but signing a release, provisioning, approving, and promoting a deployment are operator / CI actions this offline summarizer never performs.",
];
