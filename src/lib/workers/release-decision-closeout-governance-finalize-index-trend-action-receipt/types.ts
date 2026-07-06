/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index trend
 * action plan execution receipt** (Phase 78).
 *
 * Phases 59–77 built the release DECISION closeout + governance + FINALIZATION chain, one rung per phase. The most recent
 * rungs are the finalize INDEX TREND (`pdfxyz.release-decision-closeout-governance-finalize-index-trend/1`, Phase 76) and
 * the finalize-index trend ACTION PLAN
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1`, Phase 77) — which translated a
 * bounded finalization-index trend verdict into an operator follow-up plan (a plan verdict + urgency + action class + an
 * ordered next-action checklist): clear, monitor, investigate, block-release, or invalid.
 *
 * This phase records whether that FINALIZE-INDEX-TREND plan was ACTED ON. It INGESTS ONE
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` document plus a small set of bounded
 * operator acknowledgement facts, RE-VALIDATES the plan against ITSELF (reconstructing its Phase 77 bounded decision from
 * the source-trend details it recorded and re-running the Phase 77 `computeActionPlan` reducer, so a hand-flipped plan
 * verdict / action class / exit code is caught as a tamper), and folds them into ONE stable, content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` document that answers a single
 * question a governance review needs —
 *
 *    "Given this content-free finalization-index trend action plan, did the operator provide the bounded acknowledgements
 *     required to close it out, and what is the resulting receipt posture?"
 *
 * — as a bounded receipt verdict (`completed` / `incomplete` / `blocked` / `invalid`), the resolved plan class (`clear` /
 * `monitor` / `investigate` / `block`), a bounded acknowledgement checklist (which acks were required, which were
 * supplied, which are still missing, which contradict the plan class), a bounded rationale, and a content-free receipt —
 * and it FAILS CLOSED when the plan cannot be trusted or a required acknowledgement is absent.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the plan it receipts:
 *  - Every load-bearing token here is a bounded enum — a receipt verdict, a plan class, an acknowledgement id, a reason
 *    id, plus the surfaced upstream plan verdict / urgency / action class / source-trend verdict / latest finalize-index
 *    posture — never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw
 *    label, raw note, reviewer identity, commit URL, digest, or timestamp from the ingested plan. The only non-enum
 *    values are small integer counts, booleans, an ISO stamp, and app-authored prose. It accepts NO free-form note or
 *    actor name.
 *  - It never copies a free-text field out of the ingested plan (even one Phase 77 produced is UNTRUSTED input here);
 *    it reduces the plan to bounded enums, small integers, and booleans, it never echoes the plan's OWN stamp (the
 *    receipt carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a `completed` receipt. `completed` REQUIRES a usable plan of a closeable class AND the bounded
 *    acknowledgements that class demands; a missing / unreadable / tampered plan — or a usable plan whose OWN verdict is
 *    `invalid` — is `invalid` (there is nothing trustworthy to close out); a `block-release` plan is always `blocked`
 *    (the release remains held, whether or not it was acknowledged); a contradictory acknowledgement is `blocked`; a
 *    missing required acknowledgement for a clear / monitor / investigate plan is `incomplete`; and `--strict-open`
 *    escalates any missing-acknowledgement `incomplete` to `blocked`. It acknowledges NOTHING on behalf of a person — it
 *    records that an operator supplied bounded flags, and it never claims an action was EXECUTED unless `--ack-executed`
 *    is supplied, nor claims any release approval / promotion.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT an approval / sign-off, and NOT a deployment / promotion ledger. It PROVES
 * nothing the plan does not already prove; it RECORDS that the plan's bounded follow-ups were (or were not) acknowledged.
 * Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CAVEATS}) say
 * so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-action-plan/types";

/** The schema tag every finalize-index-trend action-receipt result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1" as const;

/** The upstream document schema the action-receipt ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA };

/** Stable identity of the release-decision-closeout-governance-finalize-index-trend-action-receipt — for docs / receipts. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-action-receipt";
/** Bump when the receipt surface, the verdict ladder, the ack / reason sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION = 1;

/** The upstream plan enums the receipt surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
};

/**
 * The bounded coverage state of the one ingested plan document (MY trust in the PLAN, distinct from the plan's OWN
 * verdict about its source trend):
 *  - `unreadable` — supplied but not read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` (never echoed). A
 *                   missing / unusable plan: there is nothing trustworthy to receipt (⇒ `invalid`, never `completed`);
 *  - `tampered`   — recognized as a plan but its recorded decision does NOT re-derive from the source-trend details it
 *                   recorded (a hand-flipped verdict / action class / exit code) — an untrustworthy plan (⇒ `invalid`);
 *  - `usable`     — recognized AND self-consistent (its recorded plan decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SOURCE_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SOURCE_STATES)[number];

/**
 * The coarse **plan class** a usable, closeable plan resolves to — the category that decides which bounded
 * acknowledgements the receipt requires. It folds the Phase 77 plan verdict:
 *  - `clear`       ← plan verdict `clear` (a coherent stable / improving finalize-index history): the receipt needs only
 *                    that the plan was reviewed;
 *  - `monitor`     ← plan verdict `monitor` (a `watch` / `degrading` history): the receipt needs the plan reviewed + the
 *                    follow-up executed + the monitor follow-up acknowledged;
 *  - `investigate` ← plan verdict `investigate` (an `insufficient`, inconclusive history): the receipt needs the plan
 *                    reviewed + the follow-up executed + the investigation acknowledged;
 *  - `block`       ← plan verdict `block-release` (a blocked / untrustworthy-history trend, or a `--strict-watch` /
 *                    `--require-clean` escalation): the receipt needs the plan reviewed + the follow-up executed + an
 *                    explicit acknowledgement that the release remains BLOCKED (not promoted). A `block` plan is ALWAYS
 *                    `blocked` (the release is held) — acknowledging it records the hold; it never closes out.
 *
 * A plan whose OWN verdict is `invalid` (its source-trend INPUT was untrustworthy) has NO plan class — the receipt is
 * `invalid` regardless of the flags supplied.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES = [
  "clear",
  "monitor",
  "investigate",
  "block",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES)[number];

/**
 * Fold a Phase 77 plan verdict into the coarse receipt plan class, or `null` for the plan's own `invalid` verdict (an
 * untrustworthy source-trend input the plan rejected — no follow-up class, always an `invalid` receipt).
 */
export function planClassForVerdict(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null {
  switch (verdict) {
    case "clear":
      return "clear";
    case "monitor":
      return "monitor";
    case "investigate":
      return "investigate";
    case "block-release":
      return "block";
    case "invalid":
      return null;
  }
}

/**
 * The single receipt verdict a governance reviewer keys on — the answer to "was the finalize-index-trend plan closed
 * out?":
 *  - `completed`  — the plan is usable, of a closeable class (`clear` / `monitor` / `investigate`), and the bounded
 *                   acknowledgements its class requires were all supplied (and none contradict the class). It authorizes
 *                   NOTHING; it records that the operator acknowledged the plan's follow-ups on THIS host;
 *  - `incomplete` — the plan is usable and closeable but a required bounded acknowledgement is absent (the plan was not
 *                   reviewed, or a monitor / investigation follow-up was not executed / acknowledged). A coverage gap:
 *                   supply the missing acknowledgement and re-run;
 *  - `blocked`    — a `block-release` plan (the release remains held, whether or not it was acknowledged), OR a supplied
 *                   acknowledgement contradicts the plan class (a contradictory execution fact), OR `--strict-open`
 *                   escalated an otherwise-incomplete receipt. Do NOT treat the release as closed / promoted;
 *  - `invalid`    — the plan is missing / unreadable / tampered (nothing trustworthy to receipt), OR the plan's OWN
 *                   verdict is `invalid` (its source-trend input was untrustworthy) — `invalid` even if every flag is
 *                   supplied. Recover a valid plan before relying on this receipt.
 *
 * These are the exact bounded values the run-level
 * `worker_release_decision_closeout_governance_finalize_index_trend_action_receipt_total` metric carries as its `verdict`
 * label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS = [
  "completed",
  "incomplete",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-evidence suite:
 *  - `0` COMPLETED  — a `completed` receipt (the plan's required acknowledgements are all present);
 *  - `1` USAGE      — the CLI was misused (a bad flag, no plan supplied, or an unwritable output). CLI-owned; a receipt
 *                     RUN never resolves to it;
 *  - `2` INCOMPLETE — an `incomplete` receipt (a missing required acknowledgement for a clear / monitor / investigate
 *                     plan);
 *  - `4` BLOCKED    — a `blocked` receipt (a `block-release` plan, a contradictory acknowledgement, or a `--strict-open`
 *                     escalation) OR an `invalid` receipt (a missing / unreadable / tampered plan, or a plan whose own
 *                     verdict is `invalid`). Both share the top code but are distinct verdicts.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT = {
  COMPLETED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT];

/**
 * The bounded **acknowledgement ids** — the closed set of operator execution facts the receipt records, each toggled by
 * one CLI flag. They are booleans ONLY; the CLI accepts no free-form note or actor name:
 *  - `plan`          (`--ack-plan`, alias `--ack-reviewed`) — the operator confirms the plan was reviewed. Required for
 *                                                             every usable, closeable class;
 *  - `executed`      (`--ack-executed`)      — the required next-action checklist was executed / worked. Required for
 *                                              `monitor` / `investigate` / `block`. The receipt NEVER claims an action
 *                                              was executed unless this is supplied;
 *  - `monitor`       (`--ack-monitor`)       — the monitor follow-up was acknowledged. Required for the `monitor` class;
 *  - `investigation` (`--ack-investigation`) — the investigation was acknowledged. Required for the `investigate` class;
 *  - `block`         (`--ack-block`)         — the operator confirms the release remains BLOCKED (not promoted).
 *                                              Required for the `block` class; supplying it for any other class is a
 *                                              contradiction;
 *  - `clear`         (`--ack-clear`)         — the operator confirms the clear plan needs no follow-up. Optional for the
 *                                              `clear` class; supplying it for a `block` (or any non-clear) class is a
 *                                              contradiction.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS = [
  "plan",
  "executed",
  "monitor",
  "investigation",
  "block",
  "clear",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS)[number];

/** The four CLASS-specific acks (each belongs to exactly one plan class; a mismatch is a contradiction). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS = [
  "clear",
  "monitor",
  "investigation",
  "block",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptClassAck =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS)[number];

/** The class-specific ack each plan class OWNS (the `clear` class's ack is optional; the rest are required). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptClassAck
> = {
  clear: "clear",
  monitor: "monitor",
  investigate: "investigation",
  block: "block",
};

/** The bounded set of acks each plan class REQUIRES for a `completed` receipt (in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS} order). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[]
> = {
  clear: ["plan"],
  monitor: ["plan", "executed", "monitor"],
  investigate: ["plan", "executed", "investigation"],
  block: ["plan", "executed", "block"],
};

/**
 * The severity each fired reason maps onto, with precedence `invalid > blocking > incomplete > informational` (checked in
 * that order — higher is worse, and the run's exit code follows the worst fired severity):
 *  - `informational` — a benign completion marker (the required acknowledgements are present);
 *  - `incomplete`    — a coverage gap (a missing required acknowledgement for a clear / monitor / investigate plan)
 *                      ⇒ exit 2;
 *  - `blocking`      — a `block-release` plan (release held), a contradictory acknowledgement, or a `--strict-open`
 *                      escalation ⇒ exit 4;
 *  - `invalid`       — the plan is missing / unreadable / tampered, or its own verdict is `invalid` ⇒ exit 4.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SEVERITIES = [
  "informational",
  "incomplete",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the receipt resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail
 * are authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL}:
 *
 * Invalid (nothing trustworthy / closeable to receipt):
 *  - `plan-unreadable`                  — the supplied plan could not be read / recognized (a missing / unusable plan);
 *  - `plan-tampered`                    — the plan is recognized but its recorded decision does NOT re-derive;
 *  - `plan-invalid`                     — a usable plan whose OWN verdict is `invalid` (its source-trend input was
 *                                         untrustworthy) — `invalid` regardless of the flags supplied.
 *
 * Blocking (do NOT treat the release as closed / promoted):
 *  - `block-not-acknowledged`           — a `block` plan was not acknowledged as held-blocked (`--ack-block` absent);
 *  - `block-acknowledgement-incomplete` — a `block` plan is held-blocked but a non-critical acknowledgement is absent;
 *  - `block-acknowledged`               — a `block` plan was acknowledged as held-blocked with its follow-up executed —
 *                                         the release remains BLOCKED (this receipt is NOT an approval to promote);
 *  - `acknowledgement-mismatch`         — a class ack was supplied that contradicts the plan's class;
 *  - `strict-open-escalation`           — `--strict-open` escalated an otherwise-incomplete (missing-ack) receipt.
 *
 * Incomplete (a coverage gap for a usable, closeable plan):
 *  - `plan-not-exercised`               — the plan was not acknowledged as reviewed (`--ack-plan` absent);
 *  - `monitor-incomplete`               — a `monitor` plan was reviewed but its monitor / executed ack is absent;
 *  - `investigation-incomplete`         — an `investigate` plan was reviewed but its investigation / executed ack is
 *                                         absent.
 *
 * Informational (a benign completion marker):
 *  - `plan-acknowledged`                — a `clear` plan was reviewed;
 *  - `monitor-acknowledged`             — a `monitor` plan's follow-up was acknowledged + executed;
 *  - `investigation-acknowledged`       — an `investigate` plan's investigation was acknowledged + executed.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS = [
  // Invalid
  "plan-unreadable",
  "plan-tampered",
  "plan-invalid",
  // Blocking
  "block-not-acknowledged",
  "block-acknowledgement-incomplete",
  "block-acknowledged",
  "acknowledgement-mismatch",
  "strict-open-escalation",
  // Incomplete
  "plan-not-exercised",
  "monitor-incomplete",
  "investigation-incomplete",
  // Informational
  "plan-acknowledged",
  "monitor-acknowledged",
  "investigation-acknowledged",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Ingested facts + result shapes
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` (its decision re-derived). */
export interface FinalizeIndexTrendActionReceiptPlanFacts {
  /** The plan's final verdict (trusted — the plan re-derived its own decision). */
  readonly planVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict;
  /** The coarse plan class the required acknowledgements key on, or `null` when the plan's own verdict is `invalid`. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The plan's urgency (surfaced context). */
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency;
  /** The plan's coarse action class (surfaced context). */
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass;
  /** The plan's source-trend verdict (trusted, or `null` when the plan's own source trend was not usable). */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture (trusted, or `null` when not usable / no usable window). */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
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
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSource {
  /** MY coverage state of the ingested plan document. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState;
  /**
   * The plan's own verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * plan it is the untrusted CLAIMED verdict (surfaced so the receipt shows what was asserted).
   */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict | null;
  /** The resolved plan class (a bounded enum), or `null` when not usable / the plan's own verdict is `invalid`. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The plan's urgency (a bounded enum), or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency | null;
  /** The plan's coarse action class (a bounded enum), or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass | null;
  /** The plan's source-trend verdict (a bounded enum), or `null` when not usable / not a usable trend. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture (a bounded enum), or `null` when not usable / no window. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
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
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAck {
  readonly plan: boolean;
  readonly executed: boolean;
  readonly monitor: boolean;
  readonly investigation: boolean;
  readonly block: boolean;
  readonly clear: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy {
  /** True iff `--strict-open` was set (any missing required acknowledgement escalates to `blocked`). */
  readonly strictOpen: boolean;
  /** The bounded operator acknowledgement facts. */
  readonly ack: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAck;
}

/** One entry in the bounded acknowledgement checklist — an id + supplied / required / satisfied booleans. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAcknowledgement {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId;
  /** True iff the operator supplied this acknowledgement flag. */
  readonly supplied: boolean;
  /** True iff this acknowledgement is REQUIRED for the resolved plan class. */
  readonly required: boolean;
  /** True iff `!required || supplied` — the required acknowledgement is present (or it was not required). */
  readonly satisfied: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite receipt decision — the single verdict + exit code + acknowledgement coverage a reviewer acts on. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode;
  /** The resolved plan class, or `null` when the plan is not usable / the plan's own verdict is `invalid`. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** True iff `verdict === "completed"`. */
  readonly completed: boolean;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalid: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were incomplete coverage gaps. */
  readonly incomplete: number;
  /** How many fired reasons were informational completion markers. */
  readonly informational: number;
  /** The acks required for the resolved plan class (empty when not usable / closeable). */
  readonly requiredAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[];
  /** The acks the operator supplied. */
  readonly suppliedAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[];
  /** The required acks that are still missing (`required && !supplied`). */
  readonly missingAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[];
  /** The class-specific acks supplied that do NOT match the plan's class (contradictions). */
  readonly mismatchedAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[];
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an incomplete (missing-ack) receipt to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "incomplete" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream plan schema). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION;
  readonly planSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "was this plan closed out,
 * of what class, and how" for a SIEM / review record. Bounded enums + small integers + a stable policy id + the run's
 * own stamp + a disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend-action-receipt";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode;
  /** The resolved plan class, or `null` when the plan is not usable / the plan's own verdict is `invalid`. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** MY coverage state of the ingested plan document. */
  readonly sourceState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState;
  /** The plan's own verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict | null;
  /** How many acknowledgements the resolved plan class required. */
  readonly acksRequired: number;
  /** How many of the required acknowledgements were supplied. */
  readonly acksSatisfied: number;
  /** How many required acknowledgements are still missing. */
  readonly acksMissing: number;
  /** How many supplied class acks contradict the plan's class. */
  readonly acksMismatched: number;
  /** True iff `--strict-open` escalated an incomplete receipt to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** The bounded, app-authored disclosure statement (what this receipt is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout governance finalize index trend action plan execution receipt a
 * governance reviewer / CI reads. Every field is a bounded enum, a small integer, a boolean, an ISO stamp, or
 * app-authored prose — so it carries no reviewer identity, locator, size, path, or byte, even from a hostile input, and
 * never echoes the ingested plan's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy;
  /** The single receipt verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict;
  /** The process exit code (mirrors `actionReceipt.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode;
  /** The resolved plan class (bounded enum), or `null` when not usable / the plan's own verdict is `invalid`. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The bounded source summary the receipt receipted. */
  readonly source: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSource;
  /** The composite receipt rollup (verdict + exit + reasons + ack coverage + strict flags). The TOP-LEVEL rollup. */
  readonly actionReceipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptRollup;
  /** The bounded acknowledgement checklist (which acks were required / supplied / satisfied). */
  readonly acknowledgements: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAcknowledgement[];
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReason[];
  /** The bounded next-action ids only (a compact allowlist view; never derived from an input). */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptNextActionId[];
  /** Bounded, app-authored guidance (out-of-scope steps this receipt does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from the ingested plan. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReceipt;
}

/** The process exit code for a receipt result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult,
): number {
  return result.actionReceipt.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Bounded next-action ids (a compact allowlist view of the guidance)
 * ------------------------------------------------------------------ */

/**
 * The bounded **next-action ids** — the closed set of operator steps the receipt recommends given its verdict, in this
 * canonical order (emitted deduped). Each is a stable id from an authored allowlist — never free-form raw source text:
 *  - `recover-valid-plan`       — the plan is missing / unreadable / tampered / invalid; recover a valid Phase 77 plan;
 *  - `hold-promotion`           — a `block-release` plan means the release stays held; do NOT promote / sign off;
 *  - `supply-missing-ack`       — a required acknowledgement is absent; supply it and re-run;
 *  - `resolve-contradiction`    — a supplied acknowledgement contradicts the plan class; supply the matching one;
 *  - `keep-action-receipt`      — keep this content-free receipt as the local close-out record (always). It is NOT a
 *                                 legal / compliance sign-off, an external approval / signature, an identity proof, a
 *                                 deployment authorization, a promotion ledger, an incident record, or an audit log.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS = [
  "recover-valid-plan",
  "hold-promotion",
  "supply-missing-ack",
  "resolve-contradiction",
  "keep-action-receipt",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptNextActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from the ingested plan)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
  string
> = {
  completed:
    "COMPLETED: the finalize-index-trend follow-up plan is usable, of a closeable class (clear / monitor / investigate), and the bounded acknowledgements its class requires were all supplied — the plan is closed out for the governance record on THIS host. This receipt authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  incomplete:
    "INCOMPLETE: the plan is usable and closeable but a required bounded acknowledgement is absent — the plan was not reviewed, or a monitor / investigation follow-up was not executed / acknowledged. Supply the missing acknowledgement and re-run before treating the plan as closed. This is a coverage gap, not a block.",
  blocked:
    "BLOCKED: the plan is a BLOCK-RELEASE plan (the release remains held — acknowledging it records the hold, not a close-out), OR a supplied acknowledgement contradicts the plan class, OR `--strict-open` escalated an otherwise-incomplete receipt. Do NOT treat the release as closed or promoted.",
  invalid:
    "INVALID: the plan is missing / unreadable / tampered (nothing trustworthy to receipt), OR the plan's OWN verdict is `invalid` (its source-trend input was untrustworthy) — `invalid` even if every flag is supplied. Recover a valid `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` before relying on this receipt.",
};

/**
 * The dedicated headline for a `blocked` receipt produced ONLY because `--strict-open` escalated an otherwise-incomplete
 * receipt — the plan itself was neither a block-release plan nor contradictory, so the generic headline would
 * misrepresent the cause.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY =
  "BLOCKED (--strict-open): the only concern is a MISSING required acknowledgement (a usable clear / monitor / investigate plan whose acks are not all present), and `--strict-open` escalates any such gap to a hard block — a `closed-out or blocked` gate for a high-assurance review. Without the flag this would be INCOMPLETE. The plan itself is neither a block-release plan nor contradictory.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId,
  {
    readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSeverity;
    readonly detail: string;
  }
> = {
  "plan-unreadable": {
    severity: "invalid",
    detail:
      "The supplied plan could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` (wrong schema or unparseable — never echoed). There is no trustworthy plan to receipt; recover a valid plan produced by `worker:release-decision-closeout-governance-finalize-index-trend-action-plan` and re-run. This fails closed: a missing / unusable plan is INVALID, never a vacuous completed close-out.",
  },
  "plan-tampered": {
    severity: "invalid",
    detail:
      "The supplied plan is a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` whose recorded decision (verdict / urgency / action class / exit code / reasons) does NOT re-derive from the source-trend details it recorded — a hand-edited or corrupt plan. Recover the untampered plan from your CI archive; an untrustworthy plan cannot be closed out.",
  },
  "plan-invalid": {
    severity: "invalid",
    detail:
      "The plan is a usable `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` but its OWN verdict is `invalid` — the finalize-index trend it planned over was itself unreadable / tampered, so the plan rejected the input. There is no closeable follow-up here; recover a valid trend, re-plan, then re-run this receipt. This is INVALID regardless of the acknowledgement flags supplied.",
  },
  "block-not-acknowledged": {
    severity: "blocking",
    detail:
      "The plan is a BLOCK class (a `block-release` plan — a blocked / untrustworthy-history trend, or a `--strict-watch` / `--require-clean` escalation), and the operator did NOT confirm the release remains BLOCKED (`--ack-block` absent). Do NOT treat the release as closed or promoted: confirm the release is held (not promoted), acknowledge it, and re-run. A block plan is always `blocked`; this variant lacks the acknowledgement entirely.",
  },
  "block-acknowledgement-incomplete": {
    severity: "blocking",
    detail:
      "The block-release plan was acknowledged as held-blocked (`--ack-block` present, so the release is not treated as promoted), but a non-critical acknowledgement is absent (`--ack-plan` and/or `--ack-executed`). The safety property holds and the release remains BLOCKED, but the acknowledgement record is not complete: acknowledge the review + the remediation follow-up and re-run.",
  },
  "block-acknowledged": {
    severity: "blocking",
    detail:
      "The plan is a BLOCK class and was acknowledged as held-blocked with its remediation follow-up executed (`--ack-plan` + `--ack-block` + `--ack-executed`). The block is recorded as acknowledged on THIS host; the release remains HELD — this receipt is `blocked`, NOT a completed close-out and NOT an approval to promote.",
  },
  "acknowledgement-mismatch": {
    severity: "blocking",
    detail:
      "A class-specific acknowledgement was supplied that contradicts the plan's class (e.g. `--ack-block` on a non-block plan, `--ack-clear` on a block plan, or a monitor / investigation acknowledgement on the wrong class). A receipt records the acknowledgement for the plan's ACTUAL class only; a contradictory execution fact fails closed. Supply the acknowledgement that matches the plan class.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and a required acknowledgement was missing (an otherwise-`incomplete` receipt for a usable clear / monitor / investigate plan), so the policy escalates it to a hard block — a `closed-out or blocked` gate for a high-assurance review. Supply the missing acknowledgement (or drop `--strict-open` if an open follow-up is acceptable for this review) before treating the plan as closed.",
  },
  "plan-not-exercised": {
    severity: "incomplete",
    detail:
      "The plan was not acknowledged as reviewed (`--ack-plan` / `--ack-reviewed` absent). A receipt requires that the operator confirm the plan was reviewed before any follow-up can be closed out. Review the plan, acknowledge it, and re-run.",
  },
  "monitor-incomplete": {
    severity: "incomplete",
    detail:
      "The plan is a MONITOR class (a `watch` / `degrading` finalize-index history) and was reviewed, but its monitor / executed acknowledgement is absent (`--ack-monitor` and/or `--ack-executed`). The follow-up is not closed out — track it to closure, acknowledge that the follow-up was executed, and re-run. This is a coverage gap, not a block.",
  },
  "investigation-incomplete": {
    severity: "incomplete",
    detail:
      "The plan is an INVESTIGATE class (an `insufficient`, inconclusive history) and was reviewed, but its investigation / executed acknowledgement is absent (`--ack-investigation` and/or `--ack-executed`). The coverage gap was not closed: complete the missing finalize-index evidence, acknowledge the investigation, and re-run before treating the history as usable.",
  },
  "plan-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a CLEAR class (a coherent stable / improving finalize-index history, no follow-up warranted) and was acknowledged as reviewed (`--ack-plan`). The plan is closed out on THIS host; this records a bounded review acknowledgement, not an approval or a promotion.",
  },
  "monitor-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a MONITOR class and its follow-up was acknowledged + executed (`--ack-plan` + `--ack-monitor` + `--ack-executed`). The monitor follow-up is closed out on THIS host; keep tracking the arc on your governance cadence.",
  },
  "investigation-acknowledged": {
    severity: "informational",
    detail:
      "The plan is an INVESTIGATE class and its investigation was acknowledged + executed (`--ack-plan` + `--ack-investigation` + `--ack-executed`). The investigation is closed out on THIS host; re-index + re-trend the completed finalize evidence and re-plan before relying on the history.",
  },
};

/** Per-next-action authored label, keyed by id. Bounded, content-free; never derived from an input. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptNextActionId,
  string
> = {
  "recover-valid-plan":
    "Recover a valid `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` from your CI archive (or re-run `worker:release-decision-closeout-governance-finalize-index-trend-action-plan` over a valid trend) and re-run this receipt. A plan that cannot be read, whose decision does not re-derive, or whose own verdict is `invalid` cannot be closed out.",
  "hold-promotion":
    "Hold any release promotion / sign-off: a `block-release` plan means the recent finalization history cannot be treated as consistently finalized yet. This receipt records that the block was acknowledged (or not); it is not an authorization to promote.",
  "supply-missing-ack":
    "Supply the missing required acknowledgement an operator ACTUALLY performed (`--ack-plan` / `--ack-reviewed`, `--ack-executed`, `--ack-monitor`, `--ack-investigation`) and re-run — never fabricate one. A receipt requires the acknowledgements the plan's class demands before it is closed out.",
  "resolve-contradiction":
    "Drop the contradictory acknowledgement and supply the one that matches the plan's ACTUAL class (`--ack-block` only for a block plan; `--ack-clear` only for a clear plan; `--ack-monitor` / `--ack-investigation` only for their class). A receipt records the acknowledgement for the plan's real class only.",
  "keep-action-receipt":
    "Keep this content-free receipt as the local close-out record. It is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log; keep each of those in its own dedicated system.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this receipt is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_DISCLOSURE =
  "This is a content-free operational acknowledgement receipt ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced finalize-index-trend follow-up plan plus bounded operator acknowledgement flags and records whether the plan's required acknowledgements were supplied; it authorizes and proves nothing, it attests no person's identity, and it never claims an action was executed unless `--ack-executed` was supplied.";

/**
 * The honesty caveats every result carries and every text render prints. The receipt RECORDS whether an operator
 * supplied the bounded acknowledgements the plan's class requires, and must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE INDEX TREND ACTION-PLAN EXECUTION RECEIPT: it INGESTS ONE content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` document a release pipeline produced, RE-VALIDATES it against ITSELF, and records whether the operator's bounded acknowledgements closed out the plan's required follow-ups. It is a content-free operational acknowledgement receipt ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / finalize / plan / governance / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any plan, trend, window, record, artifact, object, or deployment. A `completed` receipt authorizes nothing; it only records that the content-free plan supplied on THIS host had its required acknowledgements provided by the bounded flags given.",
  "A `completed` receipt REQUIRES a usable plan of a closeable class (`clear` / `monitor` / `investigate`) AND the bounded acknowledgements its class demands. It FAILS CLOSED: a missing / unreadable / tampered plan is `invalid`; a plan whose OWN verdict is `invalid` is `invalid` even if every flag is supplied; a `block-release` plan is always `blocked` (the release remains held — acknowledging it records the hold, never a close-out); a supplied acknowledgement that contradicts the plan class is `blocked`; a missing required acknowledgement for a clear / monitor / investigate plan is `incomplete`; and `--strict-open` escalates any missing-acknowledgement gap to `blocked`. It never fabricates a completed close-out from an untrusted, invalid, or under-acknowledged plan.",
  "It re-validates the ingested plan by RECONSTRUCTING its bounded Phase 77 decision from the source-trend details the plan recorded (reusing the Phase 77 `computeActionPlan` reducer) and requiring the recorded plan verdict / urgency / action class / exit code / reasons to re-derive, treating any disagreement as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the receipt proves neither authorship nor approval, and a fully self-consistent fabricated plan is out of its scope.",
  "It records only bounded acknowledgement FLAGS — booleans, never a free-form note or an actor name / identity, and it never claims an action was EXECUTED unless `--ack-executed` was supplied, nor claims any release approval / promotion. It emits only bounded enums, small counts, booleans, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes the ingested plan's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the receipt carries but does NOT itself perform — the honest edges of an offline receipt.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: after `worker:release-decision-closeout-governance-finalize-index-trend-action-plan` produces the ONE finalize-index-trend follow-up plan, hand it here with the bounded acknowledgement flags an operator supplies, and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / invalid receipt), surface exit 2 (an incomplete receipt) for review, and treat exit 0 (a completed receipt) as closed-out — never as an authorization.",
  "Supply the acknowledgement flags an operator ACTUALLY performed — never fabricate them: `--ack-plan` (alias `--ack-reviewed`, the plan was reviewed), `--ack-executed` (the follow-up checklist was worked), `--ack-monitor` / `--ack-investigation` (the class follow-up was tracked), `--ack-block` (the release remains BLOCKED, not promoted), and the optional `--ack-clear` (a clear plan needs no follow-up). Acknowledge the plan's ACTUAL class only; a contradictory acknowledgement fails closed. `--strict-open` escalates any missing required acknowledgement to a hard block for a high-assurance review.",
  "Archive this receipt (and the underlying plan + trend + finalize-index windows) as CI artifacts: it is a content-free acknowledgement SUMMARY, not a substitute for the plan it receipts, nor for your legal audit trail, compliance sign-off, external approval / signing, identity attestation, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this receipt RECORDS that a content-free plan's follow-ups were acknowledged, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline receipt never performs.",
];
