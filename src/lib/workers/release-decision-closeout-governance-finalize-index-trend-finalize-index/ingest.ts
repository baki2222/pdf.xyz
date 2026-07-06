/**
 * Pure, node-free **record ingest** for the release decision closeout governance finalize index trend finalize INDEX
 * (Phase 80) — the trust boundary and the no-leak core.
 *
 * The index indexes a bounded history of `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1`
 * FINALIZATION records (the Phase 79 output). Even though each record is already content-free, every one is UNTRUSTED
 * input here (a CI archive an operator points us at, a committed record, or a hand-crafted / tampered file), and this
 * module turns each parsed root into a bounded ingested shape, in the same paranoid spirit as the rest of the worker
 * ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a record. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the record's OWN
 *    stamp, and any stray extra field are all DROPPED.
 *  - **Re-derive the tested boundary.** A Phase 79 finalization record reduced its primary-receipt chain into a bounded
 *    `source` summary + a per-kind `related[]` checklist (each with the computed cross-check / posture `signal`) + a
 *    `finalize` rollup. So the DEEPEST self-consistency check available over a finalization record is to RE-DERIVE its
 *    `finalize` rollup from its OWN recorded (`source` state + facets, each `related[]` state + required + verdict +
 *    signal, policy) and require the recorded rollup to re-derive — exactly the fold the Phase 79
 *    `computeFinalizeIndexTrendFinalize` reducer performs. Because the record records the primary-receipt cross-check
 *    ANCHORS (`claimedPlanVerdict` / `sourceTrendVerdict` / `sourceLatestIndex`) alongside each related record's own
 *    verdict, the plan / trend / index cross-check signals CAN be recomputed here and are required to match; a
 *    hand-flipped finalization verdict / exit / rollup, or a flipped cross-check / posture signal, is caught as a tamper.
 *    A fully self-consistent fabrication is out of scope, exactly as at Phases 52–79.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `unreadable`; a recognized-but-inconsistent record is
 *    `tampered`; a coherent record yields reduced bounded facts (`usable`). The offending content is never echoed.
 *
 * SAFETY of the re-derivation: it mirrors `computeFinalizeIndexTrendFinalize` (verified against
 * `release-decision-closeout-governance-finalize-index-trend-finalize/reduce.ts`; re-verify that reducer's reason /
 * verdict / signal logic before trusting this reconstruction). Its faithfulness is pinned by the module tests, which
 * build REAL Phase 79 finalization records via the shipped finalize builder and require each to re-derive `usable`.
 */

import { buildReasons } from "../release-decision-closeout-governance-finalize-index-trend-finalize/reduce";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SOURCE_STATES } from "../release-decision-closeout-governance-finalize-index-trend-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_COHERENT_REASON,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CONTRADICTION_REASON,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RELATION_SIGNALS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize/types";
import type { FinalizeRecordFacts } from "./types";

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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` document. */
export interface IngestedFinalize {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded finalization rollup RE-DERIVES from its own recorded facets + policy. */
  readonly usable: boolean;
  /** The record's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: FinalizeRecordFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1`. */
export const UNRECOGNIZED_FINALIZE: IngestedFinalize = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) record, carrying only its untrusted claimed verdict. */
function inconsistentFinalize(verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict | null): IngestedFinalize {
  return { recognized: true, usable: false, verdict, facts: null };
}

/* ------------------------------------------------------------------ *
 *  Recorded blocks (validated into bounded shapes; nothing echoed)
 * ------------------------------------------------------------------ */

/** The recorded `finalize` rollup fields the recompute must reproduce for the record to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict;
  readonly exitCode: number;
  readonly finalized: boolean;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[];
  readonly invalid: number;
  readonly blocking: number;
  readonly incomplete: number;
  readonly open: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "finalize-open" | "finalize-incomplete" | null;
}

const ROLLUP_STRICT_FROM = ["finalize-open", "finalize-incomplete"] as const;
const FINALIZE_REASON_IDS = Object.keys(
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL,
) as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[];

/** Validate the record's `finalize` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const finalized = boolOf(rollup.finalized);
  const receiptState = oneOf(rollup.receiptState, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(rollup.receiptVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(rollup.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
  const reasons = enumArray(rollup.reasons, FINALIZE_REASON_IDS);
  const invalid = intOf(rollup.invalid);
  const blocking = intOf(rollup.blocking);
  const incomplete = intOf(rollup.incomplete);
  const open = intOf(rollup.open);
  const informational = intOf(rollup.informational);
  const relatedSupplied = intOf(rollup.relatedSupplied);
  const relatedCoherent = intOf(rollup.relatedCoherent);
  const relatedContradictory = intOf(rollup.relatedContradictory);
  const requiredMissing = enumArray(rollup.requiredMissing, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS);
  const strictOpen = boolOf(rollup.strictOpen);
  const strictOpenEscalated = boolOf(rollup.strictOpenEscalated);
  const strictOpenEscalatedFrom = nullableOneOf(rollup.strictOpenEscalatedFrom, ROLLUP_STRICT_FROM);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    finalized === undefined ||
    receiptState === undefined ||
    receiptVerdict === undefined ||
    planClass === undefined ||
    reasons === undefined ||
    invalid === undefined ||
    blocking === undefined ||
    incomplete === undefined ||
    open === undefined ||
    informational === undefined ||
    relatedSupplied === undefined ||
    relatedCoherent === undefined ||
    relatedContradictory === undefined ||
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
    finalized,
    receiptState,
    receiptVerdict,
    planClass,
    reasons,
    invalid,
    blocking,
    incomplete,
    open,
    informational,
    relatedSupplied,
    relatedCoherent,
    relatedContradictory,
    requiredMissing,
    strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom,
  };
}

/** The bounded `source` facets the record recorded (its primary receipt, reduced). */
interface RecordedSource {
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  readonly claimedPlanVerdict: string | null;
  readonly sourceTrendVerdict: string | null;
  readonly sourceLatestIndex: string | null;
  readonly receiptSourceState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState | null;
  readonly acksRequired: number;
  readonly acksSatisfied: number;
  readonly acksMissing: number;
  readonly receiptStrictOpen: boolean;
}

/** Validate the record's `source` block into a bounded {@link RecordedSource}, or `undefined`. */
function readRecordedSource(root: Obj): RecordedSource | undefined {
  const s = isObject(root.source) ? root.source : undefined;
  if (s === undefined) return undefined;
  const state = oneOf(s.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(s.receiptVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(s.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
  const claimedPlanVerdict = nullableOneOf(s.claimedPlanVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS);
  const sourceTrendVerdict = nullableOneOf(s.sourceTrendVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS);
  const sourceLatestIndex = nullableOneOf(s.sourceLatestIndex, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS);
  const receiptSourceState = nullableOneOf(s.receiptSourceState, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SOURCE_STATES);
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
    receiptSourceState === undefined ||
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
    receiptSourceState,
    acksRequired,
    acksSatisfied,
    acksMissing,
    receiptStrictOpen,
  };
}

/**
 * Require the record's `source` block to be internally consistent with its own receipt coverage state: a `usable`
 * primary receipt carries a non-null receipt verdict AND a non-null receipt source state (Phase 79's builder always
 * records both from a usable receipt's facts); a non-usable receipt carries the null / zero / false surface Phase 79's
 * builder always emits when the receipt was not usable (only its untrusted claimed verdict may survive). Catches a
 * crudely tampered source block (mirrors the Phase 79 `buildFinalizeSource` shape); a fully self-consistent fabrication
 * is out of scope.
 */
function sourceConsistent(s: RecordedSource): boolean {
  if (s.state === "usable") {
    return s.receiptVerdict !== null && s.receiptSourceState !== null;
  }
  // A non-usable receipt reduced to no facts: every fact-derived facet is the null / zero / false default. An
  // `unreadable` receipt carries no claimed verdict either; a `tampered` receipt may surface its untrusted claim.
  return (
    s.planClass === null &&
    s.claimedPlanVerdict === null &&
    s.sourceTrendVerdict === null &&
    s.sourceLatestIndex === null &&
    s.receiptSourceState === null &&
    s.acksRequired === 0 &&
    s.acksSatisfied === 0 &&
    s.acksMissing === 0 &&
    s.receiptStrictOpen === false
  );
}

/** One recorded related-record entry (a per-kind checklist row the record emitted). */
interface RecordedRelated {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind;
  readonly required: boolean;
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState;
  readonly signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal;
  readonly verdict: string | null;
}

/** Validate a related record's surfaced verdict against its kind's own verdict enum (nullable), else `undefined`. */
function readRelatedVerdict(kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind, value: unknown): string | null | undefined {
  switch (kind) {
    case "plan":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS);
    case "trend":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICTS);
    case "index":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS);
    case "finalization":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS);
  }
}

/**
 * Validate the record's `related` block into exactly one bounded {@link RecordedRelated} per kind, in the canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS} order Phase 79 always emits, or
 * `undefined` if malformed. The per-kind `verdict` is validated against that kind's own verdict enum (nullable) so an
 * off-enum token is a corrupt row.
 */
function readRecordedRelated(root: Obj): RecordedRelated[] | undefined {
  if (
    !Array.isArray(root.related) ||
    root.related.length !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS.length
  ) {
    return undefined;
  }
  const out: RecordedRelated[] = [];
  for (let i = 0; i < RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS.length; i++) {
    const expectedKind = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS[i]!;
    const entry = root.related[i];
    if (!isObject(entry)) return undefined;
    const kind = oneOf(entry.kind, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS);
    const required = boolOf(entry.required);
    const state = oneOf(entry.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_STATES);
    const signal = oneOf(entry.signal, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RELATION_SIGNALS);
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
  readonly require: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind, boolean>;
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
  const index = boolOf(req.index);
  const finalization = boolOf(req.finalization);
  if (plan === undefined || trend === undefined || index === undefined || finalization === undefined) {
    return undefined;
  }
  return { strictOpen, require: { plan, trend, index, finalization } };
}

/** The bounded `coverage` facets the record recorded (its own coverage rollup, reduced). */
interface RecordedCoverage {
  readonly hasReceipt: boolean;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  readonly requiredRecords: number;
  readonly suppliedRecords: number;
  readonly usableRecords: number;
  readonly missingRecords: number;
  readonly tamperedRecords: number;
  readonly unreadableRecords: number;
  readonly coherentRecords: number;
  readonly contradictoryRecords: number;
}

/** Validate the record's `coverage` block into a bounded {@link RecordedCoverage}, or `undefined`. */
function readRecordedCoverage(root: Obj): RecordedCoverage | undefined {
  const c = isObject(root.coverage) ? root.coverage : undefined;
  if (c === undefined) return undefined;
  const hasReceipt = boolOf(c.hasReceipt);
  const receiptState = oneOf(c.receiptState, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES);
  const requiredRecords = intOf(c.requiredRecords);
  const suppliedRecords = intOf(c.suppliedRecords);
  const usableRecords = intOf(c.usableRecords);
  const missingRecords = intOf(c.missingRecords);
  const tamperedRecords = intOf(c.tamperedRecords);
  const unreadableRecords = intOf(c.unreadableRecords);
  const coherentRecords = intOf(c.coherentRecords);
  const contradictoryRecords = intOf(c.contradictoryRecords);
  if (
    hasReceipt === undefined ||
    receiptState === undefined ||
    requiredRecords === undefined ||
    suppliedRecords === undefined ||
    usableRecords === undefined ||
    missingRecords === undefined ||
    tamperedRecords === undefined ||
    unreadableRecords === undefined ||
    coherentRecords === undefined ||
    contradictoryRecords === undefined
  ) {
    return undefined;
  }
  return {
    hasReceipt,
    receiptState,
    requiredRecords,
    suppliedRecords,
    usableRecords,
    missingRecords,
    tamperedRecords,
    unreadableRecords,
    coherentRecords,
    contradictoryRecords,
  };
}

/* ------------------------------------------------------------------ *
 *  Re-derivation (mirrors release-decision-closeout-governance-finalize-index-trend-finalize/reduce.ts)
 * ------------------------------------------------------------------ */

/** Fold a usable `plan` record's OWN verdict into its posture signal (mirrors reduce.ts `postureOf`). */
function planPosture(verdict: string): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal {
  switch (verdict) {
    case "clear":
      return "coherent";
    case "monitor":
      return "advisory";
    case "investigate":
      return "insufficient";
    case "block-release":
    case "invalid":
      return "blocking";
    default:
      return "coherent";
  }
}

/** Fold a usable `trend` record's OWN verdict into its posture signal (mirrors reduce.ts `postureOf`). */
function trendPosture(verdict: string): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal {
  switch (verdict) {
    case "improving":
    case "stable":
      return "coherent";
    case "watch":
    case "degrading":
      return "advisory";
    case "insufficient":
      return "insufficient";
    case "blocked":
    case "invalid":
      return "blocking";
    default:
      return "coherent";
  }
}

/** Fold a usable `index` record's OWN verdict into its posture signal (mirrors reduce.ts `postureOf`). */
function indexPosture(verdict: string): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal {
  switch (verdict) {
    case "indexed":
      return "coherent";
    case "index-open":
      return "advisory";
    case "index-incomplete":
      return "insufficient";
    case "index-blocked":
    case "index-invalid":
      return "blocking";
    default:
      return "coherent";
  }
}

/** Fold a usable `finalization` record's OWN verdict into its posture signal (mirrors reduce.ts `postureOf`). */
function finalizationPosture(verdict: string): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal {
  switch (verdict) {
    case "finalized":
      return "coherent";
    case "finalize-open":
      return "advisory";
    case "finalize-incomplete":
      return "insufficient";
    case "finalize-blocked":
      return "blocking";
    default:
      return "coherent";
  }
}

/**
 * The signal `computeFinalizeIndexTrendFinalize` would compute for one usable related record, from the record's own
 * verdict + the record's recorded primary-receipt anchors (mirrors `relationSignalFor`). A cross-check record whose
 * recorded verdict disagrees with the receipt's recorded anchor for that kind is `contradictory` (a cross-check
 * mismatch fails closed); otherwise the record folds its OWN bounded posture. The `plan` / `trend` / `index`
 * cross-checks compare against the `claimedPlanVerdict` / `sourceTrendVerdict` / `sourceLatestIndex` the receipt
 * recorded (a `null` anchor cannot contradict); a `finalization` record has no recorded anchor here (its anchor lived
 * in the index's facts, which the record does not carry) so it folds its posture only.
 */
function finalizeSignalFor(
  source: RecordedSource,
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  verdict: string,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal {
  switch (kind) {
    case "plan": {
      const anchor = source.state === "usable" ? source.claimedPlanVerdict : null;
      if (anchor !== null && verdict !== anchor) return "contradictory";
      return planPosture(verdict);
    }
    case "trend": {
      const anchor = source.state === "usable" ? source.sourceTrendVerdict : null;
      if (anchor !== null && verdict !== anchor) return "contradictory";
      return trendPosture(verdict);
    }
    case "index": {
      const anchor = source.state === "usable" ? source.sourceLatestIndex : null;
      if (anchor !== null && verdict !== anchor) return "contradictory";
      return indexPosture(verdict);
    }
    case "finalization":
      return finalizationPosture(verdict);
  }
}

/**
 * Re-check each related record's recorded `signal` against the signal `computeFinalizeIndexTrendFinalize` would
 * compute: a non-usable record must carry `none` and a `null` verdict; a usable record must surface a bounded verdict
 * and a signal that matches the recompute from its own verdict + the recorded primary-receipt anchors. A hand-flipped
 * signal on any related record is caught.
 */
function signalsConsistent(source: RecordedSource, related: readonly RecordedRelated[]): boolean {
  for (const r of related) {
    if (r.state !== "usable") {
      if (r.signal !== "none" || r.verdict !== null) return false;
      continue;
    }
    if (r.verdict === null) return false; // a usable record always surfaces a bounded verdict
    if (r.signal !== finalizeSignalFor(source, r.kind, r.verdict)) return false;
  }
  return true;
}

/** The fired receipt reason, keyed off the primary receipt's coverage state + (when usable) its own verdict. */
function receiptReason(source: RecordedSource): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId {
  if (source.state === "unreadable") return "receipt-unreadable";
  if (source.state === "tampered") return "receipt-tampered";
  switch (source.receiptVerdict) {
    case "completed":
      return "receipt-completed";
    case "incomplete":
      return "receipt-incomplete";
    case "blocked":
      return "receipt-blocked";
    case "invalid":
      return "receipt-invalid";
    default:
      // A usable source is guaranteed (by `sourceConsistent`) to carry a non-null receipt verdict.
      return "receipt-incomplete";
  }
}

/** The fired reason for a usable related record, keyed off its kind + recorded signal (mirrors reduce.ts `recordReason`). */
function usableRecordReason(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId | null {
  switch (signal) {
    case "coherent":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_COHERENT_REASON[kind];
    case "contradictory":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CONTRADICTION_REASON[kind];
    case "advisory":
      return "source-chain-advisory";
    case "insufficient":
      return "source-chain-insufficient";
    case "blocking":
      return "source-chain-blocked";
    case "none":
      return null;
  }
}

/** The reason a related record fires, keyed off its coverage state + required flag + recorded signal (mirrors reduce.ts). */
function recordReason(r: RecordedRelated): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId | null {
  switch (r.state) {
    case "absent":
      return r.required ? "required-record-missing" : null;
    case "unreadable":
      return r.required ? "required-record-missing" : "related-unreadable";
    case "tampered":
      return "related-tampered";
    case "usable":
      return usableRecordReason(r.kind, r.signal);
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > incomplete > open > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL[id].severity);
  if (severities.includes("invalid")) return "finalize-invalid";
  if (severities.includes("blocking")) return "finalize-blocked";
  if (severities.includes("incomplete")) return "finalize-incomplete";
  if (severities.includes("open")) return "finalize-open";
  return "finalized";
}

/** The re-derived finalization rollup fields the recorded rollup must reproduce (skips authored `detail`). */
interface DerivedRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict;
  readonly exitCode: number;
  readonly finalized: boolean;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[];
  readonly invalid: number;
  readonly blocking: number;
  readonly incomplete: number;
  readonly open: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "finalize-open" | "finalize-incomplete" | null;
  /** DERIVED-only (not recorded by the Phase 79 rollup): supplied records whose signal folded blocking. */
  readonly relatedBlocking: number;
  /** DERIVED-only: coverage facets the recorded `coverage` block is cross-checked against. */
  readonly requiredRecords: number;
  readonly usableRecords: number;
  readonly missingRecords: number;
  readonly tamperedRecords: number;
  readonly unreadableRecords: number;
}

/**
 * Re-derive the finalization rollup from the record's OWN recorded `source` + `related` + `policy`, mirroring
 * `computeFinalizeIndexTrendFinalize` in `release-decision-closeout-governance-finalize-index-trend-finalize/reduce.ts`
 * (taking each related record's RECORDED signal as given — the signals were independently re-checked by
 * {@link signalsConsistent}). Pure and deterministic.
 */
function deriveFinalizeRollup(
  source: RecordedSource,
  related: readonly RecordedRelated[],
  policy: RecordedPolicy,
): DerivedRollup {
  const receiptFired = receiptReason(source);
  const fired: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[] = [receiptFired];
  const requiredMissing: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind[] = [];
  for (const r of related) {
    const reason = recordReason(r);
    if (reason !== null) fired.push(reason);
    if (r.required && (r.state === "absent" || r.state === "unreadable")) requiredMissing.push(r.kind);
  }

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of an open finalization OR a
  // finalize-incomplete caused by an INCOMPLETE primary receipt (mirrors reduce.ts).
  const baseVerdict = verdictFrom(fired);
  const receiptIncomplete = receiptFired === "receipt-incomplete";
  const strictOpenEscalated =
    policy.strictOpen &&
    (baseVerdict === "finalize-open" || (baseVerdict === "finalize-incomplete" && receiptIncomplete));
  const strictOpenEscalatedFrom: "finalize-open" | "finalize-incomplete" | null = strictOpenEscalated
    ? (baseVerdict as "finalize-open" | "finalize-incomplete")
    : null;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const invalid = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const usableRecords = related.filter((r) => r.state === "usable").length;
  const tamperedRecords = related.filter((r) => r.state === "tampered").length;
  const unreadableRecords = related.filter((r) => r.state === "unreadable").length;
  const relatedCoherent = related.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = related.filter((r) => r.signal === "contradictory").length;
  const relatedBlocking = related.filter((r) => r.signal === "blocking").length;
  const requiredRecords = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS.filter(
    (k) => policy.require[k],
  ).length;

  return {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT_FOR_VERDICT[verdict],
    finalized: verdict === "finalized",
    receiptState: source.state,
    receiptVerdict: source.receiptVerdict,
    planClass: source.planClass,
    reasons: orderedIds,
    invalid,
    blocking,
    incomplete,
    open,
    informational,
    relatedSupplied: supplied.length,
    relatedCoherent,
    relatedContradictory,
    requiredMissing,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom,
    relatedBlocking,
    requiredRecords,
    usableRecords,
    missingRecords: requiredMissing.length,
    tamperedRecords,
    unreadableRecords,
  };
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: DerivedRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.finalized === b.finalized &&
    a.receiptState === b.receiptState &&
    a.receiptVerdict === b.receiptVerdict &&
    a.planClass === b.planClass &&
    a.invalid === b.invalid &&
    a.blocking === b.blocking &&
    a.incomplete === b.incomplete &&
    a.open === b.open &&
    a.informational === b.informational &&
    a.relatedSupplied === b.relatedSupplied &&
    a.relatedCoherent === b.relatedCoherent &&
    a.relatedContradictory === b.relatedContradictory &&
    a.strictOpen === b.strictOpen &&
    a.strictOpenEscalated === b.strictOpenEscalated &&
    a.strictOpenEscalatedFrom === b.strictOpenEscalatedFrom &&
    sameStringSet(a.reasons, b.reasons) &&
    sameStringSet(a.requiredMissing, b.requiredMissing)
  );
}

/** Whether the re-derived coverage matches the recorded `coverage` block (a crude-tamper recheck of the coverage). */
function sameCoverage(
  derived: DerivedRollup,
  sourceState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState,
  c: RecordedCoverage,
): boolean {
  return (
    c.hasReceipt === (sourceState === "usable") &&
    c.receiptState === sourceState &&
    c.requiredRecords === derived.requiredRecords &&
    c.suppliedRecords === derived.relatedSupplied &&
    c.usableRecords === derived.usableRecords &&
    c.missingRecords === derived.missingRecords &&
    c.tamperedRecords === derived.tamperedRecords &&
    c.unreadableRecords === derived.unreadableRecords &&
    c.coherentRecords === derived.relatedCoherent &&
    c.contradictoryRecords === derived.relatedContradictory
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` `root` to the bounded
 * {@link IngestedFinalize}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_FINALIZE}. For a recognized record it validates the recorded
 * rollup + top-level headline + source + related + policy + coverage, then requires: (1) the source block is internally
 * consistent, (2) each related record's signal is consistent with its recorded verdict + the recorded anchors, (3) the
 * top-level verdict / exit code equal the recorded rollup (Phase 79 mirrors them), (4) the record's `policy.strictOpen`
 * equals the recorded rollup's `strictOpen`, (5) the recorded rollup RE-DERIVES from the reconstructed source + related
 * + policy, and (6) the recorded coverage re-derives. Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestFinalize(root: unknown): IngestedFinalize {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA) {
    return UNRECOGNIZED_FINALIZE;
  }

  const rollupObj = isObject(root.finalize) ? root.finalize : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS) ?? null)
    : (oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS) ?? null);

  if (rollupObj === undefined) return inconsistentFinalize(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentFinalize(claimed);

  // The top-level headline facets must equal the recorded rollup (Phase 79 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const topExitCode = intOf(root.exitCode);
  if (
    topVerdict === undefined ||
    topExitCode === undefined ||
    topVerdict !== recorded.verdict ||
    topExitCode !== recorded.exitCode
  ) {
    return inconsistentFinalize(recorded.verdict);
  }

  const source = readRecordedSource(root);
  if (source === undefined || !sourceConsistent(source)) return inconsistentFinalize(recorded.verdict);

  const related = readRecordedRelated(root);
  if (related === undefined || !signalsConsistent(source, related)) return inconsistentFinalize(recorded.verdict);

  const policy = readRecordedPolicy(root);
  if (policy === undefined || policy.strictOpen !== recorded.strictOpen) {
    return inconsistentFinalize(recorded.verdict);
  }

  const coverage = readRecordedCoverage(root);
  if (coverage === undefined) return inconsistentFinalize(recorded.verdict);

  // Re-derive the finalization rollup from the record's OWN recorded facets + policy, and require the recorded rollup +
  // coverage to re-derive on every load-bearing field — so a hand-flipped finalization verdict / exit / rollup / count
  // is caught.
  const rederived = deriveFinalizeRollup(source, related, policy);
  if (!sameRollup(rederived, recorded)) return inconsistentFinalize(recorded.verdict);
  if (!sameCoverage(rederived, source.state, coverage)) return inconsistentFinalize(recorded.verdict);

  const facts: FinalizeRecordFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    finalized: recorded.finalized,
    receiptState: recorded.receiptState,
    receiptVerdict: recorded.receiptVerdict,
    planClass: recorded.planClass,
    relatedSupplied: recorded.relatedSupplied,
    relatedCoherent: recorded.relatedCoherent,
    relatedContradictory: recorded.relatedContradictory,
    relatedBlocking: rederived.relatedBlocking,
    requiredMissing: recorded.requiredMissing.length,
    strictOpen: recorded.strictOpen,
    strictOpenEscalated: recorded.strictOpenEscalated,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
