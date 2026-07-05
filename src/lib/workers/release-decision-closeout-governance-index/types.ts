/**
 * The bounded, content-free vocabulary for the secure-worker **release decision closeout governance index** (Phase 70).
 *
 * Phases 59–69 built the release DECISION chain, one rung per phase, culminating (Phase 69) in the decision CLOSEOUT
 * GOVERNANCE BUNDLE (`pdfxyz.release-decision-closeout-governance/1`) — which composed the whole closeout chain (a
 * primary execution receipt plus the related plan / trend / index / closeout records it was built from) into ONE
 * governance verdict (`closed` / `governance-incomplete` / `governance-open` / `governance-blocked`) a review files per
 * release.
 *
 * This phase closes the *review* loop over a BOUNDED HISTORY of those governance bundles. It INGESTS one or more
 * `pdfxyz.release-decision-closeout-governance/1` documents (a sprint / quarter of release-governance bundles),
 * RE-VALIDATES each against ITSELF (re-deriving its Phase 69 governance rollup from its own recorded primary-receipt
 * source facets + per-kind related-record signals + policy, mirroring the Phase 69 `computeGovernance` reducer, so a
 * hand-flipped governance verdict / exit / rollup — or a flipped cross-check / posture signal — is caught as a tamper),
 * and folds them into ONE stable, content-free `pdfxyz.release-decision-closeout-governance-index/1` summary that
 * answers a single question a governance review needs —
 *
 *    "Across the recent release decision closeout governance bundles on this host, is the latest governance state
 *     CLOSED and the history coherent — or is the latest / recent history OPEN, INCOMPLETE, or BLOCKED?"
 *
 * — with a bounded index verdict, a governance-verdict distribution, the latest / oldest governance verdict, a
 * per-record posture sequence, a bounded rationale, and a bounded next-action checklist, and it FAILS CLOSED when a
 * governance bundle cannot be trusted or the history is inconclusive.
 *
 * It is LATEST-FOCUSED (unlike the Phase 60 decision index, which is worst-in-batch): the NEWEST usable governance
 * bundle's own verdict is the primary driver, and bounded history thresholds (`--max-open` / `--max-incomplete` /
 * `--max-blocked`, each defaulting to 0) let an operator tolerate a bounded number of non-closed bundles in the window
 * before the accumulation escalates the index.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it indexes:
 *  - Every load-bearing token here is a bounded enum — a record state, a governance verdict, an index verdict, a
 *    severity, a trend class, a reason id, a checklist id — never a filename, path, object key, bucket, URL, endpoint,
 *    region, id, token, size, byte, raw ref, raw label, raw note, reviewer identity, commit URL, or digest. The only
 *    non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested governance bundle (each — even one Phase 69 produced — is
 *    UNTRUSTED input here); it reduces every record to a bounded enum, a small integer, or a boolean, it never echoes
 *    an ingested bundle's OWN stamp (the index carries only its own), and it never echoes an input file path, even on
 *    an error.
 *  - It never fabricates an `indexed`. An `indexed` index REQUIRES a coherent bounded history: the latest usable
 *    governance bundle `closed`, no tampered / unreadable bundle, and the open / incomplete / blocked counts within
 *    their thresholds. A tampered bundle, a `governance-blocked` latest / threshold breach, or a `--strict-open`
 *    escalation makes the index `index-blocked`; an unreadable bundle, a `governance-incomplete` latest / threshold
 *    breach, or zero usable bundles makes it `index-incomplete`; a `governance-open` latest / threshold breach makes it
 *    `index-open`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It
 * PROVES nothing the governance bundles do not already prove; it INDEXES a bounded history of their content-free
 * governance verdicts, RE-VALIDATES each one's self-consistency, and rolls them up into one review verdict + follow-up
 * checklist. Its authored caveats (see {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CAVEATS}) say so out loud: it
 * is a local content-free governance-history INDEX SUMMARY over governance bundles — not a legal audit log, a
 * compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  type ReleaseDecisionCloseoutActionReceiptPlanClass,
  type ReleaseDecisionCloseoutActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceSourceState,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "../release-decision-closeout-governance/types";

/** The schema tag every governance-index result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA =
  "pdfxyz.release-decision-closeout-governance-index/1" as const;

/** The upstream document schema the index ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA };

/** The upstream governance verdicts the index tallies + surfaces per record, re-exported for convenience. */
export { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS };
export type { ReleaseDecisionCloseoutGovernanceVerdict, ReleaseDecisionCloseoutGovernanceSourceState };
export type { ReleaseDecisionCloseoutActionReceiptVerdict, ReleaseDecisionCloseoutActionReceiptPlanClass };

/** Stable identity of the release-decision-closeout-governance-index — for docs / receipts / audit. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_ID =
  "pdfxyz-worker-release-decision-closeout-governance-index";
/** Bump when the index surface, the verdict ladder, the reason / checklist / trend-class sets, or the schema changes. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION = 1;

/** The default window cap: the newest N governance bundles considered when `--max-governance` is not given. */
export const DEFAULT_MAX_GOVERNANCE = 100;

/**
 * The bounded coverage state of one ingested governance bundle — every supplied `--file` / `--governance` / stdin
 * element is SUPPLIED, so a record is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-decision-closeout-governance/1` (never echoed). It certifies nothing → a coverage
 *                   gap (INCOMPLETE), never a vacuous pass;
 *  - `tampered`   — recognized as a governance bundle but its recorded governance rollup does NOT re-derive from its own
 *                   recorded primary-receipt source + related-record signals + policy (a hand-edited / corrupt record)
 *                   → an untrustworthy INPUT (BLOCKING);
 *  - `usable`     — recognized AND self-consistent (its recorded governance rollup re-derives): trustworthy.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_RECORD_STATES = [
  "unreadable",
  "tampered",
  "usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceIndexRecordState =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_RECORD_STATES)[number];

/**
 * The single index verdict a governance review keys on — the answer to "are the recent release closeout governance
 * bundles consistently closed, and is follow-up warranted?":
 *  - `indexed`          — a COHERENT bounded history: the latest usable governance bundle is `closed`, no tampered /
 *                         unreadable bundle is present, and the open / incomplete / blocked counts are within their
 *                         thresholds. The recent release governance reads as consistently closed. It authorizes NOTHING;
 *  - `index-incomplete` — a COVERAGE GAP: zero usable bundles were considered, a considered bundle was unreadable, the
 *                         latest usable bundle's own verdict is `governance-incomplete`, or the incomplete count exceeds
 *                         `--max-incomplete`. Fail-closed, never a vacuous `indexed`;
 *  - `index-open`       — an OPEN follow-up posture: the latest usable bundle's own verdict is `governance-open`, or the
 *                         open count exceeds `--max-open`. Not a hard block — track it to closure;
 *  - `index-blocked`    — a BLOCKING / untrustworthy history: a considered bundle is tampered, the latest usable
 *                         bundle's own verdict is `governance-blocked`, the blocked count exceeds `--max-blocked`, or
 *                         `--strict-open` escalated an open index. Do NOT treat the history as consistently closed.
 *
 * These are the exact bounded values the run-level `worker_release_decision_closeout_governance_index_total` metric
 * carries as its `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS = [
  "indexed",
  "index-incomplete",
  "index-open",
  "index-blocked",
] as const;
export type ReleaseDecisionCloseoutGovernanceIndexVerdict =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS)[number];

/**
 * The exit-code ladder a CI / governance job routes on — the same shape / spirit as the whole release-decision suite:
 *  - `0` INDEXED     — a coherent history (the latest bundle closed and the history within thresholds);
 *  - `1` USAGE       — the CLI was misused (a bad flag, no bundle supplied, or an unwritable output). CLI-owned; an
 *                      index RUN never resolves to it;
 *  - `2` INCOMPLETE  — a coverage gap (zero usable bundles, an unreadable bundle, an incomplete latest / breach);
 *  - `3` OPEN        — an open posture (a `governance-open` latest, or an open-threshold breach);
 *  - `4` BLOCKED     — a blocking / untrustworthy history (a tampered bundle, a `governance-blocked` latest, a
 *                      blocked-threshold breach, or a `--strict-open` escalation).
 *
 * Monotonic in badness; `index-incomplete` (2) sorts before the `index-open` band (3) exactly like the rest of the
 * suite folds a coverage gap before an advisory posture.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT = {
  INDEXED: 0,
  USAGE: 1,
  INCOMPLETE: 2,
  OPEN: 3,
  BLOCKED: 4,
} as const;
export type ReleaseDecisionCloseoutGovernanceIndexExitCode =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT)[keyof typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionCloseoutGovernanceIndexVerdict,
  ReleaseDecisionCloseoutGovernanceIndexExitCode
> = {
  indexed: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT.INDEXED,
  "index-incomplete": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT.INCOMPLETE,
  "index-open": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT.OPEN,
  "index-blocked": RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT.BLOCKED,
};

/**
 * The common **severity** each fired index reason maps onto, with precedence
 * `blocking > open > incomplete > informational` (checked in that order — higher is worse, and the run's exit code
 * follows the worst fired severity):
 *  - `informational` — a benign index marker (the latest bundle closed / the whole history coherent);
 *  - `incomplete`    — a coverage gap (zero usable bundles, an unreadable bundle, an incomplete latest / breach);
 *  - `open`          — an open follow-up posture (an open latest / breach);
 *  - `blocking`      — an untrustworthy / blocked history (a tampered bundle, a blocked latest / breach, a
 *                      `--strict-open` escalation).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SEVERITIES = [
  "informational",
  "incomplete",
  "open",
  "blocking",
] as const;
export type ReleaseDecisionCloseoutGovernanceIndexSeverity =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SEVERITIES)[number];

/** One usable bundle's own verdict → the coarse severity it contributes to the trend class (never the index fold). */
export const GOVERNANCE_VERDICT_SEVERITY: Record<
  ReleaseDecisionCloseoutGovernanceVerdict,
  ReleaseDecisionCloseoutGovernanceIndexSeverity
> = {
  closed: "informational",
  "governance-incomplete": "incomplete",
  "governance-open": "open",
  "governance-blocked": "blocking",
};

/**
 * The bounded **trend class** — the single coarse classification of what the window contains, by worst-present (a
 * strict-INDEPENDENT description, so a `--strict-open` run can be `index-blocked` while still classing the window as
 * `open-present`), in this severity order:
 *  - `tampered-present`   — a tampered bundle is present (an untrustworthy input);
 *  - `blocked-present`    — a usable bundle's own verdict is `governance-blocked`;
 *  - `open-present`       — a usable bundle's own verdict is `governance-open`;
 *  - `incomplete-present` — a usable bundle's own verdict is `governance-incomplete`, or an unreadable bundle is
 *                           present (a coverage gap);
 *  - `all-closed`         — every usable bundle's own verdict is `closed` (and at least one is usable), with no
 *                           unreadable / tampered bundle;
 *  - `no-usable`          — the window has zero usable bundles (nothing to index).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CLASSES = [
  "all-closed",
  "open-present",
  "incomplete-present",
  "blocked-present",
  "tampered-present",
  "no-usable",
] as const;
export type ReleaseDecisionCloseoutGovernanceIndexTrendClass =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the index verdict resolved as it did, emitted in this stable
 * order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id
 * severity is authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_DETAIL}:
 *
 * Blocking (do NOT treat the history as consistently closed):
 *  - `governance-tampered`          — a considered bundle is recognized but its recorded rollup does NOT re-derive;
 *  - `latest-blocked`               — the latest usable bundle's own verdict is `governance-blocked`;
 *  - `blocked-threshold-exceeded`   — the blocked bundle count in the window exceeds `--max-blocked`;
 *  - `strict-open-escalation`       — `--strict-open` escalated an otherwise-open index to a hard block.
 *
 * Open (an advisory follow-up posture remains open):
 *  - `latest-open`                  — the latest usable bundle's own verdict is `governance-open`;
 *  - `open-threshold-exceeded`      — the open bundle count in the window exceeds `--max-open`.
 *
 * Incomplete (a coverage gap):
 *  - `no-governance`                — the window has zero usable bundles (nothing to index);
 *  - `governance-unreadable`        — a considered bundle could not be read / recognized (a coverage gap);
 *  - `latest-incomplete`            — the latest usable bundle's own verdict is `governance-incomplete`;
 *  - `incomplete-threshold-exceeded`— the incomplete bundle count in the window exceeds `--max-incomplete`.
 *
 * Informational (a benign index marker):
 *  - `latest-closed`                — the latest usable bundle's own verdict is `closed`;
 *  - `history-coherent`             — every considered bundle is a usable `closed` (a fully-clean history marker).
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS = [
  // Blocking
  "governance-tampered",
  "latest-blocked",
  "blocked-threshold-exceeded",
  "strict-open-escalation",
  // Open
  "latest-open",
  "open-threshold-exceeded",
  // Incomplete
  "no-governance",
  "governance-unreadable",
  "latest-incomplete",
  "incomplete-threshold-exceeded",
  // Informational
  "latest-closed",
  "history-coherent",
] as const;
export type ReleaseDecisionCloseoutGovernanceIndexReasonId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete operator steps the index can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `recover-tampered-governance`     — recover the tampered governance bundle(s) from your CI archive; a record whose
 *                                        rollup does not re-derive cannot be trusted in the index;
 *  - `review-blocked-governance`       — a bundle was blocked (its chain was tampered / blocked / contradictory);
 *                                        reconcile the block before treating the history as closed;
 *  - `recover-unreadable-governance`   — recover the unreadable governance bundle(s); a record the index cannot read is
 *                                        a coverage gap;
 *  - `supply-governance-records`       — supply more / readable `pdfxyz.release-decision-closeout-governance/1` records
 *                                        and re-run (a thin or empty history cannot be indexed);
 *  - `complete-incomplete-governance`  — a bundle was incomplete (a missing / unusable receipt or required record);
 *                                        complete the missing evidence, re-bundle the governance record, and re-index;
 *  - `review-open-governance`          — an open follow-up posture is present; track the follow-up to closure before
 *                                        relying on the history;
 *  - `continue-recording-governance`   — the history is coherent; keep composing one governance bundle per release and
 *                                        indexing them on your review cadence;
 *  - `keep-governance-index`           — keep this content-free index as the local governance-history review SUMMARY
 *                                        (always). It is NOT a legal audit log, a compliance attestation, an external
 *                                        approval, an identity proof, or a deployment / promotion ledger.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_IDS = [
  "recover-tampered-governance",
  "review-blocked-governance",
  "recover-unreadable-governance",
  "supply-governance-records",
  "complete-incomplete-governance",
  "review-open-governance",
  "continue-recording-governance",
  "keep-governance-index",
] as const;
export type ReleaseDecisionCloseoutGovernanceIndexChecklistId =
  (typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-record bounded facts + the reduced index point
 * ------------------------------------------------------------------ */

/**
 * The bounded facts reduced from a usable `pdfxyz.release-decision-closeout-governance/1` (its rollup re-derived in
 * ingest). Every field is a bounded enum, a small integer, or a boolean — never a raw value from the input.
 */
export interface GovernanceRecordFacts {
  /** The record's final governance verdict (trusted — the record re-derived its own rollup). */
  readonly verdict: ReleaseDecisionCloseoutGovernanceVerdict;
  /** The record's own exit code (context; the index has its own). */
  readonly exitCode: number;
  /** True iff `verdict === "closed"`. */
  readonly closed: boolean;
  /** The record's primary-receipt coverage state (context). */
  readonly receiptState: ReleaseDecisionCloseoutGovernanceSourceState;
  /** The record's primary-receipt verdict (trusted when its receipt was usable; the claim when tampered; else `null`). */
  readonly receiptVerdict: ReleaseDecisionCloseoutActionReceiptVerdict | null;
  /** The record's resolved plan class, or `null` when its receipt's plan was not usable. */
  readonly planClass: ReleaseDecisionCloseoutActionReceiptPlanClass | null;
  /** How many blocking reasons the record itself carried. */
  readonly blocking: number;
  /** How many open reasons the record itself carried. */
  readonly open: number;
  /** How many incomplete reasons the record itself carried. */
  readonly incomplete: number;
  /** How many related records the record itself contradicted or found blocking (context). */
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
  /** How many required related records the record itself was missing. */
  readonly requiredMissing: number;
  /** True iff the record was produced under `--strict-open`. */
  readonly strictOpen: boolean;
  /** True iff `--strict-open` escalated the record's own posture (context; never re-judged by the index). */
  readonly strictOpenEscalated: boolean;
}

/**
 * One reduced governance bundle in the index sequence — a bounded point ordered oldest → newest. Every field is a
 * bounded enum, a small integer, or app-authored prose; never a raw value from the input (not even the record's stamp).
 */
export interface ReleaseDecisionCloseoutGovernanceIndexPoint {
  /** 0-based position in the considered window, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The record's coverage state. */
  readonly state: ReleaseDecisionCloseoutGovernanceIndexRecordState;
  /**
   * The record's own governance verdict (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` record it is the untrusted CLAIMED verdict (surfaced so the sequence shows what was asserted).
   */
  readonly verdict: ReleaseDecisionCloseoutGovernanceVerdict | null;
  /** The record's primary-receipt verdict, or `null` when not usable. */
  readonly receiptVerdict: ReleaseDecisionCloseoutActionReceiptVerdict | null;
  /** The record's resolved plan class, or `null` when not usable. */
  readonly planClass: ReleaseDecisionCloseoutActionReceiptPlanClass | null;
  /** The record's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionCloseoutGovernanceIndexSeverity | null;
  /** A one-line, content-free headline authored from the position + state + verdict. */
  readonly detail: string;
}

/**
 * The bounded ledger summary — how many bundles were supplied / usable and the governance-verdict distribution. Every
 * count is over the USABLE considered records (an unreadable / tampered record contributes no trusted verdict), so the
 * summary never fabricates a posture.
 */
export interface ReleaseDecisionCloseoutGovernanceIndexLedger {
  /** How many governance inputs were supplied (before any cap). */
  readonly governanceSupplied: number;
  /** How many bundles were considered after the `--max-governance` window cap (the newest N). */
  readonly governanceConsidered: number;
  /** True iff `--max-governance` dropped older bundles from the window. */
  readonly truncated: boolean;
  /** How many older bundles were dropped by the window cap (`governanceSupplied − governanceConsidered`). */
  readonly droppedOldest: number;
  /** How many considered bundles are usable (recognized + self-consistent). */
  readonly governanceUsable: number;
  /** How many considered bundles were unreadable (not recognized as a governance bundle). */
  readonly governanceUnreadable: number;
  /** How many considered bundles were tampered (recognized but self-inconsistent). */
  readonly governanceTampered: number;
  /** The count of each governance verdict across the usable considered records (all four keys present). */
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceVerdict, number>>;
  /** The newest usable bundle's verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionCloseoutGovernanceVerdict | null;
  /** The oldest usable bundle's verdict, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionCloseoutGovernanceVerdict | null;
  /** The single coarse classification of what the window contains (strict-independent). */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceIndexTrendClass;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionCloseoutGovernanceIndexPolicy {
  /** The maximum number of newest bundles considered (the window cap). */
  readonly maxGovernance: number;
  /** The maximum tolerated `governance-open` bundles in the window before the open threshold fires (default 0). */
  readonly maxOpen: number;
  /** The maximum tolerated `governance-incomplete` bundles before the incomplete threshold fires (default 0). */
  readonly maxIncomplete: number;
  /** The maximum tolerated `governance-blocked` bundles before the blocked threshold fires (default 0). */
  readonly maxBlocked: number;
  /** True iff `--strict-open` was set (an open index escalates to `index-blocked`). */
  readonly strictOpen: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionCloseoutGovernanceIndexReason {
  readonly id: ReleaseDecisionCloseoutGovernanceIndexReasonId;
  readonly severity: ReleaseDecisionCloseoutGovernanceIndexSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseDecisionCloseoutGovernanceIndexChecklistItem {
  readonly id: ReleaseDecisionCloseoutGovernanceIndexChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite index decision — the single verdict + exit code a review acts on. THE TOP-LEVEL rollup. */
export interface ReleaseDecisionCloseoutGovernanceIndexRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceIndexVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceIndexExitCode;
  /** True iff `verdict === "indexed"`. */
  readonly indexed: boolean;
  /** The latest (newest) usable bundle's own governance verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceVerdict | null;
  /** The fired reason ids, in canonical order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceIndexReasonId[];
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
  readonly strictOpenEscalatedFrom: "index-open" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream governance schema). */
export interface ReleaseDecisionCloseoutGovernanceIndexMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION;
  readonly governanceSchema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA;
}

/**
 * The stable, content-free release decision closeout governance index a review / CI reads. Every field is a bounded
 * enum, a small integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator, size, path,
 * or byte, even from a hostile input, and never echoes an ingested bundle's own stamp.
 */
export interface ReleaseDecisionCloseoutGovernanceIndexResult {
  readonly schema: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionCloseoutGovernanceIndexMetadata;
  readonly policy: ReleaseDecisionCloseoutGovernanceIndexPolicy;
  readonly ledger: ReleaseDecisionCloseoutGovernanceIndexLedger;
  /** One reduced point per considered bundle, ordered oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceIndexPoint[];
  /** The composite index rollup (verdict + exit + reasons + strict flags). THE TOP-LEVEL rollup. */
  readonly governanceIndex: ReleaseDecisionCloseoutGovernanceIndexRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceIndexReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly checklist: readonly ReleaseDecisionCloseoutGovernanceIndexChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this index does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionCloseoutGovernanceIndexReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this
 * governance index conclude, over how many usable bundles, in what distribution, with what latest" for a SIEM / review
 * record. Bounded enums + small integers + a stable policy id + the run's own stamp + a disclosure statement only; safe
 * to log or forward verbatim.
 */
export interface ReleaseDecisionCloseoutGovernanceIndexReceipt {
  readonly category: "worker-release-decision-closeout-governance-index";
  readonly policyId: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionCloseoutGovernanceIndexVerdict;
  readonly exitCode: ReleaseDecisionCloseoutGovernanceIndexExitCode;
  /** How many governance inputs were supplied. */
  readonly governanceSupplied: number;
  /** How many bundles were considered after the window cap. */
  readonly governanceConsidered: number;
  /** How many considered bundles are usable. */
  readonly governanceUsable: number;
  /** The count of each governance verdict across the usable considered records (all four keys present). */
  readonly verdictCounts: Readonly<Record<ReleaseDecisionCloseoutGovernanceVerdict, number>>;
  /** The latest (newest) usable bundle's own governance verdict, or `null` if none is usable. */
  readonly latest: ReleaseDecisionCloseoutGovernanceVerdict | null;
  /** The single coarse classification of what the window contains. */
  readonly trendClass: ReleaseDecisionCloseoutGovernanceIndexTrendClass;
  /** The bounded, app-authored disclosure statement (what this index is NOT). Never derived from an input. */
  readonly disclosure: string;
}

/** The process exit code for an index result. */
export function releaseDecisionCloseoutGovernanceIndexExitCode(
  result: ReleaseDecisionCloseoutGovernanceIndexResult,
): number {
  return result.governanceIndex.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICT_SUMMARY: Record<
  ReleaseDecisionCloseoutGovernanceIndexVerdict,
  string
> = {
  indexed:
    "INDEXED: the recent release decision closeout governance bundles are consistently closed — the latest usable bundle is CLOSED, no tampered or unreadable bundle is present, and the open / incomplete / blocked counts are within their thresholds. Keep composing one governance bundle per release and indexing them on your review cadence. This index authorizes nothing on its own.",
  "index-incomplete":
    "INDEX-INCOMPLETE: the governance history has a COVERAGE GAP — zero usable bundles were considered, a considered bundle was unreadable, the latest usable bundle is GOVERNANCE-INCOMPLETE, or the incomplete count exceeds the threshold. Complete the missing evidence or supply a readable history, then re-index; this is not a coherent history.",
  "index-open":
    "INDEX-OPEN: an OPEN follow-up posture is present — the latest usable bundle is GOVERNANCE-OPEN, or the open count exceeds the threshold. Track the open follow-up(s) to closure and re-index; this is not a hard block, but the history is not consistently closed either.",
  "index-blocked":
    "INDEX-BLOCKED: a BLOCKING or untrustworthy history — a considered bundle is tampered, the latest usable bundle is GOVERNANCE-BLOCKED, the blocked count exceeds the threshold, or `--strict-open` escalated an open index. Do NOT treat the recent bundles as consistently closed until the cause is resolved.",
};

/**
 * The dedicated headline for an `index-blocked` index produced ONLY because `--strict-open` escalated an open index —
 * there was no tampered bundle, blocked latest, or blocked-threshold breach, so the generic headline would misrepresent
 * the cause. Authored.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_STRICT_OPEN_ESCALATED_SUMMARY =
  "INDEX-BLOCKED (--strict-open): the only concern is an OPEN index (a governance-open latest or an open-threshold breach), and `--strict-open` escalates any open index to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Without the flag this would be INDEX-OPEN. No tampered bundle, blocked latest, or blocked-threshold breach was found.";

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceIndexReasonId,
  { readonly severity: ReleaseDecisionCloseoutGovernanceIndexSeverity; readonly detail: string }
> = {
  "governance-tampered": {
    severity: "blocking",
    detail:
      "A considered bundle is a recognized `pdfxyz.release-decision-closeout-governance/1` whose recorded governance rollup does NOT re-derive from its own recorded primary-receipt source + related-record signals + policy — a hand-edited or corrupt record. Recover the untampered bundle from your CI archive; a tampered bundle cannot be indexed.",
  },
  "latest-blocked": {
    severity: "blocking",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `governance-blocked` — its most recent governance chain was tampered / blocked / contradictory. The recent history is not consistently closed: reconcile the latest bundle's block and re-bundle it before relying on the history.",
  },
  "blocked-threshold-exceeded": {
    severity: "blocking",
    detail:
      "The number of `governance-blocked` bundles in the window exceeds `--max-blocked`. A recurring blocked bundle is a governance regression, not noise: reconcile the blocked bundles (or raise `--max-blocked` only if the blocked history is understood and accepted) before treating the history as closed.",
  },
  "strict-open-escalation": {
    severity: "blocking",
    detail:
      "`--strict-open` was set and the index would otherwise be OPEN (a governance-open latest or an open-threshold breach), so the policy escalates it to a hard block — a `consistently closed or blocked` gate for a high-assurance review. Close the open follow-up(s) (or drop `--strict-open` if an open history is acceptable for this review) before treating the history as closed.",
  },
  "latest-open": {
    severity: "open",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `governance-open` — an advisory follow-up remains open on the most recent release. Track the follow-up to closure, re-bundle the latest governance record, and re-index; this is not a hard block, but the history is not consistently closed.",
  },
  "open-threshold-exceeded": {
    severity: "open",
    detail:
      "The number of `governance-open` bundles in the window exceeds `--max-open`. Recurring open follow-ups mean the recent releases are not being closed out promptly: track the open follow-ups to closure (or raise `--max-open` if a bounded open backlog is acceptable) before treating the history as consistently closed.",
  },
  "no-governance": {
    severity: "incomplete",
    detail:
      "The window has zero usable bundles — every considered record was unreadable / tampered, or the history was empty. There is nothing to index; supply a bounded history of readable `pdfxyz.release-decision-closeout-governance/1` records and re-run.",
  },
  "governance-unreadable": {
    severity: "incomplete",
    detail:
      "A considered bundle could not be read / recognized as a `pdfxyz.release-decision-closeout-governance/1` (wrong schema or unparseable — never echoed), so it contributes no trusted verdict. The index is incomplete; recover a readable bundle produced by `worker:release-decision-closeout-governance` and re-run.",
  },
  "latest-incomplete": {
    severity: "incomplete",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `governance-incomplete` — its most recent governance chain had a missing / unusable primary receipt or a missing required related record. Complete the missing evidence, re-bundle the latest governance record, and re-index before treating the history as closed.",
  },
  "incomplete-threshold-exceeded": {
    severity: "incomplete",
    detail:
      "The number of `governance-incomplete` bundles in the window exceeds `--max-incomplete`. A recurring incomplete bundle means recent releases are not being fully evidenced: complete the missing evidence (or raise `--max-incomplete` if a bounded incomplete backlog is acceptable) before treating the history as consistently closed.",
  },
  "latest-closed": {
    severity: "informational",
    detail:
      "The latest (newest) usable bundle's OWN verdict is `closed` — the most recent release governance chain reads as closed out. This is the load-bearing marker for an `indexed` index (provided the history is coherent within its thresholds); it records a bounded review, not an approval or a promotion.",
  },
  "history-coherent": {
    severity: "informational",
    detail:
      "Every considered bundle is a usable `closed` governance bundle — the whole recent history reads as consistently closed, with no unreadable / tampered / open / incomplete / blocked bundle. Keep the underlying governance bundles on your review cadence.",
  },
};

/** Per-checklist authored detail, keyed by id. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CHECKLIST_DETAIL: Record<
  ReleaseDecisionCloseoutGovernanceIndexChecklistId,
  string
> = {
  "recover-tampered-governance":
    "Recover the tampered governance bundle(s) from your CI archive: a bundle whose recorded rollup does not re-derive from its own recorded primary-receipt source + related-record signals means the input was hand-edited or corrupt and cannot be trusted in the index.",
  "review-blocked-governance":
    "A bundle in the window is `governance-blocked` (its chain was tampered / blocked / contradictory, or `--strict-open` escalated an open one): do NOT treat that release as closed. Reconcile the block and re-bundle that release's governance record before relying on the history.",
  "recover-unreadable-governance":
    "Recover the unreadable governance bundle(s): a record that cannot be read / recognized as a `pdfxyz.release-decision-closeout-governance/1` is a coverage gap in the index. Recover a valid bundle produced by `worker:release-decision-closeout-governance` and re-run.",
  "supply-governance-records":
    "Supply more / readable content-free `pdfxyz.release-decision-closeout-governance/1` records (a bounded history, oldest first) and re-run this index: an unreadable or empty history cannot be indexed.",
  "complete-incomplete-governance":
    "A bundle in the window is `governance-incomplete` (a missing / unusable primary receipt or a missing required related record): complete the missing evidence with `worker:release-decision-closeout-governance` (supply the receipt / required records), re-bundle that release's governance record, and re-index.",
  "review-open-governance":
    "A bundle in the window is `governance-open` (an advisory follow-up still open): track the recorded follow-up to closure, re-bundle that release's governance record, and re-index before relying on the history. Archive this index as the record of that review.",
  "continue-recording-governance":
    "The history is coherent: keep composing one `worker:release-decision-closeout-governance` bundle per release and indexing them here on your review cadence. This index authorizes no promotion on its own.",
  "keep-governance-index":
    "Keep this content-free index as the local release-decision-closeout-governance-history review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/** The bounded, app-authored disclosure statement the receipt + text render carry (what this index is NOT). */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_DISCLOSURE =
  "This is a content-free governance-history INDEX SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. It ingests a bounded history of previously produced governance bundles and records whether the recent release decision closeout governance reads as consistently closed; it authorizes and proves nothing, and it attests no person's identity.";

/**
 * The honesty caveats every result carries and every text render prints. The index INDEXES a bounded history of the
 * chain's already content-free governance bundles, RE-VALIDATES each one's self-consistency, and rolls them up into one
 * review verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION CLOSEOUT GOVERNANCE INDEX: it INGESTS a bounded history of content-free `pdfxyz.release-decision-closeout-governance/1` governance bundles a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded review verdict + follow-up checklist. It is a local content-free governance-history INDEX SUMMARY over governance bundles — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / index / decision / trend / plan / receipt / closeout / governance itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any record, artifact, object, or deployment. An `indexed` index authorizes nothing; it only reports that the content-free governance bundles supplied on THIS host indexed as consistently closed over the review history.",
  "An `indexed` index REQUIRES a coherent bounded history: the latest usable bundle `closed`, no tampered / unreadable bundle, and the open / incomplete / blocked counts within their thresholds. It FAILS CLOSED: a tampered bundle, a `governance-blocked` latest / threshold breach, or a `--strict-open` escalation makes the index `index-blocked`; an unreadable bundle, a `governance-incomplete` latest / threshold breach, or zero usable bundles makes it `index-incomplete`; a `governance-open` latest / threshold breach makes it `index-open`. It never fabricates an `indexed` from thin or untrusted input.",
  "It re-derives each ingested bundle's rollup from the bundle's OWN recorded primary-receipt source facets + related-record signals + policy (mirroring the Phase 69 `computeGovernance` reducer) and treats a recorded rollup that does not re-derive as a TAMPER (`index-blocked`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the index proves neither authorship nor approval, and a set of fully self-consistent fabricated records is out of its scope.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested bundle's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the index carries but does NOT itself perform — the honest edges of an offline indexer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand REVIEW summary (per sprint / quarter), NOT a per-release gate: run `worker:release-decision-closeout-governance` per release and archive each bundle, then hand a bounded history (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked / untrustworthy history), surface exit 3 (an open history) and exit 2 (an incomplete history) for review, and treat exit 0 (a coherent history) as consistently closed — never as an authorization.",
  "Keep the history bounded and explicit: `--max-governance=N` caps the newest N bundles (older bundles are dropped from the window, and the count dropped is surfaced, never silent); `--max-open=N` / `--max-incomplete=N` / `--max-blocked=N` (each default 0) tolerate a bounded number of non-closed bundles in the window before the accumulation escalates; `--strict-open` escalates any open index to a hard block for a high-assurance review.",
  "Archive this index (and the underlying governance bundles) as CI artifacts: it is a content-free review SUMMARY, not a substitute for the bundles it indexes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this index SUMMARIZES a history of the content-free governance bundles supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline indexer never performs.",
];
