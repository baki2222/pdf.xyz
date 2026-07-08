/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index trend
 * finalize index trend closeout bundle** (Phase 94).
 *
 * Phases 90–93 built the finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend follow-up chain, one rung per phase: the
 * finalization-index window (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1`,
 * Phase 90), the finalization-index TREND (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1`,
 * Phase 91), the trend ACTION PLAN (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1`,
 * Phase 92), and the action-plan EXECUTION RECEIPT (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1`,
 * Phase 93) — which recorded whether that plan's required follow-ups were acknowledged.
 *
 * This phase COMPOSES that follow-up chain into ONE bounded closeout record. It INGESTS one primary
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` document
 * (REQUIRED) plus OPTIONAL related records already on hand — the
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1` plan the receipt
 * receipted and the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1` trend the
 * plan planned over. It RE-VALIDATES the primary receipt against ITSELF (reconstructing its Phase 93
 * bounded plan-ingest from the source facets it recorded and re-running the Phase 93 `computeReceipt` reducer, so a
 * hand-flipped receipt verdict / ack coverage / exit code is caught as a tamper), CROSS-CHECKS each supplied related
 * record against what the receipt recorded (the supplied plan must agree with the plan the receipt receipted; the
 * supplied trend must agree with the plan's recorded source-trend verdict), and surfaces the receipt's OWN recorded
 * source-chain posture. It answers a single question a governance review needs —
 *
 *    "Is this closeout-index-trend follow-up loop CLOSED OUT — the action-plan receipt completed and the supplied
 *     related records coherent — or is it still OPEN, INCOMPLETE, BLOCKED, or untrustworthy (INVALID)?"
 *
 * — as a bounded closeout verdict (`closed` / `open` / `incomplete` / `blocked` / `invalid`), a bounded primary-receipt
 * summary, a bounded related-record checklist (which records were supplied, coherent, contradictory, advisory, or
 * blocking), a bounded source-chain posture, a bounded rationale + next actions, and a content-free receipt — and it
 * FAILS CLOSED when the primary receipt cannot be trusted or a required related record is absent.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it composes:
 *  - Every load-bearing token here is a bounded enum — a closeout verdict, a source state, a related-record kind / state /
 *    signal, a reason id, a next-action id, plus the surfaced upstream receipt verdict / plan class / plan verdict / trend
 *    verdict / index verdict — never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte,
 *    raw ref, raw label, raw note, reviewer identity, commit URL, digest, or timestamp from any ingested record. The only
 *    non-enum values are small integer counts, booleans, an ISO stamp, and app-authored prose. It accepts NO free-form
 *    note or actor name.
 *  - It never copies a free-text field out of any ingested record (even records the prior phases produced are UNTRUSTED
 *    input here); it reduces every record to bounded enums, small integers, and booleans, it never echoes any record's OWN
 *    stamp (the closeout carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a `closed` closeout. `closed` REQUIRES a usable primary receipt whose OWN verdict is `completed`
 *    AND every supplied related record coherent; a missing / unreadable / tampered / wrong-schema receipt (or a receipt
 *    whose own verdict is `invalid`) is `invalid`; a `blocked` receipt, a contradictory / tampered / unreadable related
 *    record, or a blocked source chain is `blocked`; a receipt whose own verdict is `incomplete`, a missing required
 *    related record, or an insufficient source chain is `incomplete`; a `followup-open` receipt or an advisory source
 *    chain is `open`; and `--strict-open` escalates an open closeout to `blocked`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT an approval / sign-off, and NOT a deployment / promotion ledger. It PROVES
 * nothing the composed records do not already prove; it RECORDS whether the follow-up loop reads as closed. Its authored
 * caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_CAVEATS})
 * say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/types";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/types";

/** The schema tag every closeout result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/1" as const;

/** The upstream document schemas the closeout composes. Re-exported so the result can pin its input shapes. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
};

/** Stable identity of the release-decision-closeout-…-finalize-index-trend-closeout — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout";
/** Bump when the closeout surface, the verdict ladder, the reason / signal sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_POLICY_VERSION = 1;

/** The upstream enums the closeout surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
};

/**
 * The bounded coverage state of the ONE ingested primary receipt document (MY trust in the RECEIPT, distinct from the
 * receipt's OWN verdict about the plan it receipted):
 *  - `unreadable` — supplied but not read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1`
 *                   (never echoed). A missing / unusable receipt: there is nothing trustworthy to close out (⇒ `invalid`);
 *  - `tampered`   — recognized as a receipt but its recorded decision does NOT re-derive from the source facets it
 *                   recorded (a hand-flipped verdict / ack coverage / exit code) — an untrustworthy receipt (⇒ `invalid`);
 *  - `usable`     — recognized AND self-consistent (its recorded receipt decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SOURCE_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SOURCE_STATES)[number];

/**
 * The bounded **related-record kinds** the closeout can compose alongside the primary receipt — the closed set of
 * OPTIONAL upstream records a governance review may already have on hand:
 *  - `plan`  — the `…-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1` follow-up plan the receipt receipted (a
 *              cross-check);
 *  - `trend` — the `…-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1` trend the plan planned over (a cross-check).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS = [
  "plan",
  "trend",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS)[number];

/**
 * The bounded coverage state of ONE related record (MY trust in that record):
 *  - `absent`     — not supplied (nothing to compose);
 *  - `unreadable` — supplied but not recognized as a document of its expected schema (never echoed);
 *  - `tampered`   — recognized but its recorded decision does NOT re-derive (an untrustworthy record ⇒ `blocked`);
 *  - `usable`     — recognized AND self-consistent: its bounded facts are trustworthy for the cross-check / posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_STATES = [
  "absent",
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_STATES)[number];

/**
 * The bounded **signal** a usable related record contributes to the closeout — how it relates to the primary receipt:
 *  - `coherent`      — a cross-check record (`plan` / `trend`) AGREES with what the receipt recorded. It supports the
 *                      closeout;
 *  - `contradictory` — a cross-check record (`plan` / `trend`) DISAGREES with what the receipt recorded (the supplied
 *                      record is not the one this receipt's chain was built from, or one was edited) ⇒ `invalid`;
 *  - `none`          — no signal (the record is `absent` / `unreadable` / `tampered`; its state carries that).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RELATION_SIGNALS = [
  "coherent",
  "contradictory",
  "none",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRelationSignal =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RELATION_SIGNALS)[number];

/**
 * The single closeout verdict a governance reviewer keys on — the answer to "is the loop closed out?":
 *  - `closed`     — the primary receipt is usable and its OWN verdict is `completed`, and every supplied related record is
 *                   coherent (no contradiction / tamper). The follow-up loop reads as closed out on THIS host. It
 *                   authorizes NOTHING; it is not sign-off, approval, or promotion;
 *  - `open`       — the primary receipt's OWN verdict is `followup-open` (an advisory follow-up still open). Not a hard
 *                   block — track it to closure;
 *  - `incomplete` — the primary receipt's OWN verdict is `incomplete`, OR a required related record is absent. A coverage
 *                   gap: supply the missing evidence and re-run;
 *  - `blocked`    — the primary receipt's OWN verdict is `blocked`, OR `--strict-open` escalated an open closeout. Do NOT
 *                   treat the loop as closed;
 *  - `invalid`    — the primary receipt is missing / unreadable / tampered / wrong-schema OR its OWN verdict is `invalid`,
 *                   OR a supplied cross-check record contradicts it / is tampered / is unreadable (an incoherent chain) —
 *                   there is no trustworthy, coherent chain to close out. Recover a valid chain and re-run.
 *
 * These are the exact bounded values the run-level
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_trend_closeout_total` metric carries as
 * its `verdict` label; all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS = [
  "closed",
  "open",
  "incomplete",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-evidence suite:
 *  - `0` CLOSED     — a `closed` closeout (the receipt completed and the supplied related records are coherent);
 *  - `1` USAGE      — the CLI was misused (a bad flag, no receipt supplied, or an unwritable output). CLI-owned; a
 *                     closeout RUN never resolves to it;
 *  - `2` INCOMPLETE — an `incomplete` closeout (an incomplete receipt, or a missing required related record);
 *  - `3` OPEN       — an `open` closeout (a followup-open receipt);
 *  - `4` BLOCKED    — a `blocked` closeout (a blocked receipt, or a `--strict-open` escalation of an open closeout);
 *  - `4` INVALID    — an `invalid` closeout (a missing / unreadable / tampered / wrong-schema receipt, an invalid receipt
 *                     verdict, or a contradictory / tampered / unreadable related record — an incoherent chain).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT = {
  CLOSED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  OPEN: 3,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT];

/**
 * The severity each fired reason maps onto, with precedence `invalid > blocking > open > incomplete > informational`
 * (checked in that order — higher is worse, and the run's exit code follows the worst fired severity):
 *  - `informational` — a benign closeout marker (the receipt completed / a related record is coherent) ⇒ `closed`;
 *  - `incomplete`    — a coverage gap (an incomplete receipt, or a missing required record) ⇒ exit 2;
 *  - `open`          — an advisory follow-up remains open ⇒ exit 3;
 *  - `blocking`      — the receipt's OWN verdict is blocked, or a follow-up was strict-escalated ⇒ exit 4;
 *  - `invalid`       — the primary receipt itself is untrustworthy (missing / unreadable / tampered / wrong-schema) or its
 *                      own verdict is `invalid`, or a supplied related record contradicts the receipt / is tampered / is
 *                      unreadable (an incoherent chain) ⇒ exit 4.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the closeout resolved as it did, emitted in this stable order (a
 * superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity + detail are
 * authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL}:
 *
 * Invalid (no trustworthy, coherent chain to close out):
 *  - `receipt-unreadable`       — the primary receipt is missing / unreadable / wrong-schema;
 *  - `receipt-tampered`         — the primary receipt is recognized but its recorded decision does NOT re-derive;
 *  - `receipt-invalid`          — the primary receipt's OWN verdict is `invalid`;
 *  - `plan-contradiction`       — a supplied usable plan disagrees with the plan the receipt receipted;
 *  - `trend-contradiction`      — a supplied usable trend disagrees with the plan's recorded source-trend verdict;
 *  - `related-tampered`         — a supplied related record is recognized but self-inconsistent (an untrustworthy chain);
 *  - `related-unreadable`       — a supplied related record could not be read / recognized as its expected schema.
 *
 * Blocking (do NOT treat the loop as closed):
 *  - `receipt-blocked`          — the primary receipt's OWN verdict is `blocked`;
 *  - `strict-open-escalation`   — `--strict-open` escalated an otherwise-open closeout to a hard block.
 *
 * Open (an advisory follow-up remains open):
 *  - `receipt-followup-open`    — the primary receipt's OWN verdict is `followup-open`.
 *
 * Incomplete (a coverage gap):
 *  - `receipt-incomplete`       — the primary receipt's OWN verdict is `incomplete`;
 *  - `required-record-missing`  — a `--require-*` related record was required but is absent.
 *
 * Informational (a benign closeout marker):
 *  - `receipt-completed`        — the primary receipt's OWN verdict is `completed`;
 *  - `plan-coherent`            — a supplied plan agrees with the receipt (or no direct cross-check applied);
 *  - `trend-coherent`           — a supplied trend agrees with the receipt (or no direct cross-check applied).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_IDS = [
  // Invalid
  "receipt-unreadable",
  "receipt-tampered",
  "receipt-invalid",
  "plan-contradiction",
  "trend-contradiction",
  "related-tampered",
  "related-unreadable",
  // Blocking
  "receipt-blocked",
  "strict-open-escalation",
  // Open
  "receipt-followup-open",
  // Incomplete
  "receipt-incomplete",
  "required-record-missing",
  // Informational
  "receipt-completed",
  "plan-coherent",
  "trend-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_IDS)[number];

/**
 * The bounded **next-action ids** — the closed, ordered archive / follow-up checklist a reviewer works after reading the
 * closeout. Emitted deduped, in this canonical order; each is authored prose (see
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_DETAIL}).
 * The closeout NEVER performs any of these — it only records that they remain the operator's / CI's / legal's job:
 *  - `recover-valid-receipt`        — recover an untampered, valid primary receipt (an `invalid` closeout);
 *  - `reconcile-blocked-receipt`    — resolve the receipt's own block before relying on this closeout;
 *  - `recover-related-record`       — recover an untampered / readable related record;
 *  - `reconcile-contradiction`      — supply the matching plan / trend the receipt's chain was built from;
 *  - `review-strict-open`           — review the `--strict-open` escalation (or drop the flag if open is acceptable);
 *  - `close-open-followup`          — track the open follow-up to closure and re-run;
 *  - `supply-required-record`       — supply the missing required related record;
 *  - `complete-evidence`            — complete the incomplete receipt;
 *  - `archive-closeout`             — archive this content-free closeout (and the underlying records) as CI artifacts;
 *  - `record-governance-out-of-band`— record the audit trail / approval / signature / promotion in their own systems.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_IDS = [
  "recover-valid-receipt",
  "reconcile-blocked-receipt",
  "recover-related-record",
  "reconcile-contradiction",
  "review-strict-open",
  "close-open-followup",
  "supply-required-record",
  "complete-evidence",
  "archive-closeout",
  "record-governance-out-of-band",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutNextActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Ingested facts + result shapes
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable primary
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` (its decision
 * re-derived in ingest). Every field is trusted only when the receipt re-derived; surfaced content-free.
 */
export interface CloseoutReceiptFacts {
  /** The receipt's final verdict (trusted — the receipt re-derived its own decision). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict;
  /** The receipt's resolved plan class, or `null` when the receipt's own plan was not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** The plan verdict the receipt receipted (its plan's trusted verdict), or `null` when that plan was not usable. */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict | null;
  /** The plan's source-trend verdict the receipt recorded, or `null` when not available. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture the receipt recorded, or `null` when not available. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The plan's urgency the receipt recorded (surfaced context), or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency | null;
  /** The plan's coarse action class the receipt recorded (surfaced context), or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass | null;
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
  /** The related record's own bounded primary token (a plan / trend / index verdict), or `null`. */
  readonly verdict:
    | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict
    | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict
    | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict
    | null;
  /** The plan's resolved class (only for a `plan` record; `null` otherwise). */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** The plan's urgency (only for a `plan` record; `null` otherwise). */
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency | null;
  /** The plan's coarse action class (only for a `plan` record; `null` otherwise). */
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass | null;
  /** The plan's source-trend verdict (only for a `plan` record; `null` otherwise). */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture (only for a `plan` record; `null` otherwise). */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
}

/** One entry in the bounded related-record checklist — a kind + its coverage state, required flag, signal, and verdict. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRelatedRecord {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind;
  /** True iff this record was made REQUIRED by a `--require-<kind>` flag. */
  readonly required: boolean;
  /** MY coverage state of the supplied record. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordState;
  /** The bounded signal this record contributes to the closeout (`none` when not usable). */
  readonly signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRelationSignal;
  /**
   * The record's OWN bounded primary token (a plan / trend / index verdict), or `null` when not usable / absent.
   * Content-free (always a bounded enum). For a `tampered` cross-check record it is `null` (its claim is not surfaced, to
   * keep the checklist bounded).
   */
  readonly verdict:
    | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict
    | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict
    | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict
    | null;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy {
  /** True iff `--strict-open` was set (an open closeout escalates to `blocked`). */
  readonly strictOpen: boolean;
  /** Which related records were made REQUIRED (a `--require-<kind>` flag each). */
  readonly require: {
    readonly plan: boolean;
    readonly trend: boolean;
  };
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One entry in the bounded next-action checklist — an id + its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutNextAction {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutNextActionId;
  /** Bounded, app-authored guidance (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The bounded primary-receipt summary the result records — what the closeout composed, content-free. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPrimaryReceipt {
  /** MY coverage state of the ingested primary receipt document. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  /**
   * The receipt's OWN verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * receipt it is the untrusted CLAIMED verdict (surfaced so the closeout shows what was asserted).
   */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  /** The receipt's resolved plan class (a bounded enum), or `null` when not usable / the receipt's plan was not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** The plan verdict the receipt receipted (a bounded enum), or `null` when not usable. */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict | null;
  /** The plan's source-trend verdict the receipt recorded (a bounded enum), or `null` when not usable / not available. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture (a bounded enum), or `null` when not usable / not available. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  /** The plan's urgency the receipt recorded (a bounded enum), or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanUrgency | null;
  /** The plan's coarse action class the receipt recorded (a bounded enum), or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanActionClass | null;
  /** How many of the receipted plan's actions were must-complete-before-release (`0` when not usable). */
  readonly blockingActions: number;
  /** How many of the receipted plan's actions were recommended follow-ups (`0` when not usable). */
  readonly advisoryActions: number;
  /** True iff the receipted plan was produced under `--strict` (context; `false` when not usable). */
  readonly planStrict: boolean;
  /** How many acknowledgements the receipt's plan class required (`0` when not usable). */
  readonly acksRequired: number;
  /** How many of the required acknowledgements the receipt recorded as satisfied (`0` when not usable). */
  readonly acksSatisfied: number;
  /** How many required acknowledgements the receipt recorded as missing (`0` when not usable). */
  readonly acksMissing: number;
  /** True iff the receipt was produced under `--strict-open` (context; `false` when not usable). */
  readonly receiptStrictOpen: boolean;
}

/** The bounded source-chain posture summary — the upstream the receipt was built on + the supplied window's posture. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceChain {
  /** The trend verdict the receipt's plan recorded as its source (a bounded enum), or `null` when not available. */
  readonly receiptTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** The newest finalize-index posture the receipt's plan recorded (a bounded enum), or `null` when not available. */
  readonly receiptLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
}

/** The composite closeout decision — the single verdict + exit code + coverage a reviewer acts on. THE TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutCoverage {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutExitCode;
  /** True iff `verdict === "closed"`. */
  readonly closed: boolean;
  /** MY coverage state of the ingested primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  /** The receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  /** The receipt's resolved plan class, or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId[];
  /** How many fired reasons were invalid (an untrustworthy primary receipt). */
  readonly invalid: number;
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
  /** How many supplied related records were blocking (tampered, unreadable, or a blocked source chain). */
  readonly relatedBlocking: number;
  /** The required related-record kinds that are still missing (`required && absent`). */
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind[];
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an open closeout to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "open" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream schemas). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_POLICY_VERSION;
  readonly receiptSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_SCHEMA;
  readonly planSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_SCHEMA;
  readonly trendSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "is this loop closed out,
 * and how" for a SIEM / review record. Bounded enums + small integers + a stable policy id + the run's own stamp + a
 * disclosure statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutExitCode;
  /** MY coverage state of the ingested primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  /** The receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  /** The receipt's resolved plan class, or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** How many related records were supplied. */
  readonly relatedSupplied: number;
  /** How many supplied related records were coherent. */
  readonly relatedCoherent: number;
  /** How many supplied related records contradicted the receipt. */
  readonly relatedContradictory: number;
  /** How many supplied related records were blocking (tampered, unreadable, or a blocked source chain). */
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
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy;
  /** The single closeout verdict a reviewer keys on. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict;
  /** The process exit code (mirrors `coverage.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutExitCode;
  /** The bounded primary-receipt summary the closeout composed. */
  readonly primaryReceipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPrimaryReceipt;
  /** The bounded related-record checklist (one entry per kind, in canonical order). */
  readonly related: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRelatedRecord[];
  /** The bounded source-chain posture summary. */
  readonly sourceChain: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceChain;
  /** The composite closeout coverage (verdict + exit + reasons + related coverage + strict flags). The TOP-LEVEL rollup. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutCoverage;
  /** Every fired reason, in canonical reason-id order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReason[];
  /** The bounded, ordered archive / follow-up next-action checklist. */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutNextAction[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReceipt;
}

/** The process exit code for a closeout result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult,
): number {
  return result.coverage.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
  string
> = {
  closed:
    "CLOSED: the primary action-plan execution receipt is usable and its own verdict is COMPLETED, and every supplied related record (plan / trend) is coherent — the closeout-index-trend follow-up loop reads as closed out on THIS host. This closeout authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  open: "OPEN: the primary receipt's own verdict is FOLLOWUP-OPEN (an advisory follow-up still open). Track the follow-up to closure and re-run; this is not a hard block, but the loop is not closed out either.",
  incomplete:
    "INCOMPLETE: the primary receipt's own verdict is INCOMPLETE, or a required related record is absent. Supply the missing evidence and re-run before treating the loop as closed. This is a coverage gap, not a block.",
  blocked:
    "BLOCKED: the primary receipt's own verdict is BLOCKED, OR `--strict-open` escalated an OPEN closeout (a followup-open receipt) to a hard block. Do NOT treat the loop as closed; resolve the receipt's block or track the open follow-up to closure before relying on this closeout.",
  invalid:
    "INVALID: the primary action-plan execution receipt is missing / unreadable / tampered / wrong-schema or its own verdict is INVALID, OR a supplied related record contradicts the receipt / is tampered / is unreadable (an incoherent chain) — there is no trustworthy, coherent chain to close out. Recover a valid receipt produced by worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt (and the matching related records) and re-run.",
};

/**
 * The dedicated headline for a `blocked` closeout produced ONLY because `--strict-open` escalated an open closeout — the
 * receipt itself was neither tampered nor blocked, so the generic headline would misrepresent the cause.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_STRICT_OPEN_ESCALATED_SUMMARY =
  "BLOCKED (--strict-open): the only concern is an OPEN closeout (a followup-open receipt), and `--strict-open` escalates any open closeout to a hard block — a `closed or blocked` gate for a high-assurance review. Without the flag this would be OPEN. The primary receipt itself is neither tampered nor blocked, and no related record contradicts it.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId,
  {
    readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSeverity;
    readonly detail: string;
  }
> = {
  "receipt-unreadable": {
    severity: "invalid",
    detail:
      "The supplied primary receipt could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` (wrong schema or unparseable — never echoed). There is no trustworthy receipt to close out; recover a valid receipt produced by `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt` and re-run.",
  },
  "receipt-tampered": {
    severity: "invalid",
    detail:
      "The supplied primary receipt is a recognized action-plan execution receipt whose recorded decision (verdict / exit code / acknowledgement coverage) does NOT re-derive from the source facets it recorded — a hand-edited or corrupt receipt. Recover the untampered receipt from your CI archive; an untrustworthy receipt cannot close out the loop.",
  },
  "receipt-invalid": {
    severity: "invalid",
    detail:
      "The primary receipt's OWN verdict is `invalid` — the plan it receipted was missing / unreadable / tampered / wrong-schema, so the receipt could not trust it. There is no trustworthy chain to close out; recover a valid plan, re-run the receipt, and re-run this closeout.",
  },
  "receipt-blocked": {
    severity: "blocking",
    detail:
      "The primary receipt's OWN verdict is `blocked` — the plan it receipted was an unacknowledged block / strict-escalated / contradictory. The action-plan follow-up was not closed out, so the loop is NOT closed. Resolve the receipt's block (recover a valid plan / supply the correct acknowledgement) and re-run before relying on this closeout.",
  },
  "plan-contradiction": {
    severity: "invalid",
    detail:
      "A supplied `…-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1` plan is usable but its trusted facts (verdict / class / urgency / action class / source-trend verdict / latest index) DISAGREE with the plan the primary receipt receipted. The supplied plan is not the one this receipt's chain was built from (or one was edited): the records are inconsistent. Supply the matching plan and re-run; a cross-check mismatch fails closed as INVALID.",
  },
  "trend-contradiction": {
    severity: "invalid",
    detail:
      "A supplied `…-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1` trend is usable but its trusted verdict DISAGREES with the source-trend verdict the plan (via the receipt) recorded. The supplied trend is not the one this chain was built from (or one was edited): the records are inconsistent. Supply the matching trend and re-run; a cross-check mismatch fails closed as INVALID.",
  },
  "related-tampered": {
    severity: "invalid",
    detail:
      "A supplied related record (plan / trend) is a recognized document of its schema whose recorded decision does NOT re-derive from its own recorded facts — a hand-edited or corrupt record. An untrustworthy record in the chain fails closed as INVALID: recover the untampered record from your CI archive and re-run.",
  },
  "related-unreadable": {
    severity: "invalid",
    detail:
      "A supplied related record (a `--plan` / `--trend` path) could not be read / recognized as a document of its expected schema (never echoed). A record you pointed at that cannot be validated fails closed as INVALID: recover a valid record and re-run, or drop the flag if the record is not available for this review.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and the closeout would otherwise be OPEN (a followup-open receipt), so the policy escalates it to a hard block — a `closed or blocked` gate for a high-assurance review. Close the open follow-up (or drop `--strict-open` if an open closeout is acceptable for this review) before treating the loop as closed.",
  },
  "receipt-followup-open": {
    severity: "open",
    detail:
      "The primary receipt's OWN verdict is `followup-open` — the plan it receipted was reviewed but an advisory follow-up (a monitor / investigate plan) remains open (its follow-up acknowledgement is absent). Track the follow-up to closure, re-run the receipt, and re-run this closeout; this is not a hard block, but the loop is not closed out.",
  },
  "receipt-incomplete": {
    severity: "incomplete",
    detail:
      "The primary receipt's OWN verdict is `incomplete` — a required acknowledgement was absent for its plan class. The action-plan follow-up was not fully exercised, so the loop is not closed out. Supply the missing acknowledgement, re-run the receipt, and re-run this closeout.",
  },
  "required-record-missing": {
    severity: "incomplete",
    detail:
      "A related record was made REQUIRED by a `--require-<kind>` flag but is absent. A required-record coverage gap is never a `closed` closeout: supply the required plan / trend record and re-run.",
  },
  "receipt-completed": {
    severity: "informational",
    detail:
      "The primary receipt is usable and its OWN verdict is `completed` — the action-plan follow-up was closed out on the receipt's host. This is the load-bearing marker for a `closed` closeout (provided every supplied related record is coherent); it records a bounded execution close-out, not an approval or a promotion.",
  },
  "plan-coherent": {
    severity: "informational",
    detail:
      "A supplied `…-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1` plan is usable and its trusted facts AGREE with the plan the primary receipt receipted (or the receipt recorded no usable plan to cross-check against, so no contradiction is possible). The plan supports the closeout as a cross-check.",
  },
  "trend-coherent": {
    severity: "informational",
    detail:
      "A supplied `…-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1` trend is usable and its trusted verdict AGREES with the source-trend verdict the plan (via the receipt) recorded (or the receipt recorded no source-trend verdict to cross-check against). The trend supports the closeout as a cross-check.",
  },
};

/** Per-next-action authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutNextActionId,
  string
> = {
  "recover-valid-receipt":
    "Recover an untampered, valid `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` from your CI archive and re-run this closeout; the supplied receipt could not be trusted.",
  "reconcile-blocked-receipt":
    "Resolve the primary receipt's own block (recover a valid plan / supply the correct acknowledgement, re-run the receipt) before treating the loop as closed.",
  "recover-related-record":
    "Recover the untampered / readable related record you pointed at (or drop its flag if it is not available for this review) and re-run.",
  "reconcile-contradiction":
    "Supply the matching plan / trend the receipt's chain was actually built from — a cross-check mismatch means the supplied record is not this chain's record.",
  "review-strict-open":
    "Review the `--strict-open` escalation: close the open follow-up, or drop `--strict-open` if an open closeout is acceptable for this review.",
  "close-open-followup":
    "Track the open advisory follow-up to closure, re-run the underlying receipt, and re-run this closeout.",
  "supply-required-record":
    "Supply the missing required related record (a `--require-<kind>` flag made it mandatory) and re-run.",
  "complete-evidence":
    "Complete the incomplete receipt (supply the missing acknowledgement upstream) and re-run.",
  "archive-closeout":
    "Archive this content-free closeout (and the underlying receipt + plan + trend records) as CI artifacts; it is a summary, not a substitute for the records it composes.",
  "record-governance-out-of-band":
    "Record the legal audit trail, obtain the external approval / signature, prove reviewer identity, file any incident record, and promote a deployment in their OWN systems — this offline closeout performs none of them.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this closeout is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_DISCLOSURE =
  "This is a content-free operational closeout SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced action-plan execution receipt plus optional previously produced related records and records whether the closeout-index-trend follow-up loop reads as closed out; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The closeout COMPOSES previously produced
 * records and must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT BUNDLE: it INGESTS ONE content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` document a release pipeline produced (REQUIRED), plus OPTIONAL previously produced related records (the `…-action-plan/1` plan and the `…-closeout-index-trend/1` trend), RE-VALIDATES the primary receipt against ITSELF, CROSS-CHECKS the supplied related records against what the receipt recorded, and records whether the follow-up loop reads as closed out. It is a content-free operational closeout SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt / governance / finalize / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, archives, deletes, prunes, uploads, or mutates any receipt, plan, trend, record, index, artifact, object, or deployment. A `closed` closeout authorizes nothing; it only records that the content-free records supplied on THIS host read as a closed-out follow-up loop.",
  "A `closed` closeout REQUIRES a usable primary receipt whose OWN verdict is `completed` AND every supplied related record coherent. It FAILS CLOSED: a missing / unreadable / tampered / wrong-schema receipt (or a receipt whose own verdict is `invalid`), a supplied cross-check record that contradicts the receipt, or a tampered / unreadable related record is `invalid`; a receipt whose own verdict is `blocked` (or a `--strict-open` escalation of an open closeout) is `blocked`; a receipt whose own verdict is `incomplete` or a missing required related record is `incomplete`; a receipt whose own verdict is `followup-open` is `open`. It never fabricates a `closed` closeout from an untrusted receipt or an inconsistent chain.",
  "It re-validates the primary receipt by RECONSTRUCTING its bounded Phase 93 decision from the source facets the receipt recorded (reusing the Phase 93 `computeReceipt` reducer) and requiring the recorded receipt verdict / exit code / acknowledgement coverage to re-derive, treating any disagreement as a TAMPER (`invalid`); it re-validates each supplied related record against ITSELF the same way (reusing that phase's ingest boundary). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the closeout proves neither authorship nor approval, and a set of fully self-consistent fabricated records is out of its scope.",
  "It records only bounded enums, small counts, booleans, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes any ingested record's own stamp, and it never echoes an input file path, even on an error. It accepts NO free-form note or actor name.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it archives, deletes, uploads, promotes, approves, or mutates nothing.",
];
