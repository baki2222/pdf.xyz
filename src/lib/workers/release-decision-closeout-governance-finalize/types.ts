/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalization bundle**
 * (Phase 74).
 *
 * Phases 69–73 built the release decision CLOSEOUT GOVERNANCE chain, one rung per phase: the governance BUNDLE
 * (`pdfxyz.release-decision-closeout-governance/1`, Phase 69) folds a primary closeout receipt + optional related records
 * into ONE governance verdict; the governance LEDGER INDEX (`pdfxyz.release-decision-closeout-governance-index/1`, Phase
 * 70) re-verifies a ledger of governance bundles into a bounded index posture; the governance INDEX TREND
 * (`pdfxyz.release-decision-closeout-governance-index-trend/1`, Phase 71) summarizes a window of those indices into an arc
 * verdict; the governance INDEX TREND ACTION PLAN (`pdfxyz.release-decision-closeout-governance-action-plan/1`, Phase 72)
 * translates a trend verdict into an operator follow-up plan; and the governance ACTION-PLAN EXECUTION RECEIPT
 * (`pdfxyz.release-decision-closeout-governance-action-receipt/1`, Phase 73) records whether that plan's required
 * follow-ups were acknowledged / executed.
 *
 * This phase FINALIZES the governance-review loop for the whole closeout-governance chain. It INGESTS a REQUIRED
 * `pdfxyz.release-decision-closeout-governance-action-receipt/1` PRIMARY receipt (the final, most-derived governance
 * signal) plus, optionally, the related records the receipt's chain was built from — the follow-up PLAN (Phase 72), the
 * governance-index TREND (Phase 71), the governance INDEX (Phase 70), and the governance BUNDLE (Phase 69) — RE-VALIDATES
 * EACH supplied record against ITSELF through the existing Phase 69–73 boundaries (so a hand-flipped verdict / ack coverage
 * / exit code is caught as a tamper), CROSS-CHECKS the supplied plan / trend against what the primary receipt recorded (so
 * a swapped or edited record is caught as a contradiction), folds every supplied source-chain record's own bounded posture,
 * and rolls them into ONE stable, content-free `pdfxyz.release-decision-closeout-governance-finalize/1` bundle a governance
 * review archives as the FINAL record for the chain —
 *
 *    "Is this release decision closeout-governance chain fully FINALIZED, still OPEN, INCOMPLETE, or BLOCKED — and what
 *     bounded evidence should be archived and what follow-up assigned?"
 *
 * — with a bounded finalization verdict, a per-source posture, a related-record checklist, an archive checklist, a bounded
 * follow-up assignment list, and a content-free receipt, and it FAILS CLOSED when the primary receipt cannot be trusted or
 * a supplied record contradicts / blocks the chain.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it composes:
 *  - Every load-bearing token here is a bounded enum — a source id, a coverage state, a relation signal, a finalization
 *    verdict, a severity, a reason id, a checklist id, a follow-up id, plus the surfaced upstream receipt / plan / trend /
 *    index / governance verdict — never a filename, path, object key, bucket, URL, endpoint, region, id, token, size, byte,
 *    raw ref, raw label, raw note, reviewer identity, commit URL, digest, or timestamp from an ingested record. The only
 *    non-enum values are small integer counts, booleans, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested record (each — even one Phase 69–73 produced — is UNTRUSTED
 *    input here); it reduces every fact to a bounded enum, a small integer, or a boolean, it never echoes an ingested
 *    record's OWN stamp (the bundle carries only its own), and it never echoes an input file path, even on an error.
 *  - It never fabricates a `finalized`. A `finalized` bundle REQUIRES a usable primary receipt whose OWN verdict is
 *    `completed` AND every supplied related record coherent (no contradiction, no tamper, no open / insufficient / blocked
 *    posture): a missing / unreadable primary receipt is FINALIZE-INCOMPLETE (never a vacuous finalized); a tampered
 *    primary receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open` escalation is
 *    FINALIZE-BLOCKED (fail-closed).
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT an approval / sign-off, and NOT a deployment / promotion ledger. It PROVES
 * nothing the composed records do not already prove; it FINALIZES their content-free outputs for a governance review,
 * RE-VALIDATES each one's self-consistency + chain coherence, and rolls them into one finalization verdict + archive /
 * follow-up checklists. Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CAVEATS}) say so out
 * loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "../release-decision-closeout-governance/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceIndexVerdict,
} from "../release-decision-closeout-governance-index/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
} from "../release-decision-closeout-governance-index-trend/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceActionPlanVerdict,
} from "../release-decision-closeout-governance-action-plan/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
} from "../release-decision-closeout-governance-action-receipt/types";

/** The schema tag every governance-finalize result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize/1" as const;

/** The upstream document schemas the bundle ingests. Re-exported so the result can pin each input shape. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
};

/** Stable identity of the release-decision-closeout-governance-finalize bundle — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize";
/** Bump when the surface, the verdict ladder, the reason / signal / checklist sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION = 1;

/** The upstream enums the bundle surfaces, re-exported for convenience. */
export {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
};
export type {
  ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
  ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass,
  ReleaseDecisionCloseoutGovernanceActionReceiptSourceState,
  ReleaseDecisionCloseoutGovernanceActionPlanVerdict,
  ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
  ReleaseDecisionCloseoutGovernanceIndexVerdict,
  ReleaseDecisionCloseoutGovernanceVerdict,
};

/**
 * The bounded coverage state of the ONE ingested primary receipt document (MY trust in the RECEIPT, distinct from the
 * receipt's OWN verdict about the plan it receipted):
 *  - `unreadable` — supplied but not read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-action-receipt/1` (never echoed). A missing / unusable
 *                   primary receipt: there is nothing to finalize (⇒ `finalize-incomplete`, never a vacuous `finalized`);
 *  - `tampered`   — recognized as a receipt but its recorded decision does NOT re-derive from the source facets it
 *                   recorded (a hand-flipped verdict / ack coverage / exit code) — an untrustworthy receipt (⇒
 *                   `finalize-blocked`);
 *  - `usable`     — recognized AND self-consistent (its recorded receipt decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SOURCE_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeSourceState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SOURCE_STATES)[number];

/**
 * The bounded **related-record kinds** the bundle can compose alongside the primary receipt — the closed set of OPTIONAL
 * upstream records a governance review may already have on hand, ordered from the shallowest (nearest the receipt) to the
 * deepest (the governance bundle itself):
 *  - `plan`       — the `pdfxyz.release-decision-closeout-governance-action-plan/1` follow-up plan the receipt receipted (a
 *                   cross-check against the plan verdict the receipt recorded);
 *  - `trend`      — the `pdfxyz.release-decision-closeout-governance-index-trend/1` trend the plan folded (a cross-check
 *                   against the source-trend verdict the plan, via the receipt, recorded);
 *  - `index`      — the `pdfxyz.release-decision-closeout-governance-index/1` governance index upstream (a source-chain
 *                   posture signal);
 *  - `governance` — the `pdfxyz.release-decision-closeout-governance/1` governance bundle upstream (a source-chain posture
 *                   signal).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS = [
  "plan",
  "trend",
  "index",
  "governance",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeRecordKind =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS)[number];

/**
 * The bounded coverage state of ONE related record (MY trust in that record):
 *  - `absent`     — not supplied (nothing to compose);
 *  - `unreadable` — supplied but not recognized as a document of its expected schema (never echoed);
 *  - `tampered`   — recognized but its recorded decision does NOT re-derive (an untrustworthy record ⇒ `finalize-blocked`);
 *  - `usable`     — recognized AND self-consistent: its bounded verdict is trustworthy for the cross-check / posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_STATES = [
  "absent",
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeRecordState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_STATES)[number];

/**
 * The bounded **signal** a usable related record contributes — how it relates to the primary receipt / the finalization
 * posture:
 *  - `coherent`      — a cross-check record (`plan` / `trend`) AGREES with what the receipt recorded, OR a source-chain
 *                      record (`index` / `governance`) is at a clean posture. It supports the bundle;
 *  - `contradictory` — a cross-check record (`plan` / `trend`) DISAGREES with what the receipt recorded (the supplied
 *                      record is not the one this receipt's chain was built from, or one was edited) ⇒ `finalize-blocked`;
 *  - `advisory`      — a source-chain record's own posture is advisory / open (an index `index-open`, a governance
 *                      `governance-open`) — the chain is not cleanly finalized ⇒ `finalize-open`;
 *  - `insufficient`  — a source-chain record's own posture is inconclusive (an `index-incomplete` / `governance-incomplete`)
 *                      ⇒ `finalize-incomplete`;
 *  - `blocking`      — a source-chain record's own posture is blocking (an `index-blocked` / `governance-blocked`) — a
 *                      blocked source chain ⇒ `finalize-blocked`;
 *  - `none`          — no signal (the record is `absent` / `unreadable` / `tampered`; its state carries that).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RELATION_SIGNALS = [
  "coherent",
  "contradictory",
  "advisory",
  "insufficient",
  "blocking",
  "none",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RELATION_SIGNALS)[number];

/** The two cross-check record kinds (each compares against a verdict the primary receipt recorded). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CROSSCHECK_KINDS = ["plan", "trend"] as const;
/** The two source-chain record kinds (each folds its OWN bounded posture). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SOURCE_CHAIN_KINDS = ["index", "governance"] as const;

/**
 * The single finalization verdict a review / CI keys on — the answer to "is this closeout-governance chain finalized?":
 *  - `finalized`             — the primary receipt is usable and its OWN verdict is `completed`, and every supplied related
 *                              record is coherent (no contradiction / tamper / advisory / insufficiency / block). The
 *                              governance chain reads as fully finalized on THIS host. It authorizes NOTHING; it is not
 *                              sign-off, approval, or promotion;
 *  - `finalize-incomplete`   — the primary receipt is missing / unreadable (nothing to finalize), OR its OWN verdict is
 *                              `incomplete`, OR a required related record is absent / unreadable, OR a supplied source-chain
 *                              record is inconclusive. A coverage gap: supply the missing evidence and re-run;
 *  - `finalize-open`         — the primary receipt's OWN verdict is `followup-open` (an advisory follow-up still open), OR a
 *                              supplied source-chain record's posture is advisory / open. Not a hard block — track it to
 *                              closure;
 *  - `finalize-blocked`      — the primary receipt is tampered / untrustworthy, OR its OWN verdict is `blocked`, OR a
 *                              cross-check record contradicts it, OR a related record is tampered, OR a source-chain record
 *                              is blocked, OR `--strict-open` escalated an open finalization. Do NOT treat the chain as
 *                              finalized until the failure or tamper is resolved.
 *
 * These are the exact bounded values the run-level `worker_release_decision_closeout_governance_finalize_total` metric
 * carries as its `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS = [
  "finalized",
  "finalize-incomplete",
  "finalize-open",
  "finalize-blocked",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-evidence suite:
 *  - `0` FINALIZED  — a usable `completed` receipt and every supplied related record coherent;
 *  - `1` USAGE      — the CLI was misused (a bad flag, no primary receipt supplied, or an unwritable output). CLI-owned; a
 *                     finalize RUN never resolves to it;
 *  - `2` INCOMPLETE — the evidence was insufficient to finalize the chain (a missing / unreadable primary receipt, an
 *                     `incomplete` receipt, a required-but-missing related record, or an inconclusive source chain);
 *  - `3` OPEN       — an advisory posture (a `followup-open` receipt, or an advisory / open source-chain record);
 *  - `4` BLOCKED    — a blocking posture (a tampered / blocked receipt, a contradictory / tampered related record, a
 *                     blocked source chain, or a `--strict-open` escalation).
 * Monotonic — a higher code is always a stronger "do not treat this closeout-governance chain as finalized".
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT = {
  FINALIZED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  OPEN: 3,
  BLOCKED: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeExitCode
> = {
  finalized: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT.FINALIZED,
  "finalize-incomplete": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT.INCOMPLETE,
  "finalize-open": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT.OPEN,
  "finalize-blocked": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT.BLOCKED,
};

/**
 * The severity each fired reason maps onto, with precedence `blocking > open > incomplete > informational` (checked in
 * that order — higher is worse, and the run's exit code follows the worst fired severity):
 *  - `informational` — a benign completion marker (a completed receipt, a coherent related record);
 *  - `incomplete`    — a coverage gap (a missing / unreadable primary receipt, an incomplete receipt, an inconclusive
 *                      source chain, or a missing required record) ⇒ exit 2;
 *  - `open`          — an advisory follow-up remains open (a followup-open receipt, an advisory source chain) ⇒ exit 3;
 *  - `blocking`      — a tampered / blocked receipt, a contradictory / tampered related record, a blocked source chain, or
 *                      a strict-open escalation ⇒ exit 4.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SEVERITIES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the finalization verdict resolved as it did, emitted in this stable
 * order (a superset view, so a reviewer sees every condition that applied, not only the winning one). Per-id severity +
 * detail are authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL}:
 *
 * Blocking (do NOT treat the chain as finalized):
 *  - `receipt-tampered`          — the primary receipt is recognized but its recorded decision does NOT re-derive;
 *  - `receipt-blocked`           — the primary receipt is usable and its OWN verdict is `blocked`;
 *  - `related-tampered`          — a supplied related record is recognized but self-inconsistent (a tamper);
 *  - `plan-contradiction`        — a supplied plan's verdict disagrees with the plan verdict the receipt recorded;
 *  - `trend-contradiction`       — a supplied trend's verdict disagrees with the source-trend verdict the receipt recorded;
 *  - `source-chain-blocked`      — a supplied source-chain record (index / governance) is at a blocking posture;
 *  - `strict-open-escalation`    — `--strict-open` escalated an otherwise-open finalization to a hard block.
 *
 * Open (an advisory follow-up remains open):
 *  - `receipt-followup-open`     — the primary receipt is usable and its OWN verdict is `followup-open`;
 *  - `source-chain-advisory`     — a supplied source-chain record's own posture is advisory / open.
 *
 * Incomplete (a coverage gap):
 *  - `receipt-unreadable`        — the supplied primary receipt could not be read / recognized (nothing to finalize);
 *  - `receipt-incomplete`        — the primary receipt is usable and its OWN verdict is `incomplete`;
 *  - `related-unreadable`        — a supplied optional related record could not be read / recognized;
 *  - `source-chain-insufficient` — a supplied source-chain record's own posture is inconclusive;
 *  - `required-record-missing`   — a `--require-<kind>` record is absent or unreadable.
 *
 * Informational (a benign marker):
 *  - `receipt-completed`         — the primary receipt is usable and its OWN verdict is `completed`;
 *  - `plan-coherent`             — a supplied plan AGREES with the plan verdict the receipt recorded;
 *  - `trend-coherent`            — a supplied trend AGREES with the source-trend verdict the receipt recorded;
 *  - `source-chain-coherent`     — a supplied source-chain record is at a clean posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_IDS = [
  // Blocking
  "receipt-tampered",
  "receipt-blocked",
  "related-tampered",
  "plan-contradiction",
  "trend-contradiction",
  "source-chain-blocked",
  "strict-open-escalation",
  // Open
  "receipt-followup-open",
  "source-chain-advisory",
  // Incomplete
  "receipt-unreadable",
  "receipt-incomplete",
  "related-unreadable",
  "source-chain-insufficient",
  "required-record-missing",
  // Informational
  "receipt-completed",
  "plan-coherent",
  "trend-coherent",
  "source-chain-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_IDS)[number];

/**
 * The bounded archive-checklist ids — which content-free records a reviewer should keep as the final governance record:
 *  - `primary-receipt`          — the supplied primary receipt (kept iff supplied + recognized);
 *  - `governance-plan`          — the supplied follow-up plan (kept iff supplied + recognized);
 *  - `governance-index-trend`   — the supplied governance-index trend (kept iff supplied + recognized);
 *  - `governance-index`         — the supplied governance index (kept iff supplied + recognized);
 *  - `governance-bundle`        — the supplied governance bundle (kept iff supplied + recognized);
 *  - `finalize-bundle`          — THIS bundle (always kept — the content-free FINAL record for the chain).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CHECKLIST_IDS = [
  "primary-receipt",
  "governance-plan",
  "governance-index-trend",
  "governance-index",
  "governance-bundle",
  "finalize-bundle",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeChecklistId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CHECKLIST_IDS)[number];

/**
 * The bounded follow-up assignment ids — the closed set of concrete operator steps the bundle can assign, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `investigate-blocked-finalization` — investigate the blocking finalization issue (a blocked receipt, a blocked source
 *                                         chain) before the review finalizes;
 *  - `recover-tampered-record`          — recover the untampered record from the CI archive; a tampered record cannot
 *                                         anchor the final record;
 *  - `reconcile-contradictory-record`   — a supplied plan / trend disagrees with the receipt's chain; supply the record
 *                                         this receipt was actually built from, or re-run the chain, and re-finalize;
 *  - `resolve-open-followup`            — a follow-up remains open (a followup-open receipt, an advisory source chain);
 *                                         track it to closure and re-run;
 *  - `complete-finalization-evidence`   — the primary receipt is missing / unreadable / incomplete, or a source chain is
 *                                         inconclusive; supply the missing evidence and re-run;
 *  - `supply-required-record`           — a required (`--require-<kind>`) related record was not supplied; supply it and
 *                                         re-run;
 *  - `continue-governance-cadence`      — the chain is finalized; keep composing receipts / plans / trends on the cadence;
 *  - `archive-finalize-bundle`          — archive this bundle (and the underlying records) as the FINAL governance record.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_IDS = [
  "investigate-blocked-finalization",
  "recover-tampered-record",
  "reconcile-contradictory-record",
  "resolve-open-followup",
  "complete-finalization-evidence",
  "supply-required-record",
  "continue-governance-cadence",
  "archive-finalize-bundle",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeFollowupId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Bounded reduced facts (all enums / small ints / booleans)
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-governance-action-receipt/1` (its decision re-derived). */
export interface GovernanceFinalizeReceiptFacts {
  /** The receipt's OWN verdict (trusted — the receipt re-derived its own decision). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict;
  /** The receipt's resolved plan class (surfaced context; `null` when the receipt's own plan was not usable). */
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  /** The plan verdict the receipt recorded — the anchor the supplied `plan` record is cross-checked against. */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceActionPlanVerdict | null;
  /** The source-trend verdict the receipt recorded — the anchor the supplied `trend` record is cross-checked against. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict | null;
  /** The newest usable governance-index posture the receipt recorded (surfaced context). */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceIndexVerdict | null;
  /** MY coverage of the plan the receipt receipted (the receipt's own `source.state`; context for the anchors). */
  readonly receiptSourceState: ReleaseDecisionCloseoutGovernanceActionReceiptSourceState;
  /** True iff the receipt was produced under `--strict-open` (context; never re-judged by the bundle). */
  readonly receiptStrictOpen: boolean;
  /** How many acknowledgements the receipt's plan class required (a bounded count). */
  readonly acksRequired: number;
  /** How many of the required acknowledgements were supplied (a bounded count). */
  readonly acksSatisfied: number;
  /** How many required acknowledgements were still missing (a bounded count). */
  readonly acksMissing: number;
}

/** The bounded verdict a usable related record surfaces — the union of the four related-record verdict enums. */
export type ReleaseDecisionCloseoutGovernanceFinalizeRecordVerdict =
  | ReleaseDecisionCloseoutGovernanceActionPlanVerdict
  | ReleaseDecisionCloseoutGovernanceIndexTrendVerdict
  | ReleaseDecisionCloseoutGovernanceIndexVerdict
  | ReleaseDecisionCloseoutGovernanceVerdict;

/** The bounded primary-receipt summary the result records — what the bundle finalized over, content-free. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeSource {
  /** MY coverage state of the ingested primary receipt document. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  /**
   * The receipt's OWN verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a `tampered`
   * receipt it is the untrusted CLAIMED verdict (surfaced so the bundle shows what was asserted).
   */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  /** The receipt's resolved plan class (a bounded enum), or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  /** The plan verdict the receipt recorded (the plan cross-check anchor), or `null` when not usable / not present. */
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceActionPlanVerdict | null;
  /** The source-trend verdict the receipt recorded (the trend cross-check anchor), or `null`. */
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict | null;
  /** The newest usable governance-index posture the receipt recorded (surfaced context), or `null`. */
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceIndexVerdict | null;
  /** MY coverage of the plan the receipt receipted (the receipt's own `source.state`; `null` when not usable). */
  readonly receiptSourceState: ReleaseDecisionCloseoutGovernanceActionReceiptSourceState | null;
  /** How many acknowledgements the receipt's plan class required (`0` when not usable). */
  readonly acksRequired: number;
  /** How many of the required acknowledgements were supplied (`0` when not usable). */
  readonly acksSatisfied: number;
  /** How many required acknowledgements were still missing (`0` when not usable). */
  readonly acksMissing: number;
  /** True iff the receipt was produced under `--strict-open` (context; `false` when not usable). */
  readonly receiptStrictOpen: boolean;
}

/** One entry in the bounded related-record checklist — a kind + required flag + coverage state + relation signal + verdict. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind;
  /** True iff this record was REQUIRED for this run (its `--require-<kind>` flag was set). */
  readonly required: boolean;
  /** MY coverage state of the supplied record. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeRecordState;
  /** The bounded relation signal the record contributed (the cross-check / posture outcome). */
  readonly signal: ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal;
  /** The record's OWN verdict (a bounded enum), or `null` when not usable. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeRecordVerdict | null;
}

/** The bounded coverage summary — which sources were supplied and which are trustworthy evidence. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeCoverage {
  /** True iff a usable primary receipt was supplied (the required chain anchor is present). */
  readonly hasReceipt: boolean;
  /** How many of the four OPTIONAL related records were supplied (0–4). */
  readonly relatedSupplied: number;
  /** How many of the four related records are usable (recognized + self-consistent) (0–4). */
  readonly relatedUsable: number;
  /** How many supplied related records were coherent (cross-check agreement or a clean source-chain posture). */
  readonly relatedCoherent: number;
  /** How many supplied related records contradicted the receipt (a cross-check mismatch). */
  readonly relatedContradictory: number;
  /** How many supplied related records are blocking (a tampered record or a blocked source chain). */
  readonly relatedBlocking: number;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizePolicy {
  /** Per-kind `--require-<kind>` flags: the record must be supplied + usable, else the chain is incomplete. */
  readonly require: Record<ReleaseDecisionCloseoutGovernanceFinalizeRecordKind, boolean>;
  /** True iff `--strict-open` was set (escalate an open finalization to `finalize-blocked`). */
  readonly strictOpen: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One follow-up assignment, with its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeFollowup {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeFollowupId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The bounded archive guidance — which content-free records a reviewer should keep as the final governance record. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeArchiveGuidance {
  /** The checklist ids to archive, in canonical order. */
  readonly items: readonly ReleaseDecisionCloseoutGovernanceFinalizeChecklistId[];
  /** Bounded, app-authored archive note. Never derived from an input. */
  readonly note: string;
}

/** The composite finalization decision — the single verdict + exit code + coverage a review acts on. The TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeExitCode;
  /** True iff `verdict === "finalized"`. */
  readonly finalized: boolean;
  /** MY coverage state of the primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  /** The receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  /** The receipt's resolved plan class, or `null` when the receipt is not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeReasonId[];
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were open follow-ups. */
  readonly open: number;
  /** How many fired reasons were incomplete coverage gaps. */
  readonly incomplete: number;
  /** How many fired reasons were informational markers. */
  readonly informational: number;
  /** How many of the four related records were supplied. */
  readonly relatedSupplied: number;
  /** How many supplied related records were coherent. */
  readonly relatedCoherent: number;
  /** How many supplied related records contradicted the receipt. */
  readonly relatedContradictory: number;
  /** How many supplied related records were blocking (tampered / blocked source chain). */
  readonly relatedBlocking: number;
  /** The related-record kinds that were required but absent / unreadable, in canonical order. */
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeRecordKind[];
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an open finalization to `finalize-blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: "finalize-open" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream document schemas). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION;
  readonly receiptSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA;
  readonly planSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_SCHEMA;
  readonly trendSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA;
  readonly indexSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA;
  readonly governanceSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA;
}

/**
 * The content-free **receipt** the result rides alongside its body — the flattened answer to "what did this finalization
 * bundle conclude, over what primary receipt, with how many coherent / contradictory / blocking related records" for a
 * SIEM / governance record. Bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure
 * statement only; safe to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeExitCode;
  /** MY coverage state of the primary receipt document. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  /** The primary receipt's OWN verdict (trusted when usable; the untrusted claim when tampered; `null` when unreadable). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  /** How many of the four related records were supplied. */
  readonly relatedSupplied: number;
  /** How many supplied related records were coherent. */
  readonly relatedCoherent: number;
  /** How many supplied related records contradicted the receipt. */
  readonly relatedContradictory: number;
  /** How many supplied related records were blocking (tampered / blocked source chain). */
  readonly relatedBlocking: number;
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  /** True iff `--strict-open` escalated an open finalization to `finalize-blocked`. */
  readonly strictOpenEscalated: boolean;
  /** The bounded, app-authored disclosure statement (what this bundle is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout governance finalization bundle a governance review archives as the
 * FINAL record. Every field is a bounded enum, a small integer, a boolean, an ISO stamp, or app-authored prose — so it
 * carries no reviewer identity, locator, size, path, or byte, even from a hostile input, and never echoes an ingested
 * record's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizePolicy;
  /** The single finalization verdict a reviewer keys on (mirrors `governanceFinalize.verdict`). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
  /** The process exit code (mirrors `governanceFinalize.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeExitCode;
  /** The bounded coverage summary. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeCoverage;
  /** The bounded primary-receipt summary the bundle finalized over. */
  readonly source: ReleaseDecisionCloseoutGovernanceFinalizeSource;
  /** The related-record checklist, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS} order. */
  readonly related: readonly ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord[];
  /** The composite finalization rollup (verdict + exit + reasons + related coverage + strict flags). The TOP-LEVEL rollup. */
  readonly governanceFinalize: ReleaseDecisionCloseoutGovernanceFinalizeRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeReason[];
  /** Which content-free records to archive as the FINAL governance record. */
  readonly archive: ReleaseDecisionCloseoutGovernanceFinalizeArchiveGuidance;
  /** The bounded, ordered follow-up assignment checklist. Never derived from an input. */
  readonly followUps: readonly ReleaseDecisionCloseoutGovernanceFinalizeFollowup[];
  /** Bounded, app-authored guidance (out-of-scope steps this bundle does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeReceipt;
}

/** The process exit code for a finalization result. */
export function releaseDecisionCloseoutGovernanceFinalizeExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeResult,
): number {
  return result.governanceFinalize.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
  string
> = {
  finalized:
    "FINALIZED: the primary governance action-plan execution receipt is usable and COMPLETED, and every supplied related record is coherent (no contradiction, no tamper, no open / insufficient / blocked posture). The release decision closeout-governance chain reads as fully finalized on THIS host. Archive this bundle as the FINAL governance record and continue on your cadence. This bundle authorizes NOTHING on its own; it is not sign-off, approval, or promotion.",
  "finalize-incomplete":
    "FINALIZE-INCOMPLETE (insufficient): the content-free evidence is INSUFFICIENT to finalize the chain — the PRIMARY receipt is missing / unreadable (nothing to finalize) or its OWN verdict is `incomplete`, a required related record is absent / unreadable, or a supplied source-chain record is inconclusive. This is a setup / coverage problem, not a finalized chain. Supply the missing evidence and re-run.",
  "finalize-open":
    "FINALIZE-OPEN (advisory): no blocker and evidence is sufficient, but a follow-up remains OPEN — the primary receipt is `followup-open`, or a supplied source-chain record's posture is advisory / open. Track the follow-up to closure and re-run; this is not a hard block, but it is not a fully finalized chain either.",
  "finalize-blocked":
    "FINALIZE-BLOCKED: a BLOCKING issue — the primary receipt is missing-trust (tampered) or its OWN verdict is `blocked`, a supplied plan / trend CONTRADICTS what the receipt recorded, a supplied related record is tampered, a supplied source-chain record is blocked, or `--strict-open` escalated an open finalization. Do NOT treat the chain as finalized until the failure or tamper is resolved.",
};

/**
 * The dedicated headline for a `finalize-blocked` bundle produced ONLY because `--strict-open` escalated an open
 * finalization — the primary receipt was neither tampered / blocked, nor was any related record contradictory / tampered /
 * blocked, so the generic headline would misrepresent the cause.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_STRICT_OPEN_ESCALATED_SUMMARY =
  "FINALIZE-BLOCKED (--strict-open): the only concern is an OPEN follow-up (a followup-open receipt, or an advisory / open source-chain record), and `--strict-open` escalates any open finalization to a hard block — a `finalized or blocked` gate for a high-assurance review. Without the flag this would be FINALIZE-OPEN, exit 3. No tampered / blocked receipt, contradictory / tampered related record, or blocked source chain was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeReasonId,
  { readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeSeverity; readonly detail: string }
> = {
  "receipt-tampered": {
    severity: "blocking",
    detail:
      "The supplied primary `pdfxyz.release-decision-closeout-governance-action-receipt/1` is recognized but its recorded decision (verdict / ack coverage / exit code / reasons) does NOT re-derive from the source facets it recorded — a hand-edited or corrupt receipt. Recover the untampered receipt from your CI archive; an untrustworthy receipt cannot anchor the final governance record.",
  },
  "receipt-blocked": {
    severity: "blocking",
    detail:
      "The primary receipt is usable and its OWN verdict is BLOCKED: the governance follow-up plan it receipted was missing / unreadable / tampered, was an unacknowledged block, was strict-open escalated, or carried a contradictory acknowledgement. Do NOT treat the chain as finalized — resolve the receipt's blocking condition and re-run.",
  },
  "related-tampered": {
    severity: "blocking",
    detail:
      "A supplied related record (plan / trend / index / governance) is recognized but its recorded decision does NOT re-derive from its own facts — a hand-edited or corrupt record. Recover the untampered record from your CI archive; a tampered record cannot be finalized into the governance record.",
  },
  "plan-contradiction": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-action-plan/1` verdict disagrees with the plan verdict the primary receipt recorded — the supplied plan is not the one this receipt's chain was built from, or one of the two was edited. A contradictory cross-check fails closed: supply the plan this receipt actually receipted, or re-run the chain end-to-end, and re-finalize.",
  },
  "trend-contradiction": {
    severity: "blocking",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-index-trend/1` verdict disagrees with the source-trend verdict the primary receipt (via its plan) recorded — the supplied trend is not the one this chain was built from, or one was edited. A contradictory cross-check fails closed: supply the trend this chain was built from, or re-run the chain, and re-finalize.",
  },
  "source-chain-blocked": {
    severity: "blocking",
    detail:
      "A supplied source-chain record (a governance index or governance bundle) is at a BLOCKING posture (`index-blocked` / `governance-blocked`) — the underlying governance evidence is itself blocked. A blocked source chain fails closed: investigate and resolve the underlying governance issue before treating the chain as finalized.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and an OPEN follow-up remained (a followup-open receipt, or an advisory / open source-chain record), so the policy escalates it to a hard block — a `finalized or blocked` gate for a high-assurance review. Close the open follow-up and re-run (or drop `--strict-open` if an open follow-up is acceptable for this review).",
  },
  "receipt-followup-open": {
    severity: "open",
    detail:
      "The primary receipt is usable and its OWN verdict is FOLLOWUP-OPEN: a monitor plan was reviewed but its follow-up remains open / not fully executed. Track the follow-up to closure and re-run the receipt; this is not a hard block, but the chain is not fully finalized.",
  },
  "source-chain-advisory": {
    severity: "open",
    detail:
      "A supplied source-chain record (a governance index or governance bundle) is at an ADVISORY / open posture (`index-open` / `governance-open`) — the underlying governance evidence has an open item. Track it to closure; this is not a hard block, but the chain is not fully finalized.",
  },
  "receipt-unreadable": {
    severity: "incomplete",
    detail:
      "The supplied primary receipt could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-action-receipt/1` (wrong schema or unparseable — never echoed). There is nothing trustworthy to finalize: supply a readable receipt produced by `worker:release-decision-closeout-governance-action-receipt` and re-run. This fails to a coverage gap, never a vacuous finalized.",
  },
  "receipt-incomplete": {
    severity: "incomplete",
    detail:
      "The primary receipt is usable and its OWN verdict is INCOMPLETE: a required bounded acknowledgement was absent for its plan class (the plan was not reviewed, or a follow-up was not executed). Supply the missing acknowledgement, re-run the receipt, and re-finalize before treating the chain as finalized.",
  },
  "related-unreadable": {
    severity: "incomplete",
    detail:
      "A supplied optional related record could not be read / recognized as a document of its expected schema (wrong schema or unparseable — never echoed), so it contributes no evidence. Supply a readable record produced by its worker and re-run, or omit it.",
  },
  "source-chain-insufficient": {
    severity: "incomplete",
    detail:
      "A supplied source-chain record (a governance index or governance bundle) is at an INCONCLUSIVE posture (`index-incomplete` / `governance-incomplete`) — the underlying governance evidence was insufficient. Complete the missing governance evidence, re-run the record, and re-finalize before treating the chain as finalized.",
  },
  "required-record-missing": {
    severity: "incomplete",
    detail:
      "A `--require-<kind>` related record was absent or unreadable. The finalization policy requires that record for this review; supply the readable record produced by its worker and re-run.",
  },
  "receipt-completed": {
    severity: "informational",
    detail:
      "The primary receipt is usable and its OWN verdict is COMPLETED: the governance follow-up plan's required acknowledgements were all supplied. This is the baseline for a `finalized` chain; the bundle is finalized unless a supplied related record contradicts / blocks it.",
  },
  "plan-coherent": {
    severity: "informational",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-action-plan/1` verdict AGREES with the plan verdict the primary receipt recorded — the supplied plan is the one this receipt's chain was built from (a coherent cross-check). It supports the final governance record.",
  },
  "trend-coherent": {
    severity: "informational",
    detail:
      "The supplied `pdfxyz.release-decision-closeout-governance-index-trend/1` verdict AGREES with the source-trend verdict the primary receipt (via its plan) recorded — the supplied trend is the one this chain was built from (a coherent cross-check). It supports the final governance record.",
  },
  "source-chain-coherent": {
    severity: "informational",
    detail:
      "A supplied source-chain record (a governance index or governance bundle) is at a CLEAN posture (`indexed` / `closed`) — the underlying governance evidence is cleanly closed. It supports the final governance record.",
  },
};

/** Per-follow-up authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_FOLLOWUP_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeFollowupId,
  string
> = {
  "investigate-blocked-finalization":
    "Investigate the blocking finalization issue (a tampered / blocked primary receipt, or a blocked source chain) and resolve the underlying governance issue before the review finalizes; recover the untampered records from your CI archive if needed.",
  "recover-tampered-record":
    "Recover the untampered record from your CI archive: a recorded verdict / decision that does not re-derive means the record was hand-edited or corrupted, and cannot anchor the final governance record.",
  "reconcile-contradictory-record":
    "A supplied plan / trend disagrees with what the primary receipt recorded: supply the record this receipt's chain was actually built from, or re-run the governance chain end-to-end (`worker:release-decision-closeout-governance` → `-index` → `-index-trend` → `-action-plan` → `-action-receipt`), and re-finalize so the final record is consistent.",
  "resolve-open-followup":
    "Resolve the open follow-up (a followup-open receipt, or an advisory / open source-chain record): track the monitor / open governance item to closure, re-run the affected record, and re-finalize. Archive this bundle as the record of that decision.",
  "complete-finalization-evidence":
    "Supply the missing / unreadable / incomplete evidence — a readable, completed primary `pdfxyz.release-decision-closeout-governance-action-receipt/1`, and the source-chain records it needs — and re-run this bundle; a missing / unreadable receipt or an inconclusive source chain leaves the chain unfinalized.",
  "supply-required-record":
    "Supply the missing required related record (the one whose `--require-<kind>` flag was set) — a readable `pdfxyz.release-decision-closeout-governance-action-plan/1` / `-index-trend/1` / `-index/1` / governance bundle — and re-run this bundle; a required-but-missing record leaves the chain unfinalized.",
  "continue-governance-cadence":
    "The governance chain is finalized: keep composing governance receipts / plans / trends / indices per review period and finalizing here on your weekly / monthly cadence. This bundle authorizes no promotion on its own.",
  "archive-finalize-bundle":
    "Archive this finalization bundle (and the underlying primary receipt + related records) as CI artifacts: it is the content-free release-decision-closeout-governance-finalize record for this review. This bundle never uploads or promotes anything.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this bundle is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_DISCLOSURE =
  "This is a content-free operational GOVERNANCE FINALIZATION BUNDLE ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests one previously produced governance action-plan execution receipt (required) plus optional related governance-chain records, re-validates each against itself, cross-checks the chain, and rolls them into one finalization verdict; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The bundle FINALIZES the closeout-governance
 * chain's already content-free records for a governance review, RE-VALIDATES each one's self-consistency + chain
 * coherence, and rolls them into one finalization verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZATION BUNDLE: it INGESTS a REQUIRED content-free `pdfxyz.release-decision-closeout-governance-action-receipt/1` primary receipt plus, optionally, the related governance-chain records (the follow-up plan, the governance-index trend, the governance index, and the governance bundle) a release pipeline produced, RE-VALIDATES each against ITSELF, cross-checks the chain, and folds them into ONE bounded finalization verdict + archive / follow-up checklists. It is local content-free GOVERNANCE FINALIZATION over evidence records — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / governance / closeout / receipt itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any record, artifact, object, or deployment. A `finalized` bundle authorizes nothing; it only records that the content-free records supplied on THIS host read as a coherently finalized chain.",
  "A `finalized` bundle REQUIRES a usable primary receipt whose OWN verdict is `completed` AND every supplied related record coherent. It FAILS CLOSED: a missing / unreadable primary receipt is `finalize-incomplete` (nothing to finalize); a tampered primary receipt is `finalize-blocked`; a `blocked` receipt is `finalize-blocked`; a supplied plan / trend that contradicts the receipt is `finalize-blocked`; a tampered related record is `finalize-blocked`; a blocked source chain is `finalize-blocked`; a required-but-missing related record, an `incomplete` receipt, or an inconclusive source chain is `finalize-incomplete`; a `followup-open` receipt or an advisory source chain is `finalize-open`; and `--strict-open` escalates an open finalization to `finalize-blocked`. It never fabricates a `finalized` from an untrusted receipt or a contradictory chain.",
  "It re-validates each ingested record by RECONSTRUCTING its bounded decision from the facts the record recorded and re-running the SAME tested reducer that phase used (the Phase 73 `computeReceipt` for the primary receipt; the Phase 69–72 boundaries for the related records), requiring the recorded verdict / counts / exit code to re-derive, treating any disagreement as a TAMPER. This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the bundle proves neither authorship nor approval, and a fully self-consistent fabricated record is out of its scope. The cross-checks compare bounded verdict enums across records; they catch a swapped / edited record, not a fully-consistent forgery.",
  "It emits only bounded enums, small counts, booleans, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested record's own stamp, and it never echoes an input file path, even on an error. It accepts NO free-form note or actor name — only bounded record inputs and policy flags.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the bundle carries but does NOT itself perform — the honest edges of an offline finalization
 * bundle. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand GOVERNANCE step, NOT a per-release gate: after the closeout-governance chain produces the ONE `pdfxyz.release-decision-closeout-governance-action-receipt/1` receipt (and, on hand, the plan / trend / index / governance bundle it was built from), hand them here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked bundle), surface exit 3 (an open follow-up) and exit 2 (an incomplete chain) for review, and treat exit 0 (a finalized chain) as finalized — never as an authorization.",
  "Supply the related records you actually have — each is OPTIONAL, but the more of the chain you supply, the stronger the coherence check: `--plan` and `--trend` are cross-checked against what the receipt recorded (a mismatch fails closed), and `--index` / `--governance` fold their own bounded posture. Use `--require-plan` / `--require-trend` / `--require-index` / `--require-governance` to make a record mandatory, and `--strict-open` to escalate an open follow-up to a hard block for a high-assurance review.",
  "Archive this bundle (and the underlying receipt + related records) as CI artifacts: it is a content-free FINAL governance SUMMARY, not a substitute for the records it composes, nor for your legal audit trail, compliance sign-off, external approval / signing, identity attestation, storage retention, incident records, or release-promotion processes — keep each of those in its own dedicated system.",
  "Act on promotion out of band: this bundle RECORDS that a content-free closeout-governance chain reads as finalized, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, filing an incident record, and promoting a deployment are operator / CI / legal actions this offline bundle never performs.",
];
