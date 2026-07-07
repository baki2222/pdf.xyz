/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index trend
 * finalize index trend closeout INDEX** (Phase 90).
 *
 * Phases 80–89 built the finalize-index-trend-finalize-index-trend follow-up chain, one rung per phase, culminating
 * (Phase 89) in the governance CLOSEOUT record (`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1`)
 * — which composed one finalization-index-trend follow-up loop (a required primary action-plan execution receipt plus the
 * optional related plan / trend / finalization-index records it was built from) into ONE closeout verdict (`closed` /
 * `open` / `incomplete` / `blocked` / `invalid`) a governance review archives as the record that one follow-up loop was
 * closed out.
 *
 * This phase closes the *review* loop over a BOUNDED HISTORY of those closeout records. It INGESTS one or more
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` documents (a sprint /
 * quarter of finalization-index-trend follow-up loops), RE-VALIDATES each against ITSELF (re-deriving its Phase 89
 * closeout coverage rollup from its own recorded primary-receipt facets + per-kind related-record signals + source-chain
 * posture + policy, mirroring the Phase 89 `computeCloseout` reducer, so a hand-flipped closeout verdict / exit / rollup —
 * or a flipped receipt / source-chain posture signal — is caught as a tamper), and folds them into ONE stable,
 * content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1`
 * summary that answers a single question a governance review needs —
 *
 *    "Across the recent finalization-index-trend follow-up-loop CLOSEOUT records on this host, is the latest loop
 *     consistently CLOSED — or is the latest / recent history OPEN, INCOMPLETE, BLOCKED, or UNTRUSTWORTHY?"
 *
 * — with a bounded index verdict, a closeout-verdict distribution, a bounded summary of the newest usable closeout, a
 * per-record posture sequence, a bounded rationale, and a bounded next-action checklist, and it FAILS CLOSED when a
 * closeout record cannot be trusted or the history is inconclusive.
 *
 * It is LATEST-FOCUSED (like the finalization-index): the NEWEST usable closeout record's own verdict is the primary
 * driver, and bounded history thresholds (`--max-open` / `--max-incomplete`, each defaulting to 0) let an operator
 * tolerate a bounded number of non-closed OLDER records in the window before the accumulation escalates the index. It
 * carries a top-precedence `invalid` verdict: any tampered OR unreadable input FAILS CLOSED to `invalid` (a
 * record that cannot be trusted must never be silently counted as usable), and any blocked / invalid-posture closeout
 * (not a bounded count) escalates to `blocked`.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it indexes:
 *  - Every load-bearing token here is a bounded enum — a record state, a closeout verdict, an index verdict, a severity, a
 *    trend class, a reason id, a checklist id — never a filename, path, object key, bucket, URL, endpoint, region, id,
 *    token, size, byte, raw ref, raw label, raw note, reviewer identity, commit URL, or digest. The only non-enum values
 *    are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested closeout record (each — even one Phase 89 produced — is
 *    UNTRUSTED input here); it reduces every record to a bounded enum, a small integer, or a boolean, it never echoes an
 *    ingested record's OWN stamp (the index carries only its own), and it never echoes an input file path, even on an
 *    error.
 *  - It never fabricates an `all-closed`. An `all-closed` index REQUIRES a coherent bounded window: the latest usable
 *    closeout record `closed`, no tampered / unreadable record, no blocked / invalid-posture record, and the open /
 *    incomplete counts within their thresholds. A tampered / unreadable record, a usable record whose OWN verdict is
 *    `invalid`, or zero usable records makes the index `invalid` (the TOP precedence); any `blocked` record makes it
 *    `blocked`; an `open` latest or an older open-threshold breach makes it `open`; an `incomplete` latest or an older
 *    incomplete-threshold breach makes it `incomplete`; a `--strict-open` escalation of an open / incomplete window
 *    makes it `blocked`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It
 * PROVES nothing the closeout records do not already prove; it INDEXES a bounded history of their content-free closeout
 * verdicts, RE-VALIDATES each one's self-consistency, and rolls them up into one review verdict + follow-up checklist. Its
 * authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_CAVEATS})
 * say so out loud.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/types";

/** The schema tag every closeout-index result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1" as const;

/** The upstream document schema the index ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SCHEMA };

/** The upstream closeout verdicts the index tallies + surfaces per record, re-exported for convenience. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS };
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState,
};
export type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
};

/** Stable identity of the release-decision-closeout-…-finalize-index-trend-closeout-index-trend-closeout-index — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index";
/** Bump when the index surface, the verdict ladder, the reason / checklist / trend-class sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION = 1;

/** The default window cap: the newest N closeout records considered when `--max-closeouts` is not given. */
export const DEFAULT_MAX_CLOSEOUTS = 26;
/** The hard ceiling on `--max-closeouts`: a review history is bounded, never an unbounded list. */
export const MAX_MAX_CLOSEOUTS = 104;

/**
 * The bounded coverage state of one ingested closeout record — every supplied `--closeout` / `--file` / stdin element is
 * SUPPLIED, so a record is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1`
 *                   (never echoed). It certifies nothing → an UNTRUSTWORTHY input (fail-closed to INVALID);
 *  - `tampered`   — recognized as a closeout record but its recorded closeout coverage rollup does NOT re-derive from its
 *                   own recorded primary-receipt facets + related-record signals + policy (a hand-edited / corrupt
 *                   record) → an UNTRUSTWORTHY input (fail-closed to INVALID);
 *  - `usable`     — recognized AND self-consistent (its recorded closeout coverage rollup re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_RECORD_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRecordState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_RECORD_STATES)[number];

/**
 * The single index verdict a governance review keys on — the answer to "are the recent finalization-index-trend
 * follow-up-loop CLOSEOUT records consistently closed, and is follow-up warranted?":
 *  - `all-closed` — a COHERENT bounded window: the latest usable closeout record is `closed`, no tampered / unreadable
 *                   record is present, no blocked / invalid-posture record is present, and the open / incomplete counts
 *                   are within their thresholds. The recent history reads as consistently closed. It authorizes NOTHING;
 *  - `open`       — an OPEN follow-up posture: the latest usable record's own verdict is `open`, or the OLDER open count
 *                   exceeds `--max-open`. Not a hard block — track it to closure;
 *  - `incomplete` — a COVERAGE GAP: the latest usable record's own verdict is `incomplete`, or the OLDER incomplete count
 *                   exceeds `--max-incomplete`. Fail-closed, never a vacuous `all-closed`;
 *  - `blocked`    — a BLOCKING history: the latest usable record's own verdict is `blocked`, ANY usable record is
 *                   `blocked`, or `--strict-open` escalated an open / incomplete window. Do NOT treat the history as
 *                   consistently closed;
 *  - `invalid`    — an UNTRUSTWORTHY history: a considered record is tampered (its rollup does not re-derive) or
 *                   unreadable (not a recognized closeout record), a usable record's own verdict is `invalid`, or the
 *                   window has zero usable records. Fails closed to the TOP precedence, above every other posture —
 *                   recover the untampered / readable records before indexing.
 *
 * These are the exact bounded values the run-level
 * `worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_total` metric
 * carries as its `verdict` label; all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS = [
  "all-closed",
  "open",
  "incomplete",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-decision suite:
 *  - `0` INDEXED     — a coherent history (the latest record closed and the history within thresholds);
 *  - `1` USAGE       — the CLI was misused (a bad flag, no record supplied, or an unwritable output). CLI-owned; an
 *                      index RUN never resolves to it;
 *  - `2` INCOMPLETE  — a coverage gap (zero usable records, an incomplete latest / breach, a require-latest miss);
 *  - `3` OPEN        — an open posture (an `open` latest, or an open-threshold breach);
 *  - `4` BLOCKED     — a blocking history (a `blocked` / `invalid` latest / any blocked-or-invalid record, or a
 *                      `--strict-open` escalation);
 *  - `4` INVALID     — an untrustworthy history (a tampered or unreadable record). Shares exit 4 with BLOCKED (both are
 *                      "do not treat this history as closed"), but is a DISTINCT verdict so a reviewer can tell a broken
 *                      input apart from a blocked chain.
 *
 * `incomplete` (2) sorts before the `open` band (3) by exit value, exactly like the rest of the suite; the
 * fail-closed PRECEDENCE (which verdict wins when several conditions apply) is `invalid > blocked > open > incomplete >
 * indexed`.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT = {
  ALL_CLOSED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  OPEN: 3,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode
> = {
  "all-closed":
    RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT.ALL_CLOSED,
  open: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT.OPEN,
  incomplete:
    RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT.INCOMPLETE,
  blocked:
    RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT.BLOCKED,
  invalid:
    RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT.INVALID,
};

/**
 * The common **severity** each fired index reason maps onto, with precedence
 * `invalid > blocking > open > incomplete > informational` (checked in that order — higher is worse, and the run's exit
 * code follows the worst fired severity):
 *  - `informational` — a benign index marker (the latest record closed / the whole history coherent);
 *  - `incomplete`    — a coverage gap (zero usable records, an incomplete latest / breach, a require-latest miss);
 *  - `open`          — an open follow-up posture (an open latest / breach);
 *  - `blocking`      — a blocked history (a blocked / invalid latest / any blocked-or-invalid record, a `--strict-open`
 *                      escalation);
 *  - `invalid`       — an UNTRUSTWORTHY input (a tampered or unreadable record). The top precedence: a record that cannot
 *                      be trusted is worse than a record that is trustworthy-but-blocked.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SEVERITIES)[number];

/** One usable record's own verdict → the coarse severity it contributes (context; never the index fold). */
export const CLOSEOUT_VERDICT_SEVERITY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSeverity
> = {
  closed: "informational",
  incomplete: "incomplete",
  open: "open",
  blocked: "blocking",
  invalid: "invalid",
};

/**
 * The bounded **trend class** — the single coarse classification of what the window contains, by worst-present (a
 * strict-INDEPENDENT description, so a `--strict-open` run can be `blocked` while still classing the window as
 * `open-present`), in this severity order:
 *  - `invalid-present`    — a tampered or unreadable record is present (an untrustworthy input);
 *  - `blocked-present`    — a usable record's own verdict is `blocked` or `invalid`;
 *  - `open-present`       — a usable record's own verdict is `open`;
 *  - `incomplete-present` — a usable record's own verdict is `incomplete`;
 *  - `all-closed`         — every usable record's own verdict is `closed` (and at least one is usable), with no
 *                           unreadable / tampered record;
 *  - `no-usable`          — the window has zero usable records and no other signal (nothing to index).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES = [
  "all-closed",
  "open-present",
  "incomplete-present",
  "blocked-present",
  "invalid-present",
  "no-usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the index verdict resolved as it did, emitted in this stable order
 * (a superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id severity is
 * authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL}:
 *
 * Invalid (an untrustworthy input OR nothing trustworthy to index — TOP precedence):
 *  - `closeout-tampered`             — a considered record is recognized but its recorded rollup does NOT re-derive;
 *  - `closeout-unreadable`           — a considered record could not be read / recognized (an untrustworthy input);
 *  - `no-closeouts`                  — the window has zero usable records (nothing trustworthy to index);
 *  - `invalid-in-history`            — a usable record's own verdict is `invalid` (an untrustworthy loop).
 *
 * Blocking (do NOT treat the history as closed):
 *  - `latest-blocked`                — the latest usable record's own verdict is `blocked`;
 *  - `blocked-in-history`            — a usable record in the window is `blocked` (any blocked record);
 *  - `strict-open-escalation`        — `--strict-open` escalated an otherwise open / incomplete window to a hard block.
 *
 * Open (an advisory follow-up posture remains open):
 *  - `latest-open`                   — the latest usable record's own verdict is `open`;
 *  - `open-threshold-exceeded`       — the OLDER open record count in the window exceeds `--max-open`.
 *
 * Incomplete (a coverage gap):
 *  - `latest-incomplete`             — the latest usable record's own verdict is `incomplete`;
 *  - `incomplete-threshold-exceeded` — the OLDER incomplete record count in the window exceeds `--max-incomplete`.
 *
 * Informational (a benign index marker):
 *  - `latest-closed`                 — the latest usable record's own verdict is `closed`;
 *  - `history-coherent`              — every considered record is a usable `closed` (a fully-clean history marker).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS = [
  // Invalid (an untrustworthy input OR nothing trustworthy to index — TOP precedence)
  "closeout-tampered",
  "closeout-unreadable",
  "no-closeouts",
  "invalid-in-history",
  // Blocking
  "latest-blocked",
  "blocked-in-history",
  "strict-open-escalation",
  // Open
  "latest-open",
  "open-threshold-exceeded",
  // Incomplete
  "latest-incomplete",
  "incomplete-threshold-exceeded",
  // Informational
  "latest-closed",
  "history-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete operator steps the index can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `recover-tampered-closeout`     — recover the tampered closeout record(s) from your CI archive; a record whose rollup
 *                                      does not re-derive cannot be trusted in the index;
 *  - `recover-unreadable-closeout`   — recover the unreadable closeout record(s); a record the index cannot read is an
 *                                      untrustworthy input;
 *  - `review-blocked-closeout`       — a record was blocked / invalid (its receipt / chain was tampered / blocked /
 *                                      contradictory); reconcile the block before treating the history as closed;
 *  - `review-open-closeout`          — an open follow-up posture is present; track the follow-up to closure before relying
 *                                      on the history;
 *  - `complete-incomplete-closeout`  — a record was incomplete (a missing / unusable receipt or required record); complete
 *                                      the missing evidence, re-close the loop, and re-index;
 *  - `supply-closeout-records`       — supply more / readable
 *                                      `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1`
 *                                      records and re-run (a thin or empty history cannot be indexed);
 *  - `continue-recording-closeout`   — the history is coherent; keep closing out one loop per release and indexing them on
 *                                      your review cadence;
 *  - `keep-closeout-index`           — keep this content-free index as the local closeout-history review SUMMARY (always).
 *                                      It is NOT a legal audit log, a compliance attestation, an external approval, an
 *                                      identity proof, or a deployment / promotion ledger.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_IDS = [
  "recover-tampered-closeout",
  "recover-unreadable-closeout",
  "review-blocked-closeout",
  "review-open-closeout",
  "complete-incomplete-closeout",
  "supply-closeout-records",
  "continue-recording-closeout",
  "keep-closeout-index",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexChecklistId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-record bounded facts + the reduced index point
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` (its rollup
 * re-derived in ingest). Every field is a bounded enum, a small integer, or a boolean — never a raw value from the input.
 */
export interface CloseoutRecordFacts {
  /** The record's final closeout verdict (trusted — the record re-derived its own rollup). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict;
  /** The record's own exit code (context; the index has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "closed"`. */
  readonly closed: boolean;
  /** The record's primary-receipt coverage state (context). */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  /** The record's primary-receipt verdict (trusted when its receipt was usable; the claim when tampered; else `null`). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  /** The record's resolved plan class, or `null` when its receipt's plan was not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** How many of the three related records the record itself had supplied. */
  readonly relatedSupplied: number;
  /** How many supplied related records the record itself found coherent. */
  readonly relatedCoherent: number;
  /** How many supplied related records the record itself found contradictory. */
  readonly relatedContradictory: number;
  /** How many supplied related records the record itself found blocking. */
  readonly relatedBlocking: number;
  /** How many required related records the record itself was missing. */
  readonly requiredMissing: number;
  /** True iff the record was produced under `--strict-open`. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` escalated the record's own posture (context; never re-judged by the index). */
  readonly strictOpenEscalated: boolean;
}

/**
 * One reduced closeout record in the index sequence — a bounded point ordered oldest → newest (the supplied order). Every
 * field is a bounded enum, a small integer, or app-authored prose; never a raw value from the input (not even the
 * record's stamp).
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPoint {
  /** 0-based position in the considered window, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The record's coverage state. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRecordState;
  /**
   * The record's own closeout verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` record it is the untrusted CLAIMED verdict (surfaced so the sequence shows what was asserted).
   */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The record's primary-receipt coverage state, or `null` when not usable. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState | null;
  /** The record's primary-receipt verdict, or `null` when not usable. */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  /** The record's resolved plan class, or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** The record's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSeverity | null;
  /** A one-line, content-free headline authored from the position + state + verdict. */
  readonly detail: string;
}

/**
 * The bounded coverage summary — how many records were supplied / considered / usable, and the untrustworthy counts.
 * Every count is a small non-negative integer; an unreadable / tampered record contributes no trusted verdict.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage {
  /** How many closeout inputs were supplied (before any cap). */
  readonly closeoutsSupplied: number;
  /** How many records were considered after the `--max-closeouts` window cap (the newest N). */
  readonly closeoutsConsidered: number;
  /** How many considered records are usable (recognized + self-consistent). */
  readonly closeoutsUsable: number;
  /** How many considered records were unreadable (not recognized as a closeout record). */
  readonly closeoutsUnreadable: number;
  /** How many considered records were tampered (recognized but self-inconsistent). */
  readonly closeoutsTampered: number;
  /** True iff `--max-closeouts` dropped older records from the window. */
  readonly truncated: boolean;
  /** How many older records were dropped by the window cap (`closeoutsSupplied − closeoutsConsidered`). */
  readonly droppedOldest: number;
}

/**
 * The bounded distribution summary — the closeout-verdict histogram over the USABLE considered records plus the newest /
 * oldest usable verdict and the single coarse trend class. Never fabricates a posture (an unreadable / tampered record
 * contributes nothing).
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution {
  /** The count of each closeout verdict across the usable considered records (all five keys present). */
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>>;
  /** The newest usable record's verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The oldest usable record's verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The single coarse classification of what the window contains (strict-independent). */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
}

/**
 * The bounded summary of the NEWEST usable closeout record only — the primary driver of the index verdict. Every field is
 * a bounded enum or small integer; no timestamp / stamp. `null` when no record is usable.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexLatest {
  /** The newest usable record's own closeout verdict. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict;
  /** Its primary-receipt coverage state. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  /** Its primary-receipt verdict, or `null` when the receipt was not usable. */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  /** Its resolved plan class, or `null` when the receipt's plan was not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  /** How many of its three related records were supplied. */
  readonly relatedSupplied: number;
  /** How many of its supplied related records were contradictory. */
  readonly relatedContradictory: number;
  /** How many of its supplied related records were blocking. */
  readonly relatedBlocking: number;
  /** True iff it was produced under `--strict-open`. */
  readonly strictOpen: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy {
  /** The maximum number of newest records considered (the window cap). */
  readonly maxCloseouts: number;
  /** The maximum tolerated `open` records in the window before the open threshold fires (default 0). */
  readonly maxOpen: number;
  /** The maximum tolerated `incomplete` records before the incomplete threshold fires (default 0). */
  readonly maxIncomplete: number;
  /** True iff `--strict-open` was set (any open / incomplete window escalates to `blocked`). */
  readonly strictOpen: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexChecklistItem {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite index decision — the single verdict + exit code a review acts on. THE TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode;
  /** True iff `verdict === "all-closed"`. */
  readonly allClosed: boolean;
  /** The latest (newest) usable record's own closeout verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The oldest usable record's own closeout verdict, or `null` if none is usable. */
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The single coarse classification of what the window contains (strict-independent). */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId[];
  /** How many fired reasons were invalid. */
  readonly invalid: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were open. */
  readonly open: number;
  /** How many fired reasons were incomplete. */
  readonly incomplete: number;
  /** How many fired reasons were informational. */
  readonly informational: number;
  /** True iff `--strict-open` was applied. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` ESCALATED an open index to `blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream closeout schema). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION;
  readonly closeoutSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SCHEMA;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this
 * closeout index conclude, over how many usable records, in what distribution, with what latest" for a SIEM / review
 * record. Bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement only; safe
 * to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode;
  /** How many closeout inputs were supplied. */
  readonly closeoutsSupplied: number;
  /** How many records were considered after the window cap. */
  readonly closeoutsConsidered: number;
  /** How many considered records are usable. */
  readonly closeoutsUsable: number;
  /** How many considered records were unreadable. */
  readonly closeoutsUnreadable: number;
  /** How many considered records were tampered. */
  readonly closeoutsTampered: number;
  /** The count of each closeout verdict across the usable considered records (all five keys present). */
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>>;
  /** The latest (newest) usable record's own closeout verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The single coarse classification of what the window contains. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass;
  /** The bounded, app-authored disclosure statement (what this index is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index
 * a review / CI reads. Every field is a bounded enum, a small integer, an ISO stamp, or app-authored prose — so it
 * carries no reviewer identity, locator, size, path, or byte, even from a hostile input, and never echoes an ingested
 * record's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy;
  /** The single index verdict a reviewer keys on (mirrors `closeoutIndex.verdict`). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict;
  /** The process exit code (mirrors `closeoutIndex.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode;
  /** The bounded coverage summary (supplied / considered / usable / unreadable / tampered / dropped). */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage;
  /** The bounded closeout-verdict distribution over the usable considered records. */
  readonly distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution;
  /** The bounded summary of the newest usable closeout record, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexLatest | null;
  /** One reduced point per considered record, ordered oldest → newest (the supplied order). */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPoint[];
  /** The composite index rollup (verdict + exit + reasons + strict flags). THE TOP-LEVEL rollup. */
  readonly closeoutIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this index does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReceipt;
}

/** The process exit code for an index result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexResult,
): number {
  return result.closeoutIndex.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  string
> = {
  "all-closed":
    "ALL-CLOSED: the recent finalization-index-trend follow-up-loop CLOSEOUT records are consistently closed — the latest usable record is CLOSED, no tampered / unreadable / blocked / invalid record is present, and the open / incomplete counts are within their thresholds. Keep closing out one follow-up loop per release and indexing them on your review cadence. This index authorizes nothing on its own.",
  open:
    "OPEN: an OPEN follow-up posture is present — the latest usable record is OPEN, or the older open count exceeds `--max-open`. Track the open follow-up(s) to closure and re-index; this is not a hard block, but the history is not consistently closed either.",
  incomplete:
    "INCOMPLETE: the closeout history has a COVERAGE GAP — the latest usable record is INCOMPLETE, or the older incomplete count exceeds `--max-incomplete`. Complete the missing evidence or supply a coherent latest, then re-index; this is not a coherent history.",
  blocked:
    "BLOCKED: a BLOCKING history — the latest usable record is BLOCKED, a usable record in the window is blocked, or `--strict-open` escalated an open / incomplete history. Do NOT treat the recent records as consistently closed until the cause is resolved.",
  invalid:
    "INVALID: an UNTRUSTWORTHY history — a considered record is tampered (its recorded rollup does NOT re-derive from its own recorded facets), unreadable (not a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1`), a usable record's own verdict is `invalid`, or the window has zero usable records. A history that cannot be trusted fails closed above every other posture: recover the untampered / readable records from your CI archive and re-index.",
};

/**
 * The dedicated headline for an `blocked` index produced ONLY because `--strict-open` escalated an open index —
 * there was no tampered / unreadable / blocked / invalid record, so the generic headline would misrepresent the cause.
 * Authored.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_STRICT_OPEN_ESCALATED_SUMMARY =
  "BLOCKED (--strict-open): the only concern is an OPEN or INCOMPLETE index (an open / incomplete closeout record in the considered history), and `--strict-open` escalates any open / incomplete index to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Without the flag this would be OPEN or INCOMPLETE (or ALL-CLOSED if within `--max-open` / `--max-incomplete`). No tampered / unreadable / blocked / invalid record was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId,
  { readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSeverity; readonly detail: string }
> = {
  "closeout-tampered": {
    severity: "invalid",
    detail:
      "A considered record is a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` whose recorded closeout coverage rollup does NOT re-derive from its own recorded primary-receipt facets + related-record signals + policy — a hand-edited or corrupt record. Recover the untampered record from your CI archive; a tampered record cannot be trusted in the index, so the index fails closed to INVALID above every other posture.",
  },
  "closeout-unreadable": {
    severity: "invalid",
    detail:
      "A considered record could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` (wrong schema or unparseable — never echoed), so it contributes no trusted verdict. An unreadable input is untrustworthy: recover a readable record produced by `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` and re-run. The index fails closed to INVALID, never a vacuous pass.",
  },
  "invalid-in-history": {
    severity: "invalid",
    detail:
      "A usable record in the window has its OWN verdict `invalid` — its closeout concluded there was no trustworthy receipt to close out (a missing / unreadable / tampered primary receipt). An invalid-posture closeout is an untrustworthy loop, not a bounded posture: recover the trusted evidence and re-close that release's loop. The index fails closed to INVALID above every trustworthy posture; there is no bounded tolerance for an invalid closeout.",
  },
  "latest-blocked": {
    severity: "blocking",
    detail:
      "The latest (newest) usable record's OWN verdict is `blocked` — its most recent follow-up loop had a blocked receipt / a contradictory related record / a blocked source chain. The recent history is not consistently closed: reconcile the latest record's block and re-close the loop before relying on the history.",
  },
  "blocked-in-history": {
    severity: "blocking",
    detail:
      "A usable record in the window is `blocked` (its receipt / chain was tampered / blocked / contradictory). A blocked closeout is a governance regression, not noise: reconcile the record(s) before treating the history as closed. Any blocked record fails the index closed — there is no bounded tolerance for a blocked closeout.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and the index would otherwise be OPEN (an open closeout record in the considered history), so the policy escalates it to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Close the open follow-up(s) (or drop `--strict-open` if an open history is acceptable for this review) before treating the history as closed.",
  },
  "latest-open": {
    severity: "open",
    detail:
      "The latest (newest) usable record's OWN verdict is `open` — an advisory follow-up remains open on the most recent loop. Track the follow-up to closure, re-close the latest loop, and re-index; this is not a hard block, but the history is not consistently closed.",
  },
  "open-threshold-exceeded": {
    severity: "open",
    detail:
      "The number of `open` records in the window exceeds `--max-open`. Recurring open follow-ups mean the recent releases are not being closed out promptly: track the open follow-ups to closure (or raise `--max-open` if a bounded open backlog is acceptable) before treating the history as consistently closed.",
  },
  "no-closeouts": {
    severity: "invalid",
    detail:
      "The window has zero usable records — every considered record was unreadable / tampered, or the history was empty. There is nothing trustworthy to index, so the index FAILS CLOSED to INVALID; supply a bounded history of readable `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` records (oldest first, newest last) and re-run.",
  },
  "latest-incomplete": {
    severity: "incomplete",
    detail:
      "The latest (newest) usable record's OWN verdict is `incomplete` — its most recent follow-up loop had a missing / unusable primary receipt or a missing required related record. Complete the missing evidence, re-close the latest loop, and re-index before treating the history as closed.",
  },
  "incomplete-threshold-exceeded": {
    severity: "incomplete",
    detail:
      "The number of `incomplete` records in the window exceeds `--max-incomplete`. A recurring incomplete record means recent releases are not being fully evidenced: complete the missing evidence (or raise `--max-incomplete` if a bounded incomplete backlog is acceptable) before treating the history as consistently closed.",
  },
  "latest-closed": {
    severity: "informational",
    detail:
      "The latest (newest) usable record's OWN verdict is `closed` — the most recent follow-up loop reads as fully closed out. This is the load-bearing marker for an `all-closed` index (provided the history is coherent within its thresholds); it records a bounded review, not an approval or a promotion.",
  },
  "history-coherent": {
    severity: "informational",
    detail:
      "Every considered record is a usable `closed` closeout record — the whole recent history reads as consistently closed, with no unreadable / tampered / open / incomplete / blocked / invalid record. Keep the underlying closeout records on your review cadence.",
  },
};

/** Per-checklist authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_CHECKLIST_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexChecklistId,
  string
> = {
  "recover-tampered-closeout":
    "Recover the tampered closeout record(s) from your CI archive: a record whose recorded rollup does not re-derive from its own recorded primary-receipt facets + related-record signals means the input was hand-edited or corrupt and cannot be trusted in the index.",
  "recover-unreadable-closeout":
    "Recover the unreadable closeout record(s): a record that cannot be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` is an untrustworthy input in the index. Recover a valid record produced by `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` and re-run.",
  "review-blocked-closeout":
    "A record in the window is `blocked` or `invalid` (its receipt / chain was tampered / blocked / contradictory, its own closeout concluded there was no trustworthy receipt to close out, or `--strict-open` escalated an open one): do NOT treat that release as closed. Reconcile the block / recover the trusted evidence and re-close that release's follow-up loop before relying on the history.",
  "review-open-closeout":
    "A record in the window is `open` (an advisory follow-up still open): track the recorded follow-up to closure, re-close that release's loop, and re-index before relying on the history. Archive this index as the record of that review.",
  "complete-incomplete-closeout":
    "A record in the window is `incomplete` (a missing / unusable primary receipt or a missing required related record): complete the missing evidence with `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` (supply the receipt / required records), re-close that release's loop, and re-index.",
  "supply-closeout-records":
    "Supply more / readable content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` records (a bounded history, oldest first) and re-run this index: an unreadable or empty history cannot be indexed.",
  "continue-recording-closeout":
    "The history is coherent: keep closing out one `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` loop per release and indexing them here on your review cadence. This index authorizes no promotion on its own.",
  "keep-closeout-index":
    "Keep this content-free index as the local release-decision-closeout-…-closeout-history review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this index is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_DISCLOSURE =
  "This is a content-free closeout-history INDEX SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests a bounded history of previously produced governance closeout records and records whether the recent finalization-index-trend follow-up loops read as consistently closed; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The index INDEXES a bounded history of the
 * chain's already content-free closeout records, RE-VALIDATES each one's self-consistency, and rolls them up into one
 * review verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE INDEX TREND FINALIZE INDEX TREND CLOSEOUT INDEX TREND CLOSEOUT INDEX: it INGESTS a bounded history of content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` closeout records a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded review verdict + follow-up checklist. It is a local content-free closeout-history INDEX SUMMARY over closeout records — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any record, artifact, object, or deployment. An `all-closed` index authorizes nothing; it only reports that the content-free closeout records supplied on THIS host indexed as consistently closed over the review window.",
  "An `all-closed` index REQUIRES a coherent bounded window: the latest usable record `closed`, no tampered / unreadable record, no blocked / invalid-posture record, and the open / incomplete counts within their thresholds. It FAILS CLOSED: a tampered OR unreadable record, a usable record whose OWN verdict is `invalid`, or zero usable records makes the index `invalid` (an untrustworthy input, the TOP precedence); any `blocked` record makes it `blocked`; an `incomplete` latest or an older incomplete-threshold breach makes it `incomplete`; an `open` latest or an older open-threshold breach makes it `open`; a `--strict-open` escalation of an open / incomplete window makes it `blocked`. It never fabricates an `all-closed` from thin or untrusted input.",
  "It re-derives each ingested record's coverage rollup from the record's OWN recorded primary-receipt facets + related-record signals + source-chain posture + policy (mirroring the Phase 89 `computeCloseout` reducer) and treats a recorded rollup that does not re-derive as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the index proves neither authorship nor approval, and a set of fully self-consistent fabricated records is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested record's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the index carries but does NOT itself perform — the honest edges of an offline indexer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand REVIEW summary (per sprint / quarter), NOT a per-release gate: run `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` per release and archive each record, then hand a bounded history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / untrustworthy history), surface exit 3 (an open history) and exit 2 (an incomplete history) for review, and treat exit 0 (a coherent history) as consistently closed — never as an authorization.",
  "Keep the history bounded and explicit: `--max-closeouts=N` caps the newest N records (older records are dropped from the window, and the count dropped is surfaced, never silent); `--max-open=N` / `--max-incomplete=N` (each default 0) tolerate a bounded number of non-closed OLDER records in the window before the accumulation escalates; `--strict-open` escalates any open OR incomplete window to a hard block for a high-assurance review.",
  "Archive this index (and the underlying closeout records) as CI artifacts: it is a content-free review SUMMARY, not a substitute for the records it indexes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this index SUMMARIZES a history of the content-free closeout records supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline indexer never performs.",
];
