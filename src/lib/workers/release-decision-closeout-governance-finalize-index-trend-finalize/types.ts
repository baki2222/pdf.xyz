/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index trend
 * FINALIZATION record** (Phase 79).
 *
 * Phases 74–78 built the release-decision closeout-governance FINALIZE-INDEX-TREND follow-up loop, one rung per phase: the
 * FINALIZATION bundle (`pdfxyz.release-decision-closeout-governance-finalize/1`, Phase 74) finalizes one closeout-governance
 * chain; the FINALIZE INDEX (`pdfxyz.release-decision-closeout-governance-finalize-index/1`, Phase 75) re-verifies a ledger
 * of those finalization bundles into a bounded index posture; the FINALIZE-INDEX TREND
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend/1`, Phase 76) summarizes a window of those indices into
 * an arc verdict; the finalize-index-trend ACTION PLAN
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1`, Phase 77) translates the trend verdict
 * into an operator follow-up plan; and the finalize-index-trend action-plan EXECUTION RECEIPT
 * (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1`, Phase 78) records whether that
 * plan's required follow-ups were acknowledged / executed.
 *
 * This phase FINALIZES the whole finalize-index-trend follow-up loop. It INGESTS a REQUIRED Phase 78
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` PRIMARY receipt (the final,
 * most-derived follow-up signal) plus, optionally, the source-chain records the receipt's loop was built from — the
 * follow-up PLAN (Phase 77), the finalize-index TREND (Phase 76), the finalize INDEX (Phase 75), and the FINALIZATION
 * bundle (Phase 74) — RE-VALIDATES EACH supplied record against ITSELF through the existing Phase 74–78 boundaries (so a
 * hand-flipped verdict / ack coverage / exit code is caught as a tamper), CROSS-CHECKS the supplied plan / trend / index /
 * finalization against what its downstream record recorded (so a swapped or edited record is caught as a contradiction),
 * folds every supplied source-chain record's own bounded posture, and rolls them into ONE stable, content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` record a governance review archives as the
 * FINAL record for the follow-up loop —
 *
 *    "Given the content-free finalization-index trend follow-up receipt and optional source-chain records, is this
 *     follow-up loop finalized, open, incomplete, blocked, or untrustworthy?"
 *
 * — with a bounded finalization verdict, a per-source posture, a source-chain checklist, a bounded next-action list, and a
 * content-free receipt, and it FAILS CLOSED when the primary receipt cannot be trusted or a supplied record contradicts /
 * blocks the loop.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it composes:
 *  - Every load-bearing token here is a bounded enum — a source id, a coverage state, a relation signal, a finalization
 *    verdict, a severity, a reason id, a next-action id, plus the surfaced upstream receipt / plan / trend / index /
 *    finalization verdict — never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte, raw
 *    ref, raw label, raw note, reviewer identity, commit URL, digest, or timestamp from an ingested record. The only
 *    non-enum values are small integer counts, booleans, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested record (each — even one Phase 74–78 produced — is UNTRUSTED
 *    input here); it reduces every fact to a bounded enum, a small integer, or a boolean, it never echoes an ingested
 *    record's OWN stamp (the record carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a `finalized`. A `finalized` record REQUIRES a usable primary receipt whose OWN verdict is
 *    `completed` AND every supplied source-chain record coherent (no contradiction, no tamper, no open / insufficient /
 *    blocked posture): an unreadable / tampered / wrong-schema primary receipt is FINALIZE-INVALID (never a vacuous
 *    finalized); a tampered supplied source is FINALIZE-INVALID; a contradiction or a blocked / invalid receipt is
 *    FINALIZE-BLOCKED (fail-closed).
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT an approval / sign-off, and NOT a deployment / promotion ledger. It PROVES
 * nothing the composed records do not already prove; it FINALIZES their content-free outputs for a governance review,
 * RE-VALIDATES each one's self-consistency + chain coherence, and rolls them into one finalization posture. Its authored
 * caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CAVEATS}) say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-action-plan/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-action-receipt/types";

/** The schema tag every finalize-index-trend-finalize result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1" as const;

/** The upstream document schemas the record ingests. Re-exported so the result can pin each input shape. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
};

/** Stable identity of the release-decision-closeout-governance-finalize-index-trend-finalize record — for docs / receipts. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize";
/** Bump when the surface, the verdict ladder, the reason / signal / next-action sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION = 1;

/** The upstream enums the record surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
};

/**
 * The bounded coverage state of the ONE ingested primary receipt document (MY trust in the RECEIPT, distinct from the
 * receipt's OWN verdict about the plan it receipted):
 *  - `unreadable` — supplied but not read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` (never echoed). A
 *                   missing / unusable / wrong-schema primary receipt: there is nothing trustworthy to finalize (⇒
 *                   `finalize-invalid`, never a vacuous `finalized`);
 *  - `tampered`   — recognized as a receipt but its recorded decision does NOT re-derive from the source facets it
 *                   recorded (a hand-flipped verdict / ack coverage / exit code) — an untrustworthy receipt (⇒
 *                   `finalize-invalid`);
 *  - `usable`     — recognized AND self-consistent (its recorded receipt decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES)[number];

/**
 * The bounded **source-chain record kinds** the record can compose alongside the primary receipt — the closed set of
 * OPTIONAL upstream records a governance review may already have on hand, ordered from the shallowest (nearest the
 * receipt) to the deepest (the finalization bundle itself):
 *  - `plan`         — the Phase 77 `...-finalize-index-trend-action-plan/1` follow-up plan the receipt receipted (a
 *                     cross-check against the plan verdict / urgency / action class the receipt recorded);
 *  - `trend`        — the Phase 76 `...-finalize-index-trend/1` trend the plan folded (a cross-check against the
 *                     source-trend verdict / class / direction the plan, via the receipt, recorded);
 *  - `index`        — the Phase 75 `...-finalize-index/1` finalize-index window upstream (a cross-check against the trend's
 *                     newest-window posture, plus its own bounded posture signal);
 *  - `finalization` — the Phase 74 `...-finalize/1` finalization bundle upstream (a cross-check against the index's newest
 *                     finalization posture, plus its own bounded posture signal).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS = [
  "plan",
  "trend",
  "index",
  "finalization",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS)[number];

/**
 * The bounded coverage state of ONE source-chain record (MY trust in that record):
 *  - `absent`     — not supplied (nothing to compose);
 *  - `unreadable` — supplied but not recognized as a document of its expected schema (never echoed) — a coverage gap;
 *  - `tampered`   — recognized but its recorded decision does NOT re-derive (an untrustworthy record ⇒ `finalize-invalid`);
 *  - `usable`     — recognized AND self-consistent: its bounded verdict is trustworthy for the cross-check / posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_STATES = [
  "absent",
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_STATES)[number];

/**
 * The bounded **signal** a usable source-chain record contributes — how it relates to the loop's finalization posture:
 *  - `coherent`      — the record's cross-check AGREES with what its downstream record recorded AND its own posture is
 *                      clean. It supports the finalization;
 *  - `contradictory` — the record's cross-check DISAGREES with what its downstream record recorded (the supplied record is
 *                      not the one this loop was built from, or one was edited) ⇒ `finalize-blocked`;
 *  - `advisory`      — the record's own posture is advisory / open (a `monitor` plan, a `watch` / `degrading` trend, an
 *                      `index-open` window, a `finalize-open` finalization) — the loop is not cleanly finalized ⇒
 *                      `finalize-open`;
 *  - `insufficient`  — the record's own posture is inconclusive (an `investigate` plan, an `insufficient` trend, an
 *                      `index-incomplete` window, a `finalize-incomplete` finalization) ⇒ `finalize-incomplete`;
 *  - `blocking`      — the record's own posture is blocking (a `block-release` / `invalid` plan, a `blocked` / `invalid`
 *                      trend, an `index-blocked` / `index-invalid` window, a `finalize-blocked` finalization) ⇒
 *                      `finalize-blocked`;
 *  - `none`          — no signal (the record is `absent` / `unreadable` / `tampered`; its state carries that).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RELATION_SIGNALS = [
  "coherent",
  "contradictory",
  "advisory",
  "insufficient",
  "blocking",
  "none",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RELATION_SIGNALS)[number];

/**
 * The single finalization verdict a review / CI keys on — the answer to "is this finalize-index-trend follow-up loop
 * finalized?":
 *  - `finalized`           — the primary receipt is usable and its OWN verdict is `completed`, and every supplied
 *                            source-chain record is coherent (no contradiction / tamper / advisory / insufficiency /
 *                            block). The loop reads as fully finalized on THIS host. It authorizes NOTHING;
 *  - `finalize-incomplete` — the receipt's OWN verdict is `incomplete`, a required source-chain record is absent /
 *                            unreadable, or a supplied source-chain record is inconclusive. A coverage gap: supply the
 *                            missing evidence and re-run;
 *  - `finalize-open`       — a supplied source-chain record's posture is advisory / open (a monitored / degrading loop).
 *                            Not a hard block — track it to closure;
 *  - `finalize-blocked`    — the receipt's OWN verdict is `blocked` or `invalid`, a supplied record CONTRADICTS what its
 *                            downstream record recorded, a supplied source-chain record is blocked, or `--strict-open`
 *                            escalated an open / incomplete-receipt finalization. Do NOT treat the loop as finalized;
 *  - `finalize-invalid`    — the primary receipt is unreadable / tampered / wrong-schema (nothing trustworthy to
 *                            finalize), OR a supplied source-chain record is tampered (an untrustworthy input). Recover a
 *                            trustworthy record before relying on this finalization.
 *
 * These are the exact bounded values the run-level
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_total` metric carries as its `verdict` label;
 * all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS = [
  "finalized",
  "finalize-open",
  "finalize-incomplete",
  "finalize-blocked",
  "finalize-invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-evidence suite:
 *  - `0` FINALIZED  — a usable `completed` receipt and every supplied source-chain record coherent;
 *  - `1` USAGE      — the CLI was misused (a bad flag, no primary receipt supplied, or an unwritable output). CLI-owned; a
 *                     finalize RUN never resolves to it;
 *  - `2` INCOMPLETE — the evidence was insufficient to finalize (an `incomplete` receipt, a required-but-missing record, a
 *                     supplied-but-unreadable record, or an inconclusive source chain);
 *  - `3` OPEN       — an advisory posture (a supplied source-chain record whose own posture is advisory / open);
 *  - `4` BLOCKED    — a blocking posture (a `blocked` / `invalid` receipt verdict, a contradictory record, a blocked
 *                     source chain, or a `--strict-open` escalation);
 *  - `4` INVALID    — the primary receipt cannot be trusted as a document (unreadable / tampered / wrong-schema), or a
 *                     supplied source-chain record is tampered. Shares the top code with BLOCKED but is a distinct verdict.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT = {
  FINALIZED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  OPEN: 3,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeExitCode
> = {
  finalized: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.FINALIZED,
  "finalize-open": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.OPEN,
  "finalize-incomplete": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.INCOMPLETE,
  "finalize-blocked": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.BLOCKED,
  "finalize-invalid": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.INVALID,
};

/**
 * The severity each fired reason maps onto, with precedence `invalid > blocking > incomplete > open > informational`
 * (checked in that order — higher is worse, and the run's verdict follows the worst fired severity). Note INCOMPLETE
 * outranks OPEN here: a coverage gap (a missing required record / incomplete receipt / inconclusive source) is resolved
 * before an advisory open follow-up, even though its exit code (2) is numerically below OPEN's (3):
 *  - `informational` — a benign marker (a completed receipt, a coherent source-chain record);
 *  - `open`          — an advisory follow-up remains open (a monitor plan, a watch / degrading trend, an open window) ⇒
 *                      exit 3;
 *  - `incomplete`    — a coverage gap (an incomplete receipt, a required-but-missing / unreadable record, or an
 *                      inconclusive source chain) ⇒ exit 2;
 *  - `blocking`      — a blocked / invalid receipt verdict, a contradictory record, a blocked source chain, or a
 *                      strict-open escalation ⇒ exit 4;
 *  - `invalid`       — the primary receipt is unreadable / tampered, or a supplied source-chain record is tampered ⇒ exit
 *                      4.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SEVERITIES = [
  "informational",
  "open",
  "incomplete",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the finalization verdict resolved as it did, emitted in this stable
 * order (a superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity +
 * detail are authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL}:
 *
 * Invalid (nothing trustworthy to finalize):
 *  - `receipt-unreadable`        — the supplied primary receipt could not be read / recognized (wrong schema / unparseable);
 *  - `receipt-tampered`          — the primary receipt is recognized but its recorded decision does NOT re-derive;
 *  - `related-tampered`          — a supplied source-chain record is recognized but self-inconsistent (a tamper).
 *
 * Blocking (do NOT treat the loop as finalized):
 *  - `receipt-blocked`           — the primary receipt is usable and its OWN verdict is `blocked`;
 *  - `receipt-invalid`           — the primary receipt is usable and its OWN verdict is `invalid` (its plan was untrusted);
 *  - `plan-contradiction`        — a supplied plan disagrees with what the receipt recorded;
 *  - `trend-contradiction`       — a supplied trend disagrees with what the plan / receipt recorded;
 *  - `index-contradiction`       — a supplied index disagrees with the trend's newest-window posture;
 *  - `finalization-contradiction`— a supplied finalization disagrees with the index's newest finalization posture;
 *  - `source-chain-blocked`      — a supplied source-chain record's own posture is blocking;
 *  - `strict-open-escalation`    — `--strict-open` escalated an otherwise open / incomplete-receipt finalization.
 *
 * Incomplete (a coverage gap):
 *  - `required-record-missing`   — a `--require-<kind>` record is absent or unreadable;
 *  - `receipt-incomplete`        — the primary receipt is usable and its OWN verdict is `incomplete`;
 *  - `related-unreadable`        — a supplied optional source-chain record could not be read / recognized;
 *  - `source-chain-insufficient` — a supplied source-chain record's own posture is inconclusive.
 *
 * Open (an advisory follow-up remains open):
 *  - `source-chain-advisory`     — a supplied source-chain record's own posture is advisory / open.
 *
 * Informational (a benign marker):
 *  - `receipt-completed`         — the primary receipt is usable and its OWN verdict is `completed`;
 *  - `plan-coherent`             — a supplied plan AGREES with what the receipt recorded;
 *  - `trend-coherent`            — a supplied trend AGREES with what the plan / receipt recorded;
 *  - `index-coherent`            — a supplied index AGREES with the trend's newest-window posture;
 *  - `finalization-coherent`     — a supplied finalization AGREES with the index's newest finalization posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_IDS = [
  // Invalid
  "receipt-unreadable",
  "receipt-tampered",
  "related-tampered",
  // Blocking
  "receipt-blocked",
  "receipt-invalid",
  "plan-contradiction",
  "trend-contradiction",
  "index-contradiction",
  "finalization-contradiction",
  "source-chain-blocked",
  "strict-open-escalation",
  // Incomplete
  "required-record-missing",
  "receipt-incomplete",
  "related-unreadable",
  "source-chain-insufficient",
  // Open
  "source-chain-advisory",
  // Informational
  "receipt-completed",
  "plan-coherent",
  "trend-coherent",
  "index-coherent",
  "finalization-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_IDS)[number];

/** The four per-kind contradiction reason ids (a swapped / edited source-chain record). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CONTRADICTION_REASON: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId
> = {
  plan: "plan-contradiction",
  trend: "trend-contradiction",
  index: "index-contradiction",
  finalization: "finalization-contradiction",
};

/** The four per-kind coherence reason ids (a cross-check agreement + a clean posture). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_COHERENT_REASON: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId
> = {
  plan: "plan-coherent",
  trend: "trend-coherent",
  index: "index-coherent",
  finalization: "finalization-coherent",
};

/**
 * The bounded **next-action ids** — the closed set of operator steps the finalization recommends given its verdict, in
 * this canonical order (emitted deduped). Each is a stable id from an authored allowlist — never free-form source text:
 *  - `recover-trusted-receipt`        — the primary receipt is unreadable / tampered; recover a valid Phase 78 receipt;
 *  - `recover-tampered-source`        — a supplied source-chain record is tampered; recover the untampered record;
 *  - `reconcile-contradictory-source` — a supplied record disagrees with the loop; supply the record this loop was built
 *                                       from (or re-run the chain) and re-finalize;
 *  - `investigate-blocked-loop`       — a blocked / invalid receipt or a blocked source chain; investigate before
 *                                       finalizing;
 *  - `resolve-open-followup`          — an advisory / open source posture (or a strict-open escalation); track it to
 *                                       closure and re-run;
 *  - `complete-finalization-evidence` — the receipt is incomplete, or a source chain is inconclusive / unreadable; supply
 *                                       the missing evidence and re-run;
 *  - `supply-required-record`         — a required (`--require-<kind>`) record was not supplied; supply it and re-run;
 *  - `continue-governance-cadence`    — the loop is finalized; keep composing receipts / plans / trends on the cadence;
 *  - `keep-finalize-record`           — keep this content-free record as the local FINAL record for the loop (always).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_IDS = [
  "recover-trusted-receipt",
  "recover-tampered-source",
  "reconcile-contradictory-source",
  "investigate-blocked-loop",
  "resolve-open-followup",
  "complete-finalization-evidence",
  "supply-required-record",
  "continue-governance-cadence",
  "keep-finalize-record",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Bounded reduced facts (all enums / small ints / booleans)
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` (its decision re-derived). */
export interface FinalizeIndexTrendFinalizeReceiptFacts {
  /** The receipt's OWN verdict (trusted — the receipt re-derived its own decision). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict;
  /** The receipt's resolved plan class (surfaced context; `null` when the receipt's own plan verdict was `invalid`). */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The plan verdict the receipt recorded — the anchor the supplied `plan` record is cross-checked against. */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict | null;
  /** The plan urgency the receipt recorded — part of the `plan` cross-check anchor. */
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency | null;
  /** The plan action class the receipt recorded — part of the `plan` cross-check anchor. */
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass | null;
  /** The source-trend verdict the receipt recorded — the anchor the supplied `trend` record is cross-checked against. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict | null;
  /** The plan's newest usable window finalize-index posture the receipt recorded — the `index` cross-check anchor. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  /** MY coverage of the plan the receipt receipted (the receipt's own `source.state`; context for the anchors). */
  readonly receiptSourceState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState;
  /** True iff the receipt was produced under `--strict-open` (context; never re-judged by this record). */
  readonly receiptStrictOpen: boolean;
  /** How many acknowledgements the receipt's plan class required (a bounded count). */
  readonly acksRequired: number;
  /** How many of the required acknowledgements were supplied (a bounded count). */
  readonly acksSatisfied: number;
  /** How many required acknowledgements were still missing (a bounded count). */
  readonly acksMissing: number;
}

/** The bounded verdict a usable source-chain record surfaces — the union of the four source-chain verdict enums. */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordVerdict =
  | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict
  | ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict
  | ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict
  | ReleaseDecisionCloseoutGovernanceFinalizeVerdict;

/**
 * The bounded cross-check facets a usable source-chain record surfaces — a discriminated union keyed by record kind. Only
 * bounded enums the downstream record can be cross-checked against; nothing raw.
 */
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedFacets =
  | {
      readonly kind: "plan";
      readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict;
      readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency;
      readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass;
      readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict | null;
      readonly sourceTrendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass | null;
      readonly sourceArcDirection: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection | null;
      readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
    }
  | {
      readonly kind: "trend";
      readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict;
      readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
      readonly direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection;
      readonly latestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
    }
  | {
      readonly kind: "index";
      readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict;
      readonly latestFinalization: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
    }
  | {
      readonly kind: "finalization";
      readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
    };

/** The bounded primary-receipt summary the result records — what the record finalized over, content-free. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSource {
  /** MY coverage state of the ingested primary receipt document. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  /**
   * The receipt's OWN verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * receipt it is the untrusted CLAIMED verdict (surfaced so the record shows what was asserted).
   */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict | null;
  /** The receipt's resolved plan class (a bounded enum), or `null` when not usable / the receipt's plan was `invalid`. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The plan verdict the receipt recorded (the plan cross-check anchor), or `null` when not usable / not present. */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict | null;
  /** The plan urgency the receipt recorded, or `null` when not usable. */
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanUrgency | null;
  /** The plan action class the receipt recorded, or `null` when not usable. */
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanActionClass | null;
  /** The source-trend verdict the receipt recorded (the trend cross-check anchor), or `null`. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict | null;
  /** The newest usable finalize-index posture the receipt recorded (the index cross-check anchor), or `null`. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  /** MY coverage of the plan the receipt receipted (the receipt's own `source.state`; `null` when not usable). */
  readonly receiptSourceState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState | null;
  /** How many acknowledgements the receipt's plan class required (`0` when not usable). */
  readonly acksRequired: number;
  /** How many of the required acknowledgements were supplied (`0` when not usable). */
  readonly acksSatisfied: number;
  /** How many required acknowledgements were still missing (`0` when not usable). */
  readonly acksMissing: number;
  /** True iff the receipt was produced under `--strict-open` (context; `false` when not usable). */
  readonly receiptStrictOpen: boolean;
}

/** One entry in the bounded source-chain checklist — a kind + required flag + coverage state + relation signal + verdict. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedRecord {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind;
  /** True iff this record was REQUIRED for this run (its `--require-<kind>` flag was set). */
  readonly required: boolean;
  /** MY coverage state of the supplied record. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState;
  /** The bounded relation signal the record contributed (the cross-check / posture outcome). */
  readonly signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal;
  /** The record's OWN verdict (a bounded enum), or `null` when not usable. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordVerdict | null;
}

/** The bounded coverage summary — which sources were supplied and which are trustworthy evidence. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeCoverage {
  /** True iff a usable primary receipt was supplied (the required anchor is present). */
  readonly hasReceipt: boolean;
  /** MY coverage state of the primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  /** How many of the four source-chain records were REQUIRED (`--require-<kind>`) (0–4). */
  readonly requiredRecords: number;
  /** How many of the four OPTIONAL source-chain records were supplied (0–4). */
  readonly suppliedRecords: number;
  /** How many supplied source-chain records are usable (recognized + self-consistent) (0–4). */
  readonly usableRecords: number;
  /** How many REQUIRED source-chain records were absent / unreadable (the required coverage gap) (0–4). */
  readonly missingRecords: number;
  /** How many supplied source-chain records were tampered (0–4). */
  readonly tamperedRecords: number;
  /** How many supplied source-chain records were unreadable (0–4). */
  readonly unreadableRecords: number;
  /** How many usable source-chain records were coherent (cross-check agreement + a clean posture) (0–4). */
  readonly coherentRecords: number;
  /** How many usable source-chain records contradicted the loop (a cross-check mismatch) (0–4). */
  readonly contradictoryRecords: number;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy {
  /** Per-kind `--require-<kind>` flags: the record must be supplied + usable, else the loop is incomplete. */
  readonly require: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind, boolean>;
  /** True iff `--strict-open` was set (escalate an open / incomplete-receipt finalization to `finalize-blocked`). */
  readonly strictOpen: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action, with its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextAction {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite finalization decision — the single verdict + exit code + coverage a review acts on. The TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeExitCode;
  /** True iff `verdict === "finalized"`. */
  readonly finalized: boolean;
  /** MY coverage state of the primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  /** The receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict | null;
  /** The receipt's resolved plan class, or `null` when the receipt is not usable / its plan was `invalid`. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalid: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were incomplete coverage gaps. */
  readonly incomplete: number;
  /** How many fired reasons were open follow-ups. */
  readonly open: number;
  /** How many fired reasons were informational markers. */
  readonly informational: number;
  /** How many of the four source-chain records were supplied. */
  readonly relatedSupplied: number;
  /** How many supplied source-chain records were coherent. */
  readonly relatedCoherent: number;
  /** How many supplied source-chain records contradicted the loop. */
  readonly relatedContradictory: number;
  /** The source-chain record kinds that were required but absent / unreadable, in canonical order. */
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind[];
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an open / incomplete-receipt finalization to `finalize-blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "finalize-open" | "finalize-incomplete" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream document schemas). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION;
  readonly receiptSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA;
  readonly planSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA;
  readonly trendSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_SCHEMA;
  readonly indexSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA;
  readonly finalizationSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this finalization
 * conclude, over what primary receipt, with how many coherent / contradictory records" for a SIEM / governance record.
 * Bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement only; safe to log or
 * forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeExitCode;
  /** MY coverage state of the primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  /** The primary receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict | null;
  /** How many of the four source-chain records were supplied. */
  readonly relatedSupplied: number;
  /** How many supplied source-chain records were coherent. */
  readonly relatedCoherent: number;
  /** How many supplied source-chain records contradicted the loop. */
  readonly relatedContradictory: number;
  readonly invalid: number;
  readonly blocking: number;
  readonly incomplete: number;
  readonly open: number;
  /** True iff `--strict-open` escalated an open / incomplete-receipt finalization to `finalize-blocked`. */
  readonly strictOpenEscalated: boolean;
  /** The bounded, app-authored disclosure statement (what this record is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout governance finalize index trend FINALIZATION record a governance
 * review archives as the FINAL record for the follow-up loop. Every field is a bounded enum, a small integer, a boolean,
 * an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator, size, path, or byte, even from a
 * hostile input, and never echoes an ingested record's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy;
  /** The single finalization verdict a reviewer keys on (mirrors `finalize.verdict`). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict;
  /** The process exit code (mirrors `finalize.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeExitCode;
  /** The bounded coverage summary. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeCoverage;
  /** The bounded primary-receipt summary the record finalized over. */
  readonly source: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSource;
  /** The source-chain checklist, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS} order. */
  readonly related: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedRecord[];
  /** The composite finalization rollup (verdict + exit + reasons + related coverage + strict flags). The TOP-LEVEL rollup. */
  readonly finalize: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextAction[];
  /** The bounded next-action ids only (a compact allowlist view; never derived from an input). */
  readonly nextActionIds: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId[];
  /** Bounded, app-authored guidance (out-of-scope steps this record does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReceipt;
}

/** The process exit code for a finalization result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
): number {
  return result.finalize.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
  string
> = {
  finalized:
    "FINALIZED: the primary finalize-index-trend action-plan execution receipt is usable and COMPLETED, and every supplied source-chain record is coherent (no contradiction, no tamper, no open / insufficient / blocked posture). The finalize-index-trend follow-up loop reads as fully finalized on THIS host. Keep this record as the FINAL record for the loop and continue on your cadence. This record authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  "finalize-open":
    "FINALIZE-OPEN (advisory): no blocker and evidence is sufficient, but a follow-up remains OPEN — a supplied source-chain record's own posture is advisory / open (a monitor plan, a watch / degrading trend, an index-open window, a finalize-open finalization). Track the follow-up to closure and re-run; this is not a hard block, but it is not a fully finalized loop either.",
  "finalize-incomplete":
    "FINALIZE-INCOMPLETE (insufficient): the content-free evidence is INSUFFICIENT to finalize the loop — the primary receipt's OWN verdict is `incomplete`, a required source-chain record is absent / unreadable, a supplied record is unreadable, or a supplied source-chain record is inconclusive. This is a setup / coverage problem, not a finalized loop. Supply the missing evidence and re-run.",
  "finalize-blocked":
    "FINALIZE-BLOCKED: a BLOCKING issue — the primary receipt's OWN verdict is `blocked` or `invalid`, a supplied plan / trend / index / finalization CONTRADICTS what its downstream record recorded, a supplied source-chain record is at a blocking posture, or `--strict-open` escalated an open / incomplete-receipt finalization. Do NOT treat the loop as finalized until the failure is resolved.",
  "finalize-invalid":
    "FINALIZE-INVALID: the primary receipt cannot be trusted as a document — it is missing / unreadable / wrong-schema (nothing trustworthy to finalize) or recognized but TAMPERED (its recorded decision does not re-derive), OR a supplied source-chain record is TAMPERED. Recover a trustworthy `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` (and untampered source-chain records) before relying on this finalization.",
};

/**
 * The dedicated headline for a `finalize-blocked` record produced ONLY because `--strict-open` escalated an open /
 * incomplete-receipt finalization — the primary receipt was neither blocked / invalid nor was any source-chain record
 * contradictory / tampered / blocked, so the generic headline would misrepresent the cause.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_STRICT_OPEN_ESCALATED_SUMMARY =
  "FINALIZE-BLOCKED (--strict-open): the only concern is an OPEN follow-up (an advisory / open source-chain record) or an INCOMPLETE primary receipt, and `--strict-open` escalates either to a hard block — a `finalized or blocked` gate for a high-assurance review. Without the flag this would be FINALIZE-OPEN (exit 3) or FINALIZE-INCOMPLETE (exit 2). No blocked / invalid receipt, contradictory / tampered record, or blocked source chain was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId,
  {
    readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSeverity;
    readonly detail: string;
  }
> = {
  "receipt-unreadable": {
    severity: "invalid",
    detail:
      "The supplied primary receipt could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` (wrong schema or unparseable — never echoed). There is nothing trustworthy to finalize: supply a readable receipt produced by `worker:release-decision-closeout-governance-finalize-index-trend-action-receipt` and re-run. This fails closed to INVALID, never a vacuous finalized.",
  },
  "receipt-tampered": {
    severity: "invalid",
    detail:
      "The supplied primary receipt is a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` whose recorded decision (verdict / ack coverage / exit code / reasons) does NOT re-derive from the source facets it recorded — a hand-edited or corrupt receipt. Recover the untampered receipt from your CI archive; an untrustworthy receipt cannot anchor the FINAL record.",
  },
  "related-tampered": {
    severity: "invalid",
    detail:
      "A supplied source-chain record (plan / trend / index / finalization) is recognized but its recorded decision does NOT re-derive from its own facts — a hand-edited or corrupt record. Recover the untampered record from your CI archive; a tampered source is an untrustworthy input and fails the finalization closed.",
  },
  "receipt-blocked": {
    severity: "blocking",
    detail:
      "The primary receipt is usable and its OWN verdict is BLOCKED: the follow-up plan it receipted was a `block-release` plan (the release stays held), carried a contradictory acknowledgement, or was `--strict-open` escalated. Do NOT treat the loop as finalized — resolve the receipt's blocking condition and re-run.",
  },
  "receipt-invalid": {
    severity: "blocking",
    detail:
      "The primary receipt is usable and its OWN verdict is INVALID: the follow-up plan it receipted was missing / unreadable / tampered, or the plan's own verdict was `invalid` (its source trend was untrustworthy). The loop's follow-up cannot be finalized over an invalid receipt verdict — recover a valid plan, re-run the receipt, and re-finalize.",
  },
  "plan-contradiction": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` (verdict / urgency / action class / source-trend / latest-index) disagrees with what the primary receipt recorded — the supplied plan is not the one this receipt receipted, or one of the two was edited. A contradictory cross-check fails closed: supply the plan this receipt actually receipted, or re-run the chain, and re-finalize.",
  },
  "trend-contradiction": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` (verdict / class / direction) disagrees with the source-trend the plan (via the receipt) recorded — the supplied trend is not the one this loop was built from, or one was edited. A contradictory cross-check fails closed: supply the trend this loop was built from, or re-run the chain, and re-finalize.",
  },
  "index-contradiction": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize-index/1` verdict disagrees with the newest-window finalize-index posture the trend (via the plan / receipt) recorded — the supplied index is not the newest window this loop summarized, or one was edited. A contradictory cross-check fails closed: supply the index this loop was built from and re-finalize.",
  },
  "finalization-contradiction": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize/1` verdict disagrees with the newest finalization posture the index recorded — the supplied finalization bundle is not the newest one this index indexed, or one was edited. A contradictory cross-check fails closed: supply the finalization this loop was built from and re-finalize.",
  },
  "source-chain-blocked": {
    severity: "blocking",
    detail:
      "A supplied source-chain record is at a BLOCKING posture (a `block-release` / `invalid` plan, a `blocked` / `invalid` trend, an `index-blocked` / `index-invalid` window, or a `finalize-blocked` finalization) — the underlying evidence is itself blocked. A blocked source chain fails closed: investigate and resolve the underlying issue before treating the loop as finalized.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and the finalization was otherwise OPEN (an advisory / open source-chain record) or INCOMPLETE because of an `incomplete` primary receipt, so the policy escalates it to a hard block — a `finalized or blocked` gate for a high-assurance review. Close the open follow-up / supply the missing acknowledgement and re-run (or drop `--strict-open` if an open follow-up is acceptable).",
  },
  "required-record-missing": {
    severity: "incomplete",
    detail:
      "A `--require-<kind>` source-chain record was absent or unreadable. The finalization policy requires that record for this review; supply the readable record produced by its worker and re-run.",
  },
  "receipt-incomplete": {
    severity: "incomplete",
    detail:
      "The primary receipt is usable and its OWN verdict is INCOMPLETE: a required bounded acknowledgement was absent for its plan class (the plan was not reviewed, or a monitor / investigation follow-up was not executed). Supply the missing acknowledgement, re-run the receipt, and re-finalize before treating the loop as finalized.",
  },
  "related-unreadable": {
    severity: "incomplete",
    detail:
      "A supplied optional source-chain record could not be read / recognized as a document of its expected schema (wrong schema or unparseable — never echoed), so it contributes no evidence. Supply a readable record produced by its worker and re-run, or omit it.",
  },
  "source-chain-insufficient": {
    severity: "incomplete",
    detail:
      "A supplied source-chain record is at an INCONCLUSIVE posture (an `investigate` plan, an `insufficient` trend, an `index-incomplete` window, or a `finalize-incomplete` finalization) — the underlying evidence was insufficient. Complete the missing evidence, re-run the record, and re-finalize before treating the loop as finalized.",
  },
  "source-chain-advisory": {
    severity: "open",
    detail:
      "A supplied source-chain record is at an ADVISORY / open posture (a `monitor` plan, a `watch` / `degrading` trend, an `index-open` window, or a `finalize-open` finalization) — the underlying evidence has an open follow-up. Track it to closure; this is not a hard block, but the loop is not fully finalized.",
  },
  "receipt-completed": {
    severity: "informational",
    detail:
      "The primary receipt is usable and its OWN verdict is COMPLETED: the follow-up plan's required acknowledgements were all supplied. This is the baseline for a `finalized` loop; the record is finalized unless a supplied source-chain record contradicts / blocks / opens it.",
  },
  "plan-coherent": {
    severity: "informational",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` AGREES with what the primary receipt recorded (a coherent cross-check) and is at a clean posture. It supports the FINAL record.",
  },
  "trend-coherent": {
    severity: "informational",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize-index-trend/1` AGREES with the source-trend the plan (via the receipt) recorded (a coherent cross-check) and is at a clean posture. It supports the FINAL record.",
  },
  "index-coherent": {
    severity: "informational",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize-index/1` AGREES with the newest-window posture the trend recorded (a coherent cross-check) and is at a clean posture. It supports the FINAL record.",
  },
  "finalization-coherent": {
    severity: "informational",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-finalize/1` AGREES with the newest finalization posture the index recorded (a coherent cross-check) and is at a clean posture. It supports the FINAL record.",
  },
};

/** Per-next-action authored detail, keyed by id. Bounded, content-free; never derived from an input. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeNextActionId,
  string
> = {
  "recover-trusted-receipt":
    "Recover a trustworthy primary `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` from your CI archive (or re-run `worker:release-decision-closeout-governance-finalize-index-trend-action-receipt` over a valid plan): a receipt that cannot be read, or whose recorded decision does not re-derive, cannot anchor the FINAL record.",
  "recover-tampered-source":
    "Recover the untampered source-chain record from your CI archive: a recorded verdict / decision that does not re-derive means the record was hand-edited or corrupted, and cannot be finalized into the FINAL record.",
  "reconcile-contradictory-source":
    "A supplied plan / trend / index / finalization disagrees with what its downstream record recorded: supply the record this loop was actually built from, or re-run the chain end-to-end (`worker:release-decision-closeout-governance-finalize` → `-index` → `-index-trend` → `-index-trend-action-plan` → `-index-trend-action-receipt`), and re-finalize so the FINAL record is consistent.",
  "investigate-blocked-loop":
    "Investigate the blocking issue (a `blocked` / `invalid` primary receipt verdict, or a blocked source chain) and resolve the underlying issue before the review finalizes; recover the untampered records from your CI archive if needed.",
  "resolve-open-followup":
    "Resolve the open follow-up (an advisory / open source-chain record, or a `--strict-open` escalation): track the monitor / open item to closure, re-run the affected record, and re-finalize. Keep this record as the record of that decision.",
  "complete-finalization-evidence":
    "Supply the missing / unreadable / incomplete / inconclusive evidence — a readable, completed primary receipt, and the source-chain records it needs — and re-run this record; an incomplete receipt or an inconclusive source chain leaves the loop unfinalized.",
  "supply-required-record":
    "Supply the missing required source-chain record (the one whose `--require-<kind>` flag was set) — a readable `...-action-plan/1` / `...-index-trend/1` / `...-index/1` / `...-finalize/1` — and re-run this record; a required-but-missing record leaves the loop unfinalized.",
  "continue-governance-cadence":
    "The follow-up loop is finalized: keep composing finalize-index-trend receipts / plans / trends / indices per review period and finalizing here on your weekly / monthly cadence. This record authorizes no promotion on its own.",
  "keep-finalize-record":
    "Keep this finalization record (and the underlying primary receipt + source-chain records) as CI artifacts: it is the content-free release-decision-closeout-governance-finalize-index-trend-finalize record for this review. It is NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log; keep each of those in its own dedicated system.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this record is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_DISCLOSURE =
  "This is a content-free operational FINALIZATION record ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced finalize-index-trend action-plan execution receipt (required) plus optional source-chain records, re-validates each against itself, cross-checks the loop, and rolls them into one finalization verdict; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The record FINALIZES the finalize-index-trend
 * follow-up loop's already content-free records for a governance review, RE-VALIDATES each one's self-consistency + chain
 * coherence, and rolls them into one finalization verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE-INDEX-TREND FINALIZATION record: it INGESTS a REQUIRED content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` primary receipt plus, optionally, the source-chain records the receipt's loop was built from (the follow-up plan, the finalize-index trend, the finalize index, and the finalization bundle) a release pipeline produced, RE-VALIDATES each against ITSELF, cross-checks the loop, and folds them into ONE bounded finalization verdict + next-action list. It is local content-free FINALIZATION over evidence records — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / finalize / plan / governance / closeout / receipt itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any record, artifact, object, or deployment. A `finalized` record authorizes nothing; it only records that the content-free records supplied on THIS host read as a coherently finalized loop.",
  "A `finalized` record REQUIRES a usable primary receipt whose OWN verdict is `completed` AND every supplied source-chain record coherent. It FAILS CLOSED: an unreadable / tampered / wrong-schema primary receipt is `finalize-invalid` (nothing trustworthy to finalize); a tampered supplied source is `finalize-invalid`; a supplied record that contradicts what its downstream record recorded is `finalize-blocked`; a `blocked` / `invalid` receipt verdict or a blocked source chain is `finalize-blocked`; a required-but-missing / unreadable record, an `incomplete` receipt, or an inconclusive source chain is `finalize-incomplete`; an advisory / open source chain is `finalize-open`; and `--strict-open` escalates an open / incomplete-receipt finalization to `finalize-blocked`. It never fabricates a `finalized` from an untrusted receipt or a contradictory loop.",
  "It re-validates each ingested record by RECONSTRUCTING its bounded decision from the facts the record recorded and re-running the SAME tested reducer that phase used (the Phase 78 `computeReceipt` for the primary receipt; the Phase 74–77 boundaries for the source-chain records), requiring the recorded verdict / counts / exit code to re-derive, treating any disagreement as a TAMPER. This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the record proves neither authorship nor approval, and a fully self-consistent fabricated record is out of its scope. The cross-checks compare bounded verdict enums across records; they catch a swapped / edited record, not a fully-consistent forgery.",
  "It emits only bounded enums, small counts, booleans, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested record's own stamp, and it never echoes an input file path, even on an error. It accepts NO free-form note or actor name — only bounded record inputs and policy flags.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the record carries but does NOT itself perform — the honest edges of an offline finalization
 * record. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: after the finalize-index-trend follow-up loop produces the ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` receipt (and, on hand, the plan / trend / index / finalization it was built from), hand them here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / invalid record), surface exit 3 (an open follow-up) and exit 2 (an incomplete loop) for review, and treat exit 0 (a finalized loop) as finalized — never as an authorization.",
  "Supply the source-chain records you actually have — each is OPTIONAL, but the more of the chain you supply, the stronger the coherence check: `--plan` / `--trend` / `--index` / `--finalization` are each cross-checked against what their downstream record recorded (a mismatch fails closed) and fold their own bounded posture. Use `--require-plan` / `--require-trend` / `--require-index` / `--require-finalization` to make a record mandatory, and `--strict-open` to escalate an open / incomplete-receipt finalization to a hard block for a high-assurance review.",
  "Archive this record (and the underlying receipt + source-chain records) as CI artifacts: it is a content-free FINAL SUMMARY, not a substitute for the records it composes, nor for your legal audit trail, compliance sign-off, external approval / signing, identity attestation, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this record RECORDS that a content-free finalize-index-trend follow-up loop reads as finalized, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline record never performs.",
];
