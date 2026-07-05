/**
 * The bounded, content-free vocabulary for the secure-worker **release decision trend action plan** (Phase 62).
 *
 * Phases 46–61 built the release-evidence chain, one rung per phase: the readiness gate folds the content-free worker
 * checks into ONE promotion verdict; the artifact stamps it with bounded provenance + an integrity digest; the index
 * re-verifies many artifacts; the policy asserts bounded thresholds; the CI bundle composes a job's stage outputs; the
 * audit diffs a baseline bundle against a current one; the operator report folds a bundle + audit into ONE
 * recommendation; the trend summarizes a bounded history of those reports; the governance bundle composes a trend +
 * latest report / audit; the archive pack, restore drill, publish / handoff pack, and handoff acknowledgement carry the
 * evidence through archival, recoverability, hand-off, and receipt; the release DECISION record composes a publish pack
 * + its acknowledgement into ONE bounded decision; the DECISION LEDGER INDEX folds a BATCH of those decisions into ONE
 * ledger index verdict; and the DECISION INDEX TREND (`pdfxyz.release-decision-trend/1`, Phase 61) summarizes a bounded
 * HISTORY of those index windows into ONE trend verdict + arc direction + trend class.
 *
 * This phase turns that trend into an operator's next move. It INGESTS ONE `pdfxyz.release-decision-trend/1` document,
 * RE-VALIDATES it against ITSELF (re-deriving its Phase 61 trend verdict from its OWN recorded window-verdict summary,
 * AND re-checking that summary against the trend's OWN per-window posture sequence, so a hand-flipped trend verdict — or
 * a lied window distribution consistent with it — is caught as a tamper), and folds it into ONE stable, content-free
 * `pdfxyz.release-decision-action-plan/1` document that answers a single question a governance reviewer needs —
 *
 *    "Given this content-free decision-trend summary, what bounded follow-up plan should an operator run next, and at
 *     what urgency?"
 *
 * — as a bounded action-plan verdict + urgency + action class, the surfaced source trend verdict / class / arc, an
 * ordered next-action checklist (each item a stable id + a label from an allowlist + bounded urgency / expectation
 * enums), a bounded rationale, and a content-free receipt, and it FAILS CLOSED when the trend cannot be trusted.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the trend it plans over:
 *  - Every load-bearing token here is a bounded enum — a plan verdict, an urgency, an action class, an action id, an
 *    expectation, a reason id, plus the surfaced upstream trend verdict / class / direction — never a filename, path,
 *    object key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, raw note, reviewer identity,
 *    commit URL, digest, or timestamp from the ingested trend. The only non-enum values are small integer counts, an
 *    ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of the ingested trend (even one Phase 61 produced is UNTRUSTED input here);
 *    it reduces the trend to bounded enums, small integers, and booleans, it never echoes the trend's OWN stamp (the
 *    plan carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a clean plan. `clear` REQUIRES a usable trend whose OWN verdict is `stable`; a `blocked` /
 *    `invalid` trend is a `block-release` plan; an `insufficient` trend is an `investigate` plan; a `watch` / `degrading`
 *    trend is a follow-up `monitor` plan; an unreadable / tampered trend is an `invalid` plan (`reject-input`). It
 *    authorizes NOTHING — a `clear` plan is not sign-off, approval, or promotion.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, NOT an incident record, and NOT a deployment /
 * promotion ledger. It PROVES nothing the trend does not already prove; it TRANSLATES the trend's content-free verdict
 * into a bounded operator follow-up plan. Its authored caveats (see {@link RELEASE_DECISION_ACTION_PLAN_CAVEATS}) say so
 * out loud.
 */

import {
  RELEASE_DECISION_TREND_CLASSES,
  RELEASE_DECISION_TREND_DIRECTIONS,
  RELEASE_DECISION_TREND_SCHEMA,
  RELEASE_DECISION_TREND_VERDICTS,
  type ReleaseDecisionTrendClass,
  type ReleaseDecisionTrendDirection,
  type ReleaseDecisionTrendVerdict,
} from "../release-decision-trend/types";

/** The schema tag every action-plan result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_ACTION_PLAN_SCHEMA = "pdfxyz.release-decision-action-plan/1" as const;

/** The upstream document schema the action plan ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_TREND_SCHEMA };

/** Stable identity of the release-decision-action-plan — for docs / receipts / audit. */
export const RELEASE_DECISION_ACTION_PLAN_POLICY_ID = "pdfxyz-worker-release-decision-action-plan";
/** Bump when the plan surface, the verdict ladder, the action / reason sets, or the schema changes. */
export const RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION = 1;

/** The upstream trend enums the plan surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_TREND_VERDICTS,
  RELEASE_DECISION_TREND_CLASSES,
  RELEASE_DECISION_TREND_DIRECTIONS,
};
export type { ReleaseDecisionTrendVerdict, ReleaseDecisionTrendClass, ReleaseDecisionTrendDirection };

/** The default cap on emitted action items when `--max-actions` is not given. */
export const DEFAULT_MAX_ACTIONS = 8;
/** The hard ceiling on `--max-actions` — a plan is a short operator checklist, never an unbounded list. */
export const MAX_MAX_ACTIONS = 20;

/**
 * The bounded coverage state of the one ingested trend document:
 *  - `unreadable` — supplied but not read / parsed / recognized as a `pdfxyz.release-decision-trend/1` (never echoed);
 *  - `tampered`   — recognized as a trend but its recorded trend verdict does NOT re-derive from its own recorded
 *                   window-verdict summary, or that summary disagrees with the trend's own per-window sequence;
 *  - `usable`     — recognized AND self-consistent (its recorded trend verdict re-derives, and its summary matches its
 *                   sequence): trustworthy.
 */
export const RELEASE_DECISION_ACTION_PLAN_SOURCE_STATES = ["unreadable", "tampered", "usable"] as const;
export type ReleaseDecisionActionPlanSourceState =
  (typeof RELEASE_DECISION_ACTION_PLAN_SOURCE_STATES)[number];

/**
 * The single action-plan verdict a governance reviewer keys on — the answer to "what should an operator do next?":
 *  - `clear`         — the trend is a usable, clean `stable` history: no follow-up is warranted beyond continuing the
 *                      cadence. It authorizes NOTHING on its own (not sign-off / approval / promotion);
 *  - `monitor`       — the trend is `improving` (benign — confirm the recovery is sustained) or `watch` / `degrading`
 *                      (a follow-up is warranted — track the advisory / investigate the worsening arc);
 *  - `investigate`   — the trend is `insufficient` (inconclusive): supply / complete the missing decision evidence and
 *                      re-summarize before treating the history as usable;
 *  - `block-release` — the trend is `blocked` or `invalid`: a decision batch was rejected / untrustworthy, or a window
 *                      in the history could not be trusted. Do NOT promote; reconcile / restore first. `--strict` also
 *                      escalates any non-`clear` plan here;
 *  - `invalid`       — the trend INPUT itself is untrustworthy (unreadable / tampered): reject it and recover a valid
 *                      trend. Dominates; never a vacuous clean plan.
 *
 * These are the exact bounded values the run-level `worker_release_decision_action_plan_total` metric carries as its
 * `verdict` label; all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_ACTION_PLAN_VERDICTS = [
  "clear",
  "monitor",
  "investigate",
  "block-release",
  "invalid",
] as const;
export type ReleaseDecisionActionPlanVerdict = (typeof RELEASE_DECISION_ACTION_PLAN_VERDICTS)[number];

/**
 * The bounded **urgency** of the whole plan — how soon an operator should act. `none` (a clean trend), through `low`
 * (a benign improving trend), `medium` (a flat advisory / inconclusive trend), `high` (a worsening arc), to `critical`
 * (a blocked / invalid / untrustworthy trend, or a `--strict` escalation). A bounded facet; never a duration or a
 * timestamp.
 */
export const RELEASE_DECISION_ACTION_PLAN_URGENCIES = ["none", "low", "medium", "high", "critical"] as const;
export type ReleaseDecisionActionPlanUrgency = (typeof RELEASE_DECISION_ACTION_PLAN_URGENCIES)[number];

/**
 * The single coarse **action class** — the primary posture the plan recommends, keyed off the source trend:
 *  - `none`                  — the trend is clean `stable`; continue the cadence, nothing to remediate;
 *  - `monitor-next-window`   — the trend is `improving`; keep watching that the recovery is sustained (benign);
 *  - `review-followups`      — the trend is `watch`; track the advisory follow-ups to closure;
 *  - `stabilize-regression`  — the trend is `degrading`; investigate + stabilize the worsening arc;
 *  - `block-and-reconcile`   — the trend is `blocked` (a rejected decision batch), or `--strict` escalated a non-clear
 *                              plan; hold promotion and reconcile the block;
 *  - `restore-evidence`      — the trend is `invalid` (an untrustworthy window in its history) or `insufficient`
 *                              (missing evidence); recover / complete the decision evidence and re-summarize;
 *  - `reject-input`          — the trend INPUT itself is unreadable / tampered; reject it and recover a valid trend.
 */
export const RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES = [
  "none",
  "monitor-next-window",
  "review-followups",
  "stabilize-regression",
  "block-and-reconcile",
  "restore-evidence",
  "reject-input",
] as const;
export type ReleaseDecisionActionPlanActionClass =
  (typeof RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape as the whole release-evidence suite so the
 * tools speak one language:
 *  - `0` CLEAR       — a `clear` plan (clean stable trend), or a BENIGN `monitor` plan (an `improving` trend);
 *  - `1` USAGE       — the CLI was misused (a bad flag, no trend supplied, or an unwritable output). CLI-owned; a plan
 *                      RUN never resolves to it;
 *  - `2` INVESTIGATE — an `investigate` plan (an `insufficient`, inconclusive trend);
 *  - `3` FOLLOWUP    — a `monitor` plan that requires follow-up (a `watch` / `degrading` trend — the
 *                      `stabilize-regression` / `review-followups` action classes);
 *  - `4` BLOCK       — a `block-release` plan (a `blocked` / `invalid` trend, or a `--strict` escalation), or an
 *                      `invalid` plan (an untrustworthy trend input). Both share the top code but are distinct verdicts.
 */
export const RELEASE_DECISION_ACTION_PLAN_EXIT = {
  CLEAR: 0,
  USAGE: 1,
  INVESTIGATE: 2,
  FOLLOWUP: 3,
  BLOCK: 4,
} as const;
export type ReleaseDecisionActionPlanExitCode =
  (typeof RELEASE_DECISION_ACTION_PLAN_EXIT)[keyof typeof RELEASE_DECISION_ACTION_PLAN_EXIT];

/**
 * The severity each fired reason maps onto, with precedence `invalid > blocking > insufficient > advisory >
 * informational` (checked in that order — so an untrustworthy input never masquerades as a mere blocker, an
 * insufficiency never as an advisory, and a real blocker is never masked):
 *  - `informational` — a benign note (a clean / improving trend);
 *  - `advisory`      — a follow-up is warranted (a watch / degrading trend);
 *  - `insufficient`  — the trend is inconclusive (an insufficient trend);
 *  - `blocking`      — the trend blocks release (a blocked trend, or a `--strict` escalation);
 *  - `invalid`       — the trend cannot be trusted (an invalid trend, or an unreadable / tampered input).
 */
export const RELEASE_DECISION_ACTION_PLAN_SEVERITIES = [
  "informational",
  "advisory",
  "insufficient",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionActionPlanSeverity = (typeof RELEASE_DECISION_ACTION_PLAN_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the plan resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail
 * are authored in {@link RELEASE_DECISION_ACTION_PLAN_REASON_DETAIL}:
 *
 * Invalid input (the trend can't be trusted):
 *  - `trend-unreadable`      — the supplied trend could not be read / recognized as a `pdfxyz.release-decision-trend/1`;
 *  - `trend-tampered`        — the supplied trend is recognized but its verdict / summary do NOT re-derive.
 *
 * Blocking (the trend blocks release):
 *  - `trend-blocked`         — the trend's OWN verdict is `blocked` (a rejected / untrustworthy decision window);
 *  - `trend-invalid`         — the trend's OWN verdict is `invalid` (an unreadable / tampered window in its history);
 *  - `strict-escalation`     — `--strict` was set and escalated a non-clear plan to `block-release`.
 *
 * Insufficient (the trend is inconclusive):
 *  - `trend-insufficient`    — the trend's OWN verdict is `insufficient` (zero usable / only-insufficient windows).
 *
 * Advisory (a follow-up is warranted):
 *  - `trend-degrading`       — the trend's OWN verdict is `degrading` (the arc is worsening);
 *  - `trend-watch`           — the trend's OWN verdict is `watch` (a flat advisory concern).
 *
 * Informational (a benign note):
 *  - `trend-improving`       — the trend's OWN verdict is `improving` (a recovering arc — confirm it is sustained).
 */
export const RELEASE_DECISION_ACTION_PLAN_REASON_IDS = [
  // Invalid input
  "trend-unreadable",
  "trend-tampered",
  // Blocking
  "trend-blocked",
  "trend-invalid",
  "strict-escalation",
  // Insufficient
  "trend-insufficient",
  // Advisory
  "trend-degrading",
  "trend-watch",
  // Informational
  "trend-improving",
] as const;
export type ReleaseDecisionActionPlanReasonId =
  (typeof RELEASE_DECISION_ACTION_PLAN_REASON_IDS)[number];

/**
 * The bounded **expectation** attached to each action item — how binding the step is before the release can be treated
 * as clear:
 *  - `must-complete-before-release` — a blocking step; the release cannot be treated as clear until it is resolved;
 *  - `recommended`                  — a follow-up that should be done, but does not by itself block the release;
 *  - `informational`                — a standing note (continue the cadence, keep the plan) — never blocking.
 */
export const RELEASE_DECISION_ACTION_PLAN_EXPECTATIONS = [
  "must-complete-before-release",
  "recommended",
  "informational",
] as const;
export type ReleaseDecisionActionPlanExpectation =
  (typeof RELEASE_DECISION_ACTION_PLAN_EXPECTATIONS)[number];

/**
 * The bounded action ids — the closed set of concrete operator steps a plan can recommend, in this canonical order
 * (the checklist is emitted in this order, deduped, and the `--max-actions` cap keeps the highest-priority N):
 *  - `reject-and-recover-trend`      — the trend input is unreadable / tampered; reject it and recover a valid trend;
 *  - `restore-flagged-window`        — the trend flagged an untrustworthy window; recover the untampered window + re-index;
 *  - `reconcile-blocked-window`      — the trend flagged a rejected / blocked decision batch; reconcile it;
 *  - `hold-promotion`                — do NOT promote / sign off until the blocking cause is resolved;
 *  - `complete-insufficient-evidence`— the trend is inconclusive; supply / complete the missing decision evidence;
 *  - `investigate-degrading-arc`     — the arc is worsening; investigate what changed across the recent windows;
 *  - `track-watch-followups`         — an advisory window is present; track the recorded follow-ups to closure;
 *  - `re-summarize-after-fix`        — after remediating, re-index the decisions + re-run the trend, then re-plan;
 *  - `confirm-improvement-sustained` — the arc recovered; confirm the improvement holds across the next windows;
 *  - `continue-decision-cadence`     — the trend is clean; keep indexing + trending decisions on your cadence;
 *  - `keep-action-plan`              — keep this content-free plan as the local follow-up record (always). It is NOT a
 *                                      legal / compliance sign-off, an external approval / signature, an identity proof,
 *                                      a deployment authorization, a promotion ledger, an incident record, or an audit log.
 */
export const RELEASE_DECISION_ACTION_PLAN_ACTION_IDS = [
  "reject-and-recover-trend",
  "restore-flagged-window",
  "reconcile-blocked-window",
  "hold-promotion",
  "complete-insufficient-evidence",
  "investigate-degrading-arc",
  "track-watch-followups",
  "re-summarize-after-fix",
  "confirm-improvement-sustained",
  "continue-decision-cadence",
  "keep-action-plan",
] as const;
export type ReleaseDecisionActionPlanActionId =
  (typeof RELEASE_DECISION_ACTION_PLAN_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Source facts + result shapes
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-trend/1` (its verdict re-derived in ingest). */
export interface ActionPlanTrendFacts {
  /** The trend's final verdict (trusted — the trend re-derived its own verdict + window summary). */
  readonly verdict: ReleaseDecisionTrendVerdict;
  /** The trend's own exit code (context; the plan has its own). */
  readonly exitCode: number;
  /** True iff the trend's own verdict is a clean `stable` / `improving` (its `clear` flag). */
  readonly clear: boolean;
  /** The trend's coarse arc direction (surfaced as `sourceArcDirection`). */
  readonly direction: ReleaseDecisionTrendDirection;
  /** The trend's coarse class (surfaced as `sourceTrendClass`). */
  readonly trendClass: ReleaseDecisionTrendClass;
  /** How many windows the trend considered (after its own window cap). */
  readonly windowsConsidered: number;
  /** How many of those windows were usable in the trend. */
  readonly windowsUsable: number;
  /** How many records the trend considered across its usable windows (a bounded sum). */
  readonly totalRecords: number;
  /** True iff the trend was produced under `--strict` (context; never re-judged by the plan). */
  readonly strict: boolean;
}

/** The bounded source summary the result records — what the plan planned over, content-free. */
export interface ReleaseDecisionActionPlanSource {
  /** The trend's coverage state. */
  readonly state: ReleaseDecisionActionPlanSourceState;
  /**
   * The trend's own verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * trend it is the untrusted CLAIMED verdict (surfaced so the plan shows what was asserted).
   */
  readonly claimedVerdict: ReleaseDecisionTrendVerdict | null;
  /** How many windows the source trend considered (a bounded count; `0` when not usable). */
  readonly windowsConsidered: number;
  /** How many of those windows were usable (a bounded count; `0` when not usable). */
  readonly windowsUsable: number;
  /** How many records the source trend considered across its usable windows (`0` when not usable). */
  readonly totalRecords: number;
  /** True iff the source trend was produced under `--strict` (context; `false` when not usable). */
  readonly sourceStrict: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionActionPlanPolicy {
  /** True iff `--strict` was set (any non-`clear` plan escalates to `block-release`). */
  readonly strict: boolean;
  /** The maximum number of action items emitted (the checklist cap). */
  readonly maxActions: number;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionActionPlanReason {
  readonly id: ReleaseDecisionActionPlanReasonId;
  readonly severity: ReleaseDecisionActionPlanSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One ordered action item — a stable id + an allowlisted label + bounded urgency / expectation enums + a boolean. */
export interface ReleaseDecisionActionPlanItem {
  readonly id: ReleaseDecisionActionPlanActionId;
  /** Bounded, app-authored label (keyed by id, from the allowlist). Never derived from an input. */
  readonly label: string;
  /** How soon this step should be done. */
  readonly urgency: ReleaseDecisionActionPlanUrgency;
  /** How binding this step is before the release can be treated as clear. */
  readonly expectation: ReleaseDecisionActionPlanExpectation;
  /** True iff this step must be resolved before the release can be treated as clear (a `must-complete` expectation). */
  readonly blocking: boolean;
}

/** The composite plan decision — the single verdict + urgency + action class + exit code a reviewer acts on. */
export interface ReleaseDecisionActionPlanRollup {
  readonly verdict: ReleaseDecisionActionPlanVerdict;
  readonly urgency: ReleaseDecisionActionPlanUrgency;
  readonly actionClass: ReleaseDecisionActionPlanActionClass;
  readonly exitCode: ReleaseDecisionActionPlanExitCode;
  /** True iff `verdict === "clear"` (a clean trend that warrants no follow-up). */
  readonly clear: boolean;
  /** True iff the plan is a BENIGN `monitor` (an `improving` trend) — a `monitor` verdict at exit `0`. */
  readonly benignMonitor: boolean;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionActionPlanReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalidInputs: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
  /** True iff `--strict` ESCALATED a non-clear plan (monitor / investigate) to `block-release`. */
  readonly strictEscalated: boolean;
  /** Which plan verdict `--strict` escalated FROM, or `null` when no escalation applied. */
  readonly strictEscalatedFrom: "monitor" | "investigate" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream trend schema). */
export interface ReleaseDecisionActionPlanMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_ACTION_PLAN_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION;
  readonly trendSchema: typeof RELEASE_DECISION_TREND_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this plan
 * conclude, over what trend, and at what urgency" for a SIEM / review record. Bounded enums + small integers + a stable
 * policy id + the run's own stamp + a disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionActionPlanReceipt {
  readonly category: "worker-release-decision-action-plan";
  readonly policyId: typeof RELEASE_DECISION_ACTION_PLAN_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_ACTION_PLAN_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionActionPlanVerdict;
  readonly urgency: ReleaseDecisionActionPlanUrgency;
  readonly actionClass: ReleaseDecisionActionPlanActionClass;
  readonly exitCode: ReleaseDecisionActionPlanExitCode;
  /** The source trend's coverage state. */
  readonly sourceState: ReleaseDecisionActionPlanSourceState;
  /** The source trend's own verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
  /** How many action items were emitted (after the `--max-actions` cap). */
  readonly actionsEmitted: number;
  /** How many candidate action items the plan derived before the cap. */
  readonly actionsConsidered: number;
  /** How many candidate action items the `--max-actions` cap dropped (never a silent truncation). */
  readonly actionsDropped: number;
  /** True iff `--strict` escalated a non-clear plan to `block-release`. */
  readonly strictEscalated: boolean;
  /** The bounded, app-authored disclosure statement (what this plan is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision trend action plan a governance reviewer / CI reads. Every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator,
 * size, path, or byte, even from a hostile input, and never echoes the ingested trend's own stamp.
 */
export interface ReleaseDecisionActionPlanResult {
  readonly schema: typeof RELEASE_DECISION_ACTION_PLAN_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionActionPlanMetadata;
  readonly policy: ReleaseDecisionActionPlanPolicy;
  /** The single plan verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionActionPlanVerdict;
  /** The whole-plan urgency. */
  readonly urgency: ReleaseDecisionActionPlanUrgency;
  /** The single coarse action class. */
  readonly actionClass: ReleaseDecisionActionPlanActionClass;
  /** The process exit code (mirrors `plan.exitCode`). */
  readonly exitCode: ReleaseDecisionActionPlanExitCode;
  /** The source trend's own verdict (bounded enum), or `null` when unreadable. */
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
  /** The source trend's coarse class (bounded enum), or `null` when not usable. */
  readonly sourceTrendClass: ReleaseDecisionTrendClass | null;
  /** The source trend's arc direction (bounded enum), or `null` when not usable. */
  readonly sourceArcDirection: ReleaseDecisionTrendDirection | null;
  /** The bounded source summary the plan planned over. */
  readonly source: ReleaseDecisionActionPlanSource;
  /** The composite plan rollup (verdict + urgency + action class + exit + reasons + strict flags). */
  readonly plan: ReleaseDecisionActionPlanRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_ACTION_PLAN_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionActionPlanReason[];
  /** The bounded, ordered next-action checklist (after the `--max-actions` cap). Never derived from an input. */
  readonly actions: readonly ReleaseDecisionActionPlanItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this plan does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from the ingested trend. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionActionPlanReceipt;
}

/** The process exit code for a plan result. */
export function releaseDecisionActionPlanExitCode(result: ReleaseDecisionActionPlanResult): number {
  return result.plan.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from the ingested trend)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_ACTION_PLAN_VERDICT_SUMMARY: Record<
  ReleaseDecisionActionPlanVerdict,
  string
> = {
  clear:
    "CLEAR: the decision-index trend is a usable, clean STABLE history — no follow-up is warranted beyond continuing the governance cadence. This plan authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  monitor:
    "MONITOR: the trend warrants a bounded follow-up — either a benign IMPROVING arc to confirm is sustained, or a WATCH / DEGRADING history to track or investigate. Run the follow-up checklist; this is not a block, but it is not a clean pass either.",
  investigate:
    "INVESTIGATE: the trend is INSUFFICIENT (inconclusive) — supply or complete the missing decision evidence and re-summarize before treating the history as usable. This is not a clean pass and not a block; it is a coverage gap to close.",
  "block-release":
    "BLOCK-RELEASE: the trend is BLOCKED or INVALID (a rejected / untrustworthy decision window), or `--strict` escalated a non-clear plan. Do NOT promote or sign off; hold the release and reconcile / restore the flagged evidence before relying on the history.",
  invalid:
    "INVALID: the trend INPUT itself is untrustworthy — unreadable or recognized-but-self-inconsistent (a tamper). Reject it and recover a valid `pdfxyz.release-decision-trend/1`; this plan cannot be trusted until the input is recovered.",
};

/**
 * The dedicated headline for a `block-release` plan produced ONLY because `--strict` escalated a non-clear plan — the
 * trend itself was not blocked / invalid, so the generic headline would misrepresent the cause. Keyed by which verdict
 * `--strict` escalated from.
 */
export const RELEASE_DECISION_ACTION_PLAN_STRICT_ESCALATED_SUMMARY: Record<
  "monitor" | "investigate",
  string
> = {
  monitor:
    "BLOCK-RELEASE (--strict): the only concern is a follow-up MONITOR plan (an improving / watch / degrading trend), and `--strict` escalates any non-clear plan to block release — a hard `all-clear or block` gate. Without the flag this would be MONITOR. The trend itself was not blocked / invalid.",
  investigate:
    "BLOCK-RELEASE (--strict): the only concern is an INVESTIGATE plan (an insufficient, inconclusive trend), and `--strict` escalates any non-clear plan to block release — a hard `all-clear or block` gate. Without the flag this would be INVESTIGATE. The trend itself was not blocked / invalid.",
};

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_ACTION_PLAN_REASON_DETAIL: Record<
  ReleaseDecisionActionPlanReasonId,
  { readonly severity: ReleaseDecisionActionPlanSeverity; readonly detail: string }
> = {
  "trend-unreadable": {
    severity: "invalid",
    detail:
      "The supplied trend could not be read / recognized as a `pdfxyz.release-decision-trend/1` (wrong schema or unparseable — never echoed). There is no trend to plan over; recover a valid trend produced by `worker:release-decision-trend` and re-run.",
  },
  "trend-tampered": {
    severity: "invalid",
    detail:
      "The supplied trend is a recognized `pdfxyz.release-decision-trend/1` whose recorded trend verdict does NOT re-derive from its own recorded window-verdict summary, or whose summary disagrees with its own per-window sequence — a hand-edited or corrupt trend. Recover the untampered trend from your CI archive; a tampered trend cannot be planned over.",
  },
  "trend-blocked": {
    severity: "blocking",
    detail:
      "The trend's OWN verdict is BLOCKED: a window in its history is a blocked / invalid decision index (a rejected / untrustworthy release batch), or `--strict` blocked it. Do NOT treat the history as clean; hold promotion and reconcile the flagged window before relying on the history.",
  },
  "trend-invalid": {
    severity: "blocking",
    detail:
      "The trend's OWN verdict is INVALID: a window in its history was unreadable / tampered (an untrustworthy input the trend itself could not summarize). Recover the untampered decision-index window, re-index + re-trend, then re-plan; a trend built over an untrustworthy window blocks release.",
  },
  "strict-escalation": {
    severity: "blocking",
    detail:
      "`--strict` was set and the plan was not `clear`, so the policy escalates it to block release — a hard `all-clear or block` gate for a high-assurance review. Resolve the underlying concern (or drop `--strict` if a non-clear trend is acceptable for this review) before treating the release as clear.",
  },
  "trend-insufficient": {
    severity: "insufficient",
    detail:
      "The trend's OWN verdict is INSUFFICIENT: zero usable windows, or an only-insufficient history (the recent decision batches were inconclusive). Supply / complete the missing decision evidence, re-index + re-trend those windows, and re-plan before treating the history as usable.",
  },
  "trend-degrading": {
    severity: "advisory",
    detail:
      "The trend's OWN verdict is DEGRADING: the latest window is worse than the earliest usable window (a worsening arc). Investigate what changed between the recent windows and stabilize the regression before relying on the history; archive this plan as the record of that review.",
  },
  "trend-watch": {
    severity: "advisory",
    detail:
      "The trend's OWN verdict is WATCH: a flat advisory concern (a watch / insufficient window in the history, not degrading). Track the recorded follow-ups to closure before relying on the history; archive this plan as the record of that review.",
  },
  "trend-improving": {
    severity: "informational",
    detail:
      "The trend's OWN verdict is IMPROVING: the arc recovered to a clean latest window over an earlier worse one. Confirm the improvement is sustained across the next windows; this is a benign follow-up, not a block. Keep indexing + trending decisions on your cadence.",
  },
};

/** Per-action authored label + urgency + expectation + blocking flag, keyed by id. */
export const RELEASE_DECISION_ACTION_PLAN_ACTION_DETAIL: Record<
  ReleaseDecisionActionPlanActionId,
  {
    readonly label: string;
    readonly urgency: ReleaseDecisionActionPlanUrgency;
    readonly expectation: ReleaseDecisionActionPlanExpectation;
  }
> = {
  "reject-and-recover-trend": {
    label:
      "Reject the untrusted trend input and recover a valid `pdfxyz.release-decision-trend/1` from your CI archive, then re-run this plan. A trend that cannot be read, or whose verdict does not re-derive from its own summary, was lost or hand-edited and cannot be planned over.",
    urgency: "critical",
    expectation: "must-complete-before-release",
  },
  "restore-flagged-window": {
    label:
      "Recover the untrustworthy decision-index window the trend flagged (an unreadable / tampered window in its history) from your CI archive, re-index + re-trend, then re-plan. A trend built over a window it could not summarize blocks release.",
    urgency: "critical",
    expectation: "must-complete-before-release",
  },
  "reconcile-blocked-window": {
    label:
      "Reconcile the blocked / invalid decision window the trend flagged: do NOT treat that decision batch as clean. Resolve the rejection cause (or recover the untampered records), re-index + re-trend, then re-plan before relying on the history.",
    urgency: "critical",
    expectation: "must-complete-before-release",
  },
  "hold-promotion": {
    label:
      "Hold any release promotion / sign-off until the blocking cause is resolved. This plan is a follow-up checklist, not an authorization — a `block-release` plan means the recent decision history cannot be treated as clean yet.",
    urgency: "critical",
    expectation: "must-complete-before-release",
  },
  "complete-insufficient-evidence": {
    label:
      "Complete the missing decision evidence the inconclusive trend is short of: file the missing `worker:release-decision` records, re-index the window(s) with `worker:release-decision-index`, re-run `worker:release-decision-trend`, then re-plan. An inconclusive history cannot be treated as usable.",
    urgency: "medium",
    expectation: "must-complete-before-release",
  },
  "investigate-degrading-arc": {
    label:
      "Investigate what changed between the recent decision-index windows that made the arc worsen, and stabilize the regression before relying on the history. Archive this plan as the record of that review.",
    urgency: "high",
    expectation: "recommended",
  },
  "track-watch-followups": {
    label:
      "Track the advisory follow-ups the watch trend surfaced (a proceed-with-followup / hold decision, or an inconclusive window) to closure before relying on the history. Archive this plan as the record of that review.",
    urgency: "medium",
    expectation: "recommended",
  },
  "re-summarize-after-fix": {
    label:
      "After remediating, re-index the affected decisions with `worker:release-decision-index`, re-run `worker:release-decision-trend`, and re-run this plan over the fresh trend — do not rely on this plan once the underlying windows change.",
    urgency: "medium",
    expectation: "recommended",
  },
  "confirm-improvement-sustained": {
    label:
      "Confirm the recovering arc is sustained across the next decision-index windows before relaxing your review cadence. Keep indexing + trending decisions; this improvement authorizes no promotion on its own.",
    urgency: "low",
    expectation: "recommended",
  },
  "continue-decision-cadence": {
    label:
      "The history is clean: keep filing one `worker:release-decision-index` window per review period, summarizing them with `worker:release-decision-trend`, and planning here on your governance cadence. This clean plan authorizes no promotion on its own.",
    urgency: "none",
    expectation: "informational",
  },
  "keep-action-plan": {
    label:
      "Keep this content-free plan as the local release-decision follow-up record. It is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log; keep each of those in its own dedicated system.",
    urgency: "none",
    expectation: "informational",
  },
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this plan is NOT). */
export const RELEASE_DECISION_ACTION_PLAN_DISCLOSURE =
  "This is a content-free operational follow-up plan ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced decision-trend summary and recommends bounded operator follow-up; it authorizes and proves nothing.";

/**
 * The honesty caveats every result carries and every text render prints. The plan TRANSLATES the trend's already
 * content-free verdict into a bounded operator follow-up plan, and must never be read as more than that.
 */
export const RELEASE_DECISION_ACTION_PLAN_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION TREND ACTION PLAN: it INGESTS ONE content-free `pdfxyz.release-decision-trend/1` summary a release pipeline produced, RE-VALIDATES it against ITSELF, and translates its bounded verdict into ONE bounded operator follow-up plan + urgency + next-action checklist. It is a content-free operational follow-up plan ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any trend, window, record, artifact, object, or deployment. A `clear` plan authorizes nothing; it only reports that the content-free trend supplied on THIS host warrants no follow-up beyond continuing the cadence.",
  "A `clear` plan REQUIRES a usable trend whose OWN verdict is a clean `stable` history. It FAILS CLOSED: an unreadable / tampered trend input is `invalid` (`reject-input`); a `blocked` / `invalid` trend is `block-release`; an `insufficient` trend is `investigate`; a `watch` / `degrading` trend is a follow-up `monitor` plan; and `--strict` escalates any non-clear plan to `block-release`. It never fabricates a clean plan from an untrusted or non-clean trend, and `--strict` never fabricates a compliance approval for a clean one.",
  "It re-derives the ingested trend's verdict from the trend's OWN recorded window-verdict summary (reusing the Phase 61 trend rollup reducer) AND re-checks that summary against the trend's own per-window posture sequence + window arithmetic, and treats any disagreement as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the plan proves neither authorship nor approval, and a fully self-consistent fabricated trend is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes the ingested trend's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the plan carries but does NOT itself perform — the honest edges of an offline planner.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_ACTION_PLAN_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: run `worker:release-decision-trend` over your archived decision-index windows, then hand the ONE trend here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a block-release / invalid plan), surface exit 3 (a follow-up monitor plan) and exit 2 (an investigate plan) for review, and treat exit 0 (a clear / benign-monitor plan) as no follow-up warranted — never as an authorization.",
  "Keep the plan bounded and explicit: `--max-actions=N` caps the number of emitted action items (highest-priority first; the count dropped is surfaced, never silent); `--strict` escalates any non-clear plan to block release — a hard `all-clear or block` gate for a high-assurance review. The plan is derived only from the trend's bounded verdict / class / direction, never from any ingested timestamp or window content.",
  "Archive this plan (and the underlying trend + decision-index windows) as CI artifacts: it is a content-free follow-up SUMMARY, not a substitute for the trend it plans over, nor for your legal audit trail, compliance sign-off, external approval / signing, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this plan TRANSLATES a content-free trend into bounded follow-up, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline planner never performs.",
];
