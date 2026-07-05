/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout bundle** (Phase 64).
 *
 * Phases 59–63 built the release DECISION chain, one rung per phase: the decision RECORD ledger
 * (`pdfxyz.release-decision/1`, Phase 59), the decision LEDGER INDEX (`pdfxyz.release-decision-index/1`, Phase 60), the
 * decision INDEX TREND (`pdfxyz.release-decision-trend/1`, Phase 61), the decision TREND ACTION PLAN
 * (`pdfxyz.release-decision-action-plan/1`, Phase 62), and the decision ACTION-PLAN EXECUTION RECEIPT
 * (`pdfxyz.release-decision-action-receipt/1`, Phase 63) — which recorded whether that plan's required follow-ups were
 * acknowledged.
 *
 * This phase COMPOSES that whole governance chain into ONE bounded closeout record. It INGESTS one primary
 * `pdfxyz.release-decision-action-receipt/1` document (REQUIRED) plus OPTIONAL related records already on hand — the
 * `pdfxyz.release-decision-action-plan/1` plan the receipt receipted, the `pdfxyz.release-decision-trend/1` trend the
 * plan folded, and the decision-ledger `pdfxyz.release-decision/1` / decision-index `pdfxyz.release-decision-index/1`
 * records upstream. It RE-VALIDATES the primary receipt against ITSELF (reconstructing its Phase 63 bounded decision from
 * the source facets it recorded and re-running the Phase 63 `computeReceipt` reducer, so a hand-flipped receipt verdict /
 * ack coverage / exit code is caught as a tamper), CROSS-CHECKS each supplied related record against what the receipt
 * recorded (the supplied plan must agree with the plan the receipt receipted; the supplied trend must agree with the
 * plan's recorded source-trend verdict), and folds the decision / index records' own bounded postures as an independent
 * source-chain signal. It answers a single question a governance review needs —
 *
 *    "Is this release decision governance chain CLOSED OUT — the action-plan receipt completed and the supplied related
 *     records coherent — or is it still OPEN, INCOMPLETE, or BLOCKED?"
 *
 * — as a bounded closeout verdict (`closed` / `closeout-incomplete` / `closeout-open` / `closeout-blocked`), the primary
 * receipt's own state + verdict, a bounded related-record checklist (which records were supplied, coherent, contradictory,
 * advisory, or blocking), a bounded rationale, and a content-free receipt — and it FAILS CLOSED when the primary receipt
 * cannot be trusted or a required related record is absent.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it composes:
 *  - Every load-bearing token here is a bounded enum — a closeout verdict, a source state, a related-record kind / state /
 *    signal, a reason id, plus the surfaced upstream receipt verdict / plan class / plan verdict / trend verdict / index
 *    verdict / decision — never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw
 *    ref, raw label, raw note, reviewer identity, commit URL, digest, or timestamp from any ingested record. The only
 *    non-enum values are small integer counts, booleans, an ISO stamp, and app-authored prose. It accepts NO free-form
 *    note or actor name.
 *  - It never copies a free-text field out of any ingested record (even records the prior phases produced are UNTRUSTED
 *    input here); it reduces every record to bounded enums, small integers, and booleans, it never echoes any record's OWN
 *    stamp (the closeout carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a `closed` closeout. `closed` REQUIRES a usable primary receipt whose OWN verdict is `completed`
 *    AND every supplied related record coherent; a tampered receipt is `blocked`; a `blocked` receipt is `blocked`; a
 *    contradictory / tampered related record or a blocked source-chain record is `blocked`; a missing / unreadable primary
 *    receipt or a missing required related record is `incomplete`; a `followup-open` receipt or an advisory source-chain
 *    record is `open`; and `--strict-open` escalates an open closeout to `blocked`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT an approval / sign-off, and NOT a deployment / promotion ledger. It PROVES
 * nothing the composed records do not already prove; it RECORDS whether the governance chain reads as closed. Its
 * authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_CAVEATS}) say so out loud.
 */

import {
  RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_TREND_VERDICTS,
  type ReleaseDecisionActionPlanActionClass,
  type ReleaseDecisionActionPlanUrgency,
  type ReleaseDecisionActionPlanVerdict,
  type ReleaseDecisionActionReceiptPlanClass,
  type ReleaseDecisionActionReceiptVerdict,
  type ReleaseDecisionTrendVerdict,
} from "../release-decision-action-receipt/types";
import {
  RELEASE_DECISION_INDEX_SCHEMA,
  RELEASE_DECISION_INDEX_VERDICTS,
  type ReleaseDecisionIndexVerdict,
} from "../release-decision-index/types";
import {
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_SCHEMA,
  type ReleaseDecisionDecision,
} from "../release-decision/types";
import { RELEASE_DECISION_TREND_SCHEMA } from "../release-decision-trend/types";

/** The schema tag every closeout result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_SCHEMA = "pdfxyz.release-decision-closeout/1" as const;

/** The upstream document schemas the closeout composes. Re-exported so the result can pin its input shapes. */
export {
  RELEASE_DECISION_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_TREND_SCHEMA,
  RELEASE_DECISION_INDEX_SCHEMA,
  RELEASE_DECISION_SCHEMA,
};

/** Stable identity of the release-decision-closeout — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_POLICY_ID = "pdfxyz-worker-release-decision-closeout";
/** Bump when the closeout surface, the verdict ladder, the reason / signal sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_POLICY_VERSION = 1;

/** The upstream enums the closeout surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_TREND_VERDICTS,
  RELEASE_DECISION_INDEX_VERDICTS,
  RELEASE_DECISION_DECISIONS,
};
export type {
  ReleaseDecisionActionReceiptVerdict,
  ReleaseDecisionActionReceiptPlanClass,
  ReleaseDecisionActionPlanVerdict,
  ReleaseDecisionActionPlanUrgency,
  ReleaseDecisionActionPlanActionClass,
  ReleaseDecisionTrendVerdict,
  ReleaseDecisionIndexVerdict,
  ReleaseDecisionDecision,
};

/**
 * The bounded coverage state of the ONE ingested primary receipt document (MY trust in the RECEIPT, distinct from the
 * receipt's OWN verdict about the plan it receipted):
 *  - `unreadable` — supplied but not read / parsed / recognized as a `pdfxyz.release-decision-action-receipt/1` (never
 *                   echoed). A missing / unusable receipt: there is nothing to close out (⇒ `closeout-incomplete`, never
 *                   a vacuous `closed`);
 *  - `tampered`   — recognized as a receipt but its recorded decision does NOT re-derive from the source facets it
 *                   recorded (a hand-flipped verdict / ack coverage / exit code) — an untrustworthy receipt (⇒
 *                   `closeout-blocked`);
 *  - `usable`     — recognized AND self-consistent (its recorded receipt decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_SOURCE_STATES = ["unreadable", "tampered", "usable"] as const;
export type ReleaseDecisionCloseoutSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_SOURCE_STATES)[number];

/**
 * The bounded **related-record kinds** the closeout can compose alongside the primary receipt — the closed set of
 * OPTIONAL upstream records a governance review may already have on hand:
 *  - `plan`     — the `pdfxyz.release-decision-action-plan/1` follow-up plan the receipt receipted (a cross-check);
 *  - `trend`    — the `pdfxyz.release-decision-trend/1` trend the plan folded (a cross-check);
 *  - `decision` — a `pdfxyz.release-decision/1` decision-ledger record upstream (a source-chain posture signal);
 *  - `index`    — a `pdfxyz.release-decision-index/1` decision-ledger index upstream (a source-chain posture signal).
 */
export const RELEASE_DECISION_CLOSEOUT_RECORD_KINDS = ["plan", "trend", "decision", "index"] as const;
export type ReleaseDecisionCloseoutRecordKind =
  (typeof RELEASE_DECISION_CLOSEOUT_RECORD_KINDS)[number];

/**
 * The bounded coverage state of ONE related record (MY trust in that record):
 *  - `absent`     — not supplied (nothing to compose);
 *  - `unreadable` — supplied but not recognized as a document of its expected schema (never echoed);
 *  - `tampered`   — recognized but its recorded decision does NOT re-derive (an untrustworthy record ⇒ `blocked`);
 *  - `usable`     — recognized AND self-consistent: its bounded facts are trustworthy for the cross-check / posture.
 */
export const RELEASE_DECISION_CLOSEOUT_RECORD_STATES = ["absent", "unreadable", "tampered", "usable"] as const;
export type ReleaseDecisionCloseoutRecordState =
  (typeof RELEASE_DECISION_CLOSEOUT_RECORD_STATES)[number];

/**
 * The bounded **signal** a usable related record contributes to the closeout — how it relates to the primary receipt /
 * the governance posture:
 *  - `coherent`      — a cross-check record (`plan` / `trend`) AGREES with what the receipt recorded, OR a source-chain
 *                      record (`decision` / `index`) is at a clean posture. It supports the closeout;
 *  - `contradictory` — a cross-check record (`plan` / `trend`) DISAGREES with what the receipt recorded (the supplied
 *                      record is not the one this receipt's chain was built from, or one was edited) ⇒ `blocked`;
 *  - `advisory`      — a source-chain record's own posture is advisory (an index `watch`, a decision
 *                      `proceed-with-followup` / `hold`) — the chain is not cleanly closed ⇒ `open`;
 *  - `insufficient`  — a source-chain record's own posture is inconclusive (an `insufficient` verdict / decision) ⇒
 *                      `incomplete`;
 *  - `blocking`      — a source-chain record's own posture is blocking (an index `blocked` / `invalid`, a decision
 *                      `reject` / `invalid`) — a blocked source chain ⇒ `blocked`;
 *  - `none`          — no signal (the record is `absent` / `unreadable` / `tampered`; its state carries that).
 */
export const RELEASE_DECISION_CLOSEOUT_RELATION_SIGNALS = [
  "coherent",
  "contradictory",
  "advisory",
  "insufficient",
  "blocking",
  "none",
] as const;
export type ReleaseDecisionCloseoutRelationSignal =
  (typeof RELEASE_DECISION_CLOSEOUT_RELATION_SIGNALS)[number];

/**
 * The single closeout verdict a governance reviewer keys on — the answer to "is the chain closed out?":
 *  - `closed`               — the primary receipt is usable and its OWN verdict is `completed`, and every supplied related
 *                             record is coherent (no contradiction / block / advisory / insufficiency). The governance
 *                             chain reads as closed out on THIS host. It authorizes NOTHING; it is not sign-off, approval,
 *                             or promotion;
 *  - `closeout-incomplete`  — the primary receipt is missing / unreadable (nothing to close out), OR its OWN verdict is
 *                             `incomplete`, OR a required related record is absent / unusable, OR a source-chain record is
 *                             inconclusive. A coverage gap: supply the missing evidence and re-run;
 *  - `closeout-open`        — the primary receipt's OWN verdict is `followup-open` (an advisory follow-up still open), OR a
 *                             supplied source-chain record's posture is advisory. Not a hard block — track it to closure;
 *  - `closeout-blocked`     — the primary receipt is tampered / untrustworthy, OR its OWN verdict is `blocked`, OR a
 *                             cross-check record contradicts it, OR a related record is tampered, OR a source-chain record
 *                             is blocked, OR `--strict-open` escalated an open closeout. Do NOT treat the chain as closed.
 *
 * These are the exact bounded values the run-level `worker_release_decision_closeout_total` metric carries as its
 * `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_VERDICTS = [
  "closed",
  "closeout-incomplete",
  "closeout-open",
  "closeout-blocked",
] as const;
export type ReleaseDecisionCloseoutVerdict = (typeof RELEASE_DECISION_CLOSEOUT_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-evidence suite:
 *  - `0` CLOSED     — a `closed` closeout (the receipt completed and the supplied related records are coherent);
 *  - `1` USAGE      — the CLI was misused (a bad flag, no receipt supplied, or an unwritable output). CLI-owned; a
 *                     closeout RUN never resolves to it;
 *  - `2` INCOMPLETE — a `closeout-incomplete` closeout (a missing / unusable receipt or a missing required related record);
 *  - `3` OPEN       — a `closeout-open` closeout (a followup-open receipt or an advisory source-chain record);
 *  - `4` BLOCKED    — a `closeout-blocked` closeout (a tampered / blocked receipt, a contradictory / tampered related
 *                     record, a blocked source chain, or a `--strict-open` escalation).
 */
export const RELEASE_DECISION_CLOSEOUT_EXIT = {
  CLOSED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  OPEN: 3,
  BLOCKED: 4,
} as const;
export type ReleaseDecisionCloseoutExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_EXIT];

/**
 * The severity each fired reason maps onto, with precedence `blocking > open > incomplete > informational` (checked in
 * that order — higher is worse, and the run's exit code follows the worst fired severity):
 *  - `informational` — a benign closeout marker (the receipt completed / a related record is coherent);
 *  - `incomplete`    — a coverage gap (a missing / unusable receipt, a missing required record, an insufficient source
 *                      chain) ⇒ exit 2;
 *  - `open`          — an advisory follow-up / source-chain posture remains open ⇒ exit 3;
 *  - `blocking`      — the receipt is untrustworthy / blocked, a related record contradicts / is tampered / is a blocked
 *                      source chain, or a follow-up was strict-escalated ⇒ exit 4.
 */
export const RELEASE_DECISION_CLOSEOUT_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
] as const;
export type ReleaseDecisionCloseoutSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the closeout resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail
 * are authored in {@link RELEASE_DECISION_CLOSEOUT_REASON_DETAIL}:
 *
 * Blocking (do NOT treat the chain as closed):
 *  - `receipt-tampered`         — the primary receipt is recognized but its recorded decision does NOT re-derive;
 *  - `receipt-blocked`          — the primary receipt's OWN verdict is `blocked`;
 *  - `plan-contradiction`       — a supplied usable plan disagrees with the plan the receipt receipted;
 *  - `trend-contradiction`      — a supplied usable trend disagrees with the plan's recorded source-trend verdict;
 *  - `related-tampered`         — a supplied related record is recognized but self-inconsistent (an untrustworthy chain);
 *  - `source-chain-blocked`     — a supplied decision / index record's OWN posture is blocking (a blocked source chain);
 *  - `strict-open-escalation`   — `--strict-open` escalated an otherwise-open closeout to a hard block.
 *
 * Open (an advisory follow-up / posture remains open):
 *  - `receipt-followup-open`    — the primary receipt's OWN verdict is `followup-open`;
 *  - `source-chain-advisory`    — a supplied decision / index record's OWN posture is advisory.
 *
 * Incomplete (a coverage gap):
 *  - `receipt-unreadable`       — the primary receipt is missing / unreadable (nothing to close out);
 *  - `receipt-incomplete`       — the primary receipt's OWN verdict is `incomplete`;
 *  - `required-record-missing`  — a `--require-*` related record was required but is absent / unusable;
 *  - `related-unreadable`       — an OPTIONAL related record was supplied but could not be read / recognized;
 *  - `source-chain-insufficient`— a supplied decision / index record's OWN posture is inconclusive.
 *
 * Informational (a benign closeout marker):
 *  - `receipt-completed`        — the primary receipt's OWN verdict is `completed`;
 *  - `plan-coherent`            — a supplied plan agrees with the receipt (or no direct cross-check applied);
 *  - `trend-coherent`           — a supplied trend agrees with the receipt (or no direct cross-check applied);
 *  - `source-chain-coherent`    — a supplied decision / index record is usable and at a clean posture.
 */
export const RELEASE_DECISION_CLOSEOUT_REASON_IDS = [
  // Blocking
  "receipt-tampered",
  "receipt-blocked",
  "plan-contradiction",
  "trend-contradiction",
  "related-tampered",
  "source-chain-blocked",
  "strict-open-escalation",
  // Open
  "receipt-followup-open",
  "source-chain-advisory",
  // Incomplete
  "receipt-unreadable",
  "receipt-incomplete",
  "required-record-missing",
  "related-unreadable",
  "source-chain-insufficient",
  // Informational
  "receipt-completed",
  "plan-coherent",
  "trend-coherent",
  "source-chain-coherent",
] as const;
export type ReleaseDecisionCloseoutReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_REASON_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Ingested facts + result shapes
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable primary `pdfxyz.release-decision-action-receipt/1` (its decision re-derived in
 * ingest). Every field is trusted only when the receipt re-derived; surfaced content-free.
 */
export interface CloseoutReceiptFacts {
  /** The receipt's final verdict (trusted — the receipt re-derived its own decision). */
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict;
  /** The receipt's resolved plan class, or `null` when the receipt's own plan was not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** The plan verdict the receipt receipted (its plan's trusted verdict), or `null` when that plan was not usable. */
  readonly claimedPlanVerdict: ReleaseDecisionActionPlanVerdict | null;
  /** The plan's source-trend verdict the receipt recorded, or `null` when not available. */
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
  /** The plan's urgency the receipt recorded (surfaced context), or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionActionPlanUrgency | null;
  /** The plan's coarse action class the receipt recorded (surfaced context), or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionActionPlanActionClass | null;
  /** True iff the receipted plan was a benign monitor (context). */
  readonly benignMonitor: boolean;
  /** How many of the receipted plan's actions were must-complete-before-release (a bounded count). */
  readonly blockingActions: number;
  /** How many of the receipted plan's actions were recommended follow-ups (a bounded count). */
  readonly advisoryActions: number;
  /** True iff the receipted plan was produced under `--strict` (context). */
  readonly planStrict: boolean;
  /** How many acknowledgements the receipt's plan class required. */
  readonly acksRequired: number;
  /** How many of the required acknowledgements the receipt recorded as satisfied. */
  readonly acksSatisfied: number;
  /** How many required acknowledgements the receipt recorded as missing. */
  readonly acksMissing: number;
  /** True iff the receipt was produced under `--strict-open` (context; never re-judged by the closeout). */
  readonly receiptStrictOpen: boolean;
}

/** The bounded facts a usable related record contributes to the cross-check / posture (one shape per kind, folded). */
export interface CloseoutRelatedFacts {
  /** The related record's own bounded primary token (a plan / trend / index verdict, or a decision), or `null`. */
  readonly verdict:
    | ReleaseDecisionActionPlanVerdict
    | ReleaseDecisionTrendVerdict
    | ReleaseDecisionIndexVerdict
    | ReleaseDecisionDecision
    | null;
  /** The plan's resolved class (only for a `plan` record; `null` otherwise). */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** The plan's urgency (only for a `plan` record; `null` otherwise). */
  readonly planUrgency: ReleaseDecisionActionPlanUrgency | null;
  /** The plan's coarse action class (only for a `plan` record; `null` otherwise). */
  readonly planActionClass: ReleaseDecisionActionPlanActionClass | null;
  /** The plan's source-trend verdict (only for a `plan` record; `null` otherwise). */
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
}

/** One entry in the bounded related-record checklist — a kind + its coverage state, required flag, signal, and surfaced verdict. */
export interface ReleaseDecisionCloseoutRelatedRecord {
  readonly kind: ReleaseDecisionCloseoutRecordKind;
  /** True iff this record was made REQUIRED by a `--require-<kind>` flag. */
  readonly required: boolean;
  /** MY coverage state of the supplied record. */
  readonly state: ReleaseDecisionCloseoutRecordState;
  /** The bounded signal this record contributes to the closeout (`none` when not usable). */
  readonly signal: ReleaseDecisionCloseoutRelationSignal;
  /**
   * The record's OWN bounded primary token (a plan / trend / index verdict, or a decision), or `null` when not usable /
   * absent. Content-free (always a bounded enum). For a `tampered` cross-check record it is `null` (its claim is not
   * surfaced, to keep the checklist bounded).
   */
  readonly verdict:
    | ReleaseDecisionActionPlanVerdict
    | ReleaseDecisionTrendVerdict
    | ReleaseDecisionIndexVerdict
    | ReleaseDecisionDecision
    | null;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutPolicy {
  /** True iff `--strict-open` was set (an open closeout escalates to `blocked`). */
  readonly strictOpen: boolean;
  /** Which related records were made REQUIRED (a `--require-<kind>` flag each). */
  readonly require: {
    readonly plan: boolean;
    readonly trend: boolean;
    readonly decision: boolean;
    readonly index: boolean;
  };
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutReason {
  readonly id: ReleaseDecisionCloseoutReasonId;
  readonly severity: ReleaseDecisionCloseoutSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The bounded primary-receipt summary the result records — what the closeout composed, content-free. */
export interface ReleaseDecisionCloseoutSource {
  /** MY coverage state of the ingested primary receipt document. */
  readonly state: ReleaseDecisionCloseoutSourceState;
  /**
   * The receipt's OWN verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * receipt it is the untrusted CLAIMED verdict (surfaced so the closeout shows what was asserted).
   */
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict | null;
  /** The receipt's resolved plan class (a bounded enum), or `null` when not usable / the receipt's plan was not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** The plan verdict the receipt receipted (a bounded enum), or `null` when not usable. */
  readonly claimedPlanVerdict: ReleaseDecisionActionPlanVerdict | null;
  /** The plan's source-trend verdict the receipt recorded (a bounded enum), or `null` when not usable / not available. */
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
  /** The plan's urgency the receipt recorded (a bounded enum), or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionActionPlanUrgency | null;
  /** The plan's coarse action class the receipt recorded (a bounded enum), or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionActionPlanActionClass | null;
  /** True iff the receipted plan was a benign monitor (context; `false` when not usable). */
  readonly benignMonitor: boolean;
  /** How many acknowledgements the receipt's plan class required (`0` when not usable). */
  readonly acksRequired: number;
  /** How many of the required acknowledgements the receipt recorded as satisfied (`0` when not usable). */
  readonly acksSatisfied: number;
  /** How many required acknowledgements the receipt recorded as missing (`0` when not usable). */
  readonly acksMissing: number;
  /** True iff the receipt was produced under `--strict-open` (context; `false` when not usable). */
  readonly receiptStrictOpen: boolean;
}

/** The composite closeout decision — the single verdict + exit code + coverage a reviewer acts on. THE TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutRollup {
  readonly verdict: ReleaseDecisionCloseoutVerdict;
  readonly exitCode: ReleaseDecisionCloseoutExitCode;
  /** True iff `verdict === "closed"`. */
  readonly closed: boolean;
  /** MY coverage state of the ingested primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutSourceState;
  /** The receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict | null;
  /** The receipt's resolved plan class, or `null` when not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were open follow-ups / postures. */
  readonly open: number;
  /** How many fired reasons were incomplete coverage gaps. */
  readonly incomplete: number;
  /** How many fired reasons were informational closeout markers. */
  readonly informational: number;
  /** How many related records were supplied (state !== `absent`). */
  readonly relatedSupplied: number;
  /** How many supplied related records were coherent. */
  readonly relatedCoherent: number;
  /** How many supplied related records contradicted the receipt (cross-check mismatch). */
  readonly relatedContradictory: number;
  /** How many supplied related records were blocking (tampered, or a blocked source chain). */
  readonly relatedBlocking: number;
  /** The required related-record kinds that are still missing (`required && !usable`). */
  readonly requiredMissing: readonly ReleaseDecisionCloseoutRecordKind[];
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an open closeout to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "closeout-open" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream schemas). */
export interface ReleaseDecisionCloseoutMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_POLICY_VERSION;
  readonly receiptSchema: typeof RELEASE_DECISION_ACTION_RECEIPT_SCHEMA;
  readonly planSchema: typeof RELEASE_DECISION_ACTION_PLAN_SCHEMA;
  readonly trendSchema: typeof RELEASE_DECISION_TREND_SCHEMA;
  readonly decisionSchema: typeof RELEASE_DECISION_SCHEMA;
  readonly indexSchema: typeof RELEASE_DECISION_INDEX_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "is this chain closed out,
 * and how" for a SIEM / review record. Bounded enums + small integers + a stable policy id + the run's own stamp + a
 * disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutReceipt {
  readonly category: "worker-release-decision-closeout";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutVerdict;
  readonly exitCode: ReleaseDecisionCloseoutExitCode;
  /** MY coverage state of the ingested primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutSourceState;
  /** The receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict | null;
  /** The receipt's resolved plan class, or `null` when not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** How many related records were supplied. */
  readonly relatedSupplied: number;
  /** How many supplied related records were coherent. */
  readonly relatedCoherent: number;
  /** How many supplied related records contradicted the receipt. */
  readonly relatedContradictory: number;
  /** How many supplied related records were blocking (tampered or a blocked source chain). */
  readonly relatedBlocking: number;
  /** How many required related records are still missing. */
  readonly requiredMissing: number;
  /** True iff `--strict-open` escalated an open closeout to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** The bounded, app-authored disclosure statement (what this closeout is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout bundle a governance reviewer / CI reads. Every field is a bounded
 * enum, a small integer, a boolean, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator,
 * size, path, or byte, even from a hostile input, and never echoes any ingested record's own stamp.
 */
export interface ReleaseDecisionCloseoutResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutMetadata;
  readonly policy: ReleaseDecisionCloseoutPolicy;
  /** The single closeout verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionCloseoutVerdict;
  /** The process exit code (mirrors `closeout.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutExitCode;
  /** The receipt's resolved plan class (bounded enum), or `null` when not usable. */
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  /** The bounded primary-receipt summary the closeout composed. */
  readonly source: ReleaseDecisionCloseoutSource;
  /** The bounded related-record checklist (one entry per kind, in canonical order). */
  readonly related: readonly ReleaseDecisionCloseoutRelatedRecord[];
  /** The composite closeout rollup (verdict + exit + reasons + related coverage + strict flags). The TOP-LEVEL rollup. */
  readonly closeout: ReleaseDecisionCloseoutRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutReason[];
  /** Bounded, app-authored guidance (out-of-scope steps this closeout does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutReceipt;
}

/** The process exit code for a closeout result. */
export function releaseDecisionCloseoutExitCode(result: ReleaseDecisionCloseoutResult): number {
  return result.closeout.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_VERDICT_SUMMARY: Record<ReleaseDecisionCloseoutVerdict, string> = {
  closed:
    "CLOSED: the primary action-plan execution receipt is usable and its own verdict is COMPLETED, and every supplied related record (plan / trend / decision / index) is coherent — the release decision governance chain reads as closed out on THIS host. This closeout authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  "closeout-incomplete":
    "CLOSEOUT-INCOMPLETE: the primary receipt is missing / unreadable, or its own verdict is INCOMPLETE, or a required related record is absent / unusable, or a source-chain record is inconclusive. Supply the missing receipt / related record and re-run before treating the chain as closed. This is a coverage gap, not a block.",
  "closeout-open":
    "CLOSEOUT-OPEN: the primary receipt's own verdict is FOLLOWUP-OPEN (an advisory follow-up still open), or a supplied decision / index record's own posture is advisory. Track the follow-up to closure and re-run; this is not a hard block, but the chain is not closed out either.",
  "closeout-blocked":
    "CLOSEOUT-BLOCKED: the primary receipt is untrustworthy (tampered / self-inconsistent) or its own verdict is BLOCKED, OR a supplied related record contradicts the receipt / is tampered / is a blocked source chain, OR `--strict-open` escalated an open closeout. Do NOT treat the chain as closed; recover trustworthy, coherent records before relying on this closeout.",
};

/**
 * The dedicated headline for a `closeout-blocked` closeout produced ONLY because `--strict-open` escalated an open
 * closeout — the receipt itself was neither tampered nor blocked, so the generic headline would misrepresent the cause.
 */
export const RELEASE_DECISION_CLOSEOUT_STRICT_OPEN_ESCALATED_SUMMARY =
  "CLOSEOUT-BLOCKED (--strict-open): the only concern is an OPEN closeout (a followup-open receipt or an advisory decision / index record), and `--strict-open` escalates any open closeout to a hard block — a `closed or blocked` gate for a high-assurance review. Without the flag this would be CLOSEOUT-OPEN. The primary receipt itself is neither tampered nor blocked, and no related record contradicts it.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutReasonId,
  { readonly severity: ReleaseDecisionCloseoutSeverity; readonly detail: string }
> = {
  "receipt-tampered": {
    severity: "blocking",
    detail:
      "The supplied primary receipt is a recognized `pdfxyz.release-decision-action-receipt/1` whose recorded decision (verdict / exit code / acknowledgement coverage) does NOT re-derive from the source facets it recorded — a hand-edited or corrupt receipt. Recover the untampered receipt from your CI archive; an untrustworthy receipt cannot close out the chain.",
  },
  "receipt-blocked": {
    severity: "blocking",
    detail:
      "The primary receipt's OWN verdict is `blocked` — the plan it receipted was tampered / unacknowledged-block / strict-escalated / contradictory. The action-plan follow-up was not closed out, so the governance chain is NOT closed. Resolve the receipt's block (recover a valid plan / supply the correct acknowledgement) and re-run before relying on this closeout.",
  },
  "plan-contradiction": {
    severity: "blocking",
    detail:
      "A supplied `pdfxyz.release-decision-action-plan/1` plan is usable but its trusted facts (verdict / class / urgency / action class / source-trend verdict) DISAGREE with the plan the primary receipt receipted. The supplied plan is not the one this receipt's chain was built from (or one was edited): the records are inconsistent. Supply the matching plan and re-run; a cross-check mismatch fails closed.",
  },
  "trend-contradiction": {
    severity: "blocking",
    detail:
      "A supplied `pdfxyz.release-decision-trend/1` trend is usable but its trusted verdict DISAGREES with the source-trend verdict the plan (via the receipt) recorded. The supplied trend is not the one this chain was built from (or one was edited): the records are inconsistent. Supply the matching trend and re-run; a cross-check mismatch fails closed.",
  },
  "related-tampered": {
    severity: "blocking",
    detail:
      "A supplied related record (plan / trend / decision / index) is a recognized document of its schema whose recorded decision does NOT re-derive from its own recorded facts — a hand-edited or corrupt record. An untrustworthy record in the chain fails closed: recover the untampered record from your CI archive and re-run.",
  },
  "source-chain-blocked": {
    severity: "blocking",
    detail:
      "A supplied decision-ledger `pdfxyz.release-decision/1` record's OWN decision is `reject` / `invalid`, or a decision-index `pdfxyz.release-decision-index/1` record's OWN verdict is `blocked` / `invalid` — a BLOCKED source chain upstream of this closeout. The governance chain is not cleanly closeable while an upstream record is blocked: reconcile the block and re-run.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and the closeout would otherwise be OPEN (a followup-open receipt or an advisory decision / index record), so the policy escalates it to a hard block — a `closed or blocked` gate for a high-assurance review. Close the open follow-up / advisory posture (or drop `--strict-open` if an open closeout is acceptable for this review) before treating the chain as closed.",
  },
  "receipt-followup-open": {
    severity: "open",
    detail:
      "The primary receipt's OWN verdict is `followup-open` — the plan it receipted was reviewed but an advisory follow-up (a monitor / investigate plan) remains open (its follow-up acknowledgement is absent). Track the follow-up to closure, re-run the receipt, and re-run this closeout; this is not a hard block, but the chain is not closed out.",
  },
  "source-chain-advisory": {
    severity: "open",
    detail:
      "A supplied decision-ledger `pdfxyz.release-decision/1` record's OWN decision is `proceed-with-followup` / `hold`, or a decision-index `pdfxyz.release-decision-index/1` record's OWN verdict is `watch` — an ADVISORY source-chain posture upstream of this closeout. The chain is not cleanly closed while an upstream record warrants review: track it to closure and re-run.",
  },
  "receipt-unreadable": {
    severity: "incomplete",
    detail:
      "The supplied primary receipt could not be read / recognized as a `pdfxyz.release-decision-action-receipt/1` (wrong schema or unparseable — never echoed). There is no receipt to close out; recover a valid receipt produced by `worker:release-decision-action-receipt` and re-run. A missing / unusable primary receipt is never a `closed` closeout.",
  },
  "receipt-incomplete": {
    severity: "incomplete",
    detail:
      "The primary receipt's OWN verdict is `incomplete` — its plan was missing / unreadable, or a required acknowledgement was absent. The action-plan follow-up was not exercised, so the chain is not closed out. Supply the missing plan / acknowledgement, re-run the receipt, and re-run this closeout.",
  },
  "required-record-missing": {
    severity: "incomplete",
    detail:
      "A related record was made REQUIRED by a `--require-<kind>` flag but is absent or could not be read / recognized. A required-record coverage gap is never a `closed` closeout: supply the required plan / trend / decision / index record and re-run.",
  },
  "related-unreadable": {
    severity: "incomplete",
    detail:
      "An OPTIONAL related record was supplied (a `--plan` / `--trend` / `--decision` / `--index` path) but could not be read / recognized as a document of its expected schema (never echoed). The record contributes no cross-check / posture: recover a valid record and re-run, or drop the flag if the record is not available for this review.",
  },
  "source-chain-insufficient": {
    severity: "incomplete",
    detail:
      "A supplied decision-ledger `pdfxyz.release-decision/1` record's OWN decision is `insufficient`, or a decision-index `pdfxyz.release-decision-index/1` record's OWN verdict is `insufficient` — an inconclusive source-chain posture upstream of this closeout. Complete the upstream evidence and re-run before treating the chain as closed.",
  },
  "receipt-completed": {
    severity: "informational",
    detail:
      "The primary receipt is usable and its OWN verdict is `completed` — the action-plan follow-up was closed out on the receipt's host. This is the load-bearing marker for a `closed` closeout (provided every supplied related record is coherent); it records a bounded execution close-out, not an approval or a promotion.",
  },
  "plan-coherent": {
    severity: "informational",
    detail:
      "A supplied `pdfxyz.release-decision-action-plan/1` plan is usable and its trusted facts AGREE with the plan the primary receipt receipted (or the receipt recorded no usable plan to cross-check against, so no contradiction is possible). The plan supports the closeout as a cross-check.",
  },
  "trend-coherent": {
    severity: "informational",
    detail:
      "A supplied `pdfxyz.release-decision-trend/1` trend is usable and its trusted verdict AGREES with the source-trend verdict the plan (via the receipt) recorded (or the receipt recorded no source-trend verdict to cross-check against). The trend supports the closeout as a cross-check.",
  },
  "source-chain-coherent": {
    severity: "informational",
    detail:
      "A supplied decision-ledger `pdfxyz.release-decision/1` record (`proceed`) or decision-index `pdfxyz.release-decision-index/1` record (`stable`) is usable and at a clean posture — a coherent source-chain context upstream of this closeout. It supports the closeout; keep the underlying records on your governance cadence.",
  },
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this closeout is NOT). */
export const RELEASE_DECISION_CLOSEOUT_DISCLOSURE =
  "This is a content-free operational closeout SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced action-plan execution receipt plus optional previously produced related records and records whether the release decision governance chain reads as closed out; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The closeout COMPOSES previously produced
 * records and must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT BUNDLE: it INGESTS ONE content-free `pdfxyz.release-decision-action-receipt/1` document a release pipeline produced (REQUIRED), plus OPTIONAL previously produced related records (the `pdfxyz.release-decision-action-plan/1` plan, the `pdfxyz.release-decision-trend/1` trend, and the `pdfxyz.release-decision/1` / `pdfxyz.release-decision-index/1` ledger records), RE-VALIDATES the primary receipt against ITSELF, CROSS-CHECKS the supplied related records against what the receipt recorded, and records whether the governance chain reads as closed out. It is a content-free operational closeout SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any receipt, plan, trend, record, index, artifact, object, or deployment. A `closed` closeout authorizes nothing; it only records that the content-free records supplied on THIS host read as a closed-out governance chain.",
  "A `closed` closeout REQUIRES a usable primary receipt whose OWN verdict is `completed` AND every supplied related record coherent. It FAILS CLOSED: a missing / unreadable primary receipt is `closeout-incomplete` (nothing to close out); a tampered / self-inconsistent receipt is `closeout-blocked`; a receipt whose own verdict is `blocked` is `closeout-blocked`; a supplied cross-check record that contradicts the receipt, a tampered related record, or a blocked source-chain record is `closeout-blocked`; a receipt whose own verdict is `incomplete`, a missing required related record, or an insufficient source-chain record is `closeout-incomplete`; a receipt whose own verdict is `followup-open` or an advisory source-chain record is `closeout-open`; and `--strict-open` escalates an open closeout to `closeout-blocked`. It never fabricates a `closed` closeout from an untrusted receipt or an inconsistent chain.",
  "It re-validates the primary receipt by RECONSTRUCTING its bounded Phase 63 decision from the source facets the receipt recorded (reusing the Phase 63 `computeReceipt` reducer) and requiring the recorded receipt verdict / exit code / acknowledgement coverage to re-derive, treating any disagreement as a TAMPER (`closeout-blocked`); it re-validates each supplied related record against ITSELF the same way (reusing that phase's ingest boundary). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the closeout proves neither authorship nor approval, and a set of fully self-consistent fabricated records is out of its scope.",
  "It records only bounded enums, small counts, booleans, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes any ingested record's own stamp, and it never echoes an input file path, even on an error. It accepts NO free-form note or actor name.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the closeout carries but does NOT itself perform — the honest edges of an offline summary.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: after `worker:release-decision-action-receipt` records the ONE execution receipt, hand it here (with the plan / trend / decision / index records you already have) and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked closeout), surface exit 3 (an open closeout) and exit 2 (an incomplete closeout) for review, and treat exit 0 (a closed closeout) as closed-out — never as an authorization.",
  "Supply the SAME records this receipt's chain was built from — never a newer / different window: `--plan` (the plan the receipt receipted), `--trend` (the trend that plan folded), and `--decision` / `--index` (the ledger records upstream). A supplied cross-check record that does not match what the receipt recorded fails closed; use `--require-plan` / `--require-trend` / `--require-decision` / `--require-index` to make a record mandatory for a high-assurance review, and `--strict-open` to escalate any open closeout to a hard block.",
  "Archive this closeout (and the underlying receipt + plan + trend + decision-ledger records) as CI artifacts: it is a content-free closeout SUMMARY, not a substitute for the records it composes, nor for your legal audit trail, compliance sign-off, external approval / signing, identity attestation, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this closeout RECORDS whether a content-free governance chain reads as closed, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline summary never performs.",
];
