/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index trend
 * finalize index trend closeout index trend action plan** (Phase 87).
 *
 * Phases 84–86 built the closeout governance FINALIZE-INDEX-TREND CLOSEOUT chain, one rung per phase. The most recent
 * rungs are the closeout BUNDLE (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout/1`,
 * Phase 84), the closeout LEDGER INDEX
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index/1`, Phase 85), and the
 * closeout INDEX TREND
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1`, Phase 86) —
 * which folds a bounded HISTORY of closeout-index windows into ONE trend verdict + arc direction + trend class.
 *
 * This phase turns that closeout-index trend into an operator's next move. It INGESTS ONE
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` document,
 * RE-VALIDATES it against ITSELF (re-deriving its Phase 86 trend verdict from its OWN recorded coverage / window
 * distribution / arc summary AND re-checking that summary against the trend's OWN per-window posture sequence, so a
 * hand-flipped trend verdict — or a lied window distribution consistent with it — is caught as a tamper), and folds it into
 * ONE stable, content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1`
 * document that answers a single question a periodic release-governance review needs —
 *
 *    "Given this content-free closeout-index trend, what bounded follow-up plan should an operator run next, and with what
 *     urgency?"
 *
 * — as a bounded action-plan verdict + urgency + action class, the surfaced source trend verdict / class / arc / latest
 * closeout-index posture, an ordered next-action checklist (each item a stable id + a label from an allowlist + bounded
 * urgency / expectation enums), a bounded rationale, and a content-free receipt, and it FAILS CLOSED when the trend cannot
 * be trusted.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the trend it plans over:
 *  - Every load-bearing token here is a bounded enum — a plan verdict, an urgency, an action class, an action id, an
 *    expectation, a reason id, plus the surfaced upstream trend verdict / class / direction / latest closeout-index
 *    posture — never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw
 *    label, raw note, reviewer identity, commit URL, digest, or timestamp from the ingested trend. The only non-enum
 *    values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of the ingested trend (even one Phase 86 produced is UNTRUSTED input here); it
 *    reduces the trend to bounded enums, small integers, and booleans, it never echoes the trend's OWN stamp (the plan
 *    carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a clean plan. `clear` REQUIRES a usable trend whose OWN verdict is `stable` or `improving`; a
 *    `blocked` trend — or an `invalid` (untrustworthy-window) trend — is a `block-release` plan; an `insufficient` trend
 *    is an `investigate` plan; a `watch` / `degrading` trend is a follow-up `monitor` plan; an unreadable / tampered
 *    trend INPUT is an `invalid` plan (`reject-input`). It authorizes NOTHING — a `clear` plan is not sign-off, approval,
 *    or promotion.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, NOT an incident record, and NOT a deployment /
 * promotion ledger. It PROVES nothing the trend does not already prove; it TRANSLATES the trend's content-free verdict
 * into a bounded operator follow-up plan. Its authored caveats (see
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_CAVEATS})
 * say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/types";

/** The schema tag every closeout-index-trend action-plan result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1" as const;

/** The upstream document schema the action plan ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA };

/** Stable identity of the release-decision-…-closeout-index-trend-action-plan — for docs / receipts. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan";
/** Bump when the plan surface, the verdict ladder, the action / reason sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_VERSION = 1;

/** The default `--max-actions` cap: a plan is a short operator checklist, not an unbounded list. */
export const DEFAULT_MAX_ACTIONS = 8;
/** The hard ceiling for `--max-actions`: even a fully-fired plan stays a bounded checklist. */
export const MAX_MAX_ACTIONS = 20;

/** The upstream trend enums the plan surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
};

/**
 * The bounded coverage state of the one ingested closeout-index-trend document:
 *  - `unreadable` — supplied but not read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` (never echoed);
 *  - `tampered`   — recognized as a closeout-index trend but its recorded trend verdict does NOT re-derive from its own
 *                   recorded coverage + window distribution + arc summary, or that summary disagrees with the trend's own
 *                   per-window posture sequence;
 *  - `usable`     — recognized AND self-consistent (its recorded trend verdict re-derives, and its summary matches its
 *                   sequence): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SOURCE_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SOURCE_STATES)[number];

/**
 * The single action-plan verdict a governance reviewer keys on — the answer to "what should an operator do next?":
 *  - `clear`         — the trend is a usable, coherent `stable` history: no follow-up is warranted beyond continuing the
 *                      cadence. It authorizes NOTHING on its own (not sign-off / approval / promotion);
 *  - `monitor`       — the trend is `improving` (a recovering arc — confirm it is sustained; benign, low urgency),
 *                      `watch` (an older open / incomplete window under a clean latest — track it), or `degrading`
 *                      (a worsening arc / open latest — investigate the regression);
 *  - `investigate`   — the trend is `insufficient` (inconclusive): supply / complete the missing closeout-index evidence
 *                      and re-summarize before treating the history as usable;
 *  - `block-release` — the trend is `blocked` (a `blocked` usable window / `--strict-open` escalation), or `--strict`
 *                      escalated a non-`clear` (monitor / investigate) plan. Do NOT promote; reconcile first;
 *  - `invalid`       — the trend cannot be trusted: its INPUT is unreadable / tampered, OR its OWN verdict is `invalid`
 *                      (an untrustworthy window in its history). Reject / restore it. Dominates; never a vacuous clean
 *                      plan, and never weakened by a policy knob.
 *
 * These are the exact bounded values the run-level
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_action_plan_total`
 * metric carries as its `verdict` label; all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS = [
  "clear",
  "monitor",
  "investigate",
  "block-release",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS)[number];

/**
 * The bounded **urgency** of the whole plan — how soon an operator should act. `routine` (a coherent stable / improving
 * trend), through `soon` (a flat watch / inconclusive trend), `high` (a worsening arc), to `immediate` (a blocked /
 * untrustworthy trend, an untrustworthy input, or a `--strict` escalation). A bounded facet;
 * never a duration or a timestamp.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES = [
  "routine",
  "soon",
  "high",
  "immediate",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES)[number];

/**
 * The single coarse **action class** — the primary posture the plan recommends, keyed off the source trend:
 *  - `none`                — the trend is coherent `stable`; continue the cadence, nothing to remediate;
 *  - `confirm-improvement` — the trend is `improving`; confirm the recovery is sustained (a benign `monitor`, low urgency);
 *  - `monitor-followups`   — the trend is `watch`; track the residual open / incomplete follow-ups to closure;
 *  - `stabilize-regression`— the trend is `degrading`; investigate + stabilize the worsening arc / open latest;
 *  - `complete-evidence`   — the trend is `insufficient`; supply / complete the missing closeout-index evidence;
 *  - `block-and-reconcile` — the trend is `blocked` (a tampered / blocked usable window), or a `--strict`
 *                            escalation; hold promotion and reconcile the block;
 *  - `restore-history`     — the trend is `invalid` (an untrustworthy window in its history); recover the window and
 *                            re-index / re-trend;
 *  - `reject-input`        — the trend INPUT itself is unreadable / tampered; reject it and recover a valid trend.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES = [
  "none",
  "confirm-improvement",
  "monitor-followups",
  "stabilize-regression",
  "complete-evidence",
  "block-and-reconcile",
  "restore-history",
  "reject-input",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape as the whole release-evidence suite so the tools
 * speak one language:
 *  - `0` CLEAR       — a `clear` plan (a coherent `stable` / `improving` history — continue the cadence);
 *  - `1` USAGE       — the CLI was misused (a bad flag, no trend supplied, or an unwritable output). CLI-owned; a plan
 *                      RUN never resolves to it;
 *  - `2` INVESTIGATE — an `investigate` plan (an `insufficient`, inconclusive trend);
 *  - `3` MONITOR     — a `monitor` plan requiring follow-up (a `watch` / `degrading` history);
 *  - `4` BLOCK       — a `block-release` plan (a `blocked` / `invalid`-history trend, or a `--strict`
 *                      escalation), or an `invalid` plan (an untrustworthy trend input or an invalid-history trend). Both share the
 *                      top code but are distinct verdicts.
 *
 * Monotonic in badness; `investigate` (2) sorts before the `monitor` band (3) exactly like the rest of the suite folds a
 * coverage gap before an advisory posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT = {
  CLEAR: 0,
  USAGE: 1,
  INVESTIGATE: 2,
  MONITOR: 3,
  BLOCK: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT];

/** The authoritative plan verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExitCode
> = {
  clear: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT.CLEAR,
  investigate: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT.INVESTIGATE,
  monitor: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT.MONITOR,
  "block-release": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT.BLOCK,
  invalid: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXIT.BLOCK,
};

/**
 * The severity each fired reason maps onto, with precedence `invalid > blocking > insufficient > advisory >
 * informational` (checked in that order — so an untrustworthy input never masquerades as a mere blocker, an insufficiency
 * never as an advisory, and a real blocker is never masked):
 *  - `informational` — a benign note (a coherent stable / improving trend);
 *  - `advisory`      — a follow-up is warranted (a watch / degrading trend);
 *  - `insufficient`  — the trend is inconclusive (an insufficient trend);
 *  - `blocking`      — the trend blocks release (a blocked / invalid-history trend, or a `--strict` escalation);
 *  - `invalid`       — the trend INPUT cannot be trusted (an unreadable / tampered trend document).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SEVERITIES = [
  "informational",
  "advisory",
  "insufficient",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the plan resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail are
 * authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_DETAIL}:
 *
 * Invalid input (the trend document — or a window in its history — cannot be trusted):
 *  - `trend-unreadable`      — the supplied trend could not be read / recognized as a closeout-index trend;
 *  - `trend-tampered`        — the supplied trend is recognized but its verdict / summary do NOT re-derive;
 *  - `trend-invalid`         — the trend's OWN verdict is `invalid` (an unreadable / tampered window in its history).
 *
 * Blocking (the trend blocks release):
 *  - `trend-blocked`         — the trend's OWN verdict is `blocked` (a `blocked` window / `--strict-open`);
 *  - `strict-escalation`     — `--strict` escalated a non-`clear` (monitor / investigate) plan to `block-release`.
 *
 * Insufficient (the trend is inconclusive):
 *  - `trend-insufficient`    — the trend's OWN verdict is `insufficient` (zero usable / incomplete-latest windows).
 *
 * Advisory (a follow-up is warranted):
 *  - `trend-degrading`       — the trend's OWN verdict is `degrading` (a worsening arc / open latest);
 *  - `trend-watch`           — the trend's OWN verdict is `watch` (an older open / incomplete window under a clean latest);
 *  - `trend-improving`       — the trend's OWN verdict is `improving` (a recovering arc — a benign monitor follow-up).
 *
 * Informational (a benign note):
 *  - `trend-stable`          — the trend's OWN verdict is `stable` (a coherent all-closed history).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_IDS = [
  // Invalid input (the trend document or a window in its history cannot be trusted)
  "trend-unreadable",
  "trend-tampered",
  "trend-invalid",
  // Blocking (the trend blocks release)
  "trend-blocked",
  "strict-escalation",
  // Insufficient (the trend is inconclusive)
  "trend-insufficient",
  // Advisory (a follow-up is warranted)
  "trend-degrading",
  "trend-watch",
  "trend-improving",
  // Informational (a benign note)
  "trend-stable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_IDS)[number];

/**
 * The bounded **expectation** attached to each action item — how binding the step is before the release can be treated as
 * clear:
 *  - `must-complete-before-release` — a blocking step; the release cannot be treated as clear until it is resolved;
 *  - `recommended`                  — a follow-up that should be done, but does not by itself block the release;
 *  - `informational`                — a standing note (continue the cadence, keep the plan) — never blocking.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXPECTATIONS = [
  "must-complete-before-release",
  "recommended",
  "informational",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExpectation =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_EXPECTATIONS)[number];

/**
 * The bounded action ids — the closed set of concrete operator steps a plan can recommend, in this canonical order (the
 * checklist is emitted in this order, deduped):
 *  - `reject-and-recover-trend`      — the trend input is unreadable / tampered; reject it and recover a valid trend;
 *  - `reconcile-blocked-history`     — the trend flagged a blocked closeout-index window; reconcile it;
 *  - `restore-untrusted-history`     — the trend flagged an untrustworthy (tampered / unreadable) window; recover it;
 *  - `hold-promotion`                — do NOT promote / sign off until the blocking cause is resolved;
 *  - `complete-insufficient-history` — the trend is inconclusive; supply / complete the missing closeout-index evidence;
 *  - `investigate-degrading-arc`     — the arc is worsening; investigate what changed across the recent windows;
 *  - `track-watch-followups`         — an older open / incomplete window is present; track the follow-ups to closure;
 *  - `re-summarize-after-fix`        — after remediating, re-index the closeouts + re-run the trend, then re-plan;
 *  - `confirm-improvement-sustained` — the arc recovered; confirm the improvement holds across the next windows;
 *  - `continue-closeout-cadence`     — the trend is coherent; keep indexing + trending closeouts on your cadence;
 *  - `keep-action-plan`              — keep this content-free plan as the local follow-up record (always). It is NOT a
 *                                      legal / compliance sign-off, an external approval / signature, an identity proof,
 *                                      a deployment authorization, a promotion ledger, an incident record, or an audit log.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_IDS = [
  "reject-and-recover-trend",
  "reconcile-blocked-history",
  "restore-untrusted-history",
  "hold-promotion",
  "complete-insufficient-history",
  "investigate-degrading-arc",
  "track-watch-followups",
  "re-summarize-after-fix",
  "confirm-improvement-sustained",
  "continue-closeout-cadence",
  "keep-action-plan",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Source facts + result shapes
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` (its verdict
 * re-derived in ingest).
 */
export interface CloseoutIndexTrendActionPlanFacts {
  /** The trend's final verdict (trusted — the trend re-derived its own verdict + summary). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict;
  /** The trend's own exit code (context; the plan has its own). */
  readonly exitCode: number;
  /** True iff the trend's own verdict is a coherent `stable` / `improving` (its `clean` flag). */
  readonly clean: boolean;
  /** The trend's newest usable window's closeout-index verdict, or `null` (surfaced as `sourceLatestIndex`). */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The trend's coarse arc direction (surfaced as `sourceArcDirection`). */
  readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection;
  /** The trend's coarse class (surfaced as `sourceTrendClass`). */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
  /** How many windows the trend considered (after its own window cap). */
  readonly indexesConsidered: number;
  /** How many of those windows were usable in the trend. */
  readonly indexesUsable: number;
  /** How many closeout records the trend considered across its usable windows (a bounded sum). */
  readonly totalCloseouts: number;
  /** True iff the trend was produced under `--strict-open` (context; never re-judged by the plan). */
  readonly strictOpen: boolean;
}

/** The bounded source summary the result records — what the plan planned over, content-free. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSource {
  /** The trend's coverage state. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSourceState;
  /**
   * The trend's own verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * trend it is the untrusted CLAIMED verdict (surfaced so the plan shows what was asserted).
   */
  readonly claimedVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** How many windows the source trend considered (a bounded count; `0` when not usable). */
  readonly indexesConsidered: number;
  /** How many of those windows were usable (a bounded count; `0` when not usable). */
  readonly indexesUsable: number;
  /** How many closeout records the source trend considered across its usable windows (`0` when not usable). */
  readonly totalCloseouts: number;
  /** True iff the source trend was produced under `--strict-open` (context; `false` when not usable). */
  readonly sourceStrictOpen: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy {
  /** True iff `--strict` was set (every non-`clear`, non-`invalid` plan escalates to `block-release`). */
  readonly strict: boolean;
  /** The `--max-actions` cap on the emitted checklist (parser-clamped to [1, {@link MAX_MAX_ACTIONS}]). */
  readonly maxActions: number;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One ordered action item — a stable id + an allowlisted label + bounded urgency / expectation enums + a boolean. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanItem {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId;
  /** Bounded, app-authored label (keyed by id, from the allowlist). Never derived from an input. */
  readonly label: string;
  /** How soon this step should be done. */
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency;
  /** How binding this step is before the release can be treated as clear. */
  readonly expectation: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExpectation;
  /** True iff this step must be resolved before the release can be treated as clear (a `must-complete` expectation). */
  readonly blocking: boolean;
}

/** The composite plan decision — the single verdict + urgency + action class + exit code a reviewer acts on. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExitCode;
  /** True iff `verdict === "clear"` (a coherent trend that warrants no follow-up beyond continuing the cadence). */
  readonly clear: boolean;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalidInputs: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** How many fired reasons were informational. */
  readonly informationals: number;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
  /** True iff `--strict` ESCALATED a non-`clear` (monitor / investigate) plan to `block-release`. */
  readonly strictEscalated: boolean;
  /** Which plan verdict `--strict` escalated FROM, or `null` when no escalation applied. */
  readonly escalatedFrom: "monitor" | "investigate" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream closeout-index-trend schema). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_VERSION;
  readonly trendSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this plan
 * conclude, over what trend, and at what urgency" for a SIEM / review record. Bounded enums + small integers + a stable
 * policy id + the run's own stamp + a disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExitCode;
  /** The source trend's coverage state. */
  readonly sourceState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSourceState;
  /** The source trend's own verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** The source trend's newest usable window closeout-index verdict (trusted; `null` when not usable). */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** How many action items were emitted (after the `--max-actions` cap). */
  readonly actionsEmitted: number;
  /** How many candidate action items the `--max-actions` cap dropped (never a silent truncation). */
  readonly actionsDropped: number;
  /** True iff `--strict` escalated a non-block plan to `block-release`. */
  readonly escalated: boolean;
  /** The bounded, app-authored disclosure statement (what this plan is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout governance finalize index trend finalize index trend closeout index
 * trend action plan a governance reviewer / CI reads. Every field is a bounded enum, a small integer, an ISO stamp, or
 * app-authored prose — so it carries no reviewer identity, locator, size, path, or byte, even from a hostile input, and
 * never echoes the ingested trend's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy;
  /** The single plan verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict;
  /** The whole-plan urgency. */
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency;
  /** The single coarse action class. */
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass;
  /** The process exit code (mirrors `actionPlan.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExitCode;
  /** The source trend's own verdict (bounded enum), or `null` when unreadable. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** The source trend's coarse class (bounded enum), or `null` when not usable. */
  readonly sourceTrendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass | null;
  /** The source trend's arc direction (bounded enum), or `null` when not usable. */
  readonly sourceArcDirection: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection | null;
  /** The source trend's newest usable window closeout-index verdict (bounded enum), or `null` when not usable. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The bounded source summary the plan planned over. */
  readonly source: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSource;
  /** The composite plan rollup (verdict + urgency + action class + exit + reasons + escalation flags). */
  readonly actionPlan: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanRollup;
  /** Every fired reason, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReason[];
  /** The bounded, ordered next-action checklist (id + label + urgency + expectation + blocking). Never from an input. */
  readonly plan: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanItem[];
  /** The bounded, ordered next-action ids only (a compact allowlist view of `plan`). Never derived from an input. */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId[];
  /** The applied `--max-actions` cap (echoed for the governance record). */
  readonly maxActions: number;
  /** How many candidate action items the plan derived before the `--max-actions` cap. */
  readonly actionsConsidered: number;
  /** How many candidate action items the `--max-actions` cap dropped (never a silent truncation). */
  readonly actionsDropped: number;
  /** Bounded, app-authored guidance (out-of-scope steps this plan does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from the ingested trend. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReceipt;
}

/** The process exit code for a plan result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
): number {
  return result.actionPlan.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from the ingested trend)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
  string
> = {
  clear:
    "CLEAR: the closeout-index trend is a usable, coherent STABLE history — no follow-up is warranted beyond continuing the governance cadence. This plan authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  monitor:
    "MONITOR: the trend warrants a bounded follow-up — an IMPROVING history (a recovering arc — confirm it is sustained; benign), a WATCH history (an older open / incomplete window under a clean latest) to track, or a DEGRADING history (a worsening arc / open latest) to investigate. Run the follow-up checklist; this is not a block, but it is not a clean pass either.",
  investigate:
    "INVESTIGATE: the trend is INSUFFICIENT (inconclusive) — supply or complete the missing closeout-index evidence and re-summarize before treating the history as usable. This is not a clean pass and not a block; it is a coverage gap to close.",
  "block-release":
    "BLOCK-RELEASE: the trend is BLOCKED (a tampered / blocked closeout-index window in its history), or `--strict` escalated a non-clear (monitor / investigate) plan. Do NOT promote or sign off; hold the release and reconcile the flagged evidence before relying on the history.",
  invalid:
    "INVALID: the trend cannot be trusted — its INPUT is unreadable or recognized-but-self-inconsistent (a tamper), or its OWN verdict is INVALID (an untrustworthy window in its history it could not summarize). Reject / recover a valid `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1`; this plan cannot be trusted until the input is recovered.",
};

/**
 * The dedicated headline for a `block-release` plan produced ONLY because `--strict` escalated a non-clear plan — the
 * trend itself was not blocked / invalid, so the generic headline would misrepresent the cause. Keyed by which verdict
 * the escalation escalated FROM.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ESCALATED_SUMMARY: Record<
  "monitor" | "investigate",
  string
> = {
  monitor:
    "BLOCK-RELEASE (--strict): the only concern is a follow-up MONITOR plan (an improving / watch / degrading trend), and `--strict` escalates every non-clear plan to block release — a hard `all-clear or block` gate for a high-assurance review. Without the flag this would be MONITOR. The trend itself was not blocked / invalid.",
  investigate:
    "BLOCK-RELEASE (--strict): the only concern is an INVESTIGATE plan (an insufficient, inconclusive trend), and `--strict` escalates every non-clear plan to block release — a hard `all-clear or block` gate. Without the flag this would be INVESTIGATE. The trend itself was not blocked / invalid.",
};

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanReasonId,
  {
    readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanSeverity;
    readonly detail: string;
  }
> = {
  "trend-unreadable": {
    severity: "invalid",
    detail:
      "The supplied trend could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` (wrong schema or unparseable — never echoed). There is no trend to plan over; recover a valid trend produced by `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend` and re-run. This fails closed: an unreadable trend input is INVALID, never a vacuous clean plan.",
  },
  "trend-tampered": {
    severity: "invalid",
    detail:
      "The supplied trend is a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` whose recorded trend verdict does NOT re-derive from its own recorded coverage + window distribution + arc summary, or whose summary disagrees with its own per-window posture sequence — a hand-edited or corrupt trend. Recover the untampered trend from your CI archive; a tampered trend cannot be planned over.",
  },
  "trend-blocked": {
    severity: "blocking",
    detail:
      "The trend's OWN verdict is BLOCKED: a usable window's own verdict is `blocked` / `invalid` (its closeout history was blocked), or `--strict-open` escalated a watch / degrading window. Do NOT treat the recent closeouts as consistently closed; hold promotion and reconcile the flagged window before relying on the history.",
  },
  "trend-invalid": {
    severity: "invalid",
    detail:
      "The trend's OWN verdict is INVALID: a window in its history was unreadable / tampered (an untrustworthy input the trend itself could not summarize), so the trend cannot be trusted as a summary of the recent closeout-index posture. Recover the untampered closeout-index window, re-index + re-trend, then re-plan. This fails closed: an invalid-history trend is INVALID, never a vacuous clean plan.",
  },
  "strict-escalation": {
    severity: "blocking",
    detail:
      "`--strict` was set and the plan was not `clear` — a MONITOR (an improving / watch / degrading trend) or an INVESTIGATE (an insufficient trend) — so the policy escalates it to block release: a hard `all-clear or block` gate for a high-assurance review. Close the underlying concern (or drop `--strict` if a non-clear trend is acceptable for this review) before treating the release as clear. `--strict` never escalates a coherent `stable` trend and never weakens the `invalid` precedence of an untrustworthy input.",
  },
  "trend-insufficient": {
    severity: "insufficient",
    detail:
      "The trend's OWN verdict is INSUFFICIENT: zero usable windows, an `incomplete` latest, or an only-incomplete history (the recent closeouts were inconclusive). Supply / complete the missing closeout-index evidence, re-index + re-trend those windows, and re-plan before treating the history as usable.",
  },
  "trend-degrading": {
    severity: "advisory",
    detail:
      "The trend's OWN verdict is DEGRADING: the latest usable window is `open`, or the arc worsened across the recent windows. Investigate what changed between the recent closeout-index windows and stabilize the regression before relying on the history; archive this plan as the record of that review.",
  },
  "trend-watch": {
    severity: "advisory",
    detail:
      "The trend's OWN verdict is WATCH: an older `open` / `incomplete` window sits under a clean latest (a residual open posture, not degrading). Track the recorded follow-ups to closure before relying on the history; archive this plan as the record of that review.",
  },
  "trend-stable": {
    severity: "informational",
    detail:
      "The trend's OWN verdict is STABLE: a coherent, healthy closeout-index history (every usable window `all-closed`, non-degrading). No follow-up is warranted beyond routine monitoring; keep indexing + trending closeout windows on your governance cadence. This clean plan authorizes no promotion on its own.",
  },
  "trend-improving": {
    severity: "advisory",
    detail:
      "The trend's OWN verdict is IMPROVING: the arc recovered to a clean latest window over an earlier worse one. This is a benign MONITOR plan (low urgency, never a block by default): confirm the improvement is sustained across the next windows. Keep indexing + trending closeouts on your cadence.",
  },
};

/** Per-action authored label + urgency + expectation, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionId,
  {
    readonly label: string;
    readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency;
    readonly expectation: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanExpectation;
  }
> = {
  "reject-and-recover-trend": {
    label:
      "Reject the untrusted trend input and recover a valid `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` from your CI archive, then re-run this plan. A trend that cannot be read, or whose verdict does not re-derive from its own summary + sequence, was lost or hand-edited and cannot be planned over.",
    urgency: "immediate",
    expectation: "must-complete-before-release",
  },
  "reconcile-blocked-history": {
    label:
      "Reconcile the blocked closeout-index window the trend flagged: do NOT treat that review period as consistently closed. Resolve the block (or recover the untampered closeout records), re-index the closeouts, re-run the trend, then re-plan before relying on the history.",
    urgency: "immediate",
    expectation: "must-complete-before-release",
  },
  "restore-untrusted-history": {
    label:
      "Recover the untrustworthy closeout-index window the trend flagged (an unreadable / tampered window in its history) from your CI archive, re-index + re-trend, then re-plan. A trend built over a window it could not summarize blocks release.",
    urgency: "immediate",
    expectation: "must-complete-before-release",
  },
  "hold-promotion": {
    label:
      "Hold any release promotion / sign-off until the blocking cause is resolved. This plan is a follow-up checklist, not an authorization — a `block-release` plan means the recent closeout history cannot be treated as consistently closed yet.",
    urgency: "immediate",
    expectation: "must-complete-before-release",
  },
  "complete-insufficient-history": {
    label:
      "Complete the missing closeout-index evidence the inconclusive trend is short of: recover the unreadable window(s), complete the `incomplete` latest window with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout` / `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index`, re-run `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend`, then re-plan. An inconclusive history cannot be treated as usable.",
    urgency: "soon",
    expectation: "must-complete-before-release",
  },
  "investigate-degrading-arc": {
    label:
      "Investigate what changed between the recent closeout-index windows that made the arc worsen (or left the latest window open), and stabilize the regression before relying on the history. Archive this plan as the record of that review.",
    urgency: "high",
    expectation: "recommended",
  },
  "track-watch-followups": {
    label:
      "Track the residual follow-ups the watch trend surfaced (an older `open` / `incomplete` window under a clean latest) to closure before relying on the history. Archive this plan as the record of that review.",
    urgency: "soon",
    expectation: "recommended",
  },
  "re-summarize-after-fix": {
    label:
      "After remediating, re-index the affected closeouts with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index`, re-run `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend`, and re-run this plan over the fresh trend — do not rely on this plan once the underlying windows change.",
    urgency: "soon",
    expectation: "recommended",
  },
  "confirm-improvement-sustained": {
    label:
      "Confirm the recovering arc is sustained across the next closeout-index windows before relaxing your review cadence. Keep indexing + trending closeouts; this improvement authorizes no promotion on its own.",
    urgency: "routine",
    expectation: "recommended",
  },
  "continue-closeout-cadence": {
    label:
      "The history is coherent: keep filing one `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index` window per review period, summarizing them with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend`, and planning here on your governance cadence. This clean plan authorizes no promotion on its own.",
    urgency: "routine",
    expectation: "informational",
  },
  "keep-action-plan": {
    label:
      "Keep this content-free plan as the local release-decision-closeout-governance-finalize follow-up record. It is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log; keep each of those in its own dedicated system.",
    urgency: "routine",
    expectation: "informational",
  },
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this plan is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_DISCLOSURE =
  "This is a content-free operational follow-up plan ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced closeout-index-trend summary and recommends bounded operator follow-up; it authorizes and proves nothing.";

/**
 * The honesty caveats every result carries and every text render prints. The plan TRANSLATES the trend's already
 * content-free verdict into a bounded operator follow-up plan, and must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE INDEX TREND FINALIZE INDEX TREND CLOSEOUT INDEX TREND ACTION PLAN: it INGESTS ONE content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1` summary a release pipeline produced, RE-VALIDATES it against ITSELF, and translates its bounded verdict into ONE bounded operator follow-up plan + urgency + next-action checklist. It is a content-free operational follow-up plan ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / closeout / finalize / governance itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any trend, window, record, artifact, object, or deployment. A `clear` plan authorizes nothing; it only reports that the content-free trend supplied on THIS host warrants no follow-up beyond continuing the cadence.",
  "A `clear` plan REQUIRES a usable trend whose OWN verdict is a coherent `stable` history. It FAILS CLOSED: an unreadable / tampered trend input, or a trend whose OWN verdict is `invalid` (an untrustworthy window in its history), is `invalid`; a `blocked` trend is `block-release` (`block-and-reconcile`); an `insufficient` trend is `investigate`; an `improving` / `watch` / `degrading` trend is a follow-up `monitor` plan (improving is benign, low urgency); and `--strict` escalates every non-clear (monitor / investigate) plan to `block-release`. The checklist is capped by `--max-actions` (default 8, hard max 20; the count dropped is surfaced, never silent). It never fabricates a clean plan from an untrusted or non-clean trend, and `--strict` never weakens the `invalid` precedence of an untrustworthy input.",
  "It re-derives the ingested trend's verdict from the trend's OWN recorded coverage + window distribution + arc summary (reusing the Phase 86 trend rollup reducer) AND re-checks that summary against the trend's own per-window posture sequence + window arithmetic, and treats any disagreement as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the plan proves neither authorship nor approval, and a fully self-consistent fabricated trend is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes the ingested trend's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the plan carries but does NOT itself perform — the honest edges of an offline planner. Authored,
 * bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: run `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend` over your archived closeout-index windows, then hand the ONE trend here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a block-release / invalid plan), surface exit 3 (a follow-up monitor plan) and exit 2 (an investigate plan) for review, and treat exit 0 (a clear plan) as no follow-up warranted — never as an authorization.",
  "Keep the plan bounded and explicit: `--strict` escalates EVERY non-clear (monitor / investigate) plan to block release — a hard `all-clear or block` gate for a high-assurance review — and never weakens the `invalid` precedence of an untrustworthy input; `--max-actions=N` caps the emitted checklist (default 8, hard max 20; the highest-priority N are kept and the count dropped is surfaced, never silent). The plan is derived only from the trend's bounded verdict / class / direction / latest posture, never from any ingested timestamp or window content.",
  "Archive this plan (and the underlying trend + closeout-index windows) as CI artifacts: it is a content-free follow-up SUMMARY, not a substitute for the trend it plans over, nor for your legal audit trail, compliance sign-off, external approval / signing, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this plan TRANSLATES a content-free trend into bounded follow-up, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline planner never performs.",
];
