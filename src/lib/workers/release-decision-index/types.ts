/**
 * The bounded, content-free vocabulary for the secure-worker **release decision ledger index** (Phase 60).
 *
 * Phases 46–59 built the release-evidence chain, one rung per phase: the release readiness gate folds the
 * content-free worker checks into ONE promotion verdict; the release artifact stamps it with bounded provenance +
 * an integrity digest; the release index re-verifies many artifacts into a retention manifest; the release policy
 * asserts bounded operator thresholds; the release CI bundle composes a single release job's stage outputs; the
 * release audit diffs a baseline bundle against a current one; the operator report folds a bundle + audit into ONE
 * recommendation; the trend summary summarizes a bounded HISTORY of those reports; the governance bundle composes a
 * trend + latest report / audit for a review; the archive pack, restore drill, publish / handoff pack, and handoff
 * acknowledgement carry the evidence through archival, recoverability, hand-off, and receipt; and the release
 * DECISION record (`pdfxyz.release-decision/1`, Phase 59) composes a publish pack + its acknowledgement into ONE
 * bounded decision (`proceed` / `proceed-with-followup` / `hold` / `reject` / `insufficient` / `invalid`) an operator
 * files as the ledger entry for a single release.
 *
 * This phase closes the *review* loop over a BOUNDED BATCH of those decision records. It INGESTS one or more
 * `pdfxyz.release-decision/1` documents (a sprint / month of release decisions), RE-VALIDATES each against ITSELF
 * (reusing the Phase 59 rollup reducer, so a hand-flipped decision is caught as a tamper), and folds them into ONE
 * stable, content-free `pdfxyz.release-decision-index/1` summary that answers a single question an audit / review
 * needs —
 *
 *    "Over the batch of release decisions on this host, what did they decide, is anything blocking / inconclusive /
 *     untrustworthy, and what bounded operator follow-up is warranted?"
 *
 * — with a bounded index verdict, a decision distribution, per-source posture counts, a per-record posture
 * sequence, a bounded rationale, and a bounded next-action checklist, and it FAILS CLOSED when a record cannot be
 * trusted or the batch is inconclusive.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the records it
 * indexes:
 *  - Every load-bearing token here is a bounded enum — a record state, a decision, a cross-check status, a severity,
 *    an index verdict, a trend class, a reason id, a checklist id — never a filename, path, object key, bucket, URL,
 *    endpoint, region, id, token, size, byte, raw ref, raw label, reviewer identity, commit URL, or digest. The only
 *    non-enum values are small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested record (each — even one Phase 59 produced — is UNTRUSTED
 *    input here); it reduces every record to a bounded enum, a small integer, or a boolean, it never echoes an
 *    ingested record's OWN stamp (the index carries only its own), and it never echoes an input file path, even on
 *    an error.
 *  - It never fabricates a "stable". A `stable` index REQUIRES a clean bounded batch: no tampered / unreadable
 *    record and every usable record a clean `proceed`. A tampered / unreadable record makes the index `invalid`; a
 *    `reject` / `invalid` decision makes it `blocked`; an `insufficient` decision (or zero usable records) is
 *    `insufficient`; a `proceed-with-followup` / `hold` decision is `watch`.
 *
 * It is deliberately NOT a new evidence rung, NOT a legal audit trail, NOT a compliance attestation, NOT an external
 * signature, NOT an identity ledger, NOT storage-retention ENFORCEMENT, and NOT a deployment / promotion ledger. It
 * PROVES nothing the records do not already prove; it INDEXES a bounded batch of their content-free decisions,
 * RE-VALIDATES each one's self-consistency, and rolls them up into one review verdict + follow-up checklist. Its
 * authored caveats (see {@link RELEASE_DECISION_INDEX_CAVEATS}) say so out loud: it is a local content-free ledger
 * INDEX SUMMARY over decision records — not a legal audit log, compliance attestation, external approval / signature,
 * identity proof, or deployment / promotion ledger.
 */

import {
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_SCHEMA,
  type ReleaseDecisionCrossCheckStatus,
  type ReleaseDecisionDecision,
} from "../release-decision/types";
import { RELEASE_DECISION_CROSS_CHECKS } from "../release-decision/types";

/** The schema tag every release-decision-index result carries, so tooling can pin the shape it parses. */
export const RELEASE_DECISION_INDEX_SCHEMA = "pdfxyz.release-decision-index/1" as const;

/** The upstream document schema the index ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_DECISION_SCHEMA };

/** Stable identity of the release-decision-index — for docs / receipts / audit. */
export const RELEASE_DECISION_INDEX_POLICY_ID = "pdfxyz-worker-release-decision-index";
/** Bump when the index surface, the verdict ladder, the reason / checklist / trend-class sets, or the schema changes. */
export const RELEASE_DECISION_INDEX_POLICY_VERSION = 1;

/** The decisions the index tallies + surfaces per record, re-exported for convenience. */
export { RELEASE_DECISION_DECISIONS, RELEASE_DECISION_CROSS_CHECKS };
export type { ReleaseDecisionDecision, ReleaseDecisionCrossCheckStatus };

/** The default window cap: the newest N records considered when `--max-records` is not given. */
export const DEFAULT_MAX_RECORDS = 100;

/**
 * The bounded coverage state of one ingested decision record — every supplied `--file` / `--decision` / stdin
 * element is SUPPLIED (unlike a decision's per-source `absent`), so a record is one of:
 *  - `unreadable` — an element was supplied but could not be read / parsed / recognized as a
 *                   `pdfxyz.release-decision/1` (never echoed). It certifies nothing → INVALID input;
 *  - `tampered`   — recognized as a decision but its recorded decision does NOT re-derive from its own recorded
 *                   pack / ack summaries + cross-check + strict (a hand-edited / corrupt record) → INVALID input;
 *  - `usable`     — recognized AND self-consistent (its recorded decision re-derives): trustworthy.
 */
export const RELEASE_DECISION_INDEX_RECORD_STATES = ["unreadable", "tampered", "usable"] as const;
export type ReleaseDecisionIndexRecordState = (typeof RELEASE_DECISION_INDEX_RECORD_STATES)[number];

/**
 * The single index verdict an audit / review keys on — the answer to "how is the batch of release decisions, and is
 * follow-up warranted?":
 *  - `stable`       — a clean bounded batch: no tampered / unreadable record, and every usable record is a clean
 *                     `proceed`. The recent release decisions are healthy;
 *  - `watch`        — no blocker / invalid input and the batch is sufficient, but an ADVISORY concern is present: a
 *                     usable record decided `proceed-with-followup` or `hold`. Review, then decide;
 *  - `insufficient` — the batch is INCONCLUSIVE: zero usable records were considered, or a usable record decided
 *                     `insufficient` (an incomplete pack / a deferred acknowledgement). Fail-closed, not a stable;
 *  - `blocked`      — a BLOCKING decision is present: a usable record decided `reject` or `invalid` (its release was
 *                     rejected, or its evidence pair was untrustworthy), or `--strict` escalated a non-clean batch.
 *                     Do not treat the batch as clean;
 *  - `invalid`      — an untrustworthy INPUT: a supplied record was unreadable or is recognized-but-self-inconsistent
 *                     (a tamper). The ledger index itself cannot be trusted until the record is recovered. Dominates.
 *
 * These are the exact bounded values the run-level `worker_release_decision_index_total` metric carries as its
 * `verdict` label; all five are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_DECISION_INDEX_VERDICTS = [
  "stable",
  "watch",
  "insufficient",
  "blocked",
  "invalid",
] as const;
export type ReleaseDecisionIndexVerdict = (typeof RELEASE_DECISION_INDEX_VERDICTS)[number];

/**
 * The exit-code ladder a CI / review job routes on — the same shape as the whole release-evidence suite so the tools
 * speak one language:
 *  - `0` STABLE       — a clean, healthy batch of release decisions;
 *  - `1` USAGE        — the CLI was misused (a bad flag, no record supplied, or an unwritable output). CLI-owned; an
 *                       index RUN never resolves to it;
 *  - `2` INSUFFICIENT — the batch was inconclusive (zero usable records, or an `insufficient` decision);
 *  - `3` WATCH        — an advisory batch (a `proceed-with-followup` / `hold` decision present);
 *  - `4` BLOCKED      — a blocking decision (`reject` / `invalid` decision, or a strict violation);
 *  - `4` INVALID      — an untrustworthy input (an unreadable / tampered record).
 *
 * Monotonic in badness within each band; `insufficient` (2) sorts before the `watch` band (3) exactly like the rest
 * of the suite folds insufficiency before advisory. `blocked` and `invalid` share the top code `4` but are distinct
 * verdicts (a rejected / invalid DECISION in a VALID record vs an untrustworthy / unreadable INPUT).
 */
export const RELEASE_DECISION_INDEX_EXIT = {
  STABLE: 0,
  USAGE: 1,
  INSUFFICIENT: 2,
  WATCH: 3,
  BLOCKED: 4,
  INVALID: 4,
} as const;
export type ReleaseDecisionIndexExitCode =
  (typeof RELEASE_DECISION_INDEX_EXIT)[keyof typeof RELEASE_DECISION_INDEX_EXIT];

/** The authoritative verdict → exit code map. */
export const RELEASE_DECISION_INDEX_EXIT_FOR_VERDICT: Record<
  ReleaseDecisionIndexVerdict,
  ReleaseDecisionIndexExitCode
> = {
  stable: RELEASE_DECISION_INDEX_EXIT.STABLE,
  watch: RELEASE_DECISION_INDEX_EXIT.WATCH,
  insufficient: RELEASE_DECISION_INDEX_EXIT.INSUFFICIENT,
  blocked: RELEASE_DECISION_INDEX_EXIT.BLOCKED,
  invalid: RELEASE_DECISION_INDEX_EXIT.INVALID,
};

/**
 * The common **severity** each usable record's decision, and each fired index reason, maps onto so the index can
 * fold a batch of decisions + record states into one verdict, with precedence
 * `invalid > blocking > insufficient > advisory > ready` (checked in that order — so an untrustworthy input never
 * masquerades as a mere blocker, an insufficiency never as an advisory, and a real blocker is never masked):
 *  - `ready`        — a usable record that decided `proceed` (best);
 *  - `advisory`     — a usable record that decided `proceed-with-followup` or `hold`, or an advisory reason;
 *  - `insufficient` — a usable record that decided `insufficient`, or zero usable records (an insufficiency reason);
 *  - `blocking`     — a usable record that decided `reject` or `invalid` (a blocking reason);
 *  - `invalid`      — an unreadable / tampered record (an untrustworthy input, worst).
 */
export const RELEASE_DECISION_INDEX_SEVERITIES = [
  "ready",
  "advisory",
  "insufficient",
  "blocking",
  "invalid",
] as const;
export type ReleaseDecisionIndexSeverity = (typeof RELEASE_DECISION_INDEX_SEVERITIES)[number];

/** The severity rank (higher = worse) — used for the fold precedence. */
export const RELEASE_DECISION_INDEX_SEVERITY_RANK: Record<ReleaseDecisionIndexSeverity, number> = {
  ready: 0,
  advisory: 1,
  insufficient: 2,
  blocking: 3,
  invalid: 4,
};

/**
 * A usable record's own decision → common index severity. A recorded `invalid` decision (the Phase 59 tool
 * concluded the pack / ack pair was untrustworthy or incoherent) is a BLOCKING ledger outcome — "do not proceed" —
 * NOT an untrustworthy INDEX input (that is a `tampered` / `unreadable` record state, which is the `invalid` band).
 */
export const DECISION_SEVERITY: Record<ReleaseDecisionDecision, ReleaseDecisionIndexSeverity> = {
  proceed: "ready",
  "proceed-with-followup": "advisory",
  hold: "advisory",
  insufficient: "insufficient",
  reject: "blocking",
  invalid: "blocking",
};

/**
 * The bounded **trend class** — the single coarse classification of what the batch contains, by worst-present, in
 * this severity order (a strict-INDEPENDENT description of the window, so a `--strict` run can be `blocked` while
 * still classing the window as `hold-present`):
 *  - `invalid-input`         — an unreadable / tampered record is present (an untrustworthy input);
 *  - `rejection-present`     — a usable record decided `reject` or `invalid` (a blocking decision);
 *  - `insufficient-evidence` — zero usable records, or a usable record decided `insufficient`;
 *  - `hold-present`          — a usable record decided `hold` (the stronger advisory);
 *  - `followup-present`      — a usable record decided `proceed-with-followup`;
 *  - `all-clear`             — every usable record decided a clean `proceed` (and at least one is usable).
 */
export const RELEASE_DECISION_INDEX_TREND_CLASSES = [
  "all-clear",
  "followup-present",
  "hold-present",
  "rejection-present",
  "insufficient-evidence",
  "invalid-input",
] as const;
export type ReleaseDecisionIndexTrendClass = (typeof RELEASE_DECISION_INDEX_TREND_CLASSES)[number];

/**
 * The bounded reason ids — the closed set of REASONS the index verdict resolved as it did, emitted in this stable
 * order (a superset view, so a reviewer sees every condition that applied, not only the winning one). The per-id
 * severity is authored in {@link RELEASE_DECISION_INDEX_REASON_DETAIL}:
 *
 * Invalid input (a record can't be trusted):
 *  - `record-unreadable`      — a supplied record could not be read / recognized as a `pdfxyz.release-decision/1`;
 *  - `record-tampered`        — a supplied record is recognized but its recorded decision does NOT re-derive.
 *
 * Blocking (a release was not / must not proceed):
 *  - `decision-rejected`      — a usable record decided `reject` (a blocking outcome);
 *  - `decision-invalid`       — a usable record decided `invalid` (its evidence pair was untrustworthy / incoherent).
 *
 * Insufficient (the batch is inconclusive):
 *  - `no-usable-records`      — the window has zero usable records (nothing to index);
 *  - `decision-insufficient`  — a usable record decided `insufficient` (an incomplete pack / a deferred ack).
 *
 * Advisory:
 *  - `decision-hold`          — a usable record decided `hold` (needs internal review) → the stronger advisory;
 *  - `decision-followup`      — a usable record decided `proceed-with-followup` (a tracked follow-up).
 */
export const RELEASE_DECISION_INDEX_REASON_IDS = [
  // Invalid input
  "record-unreadable",
  "record-tampered",
  // Blocking
  "decision-rejected",
  "decision-invalid",
  // Insufficient
  "no-usable-records",
  "decision-insufficient",
  // Advisory
  "decision-hold",
  "decision-followup",
] as const;
export type ReleaseDecisionIndexReasonId = (typeof RELEASE_DECISION_INDEX_REASON_IDS)[number];

/**
 * The bounded next-action checklist ids — the closed set of concrete operator steps the index can recommend, in this
 * canonical order (the checklist is emitted in this order, deduped):
 *  - `recover-invalid-records`        — recover the unreadable / tampered decision record(s) from your CI archive; a
 *                                       record the index cannot trust must be resolved before the batch is relied on;
 *  - `review-blocking-decisions`      — a release was rejected, or its evidence pair was untrustworthy; do NOT treat
 *                                       those releases as proceeded, and resolve the cause;
 *  - `supply-decision-records`        — supply more / readable `pdfxyz.release-decision/1` records and re-run (a thin
 *                                       or empty batch cannot be indexed);
 *  - `complete-insufficient-evidence` — a release decision was inconclusive (an incomplete pack / a deferred ack);
 *                                       complete the missing evidence or resolve the deferral, then re-decide;
 *  - `review-advisory-decisions`      — a follow-up / needs-review decision is present; track the follow-up or hold
 *                                       for internal review before relying on the batch;
 *  - `continue-recording-decisions`   — the batch is clean; keep filing one decision record per release and indexing
 *                                       them on your review cadence;
 *  - `keep-decision-index`            — keep this content-free index as the local ledger review SUMMARY (always). It
 *                                       is NOT a legal audit log, a compliance attestation, an external approval, an
 *                                       identity proof, or a deployment / promotion ledger.
 */
export const RELEASE_DECISION_INDEX_CHECKLIST_IDS = [
  "recover-invalid-records",
  "review-blocking-decisions",
  "supply-decision-records",
  "complete-insufficient-evidence",
  "review-advisory-decisions",
  "continue-recording-decisions",
  "keep-decision-index",
] as const;
export type ReleaseDecisionIndexChecklistId = (typeof RELEASE_DECISION_INDEX_CHECKLIST_IDS)[number];

/* ------------------------------------------------------------------ *
 *  Per-record bounded facts + the reduced index point
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a usable `pdfxyz.release-decision/1` (its decision re-derived in ingest). */
export interface DecisionRecordFacts {
  /** The record's final decision (trusted — the record re-derived its own decision). */
  readonly decision: ReleaseDecisionDecision;
  /** The record's own exit code (context; the index has its own). */
  readonly exitCode: number;
  /** True iff `decision === "proceed"`. */
  readonly proceed: boolean;
  /** The record's coherence cross-check status (match / mismatch / unknown). */
  readonly crossCheck: ReleaseDecisionCrossCheckStatus;
  /** How many invalid-input reasons the record itself carried. */
  readonly invalidInputs: number;
  /** How many blocking reasons the record itself carried. */
  readonly blocking: number;
  /** How many insufficiency reasons the record itself carried. */
  readonly insufficiencies: number;
  /** How many advisory reasons the record itself carried. */
  readonly advisories: number;
  /** True iff the record was produced under `--strict`. */
  readonly strict: boolean;
  /** True iff `--strict` escalated the record's own posture (context; never re-judged by the index). */
  readonly strictEscalated: boolean;
}

/**
 * One reduced record in the index sequence — a bounded point ordered oldest → newest. Every field is a bounded enum,
 * a small integer, or app-authored prose; never a raw value from the input (not even the record's stamp).
 */
export interface ReleaseDecisionIndexPoint {
  /** 0-based position in the considered window, oldest = 0 (never the input's own stamp). */
  readonly position: number;
  /** The record's coverage state. */
  readonly state: ReleaseDecisionIndexRecordState;
  /**
   * The record's own decision token (a bounded enum), or `null` when unreadable. Trusted only when `usable`; for a
   * `tampered` record it is the untrusted CLAIMED decision (surfaced so the sequence shows what was asserted).
   */
  readonly decision: ReleaseDecisionDecision | null;
  /** The record's coherence cross-check status, or `null` when not usable. */
  readonly crossCheck: ReleaseDecisionCrossCheckStatus | null;
  /** The record's contribution on the common severity ladder, or `null` when not usable. */
  readonly severity: ReleaseDecisionIndexSeverity | null;
  /** A one-line, content-free headline authored from the position + state + decision. */
  readonly detail: string;
}

/**
 * The bounded ledger summary — how many records were supplied / usable, the decision distribution, and the bounded
 * source-posture (cross-check) distribution. Every count is over the USABLE considered records (an unreadable /
 * tampered record contributes no trusted decision), so the summary never fabricates a posture.
 */
export interface ReleaseDecisionIndexLedger {
  /** How many record inputs were supplied (before any cap). */
  readonly recordsSupplied: number;
  /** How many records were considered after the `--max-records` window cap (the newest N). */
  readonly recordsConsidered: number;
  /** True iff `--max-records` dropped older records from the window. */
  readonly truncated: boolean;
  /** How many older records were dropped by the window cap (`recordsSupplied − recordsConsidered`). */
  readonly droppedOldest: number;
  /** How many considered records are usable (recognized + self-consistent). */
  readonly recordsUsable: number;
  /** How many considered records were unreadable (not recognized as a decision). */
  readonly recordsUnreadable: number;
  /** How many considered records were tampered (recognized but self-inconsistent). */
  readonly recordsTampered: number;
  /** The count of each decision across the usable considered records (all six keys present). */
  readonly decisionCounts: Readonly<Record<ReleaseDecisionDecision, number>>;
  /** The count of each cross-check status across the usable considered records (a bounded source-posture tally). */
  readonly crossCheckCounts: Readonly<Record<ReleaseDecisionCrossCheckStatus, number>>;
  /** The newest usable record's decision, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly newest: ReleaseDecisionDecision | null;
  /** The oldest usable record's decision, or `null` if none is usable (a coarse ordinal, never a timestamp). */
  readonly oldest: ReleaseDecisionDecision | null;
  /** The single coarse classification of what the batch contains (strict-independent). */
  readonly trendClass: ReleaseDecisionIndexTrendClass;
}

/** The bounded, applied policy knobs (from the validated args). */
export interface ReleaseDecisionIndexPolicy {
  /** The maximum number of newest records considered (the window cap). */
  readonly maxRecords: number;
  /** True iff `--strict` was set (any advisory / insufficiency / rejection / invalid input escalates to `blocked`). */
  readonly strict: boolean;
}

/** One fired reason, with its resolved severity + authored detail. */
export interface ReleaseDecisionIndexReason {
  readonly id: ReleaseDecisionIndexReasonId;
  readonly severity: ReleaseDecisionIndexSeverity;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** One next-action checklist step, with its authored detail. */
export interface ReleaseDecisionIndexChecklistItem {
  readonly id: ReleaseDecisionIndexChecklistId;
  /** Bounded, app-authored explanation (keyed by id). Never derived from an input. */
  readonly detail: string;
}

/** The composite index decision — the single verdict + exit code a review acts on. */
export interface ReleaseDecisionIndexRollup {
  readonly verdict: ReleaseDecisionIndexVerdict;
  readonly exitCode: ReleaseDecisionIndexExitCode;
  /** True iff `verdict === "stable"`. */
  readonly stable: boolean;
  /** The fired reason ids, in canonical order (empty on a clean stable batch). */
  readonly reasons: readonly ReleaseDecisionIndexReasonId[];
  /** How many fired reasons were invalid-input. */
  readonly invalidInputs: number;
  /** How many fired reasons were blocking. */
  readonly blocking: number;
  /** How many fired reasons were insufficiencies. */
  readonly insufficiencies: number;
  /** How many fired reasons were advisory. */
  readonly advisories: number;
  /** True iff `--strict` was applied. */
  readonly strict: boolean;
  /**
   * True iff `--strict` ESCALATED a `watch` or `insufficient` batch to `blocked`. Surfaced so the summary explains
   * the escalation (the index would be that verdict without the flag).
   */
  readonly strictEscalated: boolean;
  /** Which verdict `--strict` escalated FROM, or `null` when no escalation applied. */
  readonly strictEscalatedFrom: "watch" | "insufficient" | null;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream decision schema). */
export interface ReleaseDecisionIndexMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_DECISION_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_INDEX_POLICY_VERSION;
  readonly decisionSchema: typeof RELEASE_DECISION_SCHEMA;
}

/**
 * The stable, content-free release decision ledger index a review / CI reads. Every field is a bounded enum, a small
 * integer, an ISO stamp, or app-authored prose — so it carries no reviewer identity, locator, size, path, or byte,
 * even from a hostile input, and never echoes an ingested record's own stamp.
 */
export interface ReleaseDecisionIndexResult {
  readonly schema: typeof RELEASE_DECISION_INDEX_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseDecisionIndexMetadata;
  readonly policy: ReleaseDecisionIndexPolicy;
  readonly ledger: ReleaseDecisionIndexLedger;
  /** One reduced point per considered record, ordered oldest → newest. */
  readonly points: readonly ReleaseDecisionIndexPoint[];
  readonly index: ReleaseDecisionIndexRollup;
  /** Every fired reason, in canonical {@link RELEASE_DECISION_INDEX_REASON_IDS} order. */
  readonly reasons: readonly ReleaseDecisionIndexReason[];
  /** The bounded, ordered next-action checklist. Never derived from an input. */
  readonly checklist: readonly ReleaseDecisionIndexChecklistItem[];
  /** Bounded, app-authored guidance (out-of-scope steps this index does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested record. */
  readonly caveats: readonly string[];
  /** The flattened, content-free receipt (safe to log / forward verbatim). */
  readonly receipt: ReleaseDecisionIndexReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what did this
 * ledger index conclude, over how many usable records, and in what decision distribution" for a SIEM / review record.
 * Bounded enums + small integers + a stable policy id + the run's own stamp only (index verdict + record count +
 * decision counts); safe to log or forward verbatim.
 */
export interface ReleaseDecisionIndexReceipt {
  readonly category: "worker-release-decision-index";
  readonly policyId: typeof RELEASE_DECISION_INDEX_POLICY_ID;
  readonly policyVersion: typeof RELEASE_DECISION_INDEX_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseDecisionIndexVerdict;
  readonly exitCode: ReleaseDecisionIndexExitCode;
  /** How many record inputs were supplied. */
  readonly recordsSupplied: number;
  /** How many records were considered after the window cap. */
  readonly recordsConsidered: number;
  /** How many considered records are usable. */
  readonly recordsUsable: number;
  /** The count of each decision across the usable considered records (all six keys present). */
  readonly decisionCounts: Readonly<Record<ReleaseDecisionDecision, number>>;
  /** The single coarse classification of what the batch contains. */
  readonly trendClass: ReleaseDecisionIndexTrendClass;
}

/** The process exit code for an index result. */
export function releaseDecisionIndexExitCode(result: ReleaseDecisionIndexResult): number {
  return result.index.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested record)
 * ------------------------------------------------------------------ */

/** The one-line verdict headline. Authored here, keyed by the enum. */
export const RELEASE_DECISION_INDEX_VERDICT_SUMMARY: Record<ReleaseDecisionIndexVerdict, string> = {
  stable:
    "STABLE: the batch of release decisions is clean — no tampered or unreadable record, and every usable record decided a clean PROCEED. Keep filing one decision record per release and indexing them on your review cadence. This index authorizes nothing on its own.",
  watch:
    "WATCH: no blocker or untrustworthy input, but an ADVISORY concern is present — a usable record decided PROCEED-WITH-FOLLOWUP or HOLD. Review the recent decisions, track any follow-up, and decide whether the batch is ready to rely on.",
  insufficient:
    "INSUFFICIENT: the batch is INCONCLUSIVE — zero usable records were considered, or a usable record decided INSUFFICIENT (an incomplete pack or a deferred acknowledgement). Complete the missing evidence or supply a readable batch, then re-index; this is not a clean batch.",
  blocked:
    "BLOCKED: a BLOCKING decision is present — a usable record decided REJECT or INVALID (its release was rejected, or its evidence pair was untrustworthy), or `--strict` escalated a non-clean batch. Do NOT treat the batch as clean until the cause is resolved.",
  invalid:
    "INVALID: an untrustworthy INPUT — a supplied record was unreadable or is recognized but self-inconsistent (a tamper). The ledger index itself cannot be trusted until the record is recovered; this is never a vacuous pass.",
};

/**
 * The dedicated headline for a `blocked` index produced ONLY because `--strict` escalated a `watch` / `insufficient`
 * batch — there was no rejection, invalid decision, or untrustworthy input, so the generic `blocked` summary would
 * misrepresent the cause. Authored, keyed by which verdict `--strict` escalated from.
 */
export const RELEASE_DECISION_INDEX_STRICT_ESCALATED_SUMMARY: Record<"watch" | "insufficient", string> = {
  watch:
    "BLOCKED (--strict): the only concern is an ADVISORY decision (a proceed-with-followup / hold record), and `--strict` escalates that to a blocked batch — a hard `clean proceed or block` gate. Without the flag this would be WATCH. No rejection, invalid decision, or untrustworthy input was found.",
  insufficient:
    "BLOCKED (--strict): the only concern is an INSUFFICIENT decision (an incomplete / deferred record), and `--strict` escalates that to a blocked batch — a hard `clean proceed or block` gate. Without the flag this would be INSUFFICIENT. No rejection, invalid decision, or untrustworthy input was found.",
};

/** Per-reason authored detail + resolved severity, keyed by id. */
export const RELEASE_DECISION_INDEX_REASON_DETAIL: Record<
  ReleaseDecisionIndexReasonId,
  { readonly severity: ReleaseDecisionIndexSeverity; readonly detail: string }
> = {
  "record-unreadable": {
    severity: "invalid",
    detail:
      "A supplied record could not be read / recognized as a `pdfxyz.release-decision/1` (wrong schema or unparseable — never echoed), so it contributes no trusted decision. The ledger index is incomplete; recover a readable decision record produced by `worker:release-decision` and re-run.",
  },
  "record-tampered": {
    severity: "invalid",
    detail:
      "A supplied record is a recognized `pdfxyz.release-decision/1` whose recorded decision does NOT re-derive from its own recorded pack / acknowledgement summaries + cross-check + strict flag — a hand-edited or corrupt record. Recover the untampered record from your CI archive; a tampered record cannot be indexed.",
  },
  "decision-rejected": {
    severity: "blocking",
    detail:
      "A usable record decided REJECT: that release was a blocking outcome (a rejected / needs-changes acknowledgement or a blocked pack). Do NOT treat that release as proceeded; resolve the cause and re-decide it before relying on the batch.",
  },
  "decision-invalid": {
    severity: "blocking",
    detail:
      "A usable record decided INVALID: that release's evidence pair was untrustworthy or incoherent (a missing / unreadable / tampered document, or a cross-check mismatch). It is a blocking ledger outcome — the release did not proceed; recover valid, matching documents and re-decide it.",
  },
  "no-usable-records": {
    severity: "insufficient",
    detail:
      "The window has zero usable records — every considered record was unreadable / tampered, or the batch was empty. There is nothing to index; supply a bounded batch of readable `pdfxyz.release-decision/1` records and re-run.",
  },
  "decision-insufficient": {
    severity: "insufficient",
    detail:
      "A usable record decided INSUFFICIENT: that release's evidence was inconclusive (an incomplete pack or a deferred acknowledgement). Complete the missing evidence or resolve the deferral and re-decide it before treating the batch as clean.",
  },
  "decision-hold": {
    severity: "advisory",
    detail:
      "A usable record decided HOLD: that release's pack needs INTERNAL REVIEW (its own verdict is review / internal-review). Hold and review the evidence internally before relying on the batch; an advisory concern, not a rejection.",
  },
  "decision-followup": {
    severity: "advisory",
    detail:
      "A usable record decided PROCEED-WITH-FOLLOWUP: that release proceeded over a share-safe pack, but a follow-up was recorded (an accepted-with-notes decision or a note class). Track the follow-up to closure; an advisory concern, not a rejection.",
  },
};

/** Per-checklist authored detail, keyed by id. */
export const RELEASE_DECISION_INDEX_CHECKLIST_DETAIL: Record<ReleaseDecisionIndexChecklistId, string> = {
  "recover-invalid-records":
    "Recover the unreadable / tampered decision record(s) from your CI archive: a record that cannot be read, or whose recorded decision does not re-derive, means the ledger input was lost or hand-edited and cannot be trusted in the index.",
  "review-blocking-decisions":
    "A usable record decided REJECT or INVALID: do NOT treat that release as proceeded. Resolve the rejection cause, or recover valid + matching evidence documents and re-decide that release, before relying on the batch.",
  "supply-decision-records":
    "Supply more / readable content-free `pdfxyz.release-decision/1` records (a bounded batch, oldest first) and re-run this index: an unreadable or empty batch cannot be indexed.",
  "complete-insufficient-evidence":
    "A usable record decided INSUFFICIENT (an incomplete pack or a deferred acknowledgement): complete the missing evidence or resolve the deferral with `worker:release-publish-pack` / `worker:release-ack`, re-decide that release, and re-index.",
  "review-advisory-decisions":
    "A usable record decided PROCEED-WITH-FOLLOWUP or HOLD: track the recorded follow-up to closure, or hold the release for internal review, before relying on the batch. Archive this index as the record of that review.",
  "continue-recording-decisions":
    "The batch is clean: keep filing one `worker:release-decision` record per release and indexing them here on your review cadence. This index authorizes no promotion on its own.",
  "keep-decision-index":
    "Keep this content-free index as the local release-decision-ledger review SUMMARY. It is NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger; keep those separately.",
};

/**
 * The honesty caveats every result carries and every text render prints. The index INDEXES a bounded batch of the
 * chain's already content-free decision records, RE-VALIDATES each one's self-consistency, and rolls them up into
 * one review verdict; it must never be read as more than that.
 */
export const RELEASE_DECISION_INDEX_CAVEATS: readonly string[] = [
  "This is a RELEASE DECISION LEDGER INDEX: it INGESTS a bounded batch of content-free `pdfxyz.release-decision/1` decision records a release pipeline produced, RE-VALIDATES each against ITSELF, and folds them into ONE bounded review verdict + follow-up checklist. It is a local content-free ledger INDEX SUMMARY over decision records — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no gate / bundle / audit / report / decision itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates any record, artifact, object, or deployment. A `stable` index authorizes nothing; it only reports that the content-free decision records supplied on THIS host indexed clean over the review batch.",
  "A `stable` index REQUIRES a clean bounded batch: no tampered / unreadable record, and every usable record a clean `proceed`. It FAILS CLOSED: an unreadable / tampered record makes the index `invalid`; a `reject` / `invalid` decision (or a `--strict` violation) makes it `blocked`; an `insufficient` decision or zero usable records is `insufficient`; a `proceed-with-followup` / `hold` decision is `watch`. It never fabricates a stable index from thin or untrusted input.",
  "It re-derives each ingested record's decision from the record's OWN recorded pack / acknowledgement summaries + cross-check + strict flag (reusing the Phase 59 reducer) and treats a recorded decision that does not re-derive as a TAMPER (`invalid`). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity, so the index proves neither authorship nor approval.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no reviewer name or email, no filename, path, object key, bucket, URL, endpoint, region, job / user id, IP, token, raw ref, raw label, raw note, commit URL, size, byte, or digest, even from a hostile input; it never echoes an ingested record's own stamp, and it never echoes an input file path, even on an error.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, approves, or mutates nothing.",
];

/**
 * Out-of-band reminders the index carries but does NOT itself perform — the honest edges of an offline indexer.
 * Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_DECISION_INDEX_GUIDANCE: readonly string[] = [
  "Wire this as a SCHEDULED or on-demand REVIEW summary (per sprint / month), NOT a per-release gate: run `worker:release-decision` per release and archive each record, then hand a bounded batch (oldest first, newest last) here and render `--text` into a review artifact / `$GITHUB_STEP_SUMMARY`. Fail the review on exit 4 (a blocked batch or an untrustworthy record), surface exit 3 (a watch batch) for review, and treat exit 2 (an inconclusive batch) as a coverage gap, not a clean batch.",
  "Keep the batch bounded and explicit: `--max-records=N` caps the newest N records (older records are dropped from the window, and the count dropped is surfaced, never silent); `--strict` escalates any advisory / insufficiency to a blocked batch — a hard `clean proceed or block` gate for a high-assurance review.",
  "Archive this index (and the underlying decision records) as CI artifacts: it is a content-free review SUMMARY, not a substitute for the records it indexes, nor for your legal audit trail, compliance log, external approval / signing, storage retention, or release-promotion processes — keep each of those in its own dedicated system.",
  "Enforce promotion out of band: this index SUMMARIZES a batch of the content-free decision records supplied, but recording a legal audit trail, obtaining an external approval / signature, proving reviewer identity, and promoting a deployment are operator / CI / legal actions this offline indexer never performs.",
];
