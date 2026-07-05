/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout index trend action plan**
 * (Phase 67).
 *
 * Phases 59–66 built the release DECISION closeout chain, one rung per phase: the decision RECORD ledger
 * (`pdfxyz.release-decision/1`, Phase 59), the decision LEDGER INDEX (Phase 60), the decision INDEX TREND (Phase 61),
 * the decision TREND ACTION PLAN (Phase 62), the ACTION-PLAN EXECUTION RECEIPT (Phase 63), the decision CLOSEOUT BUNDLE
 * (`pdfxyz.release-decision-closeout/1`, Phase 64), the decision CLOSEOUT INDEX (`pdfxyz.release-decision-closeout-index/1`,
 * Phase 65), and the decision CLOSEOUT INDEX TREND (`pdfxyz.release-decision-closeout-index-trend/1`, Phase 66) — which
 * folds a bounded HISTORY of closeout-index windows into ONE trend verdict + arc direction + trend class.
 *
 * This phase turns that closeout-index trend into an operator's next move. It INGESTS ONE
 * `pdfxyz.release-decision-closeout-index-trend/1` document, RE-VALIDATES it against ITSELF (re-deriving its Phase 66
 * trend verdict from its OWN recorded window summary AND re-checking that summary against the trend's OWN per-window
 * posture sequence, so a hand-flipped trend verdict — or a lied window distribution consistent with it — is caught as a
 * tamper), and folds it into ONE stable, content-free `pdfxyz.release-decision-closeout-action-plan/1` document that
 * answers a single question a periodic release-governance review needs —
 *
 *    "Given this content-free closeout-index trend, what bounded follow-up posture should the release team take, and at
 *     what urgency?"
 *
 * — as a bounded action-plan verdict + urgency + action class, the surfaced source trend verdict / class / arc / latest
 * index posture, an ordered next-action checklist (each item a stable id + a label from an allowlist + bounded urgency /
 * expectation enums), a bounded rationale, and a content-free receipt, and it FAILS CLOSED when the trend cannot be
 * trusted.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the trend it plans over:
 *  - Every load-bearing token here is a bounded enum — a plan verdict, an urgency, an action class, an action id, an
 *    expectation, a reason id, plus the surfaced upstream trend verdict / class / direction / latest index verdict —
 *    never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, raw
 *    note, reviewer identity, commit URL, digest, or timestamp from the ingested trend. The only non-enum values are
 *    small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of the ingested trend (even one Phase 66 produced is UNTRUSTED input here);
 *    it reduces the trend to bounded enums, small integers, and booleans, it never echoes the trend's OWN stamp (the
 *    plan carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a clean plan. `clear` REQUIRES a usable trend whose OWN verdict is `trend-stable`; a
 *    `trend-blocked` trend — or an unreadable / tampered trend input, or a `--strict-watch` escalation — is a
 *    `block-release` plan; a `trend-incomplete` trend is an `investigate` plan; a `trend-watch` trend is a follow-up
 *    `monitor` plan. It authorizes NOTHING — a `clear` plan is not sign-off, approval, or promotion.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, NOT an incident record, and NOT a deployment /
 * promotion ledger. It PROVES nothing the trend does not already prove; it TRANSLATES the trend's content-free verdict
 * into a bounded operator follow-up posture. Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_CAVEATS})
 * say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutIndexTrendClass,
  type ReleaseDecisionCloseoutIndexTrendDirection,
  type ReleaseDecisionCloseoutIndexTrendVerdict,
  type ReleaseDecisionCloseoutIndexVerdict,
} from "../release-decision-closeout-index-trend/types";

/** The schema tag every closeout-action-plan result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SCHEMA =
  "pdfxyz.release-decision-closeout-action-plan/1" as const;

/** The upstream document schema the action plan ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA };

/** Stable identity of the release-decision-closeout-action-plan — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-action-plan";
/** Bump when the plan surface, the verdict ladder, the action / reason sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION = 1;

/** The upstream trend enums the plan surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutIndexTrendVerdict,
  ReleaseDecisionCloseoutIndexTrendClass,
  ReleaseDecisionCloseoutIndexTrendDirection,
  ReleaseDecisionCloseoutIndexVerdict,
};

/**
 * The bounded coverage state of the one ingested closeout-index-trend document:
 *  - `unreadable` — supplied but not read / parsed / recognized as a `pdfxyz.release-decision-closeout-index-trend/1`
 *                   (never echoed);
 *  - `tampered`   — recognized as a closeout-index trend but its recorded trend verdict does NOT re-derive from its own
 *                   recorded window summary, or that summary disagrees with the trend's own per-window sequence;
 *  - `usable`     — recognized AND self-consistent (its recorded trend verdict re-derives, and its summary matches its
 *                   sequence): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SOURCE_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutActionPlanSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SOURCE_STATES)[number];

/**
 * The single action-plan verdict a governance reviewer keys on — the answer to "what follow-up posture should the
 * release team take?":
 *  - `clear`         — the trend is a usable, coherent `trend-stable` history: no follow-up is warranted beyond routine
 *                      monitoring. It authorizes NOTHING on its own (not sign-off / approval / promotion);
 *  - `investigate`   — the trend is `trend-incomplete` (a coverage gap / insufficient signal): supply / complete the
 *                      missing closeout-index evidence and re-summarize before treating the history as usable;
 *  - `monitor`       — the trend is `trend-watch` (an open latest / threshold breach or a degrading arc): a bounded
 *                      follow-up is warranted — track the open follow-ups / investigate the worsening arc;
 *  - `block-release` — the trend is `trend-blocked` (a tampered / blocked window in its history), OR the trend INPUT
 *                      itself is unreadable / tampered, OR `--strict-watch` escalated a `monitor` plan here. Do NOT
 *                      promote; reconcile / restore first. Dominates; never a vacuous clean plan.
 *
 * These are the exact bounded values the run-level `worker_release_decision_closeout_action_plan_total` metric carries
 * as its `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICTS = [
  "clear",
  "investigate",
  "monitor",
  "block-release",
] as const;
export type ReleaseDecisionCloseoutActionPlanVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICTS)[number];

/**
 * The bounded **urgency** of the whole plan — how soon the release team should act. `none` (a coherent stable trend),
 * through `medium` (an incomplete / inconclusive trend), `high` (a watch / degrading history), to `critical` (a blocked
 * / untrustworthy trend, or a `--strict-watch` escalation). A bounded facet; never a duration or a timestamp.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_URGENCIES = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type ReleaseDecisionCloseoutActionPlanUrgency =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_URGENCIES)[number];

/**
 * The single coarse **action class** — the primary posture the plan recommends, keyed off the source trend:
 *  - `none`                  — the trend is coherent `trend-stable`; continue routine monitoring, nothing to remediate;
 *  - `complete-evidence`     — the trend is `trend-incomplete`; supply / complete the missing closeout-index evidence
 *                              and re-summarize;
 *  - `monitor-followups`     — the trend is `trend-watch`; track the open follow-ups / investigate the worsening arc;
 *  - `block-and-reconcile`   — the trend is `trend-blocked` (a tampered / blocked window in its history), or
 *                              `--strict-watch` escalated a `monitor` plan; hold promotion and reconcile the block;
 *  - `reject-input`          — the trend INPUT itself is unreadable / tampered; reject it and recover a valid trend.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_ACTION_CLASSES = [
  "none",
  "complete-evidence",
  "monitor-followups",
  "block-and-reconcile",
  "reject-input",
] as const;
export type ReleaseDecisionCloseoutActionPlanActionClass =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_ACTION_CLASSES)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-decision suite so
 * the tools speak one language:
 *  - `0` CLEAR        — a `clear` plan (a coherent, stable closeout-index history — routine monitoring only);
 *  - `1` USAGE        — the CLI was misused (a bad flag, no trend supplied, or an unwritable output). CLI-owned; a plan
 *                       RUN never resolves to it;
 *  - `2` INVESTIGATE  — an `investigate` plan (a `trend-incomplete`, inconclusive history);
 *  - `3` MONITOR      — a `monitor` plan requiring follow-up (a `trend-watch` / degrading history);
 *  - `4` BLOCK        — a `block-release` plan (a `trend-blocked` history, an unreadable / tampered trend input, or a
 *                       `--strict-watch` escalation).
 *
 * Monotonic in badness; `investigate` (2) sorts before the `monitor` band (3) exactly like the rest of the suite folds a
 * coverage gap before an advisory posture.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT = {
  CLEAR: 0,
  USAGE: 1,
  INVESTIGATE: 2,
  MONITOR: 3,
  BLOCK: 4,
} as const;
export type ReleaseDecisionCloseoutActionPlanExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT];

/** The authoritative plan verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutActionPlanVerdict,
  ReleaseDecisionCloseoutActionPlanExitCode
> = {
  clear: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.CLEAR,
  investigate: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.INVESTIGATE,
  monitor: RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.MONITOR,
  "block-release": RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.BLOCK,
};

/**
 * The severity each fired reason maps onto, with precedence `blocking > advisory > incomplete > informational` (checked
 * in that order — higher is worse, and the run's plan verdict follows the worst fired severity, which is monotonic in
 * exit badness `4 > 3 > 2 > 0`):
 *  - `informational` — a benign note (a coherent stable trend);
 *  - `incomplete`    — a coverage gap (an incomplete / inconclusive trend);
 *  - `advisory`      — a follow-up is warranted (a watch / degrading trend);
 *  - `blocking`      — the history / input cannot be trusted (a blocked trend, an unreadable / tampered input, or a
 *                      `--strict-watch` escalation).
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SEVERITIES = [
  "informational",
  "incomplete",
  "advisory",
  "blocking",
] as const;
export type ReleaseDecisionCloseoutActionPlanSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the plan resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail
 * are authored in {@link RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_REASON_DETAIL}:
 *
 * Blocking (the history / input cannot be trusted):
 *  - `trend-unreadable`        — the supplied trend could not be read / recognized as a closeout-index trend;
 *  - `trend-tampered`          — the supplied trend is recognized but its verdict / summary do NOT re-derive;
 *  - `trend-blocked`           — the trend's OWN verdict is `trend-blocked` (a tampered / blocked closeout-index window);
 *  - `strict-watch-escalation` — `--strict-watch` was set and escalated a `monitor` plan to `block-release`.
 *
 * Advisory (a follow-up is warranted):
 *  - `trend-watch`             — the trend's OWN verdict is `trend-watch` (an open latest / threshold breach, or a
 *                                degrading arc).
 *
 * Incomplete (a coverage gap):
 *  - `trend-incomplete`        — the trend's OWN verdict is `trend-incomplete` (an unreadable / incomplete latest window,
 *                                or zero usable windows).
 *
 * Informational (a benign note):
 *  - `trend-stable`            — the trend's OWN verdict is `trend-stable` (a coherent, healthy closeout-index history).
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_REASON_IDS = [
  // Blocking
  "trend-unreadable",
  "trend-tampered",
  "trend-blocked",
  "strict-watch-escalation",
  // Advisory
  "trend-watch",
  // Incomplete
  "trend-incomplete",
  // Informational
  "trend-stable",
] as const;
export type ReleaseDecisionCloseoutActionPlanReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_REASON_IDS)[number];

/**
 * The bounded **expectation** attached to each action item — how binding the step is before the release can be treated
 * as clear:
 *  - `must-complete-before-release` — a blocking step; the release cannot be treated as clear until it is resolved;
 *  - `recommended`                  — a follow-up that should be done, but does not by itself block the release;
 *  - `informational`                — a standing note (continue routine monitoring, keep the plan) — never blocking.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXPECTATIONS = [
  "must-complete-before-release",
  "recommended",
  "informational",
] as const;
export type ReleaseDecisionCloseoutActionPlanExpectation =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXPECTATIONS)[number];

/**
 * The bounded action ids — the closed set of concrete operator steps a plan can recommend, in this canonical order (the
 * checklist is emitted in this order, deduped):
 *  - `reject-and-recover-trend`      — the trend input is unreadable / tampered; reject it and recover a valid trend;
 *  - `reconcile-blocked-history`     — the trend flagged a tampered / blocked closeout-index window; reconcile it;
 *  - `hold-promotion`                — do NOT promote / sign off until the blocking cause is resolved;
 *  - `track-watch-history`           — an open / degrading posture is present; track the follow-up(s) to closure;
 *  - `complete-incomplete-history`   — the trend is inconclusive; supply / complete the missing closeout-index evidence;
 *  - `re-summarize-after-fix`        — after remediating, re-index the closeouts + re-run the trend, then re-plan;
 *  - `continue-closeout-cadence`     — the trend is coherent; keep indexing + trending closeouts on your cadence;
 *  - `keep-action-plan`              — keep this content-free plan as the local follow-up record (always). It is NOT a
 *                                      legal / compliance sign-off, an external approval / signature, an identity proof,
 *                                      a deployment authorization, a promotion ledger, an incident record, or an audit log.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_ACTION_IDS = [
  "reject-and-recover-trend",
  "reconcile-blocked-history",
  "hold-promotion",
  "track-watch-history",
  "complete-incomplete-history",
  "re-summarize-after-fix",
  "continue-closeout-cadence",
  "keep-action-plan",
] as const;
export type ReleaseDecisionCloseoutActionPlanActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Source facts + result shapes
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-index-trend/1` (its verdict re-derived). */
export interface CloseoutActionPlanTrendFacts {
  /** The trend's final verdict (trusted — the trend re-derived its own verdict + window summary). */
  readonly verdict: ReleaseDecisionCloseoutIndexTrendVerdict;
  /** The trend's own exit code (context; the plan has its own). */
  readonly exitCode: number;
  /** True iff the trend's own verdict is a coherent `trend-stable` (its `stable` flag). */
  readonly stable: boolean;
  /** The trend's newest usable window's index verdict, or `null` (surfaced as `sourceLatestIndex`). */
  readonly latest: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The trend's coarse arc direction (surfaced as `sourceArcDirection`). */
  readonly direction: ReleaseDecisionCloseoutIndexTrendDirection;
  /** The trend's coarse class (surfaced as `sourceTrendClass`). */
  readonly trendClass: ReleaseDecisionCloseoutIndexTrendClass;
  /** How many windows the trend considered (after its own window cap). */
  readonly windowsConsidered: number;
  /** How many of those windows were usable in the trend. */
  readonly windowsUsable: number;
  /** How many closeouts the trend considered across its usable windows (a bounded sum). */
  readonly totalCloseouts: number;
  /** True iff the trend was produced under `--strict-watch` (context; never re-judged by the plan). */
  readonly strictWatch: boolean;
}

/** The bounded source summary the result records — what the plan planned over, content-free. */
export interface ReleaseDecisionCloseoutActionPlanSource {
  /** The trend's coverage state. */
  readonly state: ReleaseDecisionCloseoutActionPlanSourceState;
  /**
   * The trend's own verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * trend it is the untrusted CLAIMED verdict (surfaced so the plan shows what was asserted).
   */
  readonly claimedVerdict: ReleaseDecisionCloseoutIndexTrendVerdict | null;
  /** How many windows the source trend considered (a bounded count; `0` when not usable). */
  readonly windowsConsidered: number;
  /** How many of those windows were usable (a bounded count; `0` when not usable). */
  readonly windowsUsable: number;
  /** How many closeouts the source trend considered across its usable windows (`0` when not usable). */
  readonly totalCloseouts: number;
  /** True iff the source trend was produced under `--strict-watch` (context; `false` when not usable). */
  readonly sourceStrictWatch: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutActionPlanPolicy {
  /** True iff `--strict-watch` was set (a `monitor` plan escalates to `block-release`). */
  readonly strictWatch: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutActionPlanReason {
  readonly id: ReleaseDecisionCloseoutActionPlanReasonId;
  readonly severity: ReleaseDecisionCloseoutActionPlanSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One ordered action item — a stable id + an allowlisted label + bounded urgency / expectation enums + a boolean. */
export interface ReleaseDecisionCloseoutActionPlanItem {
  readonly id: ReleaseDecisionCloseoutActionPlanActionId;
  /** Bounded, app-authored label (keyed by id, from the allowlist). Never derived from an input. */
  readonly label: string;
  /** How soon this step should be done. */
  readonly urgency: ReleaseDecisionCloseoutActionPlanUrgency;
  /** How binding this step is before the release can be treated as clear. */
  readonly expectation: ReleaseDecisionCloseoutActionPlanExpectation;
  /** True iff this step must be resolved before the release can be treated as clear (a `must-complete` expectation). */
  readonly blocking: boolean;
}

/** The composite plan decision — the single verdict + urgency + action class + exit code a reviewer acts on. */
export interface ReleaseDecisionCloseoutActionPlanRollup {
  readonly verdict: ReleaseDecisionCloseoutActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutActionPlanActionClass;
  readonly exitCode: ReleaseDecisionCloseoutActionPlanExitCode;
  /** True iff `verdict === "clear"` (a coherent trend that warrants no follow-up beyond routine monitoring). */
  readonly clear: boolean;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutActionPlanReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** How many fired reasons were incomplete. */
  readonly incompletes: number;
  /** How many fired reasons were informational. */
  readonly informationals: number;
  /** True iff `--strict-watch` was applied. */
  readonly strictWatch: boolean;
  /** True iff `--strict-watch` ESCALATED a `monitor` plan to `block-release`. */
  readonly strictWatchEscalated: boolean;
  /** Which plan verdict `--strict-watch` escalated FROM, or `null` when no escalation applied. */
  readonly strictWatchEscalatedFrom: "monitor" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream closeout-index-trend schema). */
export interface ReleaseDecisionCloseoutActionPlanMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION;
  readonly trendSchema: typeof RELEASE_DECISION_CLOSEOUT_INDEX_TREND_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this plan
 * conclude, over what trend, and at what urgency" for a SIEM / review record. Bounded enums + small integers + a stable
 * policy id + the run's own stamp + a disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutActionPlanReceipt {
  readonly category: "worker-release-decision-closeout-action-plan";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutActionPlanActionClass;
  readonly exitCode: ReleaseDecisionCloseoutActionPlanExitCode;
  /** The source trend's coverage state. */
  readonly sourceState: ReleaseDecisionCloseoutActionPlanSourceState;
  /** The source trend's own verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutIndexTrendVerdict | null;
  /** The source trend's newest usable window index verdict (trusted; `null` when not usable). */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutIndexVerdict | null;
  /** How many action items were emitted. */
  readonly actionsEmitted: number;
  /** True iff `--strict-watch` escalated a `monitor` plan to `block-release`. */
  readonly strictWatchEscalated: boolean;
  /** The bounded, app-authored disclosure statement (what this plan is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout index trend action plan a governance reviewer / CI reads. Every
 * field is a bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity,
 * locator, size, path, or byte, even from a hostile input, and never echoes the ingested trend's own stamp.
 */
export interface ReleaseDecisionCloseoutActionPlanResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutActionPlanMetadata;
  readonly policy: ReleaseDecisionCloseoutActionPlanPolicy;
  /** The single plan verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionCloseoutActionPlanVerdict;
  /** The whole-plan urgency. */
  readonly urgency: ReleaseDecisionCloseoutActionPlanUrgency;
  /** The single coarse action class. */
  readonly actionClass: ReleaseDecisionCloseoutActionPlanActionClass;
  /** The process exit code (mirrors `closeoutActionPlan.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutActionPlanExitCode;
  /** The source trend's own verdict (bounded enum), or `null` when unreadable. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutIndexTrendVerdict | null;
  /** The source trend's coarse class (bounded enum), or `null` when not usable. */
  readonly sourceTrendClass: ReleaseDecisionCloseoutIndexTrendClass | null;
  /** The source trend's arc direction (bounded enum), or `null` when not usable. */
  readonly sourceArcDirection: ReleaseDecisionCloseoutIndexTrendDirection | null;
  /** The source trend's newest usable window index verdict (bounded enum), or `null` when not usable. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The bounded source summary the plan planned over. */
  readonly source: ReleaseDecisionCloseoutActionPlanSource;
  /** The composite plan rollup (verdict + urgency + action class + exit + reasons + strict flags). THE TOP-LEVEL rollup. */
  readonly closeoutActionPlan: ReleaseDecisionCloseoutActionPlanRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutActionPlanReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly actions: readonly ReleaseDecisionCloseoutActionPlanItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this plan does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from the ingested trend. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutActionPlanReceipt;
}

/** The process exit code for a plan result. */
export function releaseDecisionCloseoutActionPlanExitCode(
  result: ReleaseDecisionCloseoutActionPlanResult,
): number {
  return result.closeoutActionPlan.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from the ingested trend)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutActionPlanVerdict,
  string
> = {
  clear:
    "CLEAR: the closeout-index trend is a usable, coherent TREND-STABLE history — no follow-up is warranted beyond routine monitoring. This plan authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  investigate:
    "INVESTIGATE: the trend is TREND-INCOMPLETE (a coverage gap / insufficient signal) — supply or complete the missing closeout-index evidence and re-summarize before treating the history as usable. This is not a clean pass and not a block; it is a coverage gap to close.",
  monitor:
    "MONITOR: the trend is TREND-WATCH (an open latest / threshold breach, or a degrading arc) — run the bounded follow-up: track the open follow-up(s) to closure and review what changed. This is not a block, but the history is not consistently closed either.",
  "block-release":
    "BLOCK-RELEASE: the trend is TREND-BLOCKED (a tampered / blocked closeout-index window in its history), the trend INPUT itself is unreadable / tampered, or `--strict-watch` escalated a monitor plan. Do NOT promote or sign off; hold the release and reconcile / restore the flagged evidence before relying on the history.",
};

/**
 * The dedicated headline for a `block-release` plan produced ONLY because `--strict-watch` escalated a `monitor` plan —
 * the trend itself was not blocked / tampered, so the generic headline would misrepresent the cause. Authored.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_STRICT_WATCH_ESCALATED_SUMMARY =
  "BLOCK-RELEASE (--strict-watch): the only concern is a follow-up MONITOR plan (a TREND-WATCH history — an open latest, a threshold breach, or a degrading arc), and `--strict-watch` escalates any monitor plan to block release — a hard `consistently closed or blocked` gate for a high-assurance review. Without the flag this would be MONITOR. The trend itself was not blocked, and its input was not tampered.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutActionPlanReasonId,
  { readonly severity: ReleaseDecisionCloseoutActionPlanSeverity; readonly detail: string }
> = {
  "trend-unreadable": {
    severity: "blocking",
    detail:
      "The supplied trend could not be read / recognized as a `pdfxyz.release-decision-closeout-index-trend/1` (wrong schema or unparseable — never echoed). There is no trend to plan over; recover a valid trend produced by `worker:release-decision-closeout-index-trend` and re-run. This fails closed: an unreadable trend input is a block, never a vacuous clean plan.",
  },
  "trend-tampered": {
    severity: "blocking",
    detail:
      "The supplied trend is a recognized `pdfxyz.release-decision-closeout-index-trend/1` whose recorded trend verdict does NOT re-derive from its own recorded window summary, or whose summary disagrees with its own per-window sequence — a hand-edited or corrupt trend. Recover the untampered trend from your CI archive; a tampered trend cannot be planned over.",
  },
  "trend-blocked": {
    severity: "blocking",
    detail:
      "The trend's OWN verdict is TREND-BLOCKED: a closeout-index window in its history was tampered or `index-blocked`, its blocked window count exceeded its threshold, or it was `--strict-watch` escalated. Do NOT treat the recent closeouts as consistently closed; hold promotion and reconcile the flagged window before relying on the history.",
  },
  "strict-watch-escalation": {
    severity: "blocking",
    detail:
      "`--strict-watch` was set and the plan was a MONITOR (a `trend-watch` history), so the policy escalates it to block release — a hard `consistently closed or blocked` gate for a high-assurance review. Close the open follow-up(s) / resolve the regression (or drop `--strict-watch` if a watch history is acceptable for this review) before treating the release as clear.",
  },
  "trend-watch": {
    severity: "advisory",
    detail:
      "The trend's OWN verdict is TREND-WATCH: an `index-open` latest window, a watch-threshold breach, or a degrading arc (the newest window is worse than the oldest). Track the open follow-up(s) to closure and investigate what changed across the recent windows before relying on the history; archive this plan as the record of that review.",
  },
  "trend-incomplete": {
    severity: "incomplete",
    detail:
      "The trend's OWN verdict is TREND-INCOMPLETE: a coverage gap — an unreadable window, an `index-incomplete` latest window, an incomplete-threshold breach, or zero usable windows. Complete the missing closeout-index evidence, re-index + re-trend those windows, and re-plan before treating the history as usable.",
  },
  "trend-stable": {
    severity: "informational",
    detail:
      "The trend's OWN verdict is TREND-STABLE: a coherent, healthy closeout-index history (the latest window `indexed`, within thresholds, non-degrading). No follow-up is warranted beyond routine monitoring; keep indexing + trending closeouts on your governance cadence. This clean plan authorizes no promotion on its own.",
  },
};

/** Per-action authored label + urgency + expectation, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_ACTION_DETAIL: Record<
  ReleaseDecisionCloseoutActionPlanActionId,
  {
    readonly label: string;
    readonly urgency: ReleaseDecisionCloseoutActionPlanUrgency;
    readonly expectation: ReleaseDecisionCloseoutActionPlanExpectation;
  }
> = {
  "reject-and-recover-trend": {
    label:
      "Reject the untrusted trend input and recover a valid `pdfxyz.release-decision-closeout-index-trend/1` from your CI archive, then re-run this plan. A trend that cannot be read, or whose verdict does not re-derive from its own window summary + sequence, was lost or hand-edited and cannot be planned over.",
    urgency: "critical",
    expectation: "must-complete-before-release",
  },
  "reconcile-blocked-history": {
    label:
      "Reconcile the tampered / blocked closeout-index window the trend flagged: do NOT treat that review period as consistently closed. Recover the untampered window (or resolve the block), re-index the closeouts, re-run the trend, then re-plan before relying on the history.",
    urgency: "critical",
    expectation: "must-complete-before-release",
  },
  "hold-promotion": {
    label:
      "Hold any release promotion / sign-off until the blocking cause is resolved. This plan is a follow-up posture, not an authorization — a `block-release` plan means the recent closeout-index history cannot be treated as consistently closed yet.",
    urgency: "critical",
    expectation: "must-complete-before-release",
  },
  "track-watch-history": {
    label:
      "Track the open follow-up(s) the watch trend surfaced (an `index-open` latest window, a watch-threshold breach, or a degrading arc) to closure, and investigate what changed across the recent windows. Archive this plan as the record of that review.",
    urgency: "high",
    expectation: "recommended",
  },
  "complete-incomplete-history": {
    label:
      "Complete the missing closeout-index evidence the inconclusive trend is short of: recover the unreadable window(s), complete the `index-incomplete` latest window with `worker:release-decision-closeout` / `worker:release-decision-closeout-index`, re-run `worker:release-decision-closeout-index-trend`, then re-plan. An inconclusive history cannot be treated as usable.",
    urgency: "medium",
    expectation: "must-complete-before-release",
  },
  "re-summarize-after-fix": {
    label:
      "After remediating, re-index the affected closeouts with `worker:release-decision-closeout-index`, re-run `worker:release-decision-closeout-index-trend`, and re-run this plan over the fresh trend — do not rely on this plan once the underlying windows change.",
    urgency: "medium",
    expectation: "recommended",
  },
  "continue-closeout-cadence": {
    label:
      "The history is coherent: keep filing one `worker:release-decision-closeout-index` window per review period, summarizing them with `worker:release-decision-closeout-index-trend`, and planning here on your governance cadence. This clean plan authorizes no promotion on its own.",
    urgency: "none",
    expectation: "informational",
  },
  "keep-action-plan": {
    label:
      "Keep this content-free plan as the local release-decision-closeout follow-up record. It is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log; keep each of those in its own dedicated system.",
    urgency: "none",
    expectation: "informational",
  },
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this plan is NOT). */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_DISCLOSURE =
  "This is a content-free operational follow-up plan ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced closeout-index trend summary and recommends bounded operator follow-up; it authorizes and proves nothing.";

/**
 * The honesty caveats every result carries and every text render prints. The plan TRANSLATES the trend's already
 * content-free verdict into a bounded operator follow-up plan, and must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT INDEX TREND ACTION PLAN: it INGESTS ONE content-free `pdfxyz.release-decision-closeout-index-trend/1` summary a release pipeline produced, RE-VALIDATES it against ITSELF, and translates its bounded verdict into ONE bounded operator follow-up plan + urgency + next-action checklist. It is a content-free operational follow-up plan ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any trend, window, record, artifact, object, or deployment. A `clear` plan authorizes nothing; it only reports that the content-free trend supplied on THIS host warrants no follow-up beyond routine monitoring.",
  "A `clear` plan REQUIRES a usable trend whose OWN verdict is a coherent `trend-stable` history. It FAILS CLOSED: an unreadable / tampered trend input is `block-release` (`reject-input`); a `trend-blocked` trend is `block-release` (`block-and-reconcile`); a `trend-incomplete` trend is `investigate`; a `trend-watch` trend is a follow-up `monitor` plan; and `--strict-watch` escalates a `monitor` plan to `block-release`. It never fabricates a clean plan from an untrusted or non-stable trend, and `--strict-watch` never fabricates a compliance approval for a clean one.",
  "It re-derives the ingested trend's verdict from the trend's OWN recorded window summary (reusing the Phase 66 trend rollup reducer) AND re-checks that summary against the trend's own per-window posture sequence + window arithmetic, and treats any disagreement as a TAMPER (`block-release`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the plan proves neither authorship nor approval, and a fully self-consistent fabricated trend is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes the ingested trend's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the plan carries but does NOT itself perform — the honest edges of an offline planner.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: run `worker:release-decision-closeout-index-trend` over your archived closeout-index windows, then hand the ONE trend here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a block-release plan), surface exit 3 (a follow-up monitor plan) and exit 2 (an investigate plan) for review, and treat exit 0 (a clear plan) as no follow-up warranted beyond routine monitoring — never as an authorization.",
  "Keep the plan bounded and explicit: `--strict-watch` escalates a `monitor` plan (a watch / degrading trend) to block release — a hard `consistently closed or blocked` gate for a high-assurance review. The plan is derived only from the trend's bounded verdict / class / direction / latest posture, never from any ingested timestamp or window content.",
  "Archive this plan (and the underlying trend + closeout-index windows) as CI artifacts: it is a content-free follow-up SUMMARY, not a substitute for the trend it plans over, nor for your legal audit trail, compliance sign-off, external approval / signing, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this plan TRANSLATES a content-free trend into bounded follow-up, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline planner never performs.",
];
