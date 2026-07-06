/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance finalize index**
 * (Phase 75).
 *
 * Phases 63–74 built the release DECISION CLOSEOUT GOVERNANCE chain, one rung per phase, culminating (Phase 74) in the
 * governance FINALIZATION BUNDLE (`pdfxyz.release-decision-closeout-governance-finalize/1`) — which composed the whole
 * closeout-governance chain (a required primary action-plan execution receipt plus the optional related plan / trend /
 * index / governance records it was built from) into ONE finalization verdict (`finalized` / `finalize-incomplete` /
 * `finalize-open` / `finalize-blocked`) a governance review archives as the FINAL record for one chain.
 *
 * This phase closes the *review* loop over a BOUNDED HISTORY of those finalization bundles. It INGESTS one or more
 * `pdfxyz.release-decision-closeout-governance-finalize/1` documents (a sprint / quarter of finalized closeout-governance
 * chains), RE-VALIDATES each against ITSELF (re-deriving its Phase 74 finalization rollup from its own recorded
 * primary-receipt `source` facets + per-kind `related[]` state / signal + policy, mirroring the Phase 74
 * `computeGovernanceFinalize` reducer, so a hand-flipped finalization verdict / exit / rollup — or a flipped cross-check /
 * posture signal — is caught as a tamper), and folds them into ONE stable, content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index/1` summary that answers a single question a governance
 * review needs —
 *
 *    "Across the recent release decision closeout governance FINALIZATION bundles on this host, is the latest
 *     finalization state consistently FINALIZED — or is the latest / recent history OPEN, INCOMPLETE, BLOCKED, or
 *     UNTRUSTWORTHY?"
 *
 * — with a bounded index verdict, a finalization-verdict distribution, a bounded summary of the newest usable
 * finalization, a per-record posture sequence, a bounded rationale, and a bounded next-action checklist, and it FAILS
 * CLOSED when a finalization bundle cannot be trusted or the history is inconclusive.
 *
 * It is LATEST-FOCUSED (like the Phase 70 governance index): the NEWEST usable finalization bundle's own verdict is the
 * primary driver, and bounded history thresholds (`--max-open` / `--max-incomplete`, each defaulting to 0) let an
 * operator tolerate a bounded number of non-finalized OLDER bundles in the window before the accumulation escalates the
 * index. Unlike the Phase 70 index, it adds a top-precedence `index-invalid` verdict: any tampered OR unreadable input
 * FAILS CLOSED to `index-invalid` (a bundle that cannot be trusted must never be silently counted as usable), and any
 * blocked finalization (not a bounded count) escalates to `index-blocked`.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it indexes:
 *  - Every load-bearing token here is a bounded enum — a record state, a finalization verdict, an index verdict, a
 *    severity, a trend class, a reason id, a checklist id — never a filename, path, object key, bucket, URL, endpoint,
 *    region, id, token, size, byte, raw ref, raw label, raw note, reviewer identity, commit URL, or digest. The only
 *    non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested finalization bundle (each — even one Phase 74 produced — is
 *    UNTRUSTED input here); it reduces every record to a bounded enum, a small integer, or a boolean, it never echoes an
 *    ingested bundle's OWN stamp (the index carries only its own), and it never echoes an input file path, even on an
 *    error.
 *  - It never fabricates an `indexed`. An `indexed` index REQUIRES a coherent bounded history: the latest usable
 *    finalization bundle `finalized`, no tampered / unreadable bundle, no blocked bundle, and the open / incomplete
 *    counts within their thresholds. A tampered / unreadable bundle makes the index `index-invalid`; a `finalize-blocked`
 *    latest / any blocked bundle, or a `--strict-open` escalation, makes it `index-blocked`; a `finalize-incomplete`
 *    latest / threshold breach, or zero usable bundles, makes it `index-incomplete`; a `finalize-open` latest / threshold
 *    breach makes it `index-open`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It
 * PROVES nothing the finalization bundles do not already prove; it INDEXES a bounded history of their content-free
 * finalization verdicts, RE-VALIDATES each one's self-consistency, and rolls them up into one review verdict + follow-up
 * checklist. Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_CAVEATS}) say so out
 * loud: it is a local content-free finalization-history INDEX SUMMARY over finalization bundles — not a legal audit log,
 * a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize/types";

/** The schema tag every finalize-index result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-finalize-index/1" as const;

/** The upstream document schema the index ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA };

/** The upstream finalization verdicts the index tallies + surfaces per record, re-exported for convenience. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS };
export type { ReleaseDecisionCloseoutGovernanceFinalizeVerdict, ReleaseDecisionCloseoutGovernanceFinalizeSourceState };
export type { ReleaseDecisionCloseoutGovernanceActionReceiptVerdict, ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass };

/** Stable identity of the release-decision-closeout-governance-finalize-index — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-finalize-index";
/** Bump when the index surface, the verdict ladder, the reason / checklist / trend-class sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_VERSION = 1;

/** The default window cap: the newest N finalization bundles considered when `--max-finalizations` is not given. */
export const DEFAULT_MAX_FINALIZATIONS = 26;
/** The hard ceiling on `--max-finalizations`: a review history is bounded, never an unbounded list. */
export const MAX_MAX_FINALIZATIONS = 104;

/**
 * The bounded coverage state of one ingested finalization bundle — every supplied `--finalization` / `--file` / stdin
 * element is SUPPLIED, so a record is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance-finalize/1` (never echoed). It certifies nothing → an
 *                   UNTRUSTWORTHY input (fail-closed to INVALID);
 *  - `tampered`   — recognized as a finalization bundle but its recorded finalization rollup does NOT re-derive from its
 *                   own recorded primary-receipt source + related-record signals + policy (a hand-edited / corrupt
 *                   record) → an UNTRUSTWORTHY input (fail-closed to INVALID);
 *  - `usable`     — recognized AND self-consistent (its recorded finalization rollup re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_RECORD_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexRecordState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_RECORD_STATES)[number];

/**
 * The single index verdict a governance review keys on — the answer to "are the recent release closeout governance
 * FINALIZATION bundles consistently finalized, and is follow-up warranted?":
 *  - `indexed`          — a COHERENT bounded history: the latest usable finalization bundle is `finalized`, no tampered /
 *                         unreadable bundle is present, no blocked bundle is present, and the open / incomplete counts
 *                         are within their thresholds. The recent finalization history reads as consistently finalized.
 *                         It authorizes NOTHING;
 *  - `index-open`       — an OPEN follow-up posture: the latest usable bundle's own verdict is `finalize-open`, or the
 *                         open count exceeds `--max-open`. Not a hard block — track it to closure;
 *  - `index-incomplete` — a COVERAGE GAP: zero usable bundles were considered, the latest usable bundle's own verdict is
 *                         `finalize-incomplete`, the incomplete count exceeds `--max-incomplete`, or `--require-latest-
 *                         finalized` demanded a finalized latest and did not get one. Fail-closed, never a vacuous
 *                         `indexed`;
 *  - `index-blocked`    — a BLOCKING history: the latest usable bundle's own verdict is `finalize-blocked`, ANY usable
 *                         bundle is `finalize-blocked`, or `--strict-open` escalated an open history. Do NOT treat the
 *                         history as consistently finalized;
 *  - `index-invalid`    — an UNTRUSTWORTHY history: a considered bundle is tampered (its rollup does not re-derive) or
 *                         unreadable (not a recognized finalization bundle). A bundle that cannot be trusted fails closed
 *                         to the TOP precedence, above every other posture — recover the untampered / readable bundles
 *                         before indexing.
 *
 * These are the exact bounded values the run-level `worker_release_decision_closeout_governance_finalize_index_total`
 * metric carries as its `verdict` label; all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS = [
  "indexed",
  "index-open",
  "index-incomplete",
  "index-blocked",
  "index-invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-decision suite:
 *  - `0` INDEXED     — a coherent history (the latest bundle finalized and the history within thresholds);
 *  - `1` USAGE       — the CLI was misused (a bad flag, no bundle supplied, or an unwritable output). CLI-owned; an
 *                      index RUN never resolves to it;
 *  - `2` INCOMPLETE  — a coverage gap (zero usable bundles, an incomplete latest / breach, a require-latest miss);
 *  - `3` OPEN        — an open posture (a `finalize-open` latest, or an open-threshold breach);
 *  - `4` BLOCKED     — a blocking history (a `finalize-blocked` latest / any blocked bundle, or a `--strict-open`
 *                      escalation);
 *  - `4` INVALID     — an untrustworthy history (a tampered or unreadable bundle). Shares exit 4 with BLOCKED (both are
 *                      "do not treat this history as finalized"), but is a DISTINCT verdict so a reviewer can tell a
 *                      broken input apart from a blocked chain.
 *
 * `index-incomplete` (2) sorts before the `index-open` band (3) by exit value, exactly like the rest of the suite; the
 * fail-closed PRECEDENCE (which verdict wins when several conditions apply) is `invalid > blocked > open > incomplete >
 * indexed`.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT = {
  INDEXED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  OPEN: 3,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexExitCode
> = {
  indexed: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.INDEXED,
  "index-open": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.OPEN,
  "index-incomplete": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.INCOMPLETE,
  "index-blocked": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.BLOCKED,
  "index-invalid": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.INVALID,
};

/**
 * The common **severity** each fired index reason maps onto, with precedence
 * `invalid > blocking > open > incomplete > informational` (checked in that order — higher is worse, and the run's exit
 * code follows the worst fired severity):
 *  - `informational` — a benign index marker (the latest bundle finalized / the whole history coherent);
 *  - `incomplete`    — a coverage gap (zero usable bundles, an incomplete latest / breach, a require-latest miss);
 *  - `open`          — an open follow-up posture (an open latest / breach);
 *  - `blocking`      — a blocked history (a blocked latest / any blocked bundle, a `--strict-open` escalation);
 *  - `invalid`       — an UNTRUSTWORTHY input (a tampered or unreadable bundle). The top precedence: a bundle that
 *                      cannot be trusted is worse than a bundle that is trustworthy-but-blocked.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SEVERITIES)[number];

/** One usable bundle's own verdict → the coarse severity it contributes to the trend class (never the index fold). */
export const FINALIZE_VERDICT_SEVERITY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexSeverity
> = {
  finalized: "informational",
  "finalize-incomplete": "incomplete",
  "finalize-open": "open",
  "finalize-blocked": "blocking",
};

/**
 * The bounded **trend class** — the single coarse classification of what the window contains, by worst-present (a
 * strict-INDEPENDENT description, so a `--strict-open` run can be `index-blocked` while still classing the window as
 * `open-present`), in this severity order:
 *  - `invalid-present`    — a tampered or unreadable bundle is present (an untrustworthy input);
 *  - `blocked-present`    — a usable bundle's own verdict is `finalize-blocked`;
 *  - `open-present`       — a usable bundle's own verdict is `finalize-open`;
 *  - `incomplete-present` — a usable bundle's own verdict is `finalize-incomplete`;
 *  - `all-finalized`      — every usable bundle's own verdict is `finalized` (and at least one is usable), with no
 *                           unreadable / tampered bundle;
 *  - `no-usable`          — the window has zero usable bundles and no other signal (nothing to index).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CLASSES = [
  "all-finalized",
  "open-present",
  "incomplete-present",
  "blocked-present",
  "invalid-present",
  "no-usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the index verdict resolved as it did, emitted in this stable order
 * (a superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id severity is
 * authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_DETAIL}:
 *
 * Invalid (an untrustworthy input — TOP precedence):
 *  - `finalization-tampered`         — a considered bundle is recognized but its recorded rollup does NOT re-derive;
 *  - `finalization-unreadable`       — a considered bundle could not be read / recognized (an untrustworthy input).
 *
 * Blocking (do NOT treat the history as finalized):
 *  - `latest-blocked`                — the latest usable bundle's own verdict is `finalize-blocked`;
 *  - `blocked-in-history`            — a usable bundle in the window is `finalize-blocked` (any blocked bundle);
 *  - `strict-open-escalation`        — `--strict-open` escalated an otherwise-open history to a hard block.
 *
 * Open (an advisory follow-up posture remains open):
 *  - `latest-open`                   — the latest usable bundle's own verdict is `finalize-open`;
 *  - `open-threshold-exceeded`       — the open bundle count in the window exceeds `--max-open`.
 *
 * Incomplete (a coverage gap):
 *  - `no-finalizations`              — the window has zero usable bundles (nothing to index);
 *  - `latest-incomplete`             — the latest usable bundle's own verdict is `finalize-incomplete`;
 *  - `incomplete-threshold-exceeded` — the incomplete bundle count in the window exceeds `--max-incomplete`;
 *  - `latest-not-finalized`          — `--require-latest-finalized` demanded a finalized latest, and the latest usable
 *                                      bundle's own verdict is not `finalized`.
 *
 * Informational (a benign index marker):
 *  - `latest-finalized`              — the latest usable bundle's own verdict is `finalized`;
 *  - `history-coherent`              — every considered bundle is a usable `finalized` (a fully-clean history marker).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_IDS = [
  // Invalid
  "finalization-tampered",
  "finalization-unreadable",
  // Blocking
  "latest-blocked",
  "blocked-in-history",
  "strict-open-escalation",
  // Open
  "latest-open",
  "open-threshold-exceeded",
  // Incomplete
  "no-finalizations",
  "latest-incomplete",
  "incomplete-threshold-exceeded",
  "latest-not-finalized",
  // Informational
  "latest-finalized",
  "history-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete operator steps the index can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `recover-tampered-finalization`   — recover the tampered finalization bundle(s) from your CI archive; a record whose
 *                                        rollup does not re-derive cannot be trusted in the index;
 *  - `recover-unreadable-finalization` — recover the unreadable finalization bundle(s); a record the index cannot read is
 *                                        an untrustworthy input;
 *  - `review-blocked-finalization`     — a bundle was blocked (its chain was tampered / blocked / contradictory);
 *                                        reconcile the block before treating the history as finalized;
 *  - `review-open-finalization`        — an open follow-up posture is present; track the follow-up to closure before
 *                                        relying on the history;
 *  - `complete-incomplete-finalization`— a bundle was incomplete (a missing / unusable receipt or required record);
 *                                        complete the missing evidence, re-finalize the record, and re-index;
 *  - `supply-finalization-records`     — supply more / readable `pdfxyz.release-decision-closeout-governance-finalize/1`
 *                                        records and re-run (a thin or empty history cannot be indexed);
 *  - `continue-recording-finalization` — the history is coherent; keep finalizing one governance chain per release and
 *                                        indexing them on your review cadence;
 *  - `keep-finalize-index`             — keep this content-free index as the local finalization-history review SUMMARY
 *                                        (always). It is NOT a legal audit log, a compliance attestation, an external
 *                                        approval, an identity proof, or a deployment / promotion ledger.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_CHECKLIST_IDS = [
  "recover-tampered-finalization",
  "recover-unreadable-finalization",
  "review-blocked-finalization",
  "review-open-finalization",
  "complete-incomplete-finalization",
  "supply-finalization-records",
  "continue-recording-finalization",
  "keep-finalize-index",
] as const;
export type ReleaseDecisionCloseoutGovernanceFinalizeIndexChecklistId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-record bounded facts + the reduced index point
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-governance-finalize/1` (its rollup re-derived
 * in ingest). Every field is a bounded enum, a small integer, or a boolean — never a raw value from the input.
 */
export interface FinalizeRecordFacts {
  /** The record's final finalization verdict (trusted — the record re-derived its own rollup). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
  /** The record's own exit code (context; the index has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "finalized"`. */
  readonly finalized: boolean;
  /** The record's primary-receipt coverage state (context). */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  /** The record's primary-receipt verdict (trusted when its receipt was usable; the claim when tampered; else `null`). */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  /** The record's resolved plan class, or `null` when its receipt's plan was not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  /** How many of the four related records the record itself had supplied. */
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
 * One reduced finalization bundle in the index sequence — a bounded point ordered oldest → newest (the supplied order).
 * Every field is a bounded enum, a small integer, or app-authored prose; never a raw value from the input (not even the
 * record's stamp).
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexPoint {
  /** 0-based position in the considered window, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The record's coverage state. */
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexRecordState;
  /**
   * The record's own finalization verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` record it is the untrusted CLAIMED verdict (surfaced so the sequence shows what was asserted).
   */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The record's primary-receipt coverage state, or `null` when not usable. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState | null;
  /** The record's primary-receipt verdict, or `null` when not usable. */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  /** The record's resolved plan class, or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  /** The record's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexSeverity | null;
  /** A one-line, content-free headline authored from the position + state + verdict. */
  readonly detail: string;
}

/**
 * The bounded coverage summary — how many bundles were supplied / considered / usable, and the untrustworthy counts.
 * Every count is a small non-negative integer; an unreadable / tampered record contributes no trusted verdict.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage {
  /** How many finalization inputs were supplied (before any cap). */
  readonly finalizationsSupplied: number;
  /** How many bundles were considered after the `--max-finalizations` window cap (the newest N). */
  readonly finalizationsConsidered: number;
  /** How many considered bundles are usable (recognized + self-consistent). */
  readonly finalizationsUsable: number;
  /** How many considered bundles were unreadable (not recognized as a finalization bundle). */
  readonly finalizationsUnreadable: number;
  /** How many considered bundles were tampered (recognized but self-inconsistent). */
  readonly finalizationsTampered: number;
  /** True iff `--max-finalizations` dropped older bundles from the window. */
  readonly truncated: boolean;
  /** How many older bundles were dropped by the window cap (`finalizationsSupplied − finalizationsConsidered`). */
  readonly droppedOldest: number;
}

/**
 * The bounded distribution summary — the finalization-verdict histogram over the USABLE considered records plus the
 * newest / oldest usable verdict and the single coarse trend class. Never fabricates a posture (an unreadable / tampered
 * record contributes nothing).
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution {
  /** The count of each finalization verdict across the usable considered records (all four keys present). */
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>>;
  /** The newest usable bundle's verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The oldest usable bundle's verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The single coarse classification of what the window contains (strict-independent). */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
}

/**
 * The bounded summary of the NEWEST usable finalization bundle only — the primary driver of the index verdict. Every
 * field is a bounded enum or small integer; no timestamp / stamp. `null` when no bundle is usable.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexLatest {
  /** The newest usable bundle's own finalization verdict. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
  /** Its primary-receipt coverage state. */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  /** Its primary-receipt verdict, or `null` when the receipt was not usable. */
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  /** Its resolved plan class, or `null` when the receipt's plan was not usable. */
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  /** How many of its four related records were supplied. */
  readonly relatedSupplied: number;
  /** How many of its supplied related records were contradictory. */
  readonly relatedContradictory: number;
  /** How many of its supplied related records were blocking. */
  readonly relatedBlocking: number;
  /** True iff it was produced under `--strict-open`. */
  readonly strictOpen: boolean;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy {
  /** The maximum number of newest bundles considered (the window cap). */
  readonly maxFinalizations: number;
  /** The maximum tolerated `finalize-open` bundles in the window before the open threshold fires (default 0). */
  readonly maxOpen: number;
  /** The maximum tolerated `finalize-incomplete` bundles before the incomplete threshold fires (default 0). */
  readonly maxIncomplete: number;
  /** True iff `--require-latest-finalized` was set (the latest usable bundle must be `finalized`). */
  readonly requireLatestFinalized: boolean;
  /** True iff `--strict-open` was set (an open index escalates to `index-blocked`). */
  readonly strictOpen: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexReason {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexChecklistItem {
  readonly id: ReleaseDecisionCloseoutGovernanceFinalizeIndexChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite index decision — the single verdict + exit code a review acts on. THE TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexExitCode;
  /** True iff `verdict === "indexed"`. */
  readonly indexed: boolean;
  /** The latest (newest) usable bundle's own finalization verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The oldest usable bundle's own finalization verdict, or `null` if none is usable. */
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The single coarse classification of what the window contains (strict-independent). */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId[];
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
  /** True iff `--strict-open` ESCALATED an open index to `index-blocked`. */
  readonly strictOpenEscalated: boolean;
  /** Which verdict `--strict-open` escalated FROM, or `null` when no escalation applied. */
  readonly strictOpenEscalatedFrom: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream finalization schema). */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_VERSION;
  readonly finalizeSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this
 * finalization index conclude, over how many usable bundles, in what distribution, with what latest" for a SIEM / review
 * record. Bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement only; safe
 * to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexReceipt {
  readonly category: "worker-release-decision-closeout-governance-finalize-index";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexExitCode;
  /** How many finalization inputs were supplied. */
  readonly finalizationsSupplied: number;
  /** How many bundles were considered after the window cap. */
  readonly finalizationsConsidered: number;
  /** How many considered bundles are usable. */
  readonly finalizationsUsable: number;
  /** How many considered bundles were unreadable. */
  readonly finalizationsUnreadable: number;
  /** How many considered bundles were tampered. */
  readonly finalizationsTampered: number;
  /** The count of each finalization verdict across the usable considered records (all four keys present). */
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>>;
  /** The latest (newest) usable bundle's own finalization verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The single coarse classification of what the window contains. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass;
  /** The bounded, app-authored disclosure statement (what this index is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/**
 * The stable, content-free release decision closeout governance finalize index a review / CI reads. Every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator,
 * size, path, or byte, even from a hostile input, and never echoes an ingested bundle's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceFinalizeIndexMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy;
  /** The single index verdict a reviewer keys on (mirrors `finalizeIndex.verdict`). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict;
  /** The process exit code (mirrors `finalizeIndex.exitCode`). */
  readonly exitCode: ReleaseDecisionCloseoutGovernanceFinalizeIndexExitCode;
  /** The bounded coverage summary (supplied / considered / usable / unreadable / tampered / dropped). */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage;
  /** The bounded finalization-verdict distribution over the usable considered records. */
  readonly distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution;
  /** The bounded summary of the newest usable finalization bundle, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexLatest | null;
  /** One reduced point per considered bundle, ordered oldest → newest (the supplied order). */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexPoint[];
  /** The composite index rollup (verdict + exit + reasons + strict flags). THE TOP-LEVEL rollup. */
  readonly finalizeIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly nextActions: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this index does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexReceipt;
}

/** The process exit code for an index result. */
export function releaseDecisionCloseoutGovernanceFinalizeIndexExitCode(
  result: ReleaseDecisionCloseoutGovernanceFinalizeIndexResult,
): number {
  return result.finalizeIndex.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  string
> = {
  indexed:
    "INDEXED: the recent release decision closeout governance FINALIZATION bundles are consistently finalized — the latest usable bundle is FINALIZED, no tampered / unreadable / blocked bundle is present, and the open / incomplete counts are within their thresholds. Keep finalizing one governance chain per release and indexing them on your review cadence. This index authorizes nothing on its own.",
  "index-open":
    "INDEX-OPEN: an OPEN follow-up posture is present — the latest usable bundle is FINALIZE-OPEN, or the open count exceeds the threshold. Track the open follow-up(s) to closure and re-index; this is not a hard block, but the history is not consistently finalized either.",
  "index-incomplete":
    "INDEX-INCOMPLETE: the finalization history has a COVERAGE GAP — zero usable bundles were considered, the latest usable bundle is FINALIZE-INCOMPLETE, the incomplete count exceeds the threshold, or `--require-latest-finalized` demanded a finalized latest and did not get one. Complete the missing evidence or supply a coherent latest, then re-index; this is not a coherent history.",
  "index-blocked":
    "INDEX-BLOCKED: a BLOCKING history — the latest usable bundle is FINALIZE-BLOCKED, a usable bundle in the window is blocked, or `--strict-open` escalated an open index. Do NOT treat the recent bundles as consistently finalized until the cause is resolved.",
  "index-invalid":
    "INDEX-INVALID: an UNTRUSTWORTHY history — a considered bundle is tampered (its recorded rollup does NOT re-derive from its own recorded facets) or unreadable (not a recognized `pdfxyz.release-decision-closeout-governance-finalize/1`). A bundle that cannot be trusted fails closed above every other posture: recover the untampered / readable bundles from your CI archive and re-index.",
};

/**
 * The dedicated headline for an `index-blocked` index produced ONLY because `--strict-open` escalated an open index —
 * there was no tampered / unreadable / blocked bundle, so the generic headline would misrepresent the cause. Authored.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_STRICT_OPEN_ESCALATED_SUMMARY =
  "INDEX-BLOCKED (--strict-open): the only concern is an OPEN index (a finalize-open bundle in the considered history), and `--strict-open` escalates any open index to a hard block — a `consistently finalized or blocked` gate for a high-assurance review. Without the flag this would be INDEX-OPEN (or INDEXED if the open was within `--max-open`). No tampered / unreadable / blocked bundle was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId,
  { readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexSeverity; readonly detail: string }
> = {
  "finalization-tampered": {
    severity: "invalid",
    detail:
      "A considered bundle is a recognized `pdfxyz.release-decision-closeout-governance-finalize/1` whose recorded finalization rollup does NOT re-derive from its own recorded primary-receipt source + related-record signals + policy — a hand-edited or corrupt record. Recover the untampered bundle from your CI archive; a tampered bundle cannot be trusted in the index, so the index fails closed to INVALID above every other posture.",
  },
  "finalization-unreadable": {
    severity: "invalid",
    detail:
      "A considered bundle could not be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize/1` (wrong schema or unparseable — never echoed), so it contributes no trusted verdict. An unreadable input is untrustworthy: recover a readable bundle produced by `worker:release-decision-closeout-governance-finalize` and re-run. The index fails closed to INVALID, never a vacuous pass.",
  },
  "latest-blocked": {
    severity: "blocking",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `finalize-blocked` — its most recent finalization chain was tampered / blocked / contradictory. The recent history is not consistently finalized: reconcile the latest bundle's block and re-finalize it before relying on the history.",
  },
  "blocked-in-history": {
    severity: "blocking",
    detail:
      "A usable bundle in the window is `finalize-blocked` (its chain was tampered / blocked / contradictory). A blocked finalization is a governance regression, not noise: reconcile the blocked bundle(s) before treating the history as finalized. Any blocked bundle fails the index closed — there is no bounded tolerance for a blocked finalization.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and the index would otherwise be OPEN (a finalize-open bundle in the considered history), so the policy escalates it to a hard block — a `consistently finalized or blocked` gate for a high-assurance review. Close the open follow-up(s) (or drop `--strict-open` if an open history is acceptable for this review) before treating the history as finalized.",
  },
  "latest-open": {
    severity: "open",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `finalize-open` — an advisory follow-up remains open on the most recent finalization. Track the follow-up to closure, re-finalize the latest governance chain, and re-index; this is not a hard block, but the history is not consistently finalized.",
  },
  "open-threshold-exceeded": {
    severity: "open",
    detail:
      "The number of `finalize-open` bundles in the window exceeds `--max-open`. Recurring open follow-ups mean the recent releases are not being finalized promptly: track the open follow-ups to closure (or raise `--max-open` if a bounded open backlog is acceptable) before treating the history as consistently finalized.",
  },
  "no-finalizations": {
    severity: "incomplete",
    detail:
      "The window has zero usable bundles — every considered record was unreadable / tampered, or the history was empty. There is nothing to index; supply a bounded history of readable `pdfxyz.release-decision-closeout-governance-finalize/1` records and re-run.",
  },
  "latest-incomplete": {
    severity: "incomplete",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `finalize-incomplete` — its most recent finalization chain had a missing / unusable primary receipt or a missing required related record. Complete the missing evidence, re-finalize the latest governance chain, and re-index before treating the history as finalized.",
  },
  "incomplete-threshold-exceeded": {
    severity: "incomplete",
    detail:
      "The number of `finalize-incomplete` bundles in the window exceeds `--max-incomplete`. A recurring incomplete bundle means recent releases are not being fully evidenced: complete the missing evidence (or raise `--max-incomplete` if a bounded incomplete backlog is acceptable) before treating the history as consistently finalized.",
  },
  "latest-not-finalized": {
    severity: "incomplete",
    detail:
      "`--require-latest-finalized` was set and the latest (newest) usable bundle's OWN verdict is NOT `finalized` — the review policy demands the most recent finalization reach a fully-finalized state, and it has not. Finalize the latest governance chain and re-index (or drop `--require-latest-finalized` if a non-finalized latest is acceptable for this review).",
  },
  "latest-finalized": {
    severity: "informational",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `finalized` — the most recent release governance chain reads as fully finalized. This is the load-bearing marker for an `indexed` index (provided the history is coherent within its thresholds); it records a bounded review, not an approval or a promotion.",
  },
  "history-coherent": {
    severity: "informational",
    detail:
      "Every considered bundle is a usable `finalized` finalization bundle — the whole recent history reads as consistently finalized, with no unreadable / tampered / open / incomplete / blocked bundle. Keep the underlying finalization bundles on your review cadence.",
  },
};

/** Per-checklist authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_CHECKLIST_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexChecklistId,
  string
> = {
  "recover-tampered-finalization":
    "Recover the tampered finalization bundle(s) from your CI archive: a bundle whose recorded rollup does not re-derive from its own recorded primary-receipt source + related-record signals means the input was hand-edited or corrupt and cannot be trusted in the index.",
  "recover-unreadable-finalization":
    "Recover the unreadable finalization bundle(s): a record that cannot be read / recognized as a `pdfxyz.release-decision-closeout-governance-finalize/1` is an untrustworthy input in the index. Recover a valid bundle produced by `worker:release-decision-closeout-governance-finalize` and re-run.",
  "review-blocked-finalization":
    "A bundle in the window is `finalize-blocked` (its chain was tampered / blocked / contradictory, or `--strict-open` escalated an open one): do NOT treat that release as finalized. Reconcile the block and re-finalize that release's governance chain before relying on the history.",
  "review-open-finalization":
    "A bundle in the window is `finalize-open` (an advisory follow-up still open): track the recorded follow-up to closure, re-finalize that release's governance chain, and re-index before relying on the history. Archive this index as the record of that review.",
  "complete-incomplete-finalization":
    "A bundle in the window is `finalize-incomplete` (a missing / unusable primary receipt or a missing required related record): complete the missing evidence with `worker:release-decision-closeout-governance-finalize` (supply the receipt / required records), re-finalize that release's governance chain, and re-index.",
  "supply-finalization-records":
    "Supply more / readable content-free `pdfxyz.release-decision-closeout-governance-finalize/1` records (a bounded history, oldest first) and re-run this index: an unreadable or empty history cannot be indexed.",
  "continue-recording-finalization":
    "The history is coherent: keep finalizing one `worker:release-decision-closeout-governance-finalize` bundle per release and indexing them here on your review cadence. This index authorizes no promotion on its own.",
  "keep-finalize-index":
    "Keep this content-free index as the local release-decision-closeout-governance-finalize-history review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this index is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_DISCLOSURE =
  "This is a content-free finalization-history INDEX SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests a bounded history of previously produced governance finalization bundles and records whether the recent release decision closeout governance reads as consistently finalized; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The index INDEXES a bounded history of the
 * chain's already content-free finalization bundles, RE-VALIDATES each one's self-consistency, and rolls them up into
 * one review verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE FINALIZE INDEX: it INGESTS a bounded history of content-free `pdfxyz.release-decision-closeout-governance-finalize/1` finalization bundles a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded review verdict + follow-up checklist. It is a local content-free finalization-history INDEX SUMMARY over finalization bundles — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any record, artifact, object, or deployment. An `indexed` index authorizes nothing; it only reports that the content-free finalization bundles supplied on THIS host indexed as consistently finalized over the review history.",
  "An `indexed` index REQUIRES a coherent bounded history: the latest usable bundle `finalized`, no tampered / unreadable bundle, no blocked bundle, and the open / incomplete counts within their thresholds. It FAILS CLOSED: a tampered OR unreadable bundle makes the index `index-invalid` (an untrustworthy input, the TOP precedence); a `finalize-blocked` latest / any blocked bundle, or a `--strict-open` escalation, makes it `index-blocked`; a `finalize-incomplete` latest / threshold breach, a `--require-latest-finalized` miss, or zero usable bundles makes it `index-incomplete`; a `finalize-open` latest / threshold breach makes it `index-open`. It never fabricates an `indexed` from thin or untrusted input.",
  "It re-derives each ingested bundle's rollup from the bundle's OWN recorded primary-receipt source facets + related-record signals + policy (mirroring the Phase 74 `computeGovernanceFinalize` reducer) and treats a recorded rollup that does not re-derive as a TAMPER (`index-invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the index proves neither authorship nor approval, and a set of fully self-consistent fabricated records is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested bundle's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the index carries but does NOT itself perform — the honest edges of an offline indexer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand REVIEW summary (per sprint / quarter), NOT a per-release gate: run `worker:release-decision-closeout-governance-finalize` per release and archive each bundle, then hand a bounded history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / untrustworthy history), surface exit 3 (an open history) and exit 2 (an incomplete history) for review, and treat exit 0 (a coherent history) as consistently finalized — never as an authorization.",
  "Keep the history bounded and explicit: `--max-finalizations=N` caps the newest N bundles (older bundles are dropped from the window, and the count dropped is surfaced, never silent); `--max-open=N` / `--max-incomplete=N` (each default 0) tolerate a bounded number of non-finalized OLDER bundles in the window before the accumulation escalates; `--require-latest-finalized` demands a finalized latest; `--strict-open` escalates any open index to a hard block for a high-assurance review.",
  "Archive this index (and the underlying finalization bundles) as CI artifacts: it is a content-free review SUMMARY, not a substitute for the bundles it indexes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this index SUMMARIZES a history of the content-free finalization bundles supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline indexer never performs.",
];
