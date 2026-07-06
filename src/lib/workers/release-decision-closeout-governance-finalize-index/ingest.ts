/**
 * Pure, node-free **record ingest** for the release decision closeout governance finalize index (Phase 75) — the trust
 * boundary and the no-leak core.
 *
 * The index indexes a bounded history of `pdfxyz.release-decision-closeout-governance-finalize/1` finalization bundles.
 * Even though each record is already content-free, every one is UNTRUSTED input here (a CI archive an operator points us
 * at, a committed record, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded
 * ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a bundle. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the record's OWN
 *    stamp, and any stray extra field are all DROPPED.
 *  - **Re-derive the tested boundary.** A Phase 74 finalization bundle reduced its primary-receipt chain into a bounded
 *    `source` summary + a per-kind `related[]` checklist (each with the computed cross-check / posture `signal`) + a
 *    `governanceFinalize` rollup. So the DEEPEST self-consistency check available over a finalization bundle is to
 *    RE-DERIVE its `governanceFinalize` rollup from its OWN recorded (`source` state + facets, each `related[]` state +
 *    required + verdict + signal, policy) and require the recorded rollup to re-derive — exactly the fold the Phase 74
 *    `computeGovernanceFinalize` reducer performs. Because the bundle records the primary-receipt cross-check ANCHORS
 *    (`claimedPlanVerdict` + `sourceTrendVerdict`) alongside each related record's own verdict, the plan / trend
 *    cross-check signals CAN be fully recomputed here and are required to match; a hand-flipped finalization verdict /
 *    exit / rollup, or a flipped cross-check / posture signal, is caught as a tamper. A fully self-consistent fabrication
 *    is out of scope, exactly as at Phases 52–74.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `unreadable`; a recognized-but-inconsistent record is
 *    `tampered`; a coherent record yields reduced bounded facts (`usable`). The offending content is never echoed.
 *
 * SAFETY of the re-derivation: it mirrors `computeGovernanceFinalize` (verified against
 * `release-decision-closeout-governance-finalize/reduce.ts`; re-verify that reducer's reason / verdict / signal logic
 * before trusting this reconstruction). Its faithfulness is pinned by the module tests, which build REAL Phase 74
 * finalization bundles via the shipped finalize builder and require each to re-derive `usable`.
 */

import { buildReasons } from "../release-decision-closeout-governance-finalize/reduce";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SOURCE_STATES } from "../release-decision-closeout-governance-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RELATION_SIGNALS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SOURCE_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal,
  type ReleaseDecisionCloseoutGovernanceFinalizeSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize/types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeReasonId } from "../release-decision-closeout-governance-finalize/types";
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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-governance-finalize/1` document. */
export interface IngestedFinalize {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-closeout-governance-finalize/1` tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded finalization rollup RE-DERIVES from its own recorded facets + policy. */
  readonly usable: boolean;
  /** The bundle's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: FinalizeRecordFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-closeout-governance-finalize/1`. */
export const UNRECOGNIZED_FINALIZE: IngestedFinalize = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) bundle, carrying only its untrusted claimed verdict. */
function inconsistentFinalize(verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null): IngestedFinalize {
  return { recognized: true, usable: false, verdict, facts: null };
}

/* ------------------------------------------------------------------ *
 *  Recorded blocks (validated into bounded shapes; nothing echoed)
 * ------------------------------------------------------------------ */

/** The recorded `governanceFinalize` rollup fields the recompute must reproduce for the record to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
  readonly exitCode: number;
  readonly finalized: boolean;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeReasonId[];
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "finalize-open" | null;
}

const ROLLUP_STRICT_FROM = ["finalize-open"] as const;
const FINALIZE_REASON_IDS = Object.keys(
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL,
) as ReleaseDecisionCloseoutGovernanceFinalizeReasonId[];

/** Validate the bundle's `governanceFinalize` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const finalized = boolOf(rollup.finalized);
  const receiptState = oneOf(rollup.receiptState, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(rollup.receiptVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(rollup.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES);
  const reasons = enumArray(rollup.reasons, FINALIZE_REASON_IDS);
  const blocking = intOf(rollup.blocking);
  const open = intOf(rollup.open);
  const incomplete = intOf(rollup.incomplete);
  const informational = intOf(rollup.informational);
  const relatedSupplied = intOf(rollup.relatedSupplied);
  const relatedCoherent = intOf(rollup.relatedCoherent);
  const relatedContradictory = intOf(rollup.relatedContradictory);
  const relatedBlocking = intOf(rollup.relatedBlocking);
  const requiredMissing = enumArray(rollup.requiredMissing, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS);
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
    finalized,
    receiptState,
    receiptVerdict,
    planClass,
    reasons,
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

/** The bounded `source` facets the bundle recorded (its primary receipt, reduced). */
interface RecordedSource {
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  readonly claimedPlanVerdict: string | null;
  readonly sourceTrendVerdict: string | null;
  readonly sourceLatestIndex: string | null;
  readonly receiptSourceState: ReleaseDecisionCloseoutGovernanceActionReceiptSourceState | null;
  readonly acksRequired: number;
  readonly acksSatisfied: number;
  readonly acksMissing: number;
  readonly receiptStrictOpen: boolean;
}

/** Validate the bundle's `source` block into a bounded {@link RecordedSource}, or `undefined`. */
function readRecordedSource(root: Obj): RecordedSource | undefined {
  const s = isObject(root.source) ? root.source : undefined;
  if (s === undefined) return undefined;
  const state = oneOf(s.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(s.receiptVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(s.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES);
  const claimedPlanVerdict = nullableOneOf(s.claimedPlanVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS);
  const sourceTrendVerdict = nullableOneOf(s.sourceTrendVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS);
  const sourceLatestIndex = nullableOneOf(s.sourceLatestIndex, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
  const receiptSourceState = nullableOneOf(s.receiptSourceState, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SOURCE_STATES);
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
 * Require the bundle's `source` block to be internally consistent with its own receipt coverage state: a `usable`
 * primary receipt carries a non-null receipt verdict AND a non-null receipt source state (Phase 74's builder always
 * records both from a usable receipt's facts); a non-usable receipt carries the null / zero / false surface Phase 74's
 * builder always emits when the receipt was not usable (only its untrusted claimed verdict may survive). Catches a
 * crudely tampered source block (mirrors the Phase 74 `buildGovernanceFinalizeSource` shape); a fully self-consistent
 * fabrication is out of scope.
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

/** One recorded related-record entry (a per-kind checklist row the bundle emitted). */
interface RecordedRelated {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind;
  readonly required: boolean;
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeRecordState;
  readonly signal: ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal;
  readonly verdict: string | null;
}

/** Validate a related record's surfaced verdict against its kind's own verdict enum (nullable), else `undefined`. */
function readRelatedVerdict(kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind, value: unknown): string | null | undefined {
  switch (kind) {
    case "plan":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS);
    case "trend":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS);
    case "index":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
    case "governance":
      return nullableOneOf(value, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS);
  }
}

/**
 * Validate the bundle's `related` block into exactly one bounded {@link RecordedRelated} per kind, in the canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS} order Phase 74 always emits, or `undefined` if
 * malformed. The per-kind `verdict` is validated against that kind's own verdict enum (nullable) so an off-enum token is
 * a corrupt row.
 */
function readRecordedRelated(root: Obj): RecordedRelated[] | undefined {
  if (
    !Array.isArray(root.related) ||
    root.related.length !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS.length
  ) {
    return undefined;
  }
  const out: RecordedRelated[] = [];
  for (let i = 0; i < RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS.length; i++) {
    const expectedKind = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS[i]!;
    const entry = root.related[i];
    if (!isObject(entry)) return undefined;
    const kind = oneOf(entry.kind, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS);
    const required = boolOf(entry.required);
    const state = oneOf(entry.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_STATES);
    const signal = oneOf(entry.signal, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RELATION_SIGNALS);
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

/** The bounded `policy` block the bundle recorded. */
interface RecordedPolicy {
  readonly strictOpen: boolean;
  readonly require: Record<ReleaseDecisionCloseoutGovernanceFinalizeRecordKind, boolean>;
}

/** Validate the bundle's `policy` block into a bounded {@link RecordedPolicy}, or `undefined`. */
function readRecordedPolicy(root: Obj): RecordedPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const strictOpen = boolOf(p.strictOpen);
  const req = isObject(p.require) ? p.require : undefined;
  if (strictOpen === undefined || req === undefined) return undefined;
  const plan = boolOf(req.plan);
  const trend = boolOf(req.trend);
  const index = boolOf(req.index);
  const governance = boolOf(req.governance);
  if (plan === undefined || trend === undefined || index === undefined || governance === undefined) {
    return undefined;
  }
  return { strictOpen, require: { plan, trend, index, governance } };
}

/** The bounded `coverage` facets the bundle recorded (its own coverage rollup, reduced). */
interface RecordedCoverage {
  readonly hasReceipt: boolean;
  readonly relatedSupplied: number;
  readonly relatedUsable: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
}

/** Validate the bundle's `coverage` block into a bounded {@link RecordedCoverage}, or `undefined`. */
function readRecordedCoverage(root: Obj): RecordedCoverage | undefined {
  const c = isObject(root.coverage) ? root.coverage : undefined;
  if (c === undefined) return undefined;
  const hasReceipt = boolOf(c.hasReceipt);
  const relatedSupplied = intOf(c.relatedSupplied);
  const relatedUsable = intOf(c.relatedUsable);
  const relatedCoherent = intOf(c.relatedCoherent);
  const relatedContradictory = intOf(c.relatedContradictory);
  const relatedBlocking = intOf(c.relatedBlocking);
  if (
    hasReceipt === undefined ||
    relatedSupplied === undefined ||
    relatedUsable === undefined ||
    relatedCoherent === undefined ||
    relatedContradictory === undefined ||
    relatedBlocking === undefined
  ) {
    return undefined;
  }
  return { hasReceipt, relatedSupplied, relatedUsable, relatedCoherent, relatedContradictory, relatedBlocking };
}

/* ------------------------------------------------------------------ *
 *  Re-derivation (mirrors release-decision-closeout-governance-finalize/reduce.ts)
 * ------------------------------------------------------------------ */

/** The expected relation signal a usable `index` record contributes, from its own verdict (mirrors reduce.ts). */
function indexSignal(verdict: string): ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal {
  switch (verdict) {
    case "indexed":
      return "coherent";
    case "index-open":
      return "advisory";
    case "index-incomplete":
      return "insufficient";
    case "index-blocked":
      return "blocking";
    default:
      return "coherent";
  }
}

/** The expected relation signal a usable `governance` record contributes, from its own verdict (mirrors reduce.ts). */
function governanceSignal(verdict: string): ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal {
  switch (verdict) {
    case "closed":
      return "coherent";
    case "governance-open":
      return "advisory";
    case "governance-incomplete":
      return "insufficient";
    case "governance-blocked":
      return "blocking";
    default:
      return "coherent";
  }
}

/**
 * The signal `computeGovernanceFinalize` would compute for one usable related record, from the record's own verdict +
 * the bundle's recorded primary-receipt anchors (mirrors `relationSignalFor`). Cross-check records (`plan` / `trend`)
 * compare against the plan verdict / source-trend verdict the receipt recorded (a mismatch is `contradictory`; no anchor
 * is `coherent`); source-chain records (`index` / `governance`) fold their OWN bounded posture.
 */
function finalizeSignalFor(
  source: RecordedSource,
  kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  verdict: string,
): ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal {
  switch (kind) {
    case "plan":
      if (source.state !== "usable" || source.claimedPlanVerdict === null) return "coherent";
      return verdict === source.claimedPlanVerdict ? "coherent" : "contradictory";
    case "trend":
      if (source.state !== "usable" || source.sourceTrendVerdict === null) return "coherent";
      return verdict === source.sourceTrendVerdict ? "coherent" : "contradictory";
    case "index":
      return indexSignal(verdict);
    case "governance":
      return governanceSignal(verdict);
  }
}

/**
 * Re-check each related record's recorded `signal` against the signal `computeGovernanceFinalize` would compute: a
 * non-usable record must carry `none` and a `null` verdict; a usable record must surface a bounded verdict and a signal
 * that matches the recompute from its own verdict + the recorded primary-receipt anchors. A hand-flipped signal on any
 * related record is caught.
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
function receiptReason(source: RecordedSource): ReleaseDecisionCloseoutGovernanceFinalizeReasonId {
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
    default:
      // A usable source is guaranteed (by `sourceConsistent`) to carry a non-null receipt verdict.
      return "receipt-incomplete";
  }
}

/** The fired reason for a usable related record, keyed off its kind + recorded signal (mirrors reduce.ts). */
function usableRecordReason(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeReasonId | null {
  switch (signal) {
    case "coherent":
      if (kind === "plan") return "plan-coherent";
      if (kind === "trend") return "trend-coherent";
      return "source-chain-coherent";
    case "contradictory":
      return kind === "plan" ? "plan-contradiction" : kind === "trend" ? "trend-contradiction" : null;
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

/** The reason a related record fires, keyed off its coverage state + required flag + recorded signal. */
function recordReason(r: RecordedRelated): ReleaseDecisionCloseoutGovernanceFinalizeReasonId | null {
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

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "finalize-blocked";
  if (severities.includes("open")) return "finalize-open";
  if (severities.includes("incomplete")) return "finalize-incomplete";
  return "finalized";
}

/** The re-derived finalization rollup fields the recorded rollup must reproduce (skips authored `detail`). */
interface DerivedRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict;
  readonly exitCode: number;
  readonly finalized: boolean;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeReasonId[];
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutGovernanceFinalizeRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "finalize-open" | null;
  readonly relatedUsable: number;
}

/**
 * Re-derive the finalization rollup from the record's OWN recorded `source` + `related` + `policy`, mirroring
 * `computeGovernanceFinalize` in `release-decision-closeout-governance-finalize/reduce.ts` (taking each related
 * record's RECORDED signal as given — the signals were independently re-checked by {@link signalsConsistent}). Pure and
 * deterministic.
 */
function deriveFinalizeRollup(
  source: RecordedSource,
  related: readonly RecordedRelated[],
  policy: RecordedPolicy,
): DerivedRollup {
  const fired: ReleaseDecisionCloseoutGovernanceFinalizeReasonId[] = [receiptReason(source)];
  const requiredMissing: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind[] = [];
  for (const r of related) {
    const reason = recordReason(r);
    if (reason !== null) fired.push(reason);
    if (r.required && (r.state === "absent" || r.state === "unreadable")) requiredMissing.push(r.kind);
  }

  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "finalize-open" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const relatedUsable = related.filter((r) => r.state === "usable").length;
  const relatedCoherent = supplied.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = supplied.filter((r) => r.signal === "contradictory").length;
  const relatedBlocking = supplied.filter((r) => r.signal === "blocking" || r.state === "tampered").length;

  return {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT_FOR_VERDICT[verdict],
    finalized: verdict === "finalized",
    receiptState: source.state,
    receiptVerdict: source.receiptVerdict,
    planClass: source.planClass,
    reasons: orderedIds,
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
    strictOpenEscalatedFrom: strictOpenEscalated ? "finalize-open" : null,
    relatedUsable,
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

/** Whether the re-derived coverage matches the recorded `coverage` block (a crude-tamper recheck of the coverage). */
function sameCoverage(derived: DerivedRollup, sourceState: ReleaseDecisionCloseoutGovernanceFinalizeSourceState, c: RecordedCoverage): boolean {
  return (
    c.hasReceipt === (sourceState === "usable") &&
    c.relatedSupplied === derived.relatedSupplied &&
    c.relatedUsable === derived.relatedUsable &&
    c.relatedCoherent === derived.relatedCoherent &&
    c.relatedContradictory === derived.relatedContradictory &&
    c.relatedBlocking === derived.relatedBlocking
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-governance-finalize/1` `root` to the bounded
 * {@link IngestedFinalize}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_FINALIZE}. For a recognized bundle it validates the recorded
 * rollup + top-level headline + source + related + policy + coverage, then requires: (1) the source block is internally
 * consistent, (2) each related record's signal is consistent with its recorded verdict + the recorded anchors, (3) the
 * top-level verdict / exit code equal the recorded rollup (Phase 74 mirrors them), (4) the bundle's `policy.strictOpen`
 * equals the recorded rollup's `strictOpen`, (5) the recorded rollup RE-DERIVES from the reconstructed source + related
 * + policy, and (6) the recorded coverage re-derives. Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestFinalize(root: unknown): IngestedFinalize {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA) {
    return UNRECOGNIZED_FINALIZE;
  }

  const rollupObj = isObject(root.governanceFinalize) ? root.governanceFinalize : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) ?? null)
    : (oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) ?? null);

  if (rollupObj === undefined) return inconsistentFinalize(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentFinalize(claimed);

  // The top-level headline facets must equal the recorded rollup (Phase 74 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS);
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
    relatedBlocking: recorded.relatedBlocking,
    requiredMissing: recorded.requiredMissing.length,
    strictOpen: recorded.strictOpen,
    strictOpenEscalated: recorded.strictOpenEscalated,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
