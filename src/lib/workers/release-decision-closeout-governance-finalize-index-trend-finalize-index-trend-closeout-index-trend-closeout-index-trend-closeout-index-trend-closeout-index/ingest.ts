/**
 * Pure, node-free **record ingest** for the release decision closeout governance finalize index trend finalize index
 * trend closeout INDEX (Phase 90) — the trust boundary and the no-leak core.
 *
 * The index indexes a bounded history of
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` CLOSEOUT records (the
 * Phase 89 output). Even though each record is already content-free, every one is UNTRUSTED input here (a CI archive an
 * operator points us at, a committed record, or a hand-crafted / tampered file), and this module turns each parsed root
 * into a bounded ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a record. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the record's OWN
 *    stamp, and any stray extra field are all DROPPED.
 *  - **Re-derive the tested boundary.** A Phase 89 closeout record reduced its primary-receipt + related-record chain into
 *    a bounded `primaryReceipt` summary + a per-kind `related[]` checklist (each with the computed cross-check / posture
 *    `signal`) + a `sourceChain` posture + a `coverage` rollup. So the DEEPEST self-consistency check available over a
 *    closeout record is to RE-DERIVE its `coverage` rollup from its OWN recorded (`primaryReceipt` facets, each `related[]`
 *    state + required + verdict + signal, policy) and require the recorded rollup + source chain to re-derive — exactly
 *    the fold the Phase 89 `computeCloseout` reducer performs. The `index` source-chain posture signal is fully
 *    re-derived from the record's own recorded index verdict; the `plan` / `trend` cross-check signals are re-checked
 *    against the primary receipt's recorded anchors as far as the recorded verdicts allow (a verdict mismatch forces
 *    `contradictory`), so a hand-flipped closeout verdict / exit / rollup, or a flipped receipt / source-chain posture
 *    signal, is caught as a tamper. A fully self-consistent fabrication is out of scope, exactly as at Phases 52–89.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `unreadable`; a recognized-but-inconsistent record is
 *    `tampered`; a coherent record yields reduced bounded facts (`usable`). The offending content is never echoed.
 *
 * SAFETY of the re-derivation: it mirrors `computeCloseout` (verified against
 * `release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/reduce.ts`; re-verify that
 * reducer's reason / verdict / signal logic before trusting this reconstruction). Its faithfulness is pinned by the module
 * tests, which build REAL Phase 89 closeout records via the shipped closeout builder and require each to re-derive
 * `usable`.
 */

import { buildReasons } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/reduce";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RELATION_SIGNALS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SOURCE_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRelationSignal,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/types";
import type { CloseoutRecordFacts } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** A strict non-negative safe integer, or `undefined`. */
function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Strictly `true` or `false`, or `undefined`. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** `null`, or one of `allowed`; anything else (a stray non-null off-enum value) is a corrupt field (`undefined`). */
function nullableOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  if (value === null) return null;
  return oneOf(value, allowed);
}

/** Validate an array of enum members into a bounded list, or `undefined` if any element is off-enum / not an array. */
function enumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const v of value) {
    const id = oneOf(v, allowed);
    if (id === undefined) return undefined;
    out.push(id);
  }
  return out;
}

/** Compare two string lists as sets (order-independent, exact membership, size-aware in both directions). */
function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** The exit code for a resolved closeout verdict (mirrors the Phase 89 reducer's `exitFor`). */
function exitForCloseout(verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict): number {
  switch (verdict) {
    case "closed":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.CLOSED;
    case "incomplete":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.INCOMPLETE;
    case "open":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.OPEN;
    case "blocked":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.BLOCKED;
    case "invalid":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.INVALID;
  }
}

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-…-closeout/1` document. */
export interface IngestedCloseout {
  /** True iff the input parsed to an object carrying the `…-closeout/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded closeout coverage rollup RE-DERIVES from its own recorded facets + policy. */
  readonly usable: boolean;
  /** The record's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: CloseoutRecordFacts | null;
}

/** The bounded outcome for an input that was not a recognized `…-closeout/1`. */
export const UNRECOGNIZED_CLOSEOUT: IngestedCloseout = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) record, carrying only its untrusted claimed verdict. */
function inconsistentCloseout(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null,
): IngestedCloseout {
  return { recognized: true, usable: false, verdict, facts: null };
}

/* ------------------------------------------------------------------ *
 *  Recorded blocks (validated into bounded shapes; nothing echoed)
 * ------------------------------------------------------------------ */

const CLOSEOUT_STRICT_FROM = ["open"] as const;
const CLOSEOUT_REASON_IDS = Object.keys(
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL,
) as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId[];

/** The recorded `coverage` rollup fields the recompute must reproduce for the record to be `usable`. */
interface RecordedCoverage {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict;
  readonly exitCode: number;
  readonly closed: boolean;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId[];
  readonly invalid: number;
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "open" | null;
}

/** Validate the record's `coverage` rollup block into the bounded {@link RecordedCoverage}, or `undefined`. */
function readRecordedCoverage(cov: Obj): RecordedCoverage | undefined {
  const verdict = oneOf(cov.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS);
  const exitCode = intOf(cov.exitCode);
  const closed = boolOf(cov.closed);
  const receiptState = oneOf(cov.receiptState, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(cov.receiptVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(cov.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
  const reasons = enumArray(cov.reasons, CLOSEOUT_REASON_IDS);
  const invalid = intOf(cov.invalid);
  const blocking = intOf(cov.blocking);
  const open = intOf(cov.open);
  const incomplete = intOf(cov.incomplete);
  const informational = intOf(cov.informational);
  const relatedSupplied = intOf(cov.relatedSupplied);
  const relatedCoherent = intOf(cov.relatedCoherent);
  const relatedContradictory = intOf(cov.relatedContradictory);
  const relatedBlocking = intOf(cov.relatedBlocking);
  const requiredMissing = enumArray(cov.requiredMissing, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS);
  const strictOpen = boolOf(cov.strictOpen);
  const strictOpenEscalated = boolOf(cov.strictOpenEscalated);
  const strictOpenEscalatedFrom = nullableOneOf(cov.strictOpenEscalatedFrom, CLOSEOUT_STRICT_FROM);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    closed === undefined ||
    receiptState === undefined ||
    receiptVerdict === undefined ||
    planClass === undefined ||
    reasons === undefined ||
    invalid === undefined ||
    blocking === undefined ||
    open === undefined ||
    incomplete === undefined ||
    informational === undefined ||
    relatedSupplied === undefined ||
    relatedCoherent === undefined ||
    relatedContradictory === undefined ||
    relatedBlocking === undefined ||
    requiredMissing === undefined ||
    strictOpen === undefined ||
    strictOpenEscalated === undefined ||
    strictOpenEscalatedFrom === undefined
  ) {
    return undefined;
  }
  return {
    verdict,
    exitCode,
    closed,
    receiptState,
    receiptVerdict,
    planClass,
    reasons,
    invalid,
    blocking,
    open,
    incomplete,
    informational,
    relatedSupplied,
    relatedCoherent,
    relatedContradictory,
    relatedBlocking,
    requiredMissing,
    strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom,
  };
}

/** The bounded `primaryReceipt` facets the record recorded (its primary receipt, reduced). */
interface RecordedPrimaryReceipt {
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  readonly claimedPlanVerdict: string | null;
  readonly sourceTrendVerdict: string | null;
  readonly sourceLatestIndex: string | null;
  readonly planUrgency: string | null;
  readonly planActionClass: string | null;
  readonly blockingActions: number;
  readonly advisoryActions: number;
  readonly planStrict: boolean;
  readonly acksRequired: number;
  readonly acksSatisfied: number;
  readonly acksMissing: number;
  readonly receiptStrictOpen: boolean;
}

/** Validate the record's `primaryReceipt` block into a bounded {@link RecordedPrimaryReceipt}, or `undefined`. */
function readRecordedPrimaryReceipt(root: Obj): RecordedPrimaryReceipt | undefined {
  const s = isObject(root.primaryReceipt) ? root.primaryReceipt : undefined;
  if (s === undefined) return undefined;
  const state = oneOf(s.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(s.receiptVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(s.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
  const claimedPlanVerdict = nullableOneOf(s.claimedPlanVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS);
  const sourceTrendVerdict = nullableOneOf(s.sourceTrendVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS);
  const sourceLatestIndex = nullableOneOf(s.sourceLatestIndex, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);
  const planUrgency = nullableOneOf(s.planUrgency, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES);
  const planActionClass = nullableOneOf(s.planActionClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES);
  const blockingActions = intOf(s.blockingActions);
  const advisoryActions = intOf(s.advisoryActions);
  const planStrict = boolOf(s.planStrict);
  const acksRequired = intOf(s.acksRequired);
  const acksSatisfied = intOf(s.acksSatisfied);
  const acksMissing = intOf(s.acksMissing);
  const receiptStrictOpen = boolOf(s.receiptStrictOpen);
  if (
    state === undefined ||
    receiptVerdict === undefined ||
    planClass === undefined ||
    claimedPlanVerdict === undefined ||
    sourceTrendVerdict === undefined ||
    sourceLatestIndex === undefined ||
    planUrgency === undefined ||
    planActionClass === undefined ||
    blockingActions === undefined ||
    advisoryActions === undefined ||
    planStrict === undefined ||
    acksRequired === undefined ||
    acksSatisfied === undefined ||
    acksMissing === undefined ||
    receiptStrictOpen === undefined
  ) {
    return undefined;
  }
  return {
    state,
    receiptVerdict,
    planClass,
    claimedPlanVerdict,
    sourceTrendVerdict,
    sourceLatestIndex,
    planUrgency,
    planActionClass,
    blockingActions,
    advisoryActions,
    planStrict,
    acksRequired,
    acksSatisfied,
    acksMissing,
    receiptStrictOpen,
  };
}

/**
 * Require the record's `primaryReceipt` block to be internally consistent with its own receipt coverage state: a `usable`
 * primary receipt carries a non-null receipt verdict (Phase 89's builder always records it from a usable receipt's
 * facts); a non-usable receipt carries the null / zero / false surface Phase 89's builder always emits when the receipt
 * was not usable (only its untrusted claimed verdict may survive). Catches a crudely tampered primary-receipt block
 * (mirrors the Phase 89 `buildCloseoutPrimaryReceipt` shape); a fully self-consistent fabrication is out of scope.
 */
function primaryReceiptConsistent(s: RecordedPrimaryReceipt): boolean {
  if (s.state === "usable") {
    return s.receiptVerdict !== null;
  }
  // A non-usable receipt reduced to no facts: every fact-derived facet is the null / zero / false default. An
  // `unreadable` receipt carries no claimed verdict either; a `tampered` receipt may surface its untrusted claim.
  return (
    s.planClass === null &&
    s.claimedPlanVerdict === null &&
    s.sourceTrendVerdict === null &&
    s.sourceLatestIndex === null &&
    s.planUrgency === null &&
    s.planActionClass === null &&
    s.blockingActions === 0 &&
    s.advisoryActions === 0 &&
    s.planStrict === false &&
    s.acksRequired === 0 &&
    s.acksSatisfied === 0 &&
    s.acksMissing === 0 &&
    s.receiptStrictOpen === false
  );
}

/** One recorded related-record entry (a per-kind checklist row the record emitted). */
interface RecordedRelated {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind;
  readonly required: boolean;
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordState;
  readonly signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRelationSignal;
  readonly verdict: string | null;
}

/** Validate a related record's surfaced verdict against its kind's own verdict enum (nullable), else `undefined`. */
function readRelatedVerdict(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  value: unknown,
): string | null | undefined {
  switch (kind) {
    case "plan":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS);
    case "trend":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS);
  }
}

/**
 * Validate the record's `related` block into exactly one bounded {@link RecordedRelated} per kind, in the canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS} order Phase
 * 84 always emits, or `undefined` if malformed. The per-kind `verdict` is validated against that kind's own verdict enum
 * (nullable) so an off-enum token is a corrupt row.
 */
function readRecordedRelated(root: Obj): RecordedRelated[] | undefined {
  if (
    !Array.isArray(root.related) ||
    root.related.length !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS.length
  ) {
    return undefined;
  }
  const out: RecordedRelated[] = [];
  for (let i = 0; i < RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS.length; i++) {
    const expectedKind = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS[i]!;
    const entry = root.related[i];
    if (!isObject(entry)) return undefined;
    const kind = oneOf(entry.kind, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS);
    const required = boolOf(entry.required);
    const state = oneOf(entry.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_STATES);
    const signal = oneOf(entry.signal, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RELATION_SIGNALS);
    const verdict = readRelatedVerdict(expectedKind, entry.verdict);
    if (
      kind === undefined ||
      kind !== expectedKind ||
      required === undefined ||
      state === undefined ||
      signal === undefined ||
      verdict === undefined
    ) {
      return undefined;
    }
    out.push({ kind, required, state, signal, verdict });
  }
  return out;
}

/** The bounded `policy` block the record recorded. */
interface RecordedPolicy {
  readonly strictOpen: boolean;
  readonly require: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind, boolean>;
}

/** Validate the record's `policy` block into a bounded {@link RecordedPolicy}, or `undefined`. */
function readRecordedPolicy(root: Obj): RecordedPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const strictOpen = boolOf(p.strictOpen);
  const req = isObject(p.require) ? p.require : undefined;
  if (strictOpen === undefined || req === undefined) return undefined;
  const plan = boolOf(req.plan);
  const trend = boolOf(req.trend);
  if (plan === undefined || trend === undefined) return undefined;
  return { strictOpen, require: { plan, trend } };
}

/** The bounded `sourceChain` facets the record recorded (the folded window posture, reduced). */
interface RecordedSourceChain {
  readonly receiptTrendVerdict: string | null;
  readonly receiptLatestIndex: string | null;
}

/** Validate the record's `sourceChain` block into a bounded {@link RecordedSourceChain}, or `undefined`. */
function readRecordedSourceChain(root: Obj): RecordedSourceChain | undefined {
  const c = isObject(root.sourceChain) ? root.sourceChain : undefined;
  if (c === undefined) return undefined;
  const receiptTrendVerdict = nullableOneOf(c.receiptTrendVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS);
  const receiptLatestIndex = nullableOneOf(c.receiptLatestIndex, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);
  if (receiptTrendVerdict === undefined || receiptLatestIndex === undefined) {
    return undefined;
  }
  return { receiptTrendVerdict, receiptLatestIndex };
}

/* ------------------------------------------------------------------ *
 *  Re-derivation (mirrors release-decision-…-closeout/reduce.ts `computeCloseout`)
 * ------------------------------------------------------------------ */

/**
 * Re-check each related record's recorded `signal` against what `computeCloseout` would compute: a non-usable record must
 * carry `none` and a `null` verdict; a usable `index` record must surface a bounded verdict and a signal that matches the
 * recompute from its OWN verdict; a usable `plan` / `trend` cross-check record must surface a bounded verdict and a signal
 * of `coherent` / `contradictory`, and — as far as the recorded verdicts allow — a verdict that DISAGREES with the primary
 * receipt's recorded anchor for that kind forces `contradictory`. A hand-flipped signal is caught to the extent the
 * recorded data allows (the plan cross-check compares six receipt facets, of which only the verdict is recorded here, so
 * a coordinated multi-field fabrication is out of scope, exactly as the closeout itself documents).
 */
function signalsConsistent(source: RecordedPrimaryReceipt, related: readonly RecordedRelated[]): boolean {
  for (const r of related) {
    if (r.state !== "usable") {
      if (r.signal !== "none" || r.verdict !== null) return false;
      continue;
    }
    if (r.verdict === null) return false; // a usable record always surfaces a bounded verdict
    switch (r.kind) {
      case "plan": {
        if (r.signal !== "coherent" && r.signal !== "contradictory") return false;
        const anchor = source.state === "usable" ? source.claimedPlanVerdict : null;
        if (anchor !== null && r.verdict !== anchor && r.signal !== "contradictory") return false;
        break;
      }
      case "trend": {
        if (r.signal !== "coherent" && r.signal !== "contradictory") return false;
        const anchor = source.state === "usable" ? source.sourceTrendVerdict : null;
        if (anchor !== null && r.verdict !== anchor && r.signal !== "contradictory") return false;
        break;
      }
    }
  }
  return true;
}

/** The reason the primary receipt fires, keyed off its coverage state + (when usable) its OWN verdict. */
function receiptReason(source: RecordedPrimaryReceipt): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId {
  if (source.state === "unreadable") return "receipt-unreadable";
  if (source.state === "tampered") return "receipt-tampered";
  switch (source.receiptVerdict) {
    case "completed":
      return "receipt-completed";
    case "incomplete":
      return "receipt-incomplete";
    case "followup-open":
      return "receipt-followup-open";
    case "blocked":
      return "receipt-blocked";
    case "invalid":
      return "receipt-invalid";
    default:
      // A usable source is guaranteed (by `primaryReceiptConsistent`) to carry a non-null receipt verdict.
      return "receipt-incomplete";
  }
}

/** The fired reason for a usable related record, keyed off its kind + recorded signal (mirrors reduce.ts `usableRecordReason`). */
function usableRecordReason(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId | null {
  switch (signal) {
    case "coherent":
      return kind === "plan" ? "plan-coherent" : "trend-coherent";
    case "contradictory":
      return kind === "plan" ? "plan-contradiction" : "trend-contradiction";
    case "none":
      return null;
  }
}

/** The reason a related record fires, keyed off its coverage state + required flag + recorded signal (mirrors reduce.ts). */
function recordReason(r: RecordedRelated): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId | null {
  switch (r.state) {
    case "absent":
      return r.required ? "required-record-missing" : null;
    case "unreadable":
      return "related-unreadable";
    case "tampered":
      return "related-tampered";
    case "usable":
      return usableRecordReason(r.kind, r.signal);
  }
}

/** Fold the fired reasons' severities into the composite closeout verdict (precedence invalid > blocking > open > incomplete). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict {
  const severities = fired.map(
    (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL[id].severity,
  );
  if (severities.includes("invalid")) return "invalid";
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("open")) return "open";
  if (severities.includes("incomplete")) return "incomplete";
  return "closed";
}

/** The re-derived closeout coverage rollup the recorded coverage must reproduce (skips authored `detail`). */
interface DerivedCoverage {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict;
  readonly exitCode: number;
  readonly closed: boolean;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId[];
  readonly invalid: number;
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "open" | null;
}

/**
 * Re-derive the closeout coverage rollup from the record's OWN recorded `primaryReceipt` + `related` + `policy`,
 * mirroring `computeCloseout` (taking each related record's RECORDED signal as given — the signals were independently
 * re-checked by {@link signalsConsistent}). Pure and deterministic.
 */
function deriveCloseoutRollup(
  source: RecordedPrimaryReceipt,
  related: readonly RecordedRelated[],
  policy: RecordedPolicy,
): DerivedCoverage {
  const fired: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutReasonId[] = [receiptReason(source)];
  const requiredMissing: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind[] = [];
  for (const r of related) {
    const reason = recordReason(r);
    if (reason !== null) fired.push(reason);
    if (r.required && r.state === "absent") requiredMissing.push(r.kind);
  }

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of an open closeout (mirrors reduce.ts).
  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "open" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const invalid = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const relatedCoherent = supplied.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = supplied.filter((r) => r.signal === "contradictory").length;
  const relatedBlocking = supplied.filter((r) => r.state === "tampered" || r.state === "unreadable").length;

  return {
    verdict,
    exitCode: exitForCloseout(verdict),
    closed: verdict === "closed",
    receiptState: source.state,
    receiptVerdict: source.receiptVerdict,
    planClass: source.planClass,
    reasons: orderedIds,
    invalid,
    blocking,
    open,
    incomplete,
    informational,
    relatedSupplied: supplied.length,
    relatedCoherent,
    relatedContradictory,
    relatedBlocking,
    requiredMissing,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom: strictOpenEscalated ? "open" : null,
  };
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameCoverage(a: DerivedCoverage, b: RecordedCoverage): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.closed === b.closed &&
    a.receiptState === b.receiptState &&
    a.receiptVerdict === b.receiptVerdict &&
    a.planClass === b.planClass &&
    a.invalid === b.invalid &&
    a.blocking === b.blocking &&
    a.open === b.open &&
    a.incomplete === b.incomplete &&
    a.informational === b.informational &&
    a.relatedSupplied === b.relatedSupplied &&
    a.relatedCoherent === b.relatedCoherent &&
    a.relatedContradictory === b.relatedContradictory &&
    a.relatedBlocking === b.relatedBlocking &&
    a.strictOpen === b.strictOpen &&
    a.strictOpenEscalated === b.strictOpenEscalated &&
    a.strictOpenEscalatedFrom === b.strictOpenEscalatedFrom &&
    sameStringSet(a.reasons, b.reasons) &&
    sameStringSet(a.requiredMissing, b.requiredMissing)
  );
}

/**
 * Whether the recorded `sourceChain` block re-derives from the record's own recorded primary-receipt source anchors (a
 * crude-tamper recheck of the source-chain summary; mirrors the Phase 94 `computeCloseout` source-chain fold).
 */
function sourceChainConsistent(source: RecordedPrimaryReceipt, chain: RecordedSourceChain): boolean {
  return (
    chain.receiptTrendVerdict === source.sourceTrendVerdict && chain.receiptLatestIndex === source.sourceLatestIndex
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-…-closeout/1` `root` to the bounded {@link IngestedCloseout}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_CLOSEOUT}. For a recognized record it validates the recorded
 * coverage rollup + top-level headline + primary receipt + related + policy + source chain, then requires: (1) the
 * primary-receipt block is internally consistent, (2) each related record's signal is consistent with its recorded
 * verdict + the recorded anchors, (3) the top-level verdict / exit code equal the recorded coverage (Phase 89 mirrors
 * them), (4) the record's `policy.strictOpen` equals the recorded coverage's `strictOpen`, (5) the recorded coverage
 * RE-DERIVES from the reconstructed primary receipt + related + policy, and (6) the recorded source chain re-derives. Any
 * mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestCloseout(root: unknown): IngestedCloseout {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_SCHEMA) {
    return UNRECOGNIZED_CLOSEOUT;
  }

  const coverageObj = isObject(root.coverage) ? root.coverage : undefined;
  const claimed = coverageObj
    ? (oneOf(coverageObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) ?? null)
    : (oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) ?? null);

  if (coverageObj === undefined) return inconsistentCloseout(claimed);
  const recorded = readRecordedCoverage(coverageObj);
  if (recorded === undefined) return inconsistentCloseout(claimed);

  // The top-level headline facets must equal the recorded coverage (Phase 89 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS);
  const topExitCode = intOf(root.exitCode);
  if (
    topVerdict === undefined ||
    topExitCode === undefined ||
    topVerdict !== recorded.verdict ||
    topExitCode !== recorded.exitCode
  ) {
    return inconsistentCloseout(recorded.verdict);
  }

  const source = readRecordedPrimaryReceipt(root);
  if (source === undefined || !primaryReceiptConsistent(source)) return inconsistentCloseout(recorded.verdict);

  const related = readRecordedRelated(root);
  if (related === undefined || !signalsConsistent(source, related)) return inconsistentCloseout(recorded.verdict);

  const policy = readRecordedPolicy(root);
  if (policy === undefined || policy.strictOpen !== recorded.strictOpen) return inconsistentCloseout(recorded.verdict);

  const chain = readRecordedSourceChain(root);
  if (chain === undefined || !sourceChainConsistent(source, chain)) return inconsistentCloseout(recorded.verdict);

  // Re-derive the closeout coverage rollup from the record's OWN recorded facets + policy, and require the recorded
  // coverage to re-derive on every load-bearing field — so a hand-flipped closeout verdict / exit / rollup / count is
  // caught.
  const rederived = deriveCloseoutRollup(source, related, policy);
  if (!sameCoverage(rederived, recorded)) return inconsistentCloseout(recorded.verdict);

  const facts: CloseoutRecordFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    closed: recorded.closed,
    receiptState: recorded.receiptState,
    receiptVerdict: recorded.receiptVerdict,
    planClass: recorded.planClass,
    relatedSupplied: recorded.relatedSupplied,
    relatedCoherent: recorded.relatedCoherent,
    relatedContradictory: recorded.relatedContradictory,
    relatedBlocking: recorded.relatedBlocking,
    requiredMissing: recorded.requiredMissing.length,
    strictOpen: recorded.strictOpen,
    strictOpenEscalated: recorded.strictOpenEscalated,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
