/**
 * The bounded, content-free vocabulary for the secure-worker **release decision action-plan execution receipt**
 * (Phase 63).
 *
 * Phases 46–62 built the release-evidence chain, one rung per phase, ending with the release DECISION chain: the
 * decision RECORD ledger (Phase 59), the decision LEDGER INDEX (Phase 60), the decision INDEX TREND (Phase 61), and the
 * decision TREND ACTION PLAN (`pdfxyz.release-decision-action-plan/1`, Phase 62) — which translated a bounded trend
 * verdict into an operator follow-up plan (a plan verdict + urgency + action class + an ordered next-action checklist).
 *
 * This phase records whether that plan was ACTED ON. It INGESTS ONE `pdfxyz.release-decision-action-plan/1` document
 * plus a small set of bounded operator acknowledgement facts, RE-VALIDATES the plan against ITSELF (reconstructing its
 * Phase 62 bounded decision from the source-trend details it recorded and re-running the Phase 62 `computeActionPlan`
 * reducer, so a hand-flipped plan verdict / action class / exit code is caught as a tamper), and folds them into ONE
 * stable, content-free `pdfxyz.release-decision-action-receipt/1` document that answers a single question a governance
 * review needs —
 *
 *    "Given this content-free follow-up plan and the operator's bounded acknowledgements, were the plan's required
 *     follow-ups acknowledged / executed sufficiently to close it out for the release governance record?"
 *
 * — as a bounded receipt verdict (`completed` / `incomplete` / `followup-open` / `blocked`), the resolved plan class
 * (`clear` / `monitor` / `investigate` / `block`), a bounded acknowledgement checklist (which acks were required, which
 * were supplied, which are still missing, which contradict the plan class), a bounded rationale, and a content-free
 * receipt — and it FAILS CLOSED when the plan cannot be trusted or a required acknowledgement is absent.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the plan it receipts:
 *  - Every load-bearing token here is a bounded enum — a receipt verdict, a plan class, an acknowledgement id, a reason
 *    id, plus the surfaced upstream plan verdict / urgency / action class / source-trend verdict — never a filename,
 *    path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw ref, raw label, raw note, reviewer
 *    identity, commit URL, digest, or timestamp from the ingested plan. The only non-enum values are small integer
 *    counts, booleans, an ISO stamp, and app-authored prose. It accepts NO free-form note or actor name.
 *  - It never copies a free-text field out of the ingested plan (even one Phase 62 produced is UNTRUSTED input here);
 *    it reduces the plan to bounded enums, small integers, and booleans, it never echoes the plan's OWN stamp (the
 *    receipt carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a `completed` receipt. `completed` REQUIRES a usable plan AND the bounded acknowledgements its
 *    class demands; a tampered plan is `blocked`; a `block` plan not acknowledged as held-blocked is `blocked`; a
 *    missing / unreadable plan or a missing required acknowledgement is `incomplete`; an advisory follow-up still open
 *    for a `monitor` / `investigate` plan is `followup-open`; and `--strict-open` escalates an open follow-up to
 *    `blocked`. It acknowledges NOTHING on behalf of a person — it records that an operator supplied bounded flags.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT an approval / sign-off, and NOT a deployment / promotion ledger. It PROVES
 * nothing the plan does not already prove; it RECORDS that the plan's bounded follow-ups were (or were not)
 * acknowledged. Its authored caveats (see {@link RELEASE_DECISION_ACTION_RECEIPT_CAVEATS}) say so out loud.
 */

import {
  RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_TREND_VERDICTS,
  type ReleaseDecisionActionPlanActionClass,
  type ReleaseDecisionActionPlanUrgency,
  type ReleaseDecisionActionPlanVerdict,
  type ReleaseDecisionTrendVerdict,
} from "../release-decision-action-plan/types";

/** The schema tag every action-receipt result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_ACTION_RECEIPT_SCHEMA = "pdfxyz.release-decision-action-receipt/1" as const;

/** The upstream document schema the action receipt ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_ACTION_PLAN_SCHEMA };

/** Stable identity of the release-decision-action-receipt — for docs / receipts / audit. */
export const RELEASE_DECISION_ACTION_RECEIPT_POLICY_ID = "pdfxyz-worker-release-decision-action-receipt";
/** Bump when the receipt surface, the verdict ladder, the ack / reason sets, or the schema changes. */
export const RELEASE_DECISION_ACTION_RECEIPT_POLICY_VERSION = 1;

/** The upstream plan enums the receipt surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_TREND_VERDICTS,
};
export type {
  ReleaseDecisionActionPlanVerdict,
  ReleaseDecisionActionPlanUrgency,
  ReleaseDecisionActionPlanActionClass,
  ReleaseDecisionTrendVerdict,
};

/**
 * The bounded coverage state of the one ingested plan document (MY trust in the PLAN, distinct from the plan's OWN
 * verdict about its source trend):
 *  - `unreadable` — supplied but not read / parsed / recognized as a `pdfxyz.release-decision-action-plan/1` (never
 *                   echoed). A missing / unusable plan: there is nothing to receipt (⇒ `incomplete`, never `completed`);
 *  - `tampered`   — recognized as a plan but its recorded decision does NOT re-derive from the source-trend details it
 *                   recorded (a hand-flipped verdict / action class / exit code) — an untrustworthy plan (⇒ `blocked`);
 *  - `usable`     — recognized AND self-consistent (its recorded plan decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_SOURCE_STATES = ["unreadable", "tampered", "usable"] as const;
export type ReleaseDecisionActionReceiptSourceState =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_SOURCE_STATES)[number];

/**
 * The coarse **plan class** a usable plan resolves to — the category that decides which bounded acknowledgements the
 * receipt requires. It folds the Phase 62 plan verdict:
 *  - `clear`       ← plan verdict `clear` (a clean stable trend): the receipt needs only that the plan was reviewed;
 *  - `monitor`     ← plan verdict `monitor` (a benign improving, or a follow-up watch / degrading trend): the receipt
 *                    needs the plan reviewed + the monitor follow-up acknowledged;
 *  - `investigate` ← plan verdict `investigate` (an inconclusive insufficient trend): the receipt needs the plan
 *                    reviewed + the investigation acknowledged;
 *  - `block`       ← plan verdict `block-release` OR `invalid` (a blocked / untrustworthy source, or an untrustworthy
 *                    trend input): the receipt needs the plan reviewed + an explicit acknowledgement that the release
 *                    remains BLOCKED (not promoted). A `block` plan not acknowledged as blocked is `blocked`.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES = [
  "clear",
  "monitor",
  "investigate",
  "block",
] as const;
export type ReleaseDecisionActionReceiptPlanClass =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES)[number];

/** Fold a Phase 62 plan verdict into the coarse receipt plan class. */
export function planClassForVerdict(
  verdict: ReleaseDecisionActionPlanVerdict,
): ReleaseDecisionActionReceiptPlanClass {
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
 * The single receipt verdict a governance reviewer keys on — the answer to "was the plan closed out?":
 *  - `completed`     — the plan is usable and the bounded acknowledgements its class requires were all supplied (and
 *                      none contradict the class). It authorizes NOTHING; it records that the operator acknowledged the
 *                      plan's follow-ups on THIS host;
 *  - `incomplete`    — the plan is missing / unreadable (nothing to receipt), OR a required bounded acknowledgement is
 *                      absent (the plan was not exercised, or a block plan's non-critical ack is missing). A coverage
 *                      gap: supply the missing evidence / acknowledgement and re-run;
 *  - `followup-open` — the plan was reviewed but an advisory follow-up for a `monitor` / `investigate` plan remains
 *                      open (its follow-up ack is absent). Not a hard block — track it to closure;
 *  - `blocked`       — the plan is tampered / untrustworthy, OR a `block` plan was not acknowledged as held-blocked, OR
 *                      `--strict-open` escalated an open follow-up, OR the supplied acknowledgements contradict the plan
 *                      class (a contradictory execution fact). Do NOT treat the release as closed.
 *
 * These are the exact bounded values the run-level `worker_release_decision_action_receipt_total` metric carries as its
 * `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_VERDICTS = [
  "completed",
  "incomplete",
  "followup-open",
  "blocked",
] as const;
export type ReleaseDecisionActionReceiptVerdict =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-evidence suite:
 *  - `0` COMPLETED     — a `completed` receipt (the plan's required acknowledgements are all present);
 *  - `1` USAGE         — the CLI was misused (a bad flag, no plan supplied, or an unwritable output). CLI-owned; a
 *                        receipt RUN never resolves to it;
 *  - `2` INCOMPLETE    — an `incomplete` receipt (a missing / unusable plan, or a missing required acknowledgement);
 *  - `3` FOLLOWUP_OPEN — a `followup-open` receipt (an advisory follow-up still open for a monitor / investigate plan);
 *  - `4` BLOCKED       — a `blocked` receipt (a tampered plan, a block plan not acknowledged as blocked, a
 *                        `--strict-open` escalation, or a contradictory acknowledgement).
 */
export const RELEASE_DECISION_ACTION_RECEIPT_EXIT = {
  COMPLETED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  FOLLOWUP_OPEN: 3,
  BLOCKED: 4,
} as const;
export type ReleaseDecisionActionReceiptExitCode =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_EXIT)[keyof typeof RELEASE_DECISION_ACTION_RECEIPT_EXIT];

/**
 * The bounded **acknowledgement ids** — the closed set of operator execution facts the receipt records, each toggled by
 * one CLI flag. They are booleans ONLY; the CLI accepts no free-form note or actor name:
 *  - `plan`          (`--ack-plan`)          — the operator confirms the plan was reviewed. Required for every class;
 *  - `followups`     (`--ack-followups`)     — the required follow-up checklist was acknowledged. Required for every
 *                                              non-`clear` class (`monitor` / `investigate` / `block`);
 *  - `monitor`       (`--ack-monitor`)       — the monitor follow-up was acknowledged. Required for the `monitor` class;
 *  - `investigation` (`--ack-investigation`) — the investigation was acknowledged. Required for the `investigate` class;
 *  - `block`         (`--ack-block`)         — the operator confirms the release remains BLOCKED (not promoted).
 *                                              Required for the `block` class; supplying it for any other class is a
 *                                              contradiction.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS = [
  "plan",
  "followups",
  "monitor",
  "investigation",
  "block",
] as const;
export type ReleaseDecisionActionReceiptAckId =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS)[number];

/** The three CLASS-specific acks (each belongs to exactly one non-`clear` class; a mismatch is a contradiction). */
export const RELEASE_DECISION_ACTION_RECEIPT_CLASS_ACKS = ["monitor", "investigation", "block"] as const;
export type ReleaseDecisionActionReceiptClassAck =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_CLASS_ACKS)[number];

/** The class-specific ack each plan class expects (or `null` for `clear`, which has no class ack). */
export const RELEASE_DECISION_ACTION_RECEIPT_CLASS_ACK: Record<
  ReleaseDecisionActionReceiptPlanClass,
  ReleaseDecisionActionReceiptClassAck | null
> = {
  clear: null,
  monitor: "monitor",
  investigate: "investigation",
  block: "block",
};

/** The bounded set of acks each plan class REQUIRES for a `completed` receipt (in {@link RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS} order). */
export const RELEASE_DECISION_ACTION_RECEIPT_REQUIRED_ACKS: Record<
  ReleaseDecisionActionReceiptPlanClass,
  readonly ReleaseDecisionActionReceiptAckId[]
> = {
  clear: ["plan"],
  monitor: ["plan", "followups", "monitor"],
  investigate: ["plan", "followups", "investigation"],
  block: ["plan", "followups", "block"],
};

/**
 * The severity each fired reason maps onto, with precedence `blocking > open > incomplete > informational` (checked in
 * that order — higher is worse, and the run's exit code follows the worst fired severity):
 *  - `informational` — a benign completion marker (the required acknowledgements are present);
 *  - `incomplete`    — a coverage gap (a missing / unusable plan, or a missing required acknowledgement) ⇒ exit 2;
 *  - `open`          — an advisory follow-up remains open for a monitor / investigate plan ⇒ exit 3;
 *  - `blocking`      — the plan is untrustworthy, a block plan is unacknowledged, a follow-up was strict-escalated, or
 *                      an acknowledgement contradicts the class ⇒ exit 4.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
] as const;
export type ReleaseDecisionActionReceiptSeverity =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the receipt resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail
 * are authored in {@link RELEASE_DECISION_ACTION_RECEIPT_REASON_DETAIL}:
 *
 * Blocking (do NOT treat the release as closed):
 *  - `plan-tampered`                    — the plan is recognized but its recorded decision does NOT re-derive;
 *  - `block-not-acknowledged`           — a `block` plan was not acknowledged as held-blocked (`--ack-block` absent);
 *  - `acknowledgement-mismatch`         — a class ack was supplied that contradicts the plan's class;
 *  - `strict-open-escalation`           — `--strict-open` escalated an otherwise-advisory open follow-up.
 *
 * Open (an advisory follow-up remains open — monitor / investigate):
 *  - `monitor-followup-open`            — a `monitor` plan was reviewed but its monitor / follow-up ack is absent;
 *  - `investigation-open`               — an `investigate` plan was reviewed but its investigation / follow-up ack is absent.
 *
 * Incomplete (a coverage gap):
 *  - `plan-unreadable`                  — the supplied plan could not be read / recognized (nothing to receipt);
 *  - `plan-not-exercised`               — the plan was not acknowledged as reviewed (`--ack-plan` absent);
 *  - `block-acknowledgement-incomplete` — a `block` plan is held-blocked but a non-critical acknowledgement is absent.
 *
 * Informational (a benign completion marker):
 *  - `plan-acknowledged`                — a `clear` plan was reviewed;
 *  - `monitor-followups-acknowledged`   — a `monitor` plan's follow-ups were acknowledged;
 *  - `investigation-acknowledged`       — an `investigate` plan's investigation was acknowledged;
 *  - `block-acknowledged`               — a `block` plan was acknowledged as held-blocked with its follow-ups.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_REASON_IDS = [
  // Blocking
  "plan-tampered",
  "block-not-acknowledged",
  "acknowledgement-mismatch",
  "strict-open-escalation",
  // Open
  "monitor-followup-open",
  "investigation-open",
  // Incomplete
  "plan-unreadable",
  "plan-not-exercised",
  "block-acknowledgement-incomplete",
  // Informational
  "plan-acknowledged",
  "monitor-followups-acknowledged",
  "investigation-acknowledged",
  "block-acknowledged",
] as const;
export type ReleaseDecisionActionReceiptReasonId =
  (typeof RELEASE_DECISION_ACTION_RECEIPT_REASON_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Ingested facts + result shapes
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-action-plan/1` (its decision re-derived in ingest). */
export interface ActionReceiptPlanFacts {
  /** The plan's final verdict (trusted — the plan re-derived its own decision). */
  readonly planVerdict: ReleaseDecisionActionPlanVerdict;
  /** The coarse plan class the required acknowledgements key on. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass;
  /** The plan's urgency (surfaced context). */
  readonly urgency: ReleaseDecisionActionPlanUrgency;
  /** The plan's coarse action class (surfaced context). */
  readonly actionClass: ReleaseDecisionActionPlanActionClass;
  /** True iff the plan is a BENIGN monitor (an improving trend, the plan's own exit 0). */
  readonly benignMonitor: boolean;
  /** The plan's source trend verdict (trusted, or `null` when the plan's own source trend was not usable). */
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
  /** How many of the plan's actions were must-complete-before-release (a bounded count). */
  readonly blockingActions: number;
  /** How many of the plan's actions were recommended follow-ups (a bounded count). */
  readonly advisoryActions: number;
  /** True iff the plan was produced under `--strict` (context; never re-judged by the receipt). */
  readonly planStrict: boolean;
}

/** The bounded source summary the result records — what the receipt receipted, content-free. */
export interface ReleaseDecisionActionReceiptSource {
  /** MY coverage state of the ingested plan document. */
  readonly state: ReleaseDecisionActionReceiptSourceState;
  /**
   * The plan's own verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * plan it is the untrusted CLAIMED verdict (surfaced so the receipt shows what was asserted).
   */
  readonly claimedPlanVerdict: ReleaseDecisionActionPlanVerdict | null;
  /** The resolved plan class (a bounded enum), or `null` when not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** The plan's urgency (a bounded enum), or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionActionPlanUrgency | null;
  /** The plan's coarse action class (a bounded enum), or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionActionPlanActionClass | null;
  /** True iff the usable plan was a benign monitor (context; `false` when not usable). */
  readonly benignMonitor: boolean;
  /** The plan's source trend verdict (a bounded enum), or `null` when not usable / not a usable trend. */
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
  /** How many of the plan's actions were must-complete-before-release (`0` when not usable). */
  readonly blockingActions: number;
  /** How many of the plan's actions were recommended follow-ups (`0` when not usable). */
  readonly advisoryActions: number;
  /** True iff the plan was produced under `--strict` (context; `false` when not usable). */
  readonly planStrict: boolean;
}

/** The bounded operator acknowledgement facts, from the validated args. */
export interface ReleaseDecisionActionReceiptAck {
  readonly plan: boolean;
  readonly followups: boolean;
  readonly monitor: boolean;
  readonly investigation: boolean;
  readonly block: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionActionReceiptPolicy {
  /** True iff `--strict-open` was set (an open advisory follow-up escalates to `blocked`). */
  readonly strictOpen: boolean;
  /** The bounded operator acknowledgement facts. */
  readonly ack: ReleaseDecisionActionReceiptAck;
}

/** One entry in the bounded acknowledgement checklist — an id + supplied / required / satisfied booleans. */
export interface ReleaseDecisionActionReceiptAcknowledgement {
  readonly id: ReleaseDecisionActionReceiptAckId;
  /** True iff the operator supplied this acknowledgement flag. */
  readonly supplied: boolean;
  /** True iff this acknowledgement is REQUIRED for the resolved plan class. */
  readonly required: boolean;
  /** True iff `!required || supplied` — the required acknowledgement is present (or it was not required). */
  readonly satisfied: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionActionReceiptReason {
  readonly id: ReleaseDecisionActionReceiptReasonId;
  readonly severity: ReleaseDecisionActionReceiptSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite receipt decision — the single verdict + exit code + acknowledgement coverage a reviewer acts on. */
export interface ReleaseDecisionActionReceiptRollup {
  readonly verdict: ReleaseDecisionActionReceiptVerdict;
  readonly exitCode: ReleaseDecisionActionReceiptExitCode;
  /** The resolved plan class, or `null` when the plan is not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** True iff `verdict === "completed"`. */
  readonly completed: boolean;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionActionReceiptReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were open follow-ups. */
  readonly open: number;
  /** How many fired reasons were incomplete coverage gaps. */
  readonly incomplete: number;
  /** How many fired reasons were informational completion markers. */
  readonly informational: number;
  /** The acks required for the resolved plan class (empty when not usable). */
  readonly requiredAcks: readonly ReleaseDecisionActionReceiptAckId[];
  /** The acks the operator supplied. */
  readonly suppliedAcks: readonly ReleaseDecisionActionReceiptAckId[];
  /** The required acks that are still missing (`required && !supplied`). */
  readonly missingAcks: readonly ReleaseDecisionActionReceiptAckId[];
  /** The class-specific acks supplied that do NOT match the plan's class (contradictions). */
  readonly mismatchedAcks: readonly ReleaseDecisionActionReceiptAckId[];
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an open follow-up to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "followup-open" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream plan schema). */
export interface ReleaseDecisionActionReceiptMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_ACTION_RECEIPT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_ACTION_RECEIPT_POLICY_VERSION;
  readonly planSchema: typeof RELEASE_DECISION_ACTION_PLAN_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "was this plan closed out,
 * of what class, and how" for a SIEM / review record. Bounded enums + small integers + a stable policy id + the run's
 * own stamp + a disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionActionReceiptReceipt {
  readonly category: "worker-release-decision-action-receipt";
  readonly policyId: typeof RELEASE_DECISION_ACTION_RECEIPT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_ACTION_RECEIPT_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionActionReceiptVerdict;
  readonly exitCode: ReleaseDecisionActionReceiptExitCode;
  /** The resolved plan class, or `null` when the plan is not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** MY coverage state of the ingested plan document. */
  readonly sourceState: ReleaseDecisionActionReceiptSourceState;
  /** The plan's own verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly claimedPlanVerdict: ReleaseDecisionActionPlanVerdict | null;
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
 * The stable, content-free release decision action-plan execution receipt a governance reviewer / CI reads. Every field
 * is a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored prose — so it carries no reviewer
 * identity, locator, size, path, or byte, even from a hostile input, and never echoes the ingested plan's own stamp.
 */
export interface ReleaseDecisionActionReceiptResult {
  readonly schema: typeof RELEASE_DECISION_ACTION_RECEIPT_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionActionReceiptMetadata;
  readonly policy: ReleaseDecisionActionReceiptPolicy;
  /** The single receipt verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionActionReceiptVerdict;
  /** The process exit code (mirrors `actionReceipt.exitCode`). */
  readonly exitCode: ReleaseDecisionActionReceiptExitCode;
  /** The resolved plan class (bounded enum), or `null` when not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** The bounded source summary the receipt receipted. */
  readonly source: ReleaseDecisionActionReceiptSource;
  /** The composite receipt rollup (verdict + exit + reasons + ack coverage + strict flags). The TOP-LEVEL rollup. */
  readonly actionReceipt: ReleaseDecisionActionReceiptRollup;
  /** The bounded acknowledgement checklist (which acks were required / supplied / satisfied). */
  readonly acknowledgements: readonly ReleaseDecisionActionReceiptAcknowledgement[];
  /** Every fired reason, in canonical {@link RELEASE_DECISION_ACTION_RECEIPT_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionActionReceiptReason[];
  /** Bounded, app-authored guidance (out-of-scope steps this receipt does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from the ingested plan. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionActionReceiptReceipt;
}

/** The process exit code for a receipt result. */
export function releaseDecisionActionReceiptExitCode(result: ReleaseDecisionActionReceiptResult): number {
  return result.actionReceipt.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from the ingested plan)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_ACTION_RECEIPT_VERDICT_SUMMARY: Record<
  ReleaseDecisionActionReceiptVerdict,
  string
> = {
  completed:
    "COMPLETED: the follow-up plan is usable and the bounded acknowledgements its class requires were all supplied — the plan is closed out for the governance record on THIS host. This receipt authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  incomplete:
    "INCOMPLETE: the plan is missing / unreadable, or a required bounded acknowledgement is absent (the plan was not exercised, or a non-critical acknowledgement is missing). Supply the missing plan / acknowledgement and re-run before treating the plan as closed. This is a coverage gap, not a block.",
  "followup-open":
    "FOLLOWUP-OPEN: the plan was reviewed but an advisory follow-up (a monitor / investigate plan) remains open — its follow-up acknowledgement is absent. Track the follow-up to closure and re-run; this is not a hard block, but it is not a completed close-out either.",
  blocked:
    "BLOCKED: the plan is untrustworthy (a tampered / self-inconsistent plan), OR a block-release plan was not acknowledged as held-blocked, OR `--strict-open` escalated an open follow-up, OR a supplied acknowledgement contradicts the plan class. Do NOT treat the release as closed; recover a valid plan / supply the correct acknowledgement before relying on this receipt.",
};

/**
 * The dedicated headline for a `blocked` receipt produced ONLY because `--strict-open` escalated an open follow-up —
 * the plan itself was neither tampered nor an unacknowledged block, so the generic headline would misrepresent the
 * cause.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY =
  "BLOCKED (--strict-open): the only concern is an OPEN advisory follow-up (a monitor / investigate plan whose follow-up acknowledgement is absent), and `--strict-open` escalates any open follow-up to a hard block — a `closed-out or blocked` gate for a high-assurance review. Without the flag this would be FOLLOWUP-OPEN. The plan itself is neither tampered nor an unacknowledged block.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_ACTION_RECEIPT_REASON_DETAIL: Record<
  ReleaseDecisionActionReceiptReasonId,
  { readonly severity: ReleaseDecisionActionReceiptSeverity; readonly detail: string }
> = {
  "plan-tampered": {
    severity: "blocking",
    detail:
      "The supplied plan is a recognized `pdfxyz.release-decision-action-plan/1` whose recorded decision (verdict / urgency / action class / exit code / reasons) does NOT re-derive from the source-trend details it recorded — a hand-edited or corrupt plan. Recover the untampered plan from your CI archive; an untrustworthy plan cannot be closed out.",
  },
  "block-not-acknowledged": {
    severity: "blocking",
    detail:
      "The plan is a BLOCK class (a `block-release` / `invalid` plan — a blocked / untrustworthy source trend), and the operator did NOT confirm the release remains BLOCKED (`--ack-block` absent). Do NOT treat the release as closed: confirm the release is held (not promoted), acknowledge it, and re-run; a block plan not acknowledged as blocked fails closed.",
  },
  "acknowledgement-mismatch": {
    severity: "blocking",
    detail:
      "A class-specific acknowledgement was supplied that contradicts the plan's class (e.g. `--ack-block` on a non-block plan, or a monitor / investigation acknowledgement on a block plan). A receipt records the acknowledgement for the plan's ACTUAL class only; a contradictory execution fact fails closed. Supply the acknowledgement that matches the plan class.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and an advisory follow-up remained open, so the policy escalates it to a hard block — a `closed-out or blocked` gate for a high-assurance review. Close the open follow-up and acknowledge it (or drop `--strict-open` if an open advisory follow-up is acceptable for this review) before treating the plan as closed.",
  },
  "monitor-followup-open": {
    severity: "open",
    detail:
      "The plan is a MONITOR class (a benign improving, or a follow-up watch / degrading trend) and was reviewed, but its monitor / follow-up acknowledgement is absent (`--ack-monitor` and/or `--ack-followups`). The advisory follow-up remains open — track it to closure and acknowledge it; this is not a hard block, but the plan is not closed out.",
  },
  "investigation-open": {
    severity: "open",
    detail:
      "The plan is an INVESTIGATE class (an inconclusive insufficient trend) and was reviewed, but its investigation / follow-up acknowledgement is absent (`--ack-investigation` and/or `--ack-followups`). The advisory follow-up remains open — complete the investigation and acknowledge it; this is not a hard block, but the plan is not closed out.",
  },
  "plan-unreadable": {
    severity: "incomplete",
    detail:
      "The supplied plan could not be read / recognized as a `pdfxyz.release-decision-action-plan/1` (wrong schema or unparseable — never echoed). There is no plan to receipt; recover a valid plan produced by `worker:release-decision-action-plan` and re-run. A missing / unusable plan is never a completed close-out.",
  },
  "plan-not-exercised": {
    severity: "incomplete",
    detail:
      "The plan was not acknowledged as reviewed (`--ack-plan` absent). A receipt requires that the operator confirm the plan was reviewed before any follow-up can be closed out. Review the plan, acknowledge it, and re-run.",
  },
  "block-acknowledgement-incomplete": {
    severity: "incomplete",
    detail:
      "The block-release plan was acknowledged as held-blocked (`--ack-block` present, so the release is not treated as promoted), but a non-critical acknowledgement is absent (`--ack-plan` and/or `--ack-followups`). The safety property holds, but the receipt is not complete: acknowledge the review + the remediation follow-ups and re-run.",
  },
  "plan-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a CLEAR class (a clean stable trend, no follow-up warranted) and was acknowledged as reviewed (`--ack-plan`). The plan is closed out on THIS host; this records a bounded review acknowledgement, not an approval or a promotion.",
  },
  "monitor-followups-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a MONITOR class and its follow-ups were acknowledged (`--ack-plan` + `--ack-monitor` + `--ack-followups`). The monitor follow-up is closed out on THIS host; keep tracking the arc on your governance cadence.",
  },
  "investigation-acknowledged": {
    severity: "informational",
    detail:
      "The plan is an INVESTIGATE class and its investigation was acknowledged (`--ack-plan` + `--ack-investigation` + `--ack-followups`). The investigation is closed out on THIS host; re-index + re-trend the completed evidence and re-plan before relying on the history.",
  },
  "block-acknowledged": {
    severity: "informational",
    detail:
      "The plan is a BLOCK class and was acknowledged as held-blocked with its remediation follow-ups (`--ack-plan` + `--ack-block` + `--ack-followups`). The block is recorded as acknowledged on THIS host; the release remains held — this receipt is NOT an approval to promote.",
  },
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this receipt is NOT). */
export const RELEASE_DECISION_ACTION_RECEIPT_DISCLOSURE =
  "This is a content-free operational execution receipt ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced follow-up plan plus bounded operator acknowledgement flags and records whether the plan's required follow-ups were acknowledged; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The receipt RECORDS whether an operator
 * acknowledged the plan's follow-ups, and must never be read as more than that.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION ACTION-PLAN EXECUTION RECEIPT: it INGESTS ONE content-free `pdfxyz.release-decision-action-plan/1` document a release pipeline produced, RE-VALIDATES it against ITSELF, and records whether the operator's bounded acknowledgements closed out the plan's required follow-ups. It is a content-free operational execution receipt ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any plan, trend, window, record, artifact, object, or deployment. A `completed` receipt authorizes nothing; it only records that the content-free plan supplied on THIS host had its required follow-ups acknowledged by the bounded flags provided.",
  "A `completed` receipt REQUIRES a usable plan AND the bounded acknowledgements its class demands. It FAILS CLOSED: a missing / unreadable plan is `incomplete` (nothing to receipt); a tampered / self-inconsistent plan is `blocked`; a `block` plan not acknowledged as held-blocked is `blocked`; a supplied acknowledgement that contradicts the plan class is `blocked`; a missing required acknowledgement is `incomplete`; an advisory follow-up still open for a monitor / investigate plan is `followup-open`; and `--strict-open` escalates an open follow-up to `blocked`. It never fabricates a completed close-out from an untrusted plan or an unacknowledged one.",
  "It re-validates the ingested plan by RECONSTRUCTING its bounded Phase 62 decision from the source-trend details the plan recorded (reusing the Phase 62 `computeActionPlan` reducer) and requiring the recorded plan verdict / urgency / action class / exit code / reasons to re-derive, treating any disagreement as a TAMPER (`blocked`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the receipt proves neither authorship nor approval, and a fully self-consistent fabricated plan is out of its scope.",
  "It records only bounded acknowledgement FLAGS — booleans, never a free-form note or an actor name / identity. It emits only bounded enums, small counts, booleans, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes the ingested plan's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the receipt carries but does NOT itself perform — the honest edges of an offline receipt.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_ACTION_RECEIPT_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: after `worker:release-decision-action-plan` produces the ONE follow-up plan, hand it here with the bounded acknowledgement flags an operator supplies, and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked receipt), surface exit 3 (an open follow-up) and exit 2 (an incomplete receipt) for review, and treat exit 0 (a completed receipt) as closed-out — never as an authorization.",
  "Supply the acknowledgement flags an operator ACTUALLY performed — never fabricate them: `--ack-plan` (the plan was reviewed), `--ack-followups` (the follow-up checklist was worked), `--ack-monitor` / `--ack-investigation` (the class follow-up was tracked), and `--ack-block` (the release remains BLOCKED, not promoted). Acknowledge the plan's ACTUAL class only; a contradictory acknowledgement fails closed. `--strict-open` escalates any open follow-up to a hard block for a high-assurance review.",
  "Archive this receipt (and the underlying plan + trend + decision-index windows) as CI artifacts: it is a content-free execution SUMMARY, not a substitute for the plan it receipts, nor for your legal audit trail, compliance sign-off, external approval / signing, identity attestation, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this receipt RECORDS that a content-free plan's follow-ups were acknowledged, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline receipt never performs.",
];
