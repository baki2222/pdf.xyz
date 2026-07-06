/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index trend
 * finalize index trend action-plan execution receipt** (Phase 83).
 *
 * Phases 59–82 built the release DECISION closeout + governance + FINALIZATION chain, one rung per phase. The most recent
 * rungs are the finalize-index trend finalize-index TREND
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1`, Phase 81) and the
 * finalize-index-trend finalize-index-trend ACTION PLAN
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1`, Phase 82) —
 * which translated a bounded finalization-index trend verdict into an operator follow-up plan (a plan verdict + urgency +
 * action class + an ordered next-action checklist): clear, monitor, investigate, block-release, or invalid.
 *
 * This phase records whether that FINALIZE-INDEX-TREND FINALIZE-INDEX-TREND plan was ACTED ON. It INGESTS ONE
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` document plus a
 * small set of bounded operator acknowledgement facts, RE-VALIDATES the plan against ITSELF (reconstructing its Phase 82
 * bounded decision from the source-trend details it recorded and re-running the Phase 82 `computeActionPlan` reducer, so a
 * hand-flipped plan verdict / action class / exit code is caught as a tamper), and folds them into ONE stable,
 * content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/1`
 * document that answers a single question a governance review needs —
 *
 *    "Given this content-free finalization-index trend action plan, did the operator provide the bounded acknowledgements
 *     required to close it out or hold it, and what is the resulting receipt posture?"
 *
 * — as a bounded receipt verdict (`completed` / `incomplete` / `followup-open` / `blocked` / `invalid`), the resolved plan
 * class (`clear` / `monitor` / `investigate` / `block`), a bounded acknowledgement checklist (which acks were required,
 * which were supplied, which are still missing, which contradict the plan class), a bounded rationale + next actions, and
 * a content-free receipt — and it FAILS CLOSED when the plan cannot be trusted or a required acknowledgement is absent.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the plan it receipts:
 *  - Every load-bearing token here is a bounded enum — a receipt verdict, a plan class, an acknowledgement id, a reason
 *    id, plus the surfaced upstream plan verdict / urgency / action class / source-trend verdict / latest finalize-index
 *    posture — never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw
 *    label, raw note, reviewer identity, commit URL, digest, or timestamp from the ingested plan. The only non-enum
 *    values are small integer counts, booleans, an ISO stamp, and app-authored prose. It accepts NO free-form note or
 *    actor name.
 *  - It never copies a free-text field out of the ingested plan (even one Phase 82 produced is UNTRUSTED input here);
 *    it reduces the plan to bounded enums, small integers, and booleans, it never echoes the plan's OWN stamp (the
 *    receipt carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a `completed` receipt. `completed` REQUIRES a usable plan AND the bounded acknowledgements its
 *    class demands; a missing / unreadable / tampered / wrong-schema plan is `invalid` (nothing trustworthy to receipt);
 *    a `block` plan not acknowledged as held-blocked is `blocked`; a supplied acknowledgement that contradicts the plan
 *    class is `blocked`; a missing required acknowledgement is `incomplete`; an advisory follow-up still open for a
 *    `monitor` / `investigate` plan is `followup-open`; and `--strict-open` escalates any open follow-up to `blocked`. It
 *    acknowledges NOTHING on behalf of a person — it records that an operator supplied bounded flags, and even a
 *    `completed` block plan records the release as HELD, never promoted.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT an approval / sign-off, and NOT a deployment / promotion ledger. It PROVES
 * nothing the plan does not already prove; it RECORDS that the plan's bounded follow-ups were (or were not) acknowledged.
 * Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CAVEATS}) say
 * so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/types";

/** The schema tag every finalize-index-trend-finalize-index-trend action-receipt result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/1" as const;

/** The upstream document schema the action-receipt ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA };

/** Stable identity of the release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt — for docs / receipts. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt";
/** Bump when the receipt surface, the verdict ladder, the ack / reason sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION = 1;

/** The upstream plan enums the receipt surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanUrgency,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanActionClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict,
};

/**
 * The bounded coverage state of the one ingested plan document (MY trust in the PLAN, distinct from the plan's OWN
 * verdict about its source trend):
 *  - `unreadable` — supplied but not read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1`
 *                   (never echoed). A missing / unusable plan: there is nothing trustworthy to receipt (⇒ `invalid`,
 *                   never `completed`);
 *  - `tampered`   — recognized as a plan but its recorded decision does NOT re-derive from the source-trend details it
 *                   recorded (a hand-flipped verdict / action class / exit code) — an untrustworthy plan (⇒ `invalid`);
 *  - `usable`     — recognized AND self-consistent (its recorded plan decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SOURCE_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SOURCE_STATES)[number];

/**
 * The coarse **plan class** a usable plan resolves to — the category that decides which bounded acknowledgements the
 * receipt requires. It folds the Phase 82 plan verdict:
 *  - `clear`       ← plan verdict `clear` (a coherent stable / improving finalize-index history): the receipt needs only
 *                    that the plan was reviewed;
 *  - `monitor`     ← plan verdict `monitor` (a `watch` / `degrading` history): the receipt needs the plan reviewed + the
 *                    follow-up checklist + the monitor follow-up acknowledged;
 *  - `investigate` ← plan verdict `investigate` (an `insufficient`, inconclusive history): the receipt needs the plan
 *                    reviewed + the follow-up checklist + the investigation acknowledged;
 *  - `block`       ← plan verdict `block-release` (a blocked / untrustworthy-history trend, or a `--strict-watch` /
 *                    `--require-clean` escalation) OR `invalid` (the plan's source-trend INPUT was itself untrustworthy,
 *                    so the plan rejected it): the receipt needs the plan reviewed + the follow-up checklist + an explicit
 *                    acknowledgement that the release remains BLOCKED (not promoted). Even fully acknowledged, a `block`
 *                    plan records the hold — never a promotion.
 *
 * The receipt's own `invalid` verdict is reserved for an untrustworthy plan DOCUMENT (unreadable / tampered / wrong
 * schema), NOT for a trustworthy plan whose CONTENT verdict is `invalid` — that is a `block`-class hold.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES = [
  "clear",
  "monitor",
  "investigate",
  "block",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES)[number];

/**
 * Fold a Phase 82 plan verdict into the coarse receipt plan class. A trustworthy plan whose own verdict is `invalid`
 * (its source-trend input was untrustworthy) maps to the `block` class — the release stays held; a receipt `invalid`
 * verdict is reserved for an untrustworthy plan DOCUMENT, decided by the source state, not this fold.
 */
export function planClassForVerdict(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass {
  switch (verdict) {
    case "clear":
      return "clear";
    case "monitor":
      return "monitor";
    case "investigate":
      return "investigate";
    case "block-release":
    case "invalid":
      return "block";
  }
}

/**
 * The single receipt verdict a governance reviewer keys on — the answer to "was the finalize-index-trend
 * finalize-index-trend plan closed out?":
 *  - `completed`     — the plan is usable and the bounded acknowledgements its class requires were all supplied (and none
 *                      contradict the class). It authorizes NOTHING; it records that the operator acknowledged the plan's
 *                      follow-ups on THIS host (for a `block` plan, that the release is held-blocked, not promoted);
 *  - `incomplete`    — the plan is usable but a required bounded acknowledgement is absent (the plan was not reviewed, or
 *                      a `block` plan is held-blocked but a non-critical acknowledgement is missing). A coverage gap:
 *                      supply the missing acknowledgement and re-run;
 *  - `followup-open` — the plan was reviewed but an advisory follow-up for a `monitor` / `investigate` plan remains open
 *                      (its follow-up ack is absent). Not a hard block — track it to closure;
 *  - `blocked`       — a `block` plan was not acknowledged as held-blocked, OR the supplied acknowledgements contradict
 *                      the plan class (a contradictory execution fact), OR `--strict-open` escalated an open follow-up.
 *                      Do NOT treat the release as closed / promoted;
 *  - `invalid`       — the plan is missing / unreadable / tampered / wrong-schema (nothing trustworthy to receipt) —
 *                      `invalid` even if every flag is supplied. Recover a valid plan before relying on this receipt.
 *
 * These are the exact bounded values the run-level
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_action_receipt_total` metric
 * carries as its `verdict` label; all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS = [
  "completed",
  "incomplete",
  "followup-open",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-evidence suite:
 *  - `0` COMPLETED     — a `completed` receipt (the plan's required acknowledgements are all present);
 *  - `1` USAGE         — the CLI was misused (a bad flag, no plan supplied, or an unwritable output). CLI-owned; a
 *                        receipt RUN never resolves to it;
 *  - `2` INCOMPLETE    — an `incomplete` receipt (a missing required acknowledgement);
 *  - `3` FOLLOWUP_OPEN — a `followup-open` receipt (an advisory follow-up still open for a monitor / investigate plan);
 *  - `4` BLOCKED       — a `blocked` receipt (an unacknowledged block plan, a contradictory acknowledgement, or a
 *                        `--strict-open` escalation) OR an `invalid` receipt (a missing / unreadable / tampered /
 *                        wrong-schema plan). Both share the top code but are distinct verdicts.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT = {
  COMPLETED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  FOLLOWUP_OPEN: 3,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT];

/**
 * The bounded **acknowledgement ids** — the closed set of operator execution facts the receipt records, each toggled by
 * one CLI flag. They are booleans ONLY; the CLI accepts no free-form note or actor name:
 *  - `plan`          (`--ack-plan`, alias `--ack-reviewed`) — the operator confirms the plan was reviewed. Required for
 *                                                             every usable class;
 *  - `followups`     (`--ack-followups`)     — the required follow-up checklist was acknowledged. Required for the
 *                                              `monitor` / `investigate` / `block` classes;
 *  - `monitor`       (`--ack-monitor`)       — the monitor follow-up was acknowledged. Required for the `monitor` class;
 *  - `investigation` (`--ack-investigation`) — the investigation was acknowledged. Required for the `investigate` class;
 *  - `block`         (`--ack-block`)         — the operator confirms the release remains BLOCKED (not promoted).
 *                                              Required for the `block` class; supplying it for any other class is a
 *                                              contradiction.
 *
 * A `clear` plan has NO extra class acknowledgement beyond `--ack-plan`; there is no `--ack-clear` flag.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS = [
  "plan",
  "followups",
  "monitor",
  "investigation",
  "block",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS)[number];

/** The three CLASS-specific acks (each belongs to exactly one non-`clear` class; a mismatch is a contradiction). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS = [
  "monitor",
  "investigation",
  "block",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptClassAck =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS)[number];

/** The class-specific ack each plan class expects (or `null` for `clear`, which has no class ack beyond `--ack-plan`). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptClassAck | null
> = {
  clear: null,
  monitor: "monitor",
  investigate: "investigation",
  block: "block",
};

/** The bounded set of acks each plan class REQUIRES for a `completed` receipt (in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS} order). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[]
> = {
  clear: ["plan"],
  monitor: ["plan", "followups", "monitor"],
  investigate: ["plan", "followups", "investigation"],
  block: ["plan", "followups", "block"],
};

/**
 * The severity each fired reason maps onto, with precedence `invalid > blocking > open > incomplete > informational`
 * (checked in that order — higher is worse, and the run's exit code follows the worst fired severity):
 *  - `informational` — a benign completion marker (the required acknowledgements are present);
 *  - `incomplete`    — a coverage gap (a missing required acknowledgement) ⇒ exit 2;
 *  - `open`          — an advisory follow-up remains open for a monitor / investigate plan ⇒ exit 3;
 *  - `blocking`      — an unacknowledged block plan, a contradictory acknowledgement, or a `--strict-open` escalation
 *                      ⇒ exit 4;
 *  - `invalid`       — the plan is missing / unreadable / tampered / wrong-schema ⇒ exit 4.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the receipt resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail
 * are authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL}:
 *
 * Invalid (nothing trustworthy to receipt):
 *  - `plan-unreadable`                  — the supplied plan could not be read / recognized (a missing / unusable plan);
 *  - `plan-tampered`                    — the plan is recognized but its recorded decision does NOT re-derive.
 *
 * Blocking (do NOT treat the release as closed / promoted):
 *  - `block-not-acknowledged`           — a `block` plan was not acknowledged as held-blocked (`--ack-block` absent);
 *  - `acknowledgement-mismatch`         — a class ack was supplied that contradicts the plan's class;
 *  - `strict-open-escalation`           — `--strict-open` escalated an otherwise-advisory open follow-up.
 *
 * Open (an advisory follow-up remains open — monitor / investigate):
 *  - `monitor-followup-open`            — a `monitor` plan was reviewed but its monitor / follow-up ack is absent;
 *  - `investigation-open`               — an `investigate` plan was reviewed but its investigation / follow-up ack is
 *                                         absent.
 *
 * Incomplete (a coverage gap for a usable plan):
 *  - `plan-not-exercised`               — the plan was not acknowledged as reviewed (`--ack-plan` absent);
 *  - `block-acknowledgement-incomplete` — a `block` plan is held-blocked but a non-critical acknowledgement is absent.
 *
 * Informational (a benign completion marker):
 *  - `plan-acknowledged`                — a `clear` plan was reviewed;
 *  - `monitor-followups-acknowledged`   — a `monitor` plan's follow-ups were acknowledged;
 *  - `investigation-acknowledged`       — an `investigate` plan's investigation was acknowledged;
 *  - `block-acknowledged`               — a `block` plan was acknowledged as held-blocked with its follow-ups.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS = [
  // Invalid
  "plan-unreadable",
  "plan-tampered",
  // Blocking
  "block-not-acknowledged",
  "acknowledgement-mismatch",
  "strict-open-escalation",
  // Open
  "monitor-followup-open",
  "investigation-open",
  // Incomplete
  "plan-not-exercised",
  "block-acknowledgement-incomplete",
  // Informational
  "plan-acknowledged",
  "monitor-followups-acknowledged",
  "investigation-acknowledged",
  "block-acknowledged",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Ingested facts + result shapes
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` (its decision re-derived). */
export interface FinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanFacts {
  /** The plan's final verdict (trusted — the plan re-derived its own decision). */
  readonly planVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict;
  /** The coarse plan class the required acknowledgements key on. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass;
  /** The plan's urgency (surfaced context). */
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanUrgency;
  /** The plan's coarse action class (surfaced context). */
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanActionClass;
  /** The plan's source-trend verdict (trusted, or `null` when the plan's own source trend was not usable). */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture (trusted, or `null` when not usable / no usable window). */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict | null;
  /** How many of the plan's actions were must-complete-before-release (a bounded count). */
  readonly blockingActions: number;
  /** How many of the plan's actions were recommended follow-ups (a bounded count). */
  readonly advisoryActions: number;
  /** True iff the plan was produced under `--strict-watch` (context; never re-judged by the receipt). */
  readonly planStrictWatch: boolean;
  /** True iff the plan was produced under `--require-clean` (context; never re-judged by the receipt). */
  readonly planRequireClean: boolean;
}

/** The bounded source summary the result records — what the receipt receipted, content-free. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSource {
  /** MY coverage state of the ingested plan document. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSourceState;
  /**
   * The plan's own verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * plan it is the untrusted CLAIMED verdict (surfaced so the receipt shows what was asserted).
   */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict | null;
  /** The resolved plan class (a bounded enum), or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The plan's urgency (a bounded enum), or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanUrgency | null;
  /** The plan's coarse action class (a bounded enum), or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanActionClass | null;
  /** The plan's source-trend verdict (a bounded enum), or `null` when not usable / not a usable trend. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture (a bounded enum), or `null` when not usable / no window. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict | null;
  /** How many of the plan's actions were must-complete-before-release (`0` when not usable). */
  readonly blockingActions: number;
  /** How many of the plan's actions were recommended follow-ups (`0` when not usable). */
  readonly advisoryActions: number;
  /** True iff the plan was produced under `--strict-watch` (context; `false` when not usable). */
  readonly planStrictWatch: boolean;
  /** True iff the plan was produced under `--require-clean` (context; `false` when not usable). */
  readonly planRequireClean: boolean;
}

/** The bounded operator acknowledgement facts, from the validated args. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAck {
  readonly plan: boolean;
  readonly followups: boolean;
  readonly monitor: boolean;
  readonly investigation: boolean;
  readonly block: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy {
  /** True iff `--strict-open` was set (an open advisory follow-up escalates to `blocked`). */
  readonly strictOpen: boolean;
  /** The bounded operator acknowledgement facts. */
  readonly ack: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAck;
}

/** One entry in the bounded acknowledgement checklist — an id + supplied / required / satisfied booleans. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAcknowledgement {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId;
  /** True iff the operator supplied this acknowledgement flag. */
  readonly supplied: boolean;
  /** True iff this acknowledgement is REQUIRED for the resolved plan class. */
  readonly required: boolean;
  /** True iff `!required || supplied` — the required acknowledgement is present (or it was not required). */
  readonly satisfied: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite receipt decision — the single verdict + exit code + acknowledgement coverage a reviewer acts on. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptExitCode;
  /** The resolved plan class, or `null` when the plan is not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass | null;
  /** True iff `verdict === "completed"`. */
  readonly completed: boolean;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId[];
  /** How many fired reasons were invalid (an untrustworthy plan document). */
  readonly invalid: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were open follow-ups. */
  readonly open: number;
  /** How many fired reasons were incomplete coverage gaps. */
  readonly incomplete: number;
  /** How many fired reasons were informational completion markers. */
  readonly informational: number;
  /** The acks required for the resolved plan class (empty when not usable). */
  readonly requiredAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[];
  /** The acks the operator supplied. */
  readonly suppliedAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[];
  /** The required acks that are still missing (`required && !supplied`). */
  readonly missingAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[];
  /** The class-specific acks supplied that do NOT match the plan's class (contradictions). */
  readonly mismatchedAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[];
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an open follow-up to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "followup-open" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream plan schema). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION;
  readonly planSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "was this plan closed out,
 * of what class, and how" for a SIEM / review record. Bounded enums + small integers + a stable policy id + the run's
 * own stamp + a disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptExitCode;
  /** The resolved plan class, or `null` when the plan is not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass | null;
  /** MY coverage state of the ingested plan document. */
  readonly sourceState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSourceState;
  /** The plan's own verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict | null;
  /** How many acknowledgements the resolved plan class required. */
  readonly acksRequired: number;
  /** How many of the required acknowledgements were supplied. */
  readonly acksSatisfied: number;
  /** How many required acknowledgements are still missing. */
  readonly acksMissing: number;
  /** How many supplied class acks contradict the plan's class. */
  readonly acksMismatched: number;
  /** True iff `--strict-open` escalated an open follow-up to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** The bounded, app-authored disclosure statement (what this receipt is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout governance finalize index trend finalize index trend action-plan
 * execution receipt a governance reviewer / CI reads. Every field is a bounded enum, a small integer, a boolean, an ISO
 * stamp, or app-authored prose — so it carries no reviewer identity, locator, size, path, or byte, even from a hostile
 * input, and never echoes the ingested plan's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy;
  /** The single receipt verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict;
  /** The process exit code (mirrors `actionReceipt.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptExitCode;
  /** The resolved plan class (bounded enum), or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The bounded source summary the receipt receipted. */
  readonly source: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSource;
  /** The composite receipt rollup (verdict + exit + reasons + ack coverage + strict flags). The TOP-LEVEL rollup. */
  readonly actionReceipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptRollup;
  /** The bounded acknowledgement checklist (which acks were required / supplied / satisfied). */
  readonly acknowledgements: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAcknowledgement[];
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReason[];
  /** The bounded next-action ids only (a compact allowlist view; never derived from an input). */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptNextActionId[];
  /** Bounded, app-authored guidance (out-of-scope steps this receipt does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from the ingested plan. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReceipt;
}

/** The process exit code for a receipt result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult,
): number {
  return result.actionReceipt.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Bounded next-action ids (a compact allowlist view of the guidance)
 * ------------------------------------------------------------------ */

/**
 * The bounded **next-action ids** — the closed set of operator steps the receipt recommends given its verdict, in this
 * canonical order (emitted deduped). Each is a stable id from an authored allowlist — never free-form raw source text:
 *  - `recover-valid-plan`       — the plan is missing / unreadable / tampered / wrong-schema; recover a valid Phase 82
 *                                 plan;
 *  - `hold-promotion`           — a `block` plan means the release stays held; do NOT promote / sign off;
 *  - `supply-missing-ack`       — a required acknowledgement is absent; supply it and re-run;
 *  - `resolve-contradiction`    — a supplied acknowledgement contradicts the plan class; supply the matching one;
 *  - `keep-action-receipt`      — keep this content-free receipt as the local close-out record (always). It is NOT a
 *                                 legal / compliance sign-off, an external approval / signature, an identity proof, a
 *                                 deployment authorization, a promotion ledger, an incident record, or an audit log.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS = [
  "recover-valid-plan",
  "hold-promotion",
  "supply-missing-ack",
  "resolve-contradiction",
  "keep-action-receipt",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptNextActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from the ingested plan)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict,
  string
> = {
  completed:
    "COMPLETED: the finalize-index-trend follow-up plan is usable and the bounded acknowledgements its class requires were all supplied — the plan is closed out for the governance record on THIS host. For a clear / monitor / investigate plan the follow-up is acknowledged; for a block-release plan the release is recorded as held-blocked (NOT promoted). This receipt authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  incomplete:
    "INCOMPLETE: the plan is usable but a required bounded acknowledgement is absent — the plan was not reviewed, or a block-release plan is held-blocked but a non-critical acknowledgement is missing. Supply the missing acknowledgement and re-run before treating the plan as closed. This is a coverage gap, not a block.",
  "followup-open":
    "FOLLOWUP-OPEN: the plan was reviewed but an advisory follow-up (a monitor / investigate plan) remains open — its follow-up acknowledgement is absent. Track the follow-up to closure and re-run; this is not a hard block, but it is not a completed close-out either.",
  blocked:
    "BLOCKED: a block-release plan was not acknowledged as held-blocked, OR a supplied acknowledgement contradicts the plan class, OR `--strict-open` escalated an open follow-up. Do NOT treat the release as closed or promoted; supply the correct acknowledgement before relying on this receipt.",
  invalid:
    "INVALID: the plan is missing / unreadable / tampered / wrong-schema (nothing trustworthy to receipt) — `invalid` even if every flag is supplied. Recover a valid `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` before relying on this receipt.",
};

/**
 * The dedicated headline for a `blocked` receipt produced ONLY because `--strict-open` escalated an open follow-up — the
 * plan itself was neither an unacknowledged block nor contradictory, so the generic headline would misrepresent the
 * cause.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY =
  "BLOCKED (--strict-open): the only concern is an OPEN advisory follow-up (a monitor / investigate plan whose follow-up acknowledgement is absent), and `--strict-open` escalates any open follow-up to a hard block — a `closed-out or blocked` gate for a high-assurance review. Without the flag this would be FOLLOWUP-OPEN. The plan itself is neither an unacknowledged block nor contradictory.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId,
  {
    readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSeverity;
    readonly detail: string;
  }
> = {
  "plan-unreadable": {
    severity: "invalid",
    detail:
      "The supplied plan could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` (wrong schema or unparseable — never echoed). There is no trustworthy plan to receipt; recover a valid plan produced by `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan` and re-run. This fails closed: a missing / unusable plan is INVALID, never a vacuous completed close-out.",
  },
  "plan-tampered": {
    severity: "invalid",
    detail:
      "The supplied plan is a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` whose recorded decision (verdict / urgency / action class / exit code / reasons) does NOT re-derive from the source-trend details it recorded — a hand-edited or corrupt plan. Recover the untampered plan from your CI archive; an untrustworthy plan cannot be closed out.",
  },
  "block-not-acknowledged": {
    severity: "blocking",
    detail:
      "The plan is a BLOCK class (a `block-release` plan — a blocked / untrustworthy-history trend, a `--strict-watch` / `--require-clean` escalation, or a plan whose own source-trend input was invalid), and the operator did NOT confirm the release remains BLOCKED (`--ack-block` absent). Do NOT treat the release as closed or promoted: confirm the release is held (not promoted), acknowledge it, and re-run; a block plan not acknowledged as blocked fails closed.",
  },
  "acknowledgement-mismatch": {
    severity: "blocking",
    detail:
      "A class-specific acknowledgement was supplied that contradicts the plan's class (e.g. `--ack-block` on a non-block plan, or a monitor / investigation acknowledgement on the wrong class). A receipt records the acknowledgement for the plan's ACTUAL class only; a contradictory execution fact fails closed. Supply the acknowledgement that matches the plan class.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and an advisory follow-up remained open, so the policy escalates it to a hard block — a `closed-out or blocked` gate for a high-assurance review. Close the open follow-up and acknowledge it (or drop `--strict-open` if an open advisory follow-up is acceptable for this review) before treating the plan as closed.",
  },
  "monitor-followup-open": {
    severity: "open",
    detail:
      "The plan is a MONITOR class (a `watch` / `degrading` finalize-index history) and was reviewed, but its monitor / follow-up acknowledgement is absent (`--ack-monitor` and/or `--ack-followups`). The advisory follow-up remains open — track it to closure and acknowledge it; this is not a hard block, but the plan is not closed out.",
  },
  "investigation-open": {
    severity: "open",
    detail:
      "The plan is an INVESTIGATE class (an `insufficient`, inconclusive history) and was reviewed, but its investigation / follow-up acknowledgement is absent (`--ack-investigation` and/or `--ack-followups`). The advisory follow-up remains open — complete the missing finalize-index evidence and acknowledge it; this is not a hard block, but the plan is not closed out.",
  },
  "plan-not-exercised": {
    severity: "incomplete",
    detail:
      "The plan was not acknowledged as reviewed (`--ack-plan` / `--ack-reviewed` absent). A receipt requires that the operator confirm the plan was reviewed before any follow-up can be closed out. Review the plan, acknowledge it, and re-run.",
  },
  "block-acknowledgement-incomplete": {
    severity: "incomplete",
    detail:
      "The block-release plan was acknowledged as held-blocked (`--ack-block` present, so the release is not treated as promoted), but a non-critical acknowledgement is absent (`--ack-plan` and/or `--ack-followups`). The safety property holds and the release remains BLOCKED, but the receipt is not complete: acknowledge the review + the remediation follow-ups and re-run.",
  },
  "plan-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a CLEAR class (a coherent stable / improving finalize-index history, no follow-up warranted) and was acknowledged as reviewed (`--ack-plan`). The plan is closed out on THIS host; this records a bounded review acknowledgement, not an approval or a promotion.",
  },
  "monitor-followups-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a MONITOR class and its follow-ups were acknowledged (`--ack-plan` + `--ack-monitor` + `--ack-followups`). The monitor follow-up is closed out on THIS host; keep tracking the arc on your governance cadence.",
  },
  "investigation-acknowledged": {
    severity: "informational",
    detail:
      "The plan is an INVESTIGATE class and its investigation was acknowledged (`--ack-plan` + `--ack-investigation` + `--ack-followups`). The investigation is closed out on THIS host; re-index + re-trend the completed finalize evidence and re-plan before relying on the history.",
  },
  "block-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a BLOCK class and was acknowledged as held-blocked with its remediation follow-ups (`--ack-plan` + `--ack-block` + `--ack-followups`). The block is recorded as acknowledged on THIS host; the release remains HELD — this receipt is NOT an approval to promote.",
  },
};

/** Per-next-action authored label, keyed by id. Bounded, content-free; never derived from an input. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptNextActionId,
  string
> = {
  "recover-valid-plan":
    "Recover a valid `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` from your CI archive (or re-run `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan` over a valid trend) and re-run this receipt. A plan that cannot be read, is the wrong schema, or whose decision does not re-derive cannot be closed out.",
  "hold-promotion":
    "Hold any release promotion / sign-off: a `block-release` plan means the recent finalization history cannot be treated as consistently finalized yet. This receipt records that the block was acknowledged (or not); it is not an authorization to promote.",
  "supply-missing-ack":
    "Supply the missing required acknowledgement an operator ACTUALLY performed (`--ack-plan` / `--ack-reviewed`, `--ack-followups`, `--ack-monitor`, `--ack-investigation`, `--ack-block`) and re-run — never fabricate one. A receipt requires the acknowledgements the plan's class demands before it is closed out.",
  "resolve-contradiction":
    "Drop the contradictory acknowledgement and supply the one that matches the plan's ACTUAL class (`--ack-block` only for a block plan; `--ack-monitor` / `--ack-investigation` only for their class). A receipt records the acknowledgement for the plan's real class only.",
  "keep-action-receipt":
    "Keep this content-free receipt as the local close-out record. It is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log; keep each of those in its own dedicated system.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this receipt is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_DISCLOSURE =
  "This is a content-free operational acknowledgement receipt ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced finalize-index-trend follow-up plan plus bounded operator acknowledgement flags and records whether the plan's required acknowledgements were supplied; it authorizes and proves nothing, it attests no person's identity, and even a completed block plan records the release as HELD, never promoted.";

/**
 * The honesty caveats every result carries and every text render prints. The receipt RECORDS whether an operator
 * supplied the bounded acknowledgements the plan's class requires, and must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE INDEX TREND FINALIZE INDEX TREND ACTION-PLAN EXECUTION RECEIPT: it INGESTS ONE content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` document a release pipeline produced, RE-VALIDATES it against ITSELF, and records whether the operator's bounded acknowledgements closed out or held the plan's required follow-ups. It is a content-free operational acknowledgement receipt ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / finalize / plan / governance / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any plan, trend, window, record, artifact, object, or deployment. A `completed` receipt authorizes nothing; it only records that the content-free plan supplied on THIS host had its required acknowledgements provided by the bounded flags given.",
  "A `completed` receipt REQUIRES a usable plan AND the bounded acknowledgements its class demands. It FAILS CLOSED: a missing / unreadable / tampered / wrong-schema plan is `invalid`; a `block-release` plan not acknowledged as held-blocked is `blocked` (and even when fully acknowledged it records the release as HELD, never promoted); a supplied acknowledgement that contradicts the plan class is `blocked`; a missing required acknowledgement is `incomplete`; an advisory follow-up still open for a monitor / investigate plan is `followup-open`; and `--strict-open` escalates an open follow-up to `blocked`. It never fabricates a completed close-out from an untrusted or under-acknowledged plan.",
  "It re-validates the ingested plan by RECONSTRUCTING its bounded Phase 82 decision from the source-trend details the plan recorded (reusing the Phase 82 `computeActionPlan` reducer) and requiring the recorded plan verdict / urgency / action class / exit code / reasons to re-derive, treating any disagreement as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the receipt proves neither authorship nor approval, and a fully self-consistent fabricated plan is out of its scope.",
  "It records only bounded acknowledgement FLAGS — booleans, never a free-form note or an actor name / identity, and it never claims a follow-up was acknowledged unless its flag was supplied, nor claims any release approval / promotion. It emits only bounded enums, small counts, booleans, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes the ingested plan's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the receipt carries but does NOT itself perform — the honest edges of an offline receipt.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: after `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan` produces the ONE finalize-index-trend follow-up plan, hand it here with the bounded acknowledgement flags an operator supplies, and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / invalid receipt), surface exit 3 (an open follow-up) and exit 2 (an incomplete receipt) for review, and treat exit 0 (a completed receipt) as closed-out — never as an authorization.",
  "Supply the acknowledgement flags an operator ACTUALLY performed — never fabricate them: `--ack-plan` (alias `--ack-reviewed`, the plan was reviewed), `--ack-followups` (the follow-up checklist was worked), `--ack-monitor` / `--ack-investigation` (the class follow-up was tracked), and `--ack-block` (the release remains BLOCKED, not promoted). A clear plan needs only `--ack-plan`. Acknowledge the plan's ACTUAL class only; a contradictory acknowledgement fails closed. `--strict-open` escalates any open follow-up to a hard block for a high-assurance review.",
  "Archive this receipt (and the underlying plan + trend + finalize-index windows) as CI artifacts: it is a content-free acknowledgement SUMMARY, not a substitute for the plan it receipts, nor for your legal audit trail, compliance sign-off, external approval / signing, identity attestation, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this receipt RECORDS that a content-free plan's follow-ups were acknowledged, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline receipt never performs.",
];
