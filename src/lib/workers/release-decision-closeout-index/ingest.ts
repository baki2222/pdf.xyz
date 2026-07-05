/**
 * Pure, node-free **record ingest** for the release decision closeout index (Phase 65) — the trust boundary and the
 * no-leak core.
 *
 * The index indexes a bounded history of `pdfxyz.release-decision-closeout/1` closeout records. Even though each record
 * is already content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a committed
 * record, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested shape, in
 * the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a closeout. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the
 *    record's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Re-derive the tested boundary.** A Phase 64 closeout record reduced its inner chain (the receipt, the plan, the
 *    trend, the decision / index records) into a bounded `source` summary + a per-kind `related[]` checklist (each with
 *    the computed cross-check `signal`) + a `closeout` rollup. So the DEEPEST self-consistency check available over a
 *    closeout record is to RE-DERIVE its `closeout` rollup from its OWN recorded (`source` state + verdict, each
 *    `related[]` state + required + signal, policy) and require the recorded rollup to re-derive — exactly the fold the
 *    Phase 64 `computeCloseout` reducer performs, taking the record's recorded signals as given. A hand-flipped
 *    closeout verdict / exit / rollup, or an inconsistent source / related block, is caught as a tamper. Because the
 *    closeout dropped the related plan's cross-check facets (keeping only the computed signal + the plan's verdict),
 *    the plan cross-check `signal` cannot be recomputed here; the decision / index / trend signals CAN be recomputed
 *    from their recorded verdicts and are required to match. A fully self-consistent fabrication is out of scope,
 *    exactly as at Phases 52–64.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `unreadable`; a recognized-but-inconsistent record is
 *    `tampered`; a coherent record yields reduced bounded facts (`usable`). The offending content is never echoed.
 *
 * SAFETY of the re-derivation: it mirrors `computeCloseout` (verified against `release-decision-closeout/reduce.ts`;
 * re-verify that reducer's reason / verdict / coverage logic before trusting this reconstruction). Its faithfulness is
 * pinned by the module tests, which build REAL Phase 64 closeout records via the shipped closeout builder and require
 * each to re-derive `usable`.
 */

import { buildReasons } from "../release-decision-closeout/reduce";
import { planClassForVerdict } from "../release-decision-action-receipt/types";
import {
  RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_EXIT,
  RELEASE_DECISION_CLOSEOUT_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_RECORD_STATES,
  RELEASE_DECISION_CLOSEOUT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_RELATION_SIGNALS,
  RELEASE_DECISION_CLOSEOUT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_SOURCE_STATES,
  RELEASE_DECISION_CLOSEOUT_VERDICTS,
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_INDEX_VERDICTS,
  RELEASE_DECISION_TREND_VERDICTS,
  type ReleaseDecisionActionPlanActionClass,
  type ReleaseDecisionActionPlanUrgency,
  type ReleaseDecisionActionPlanVerdict,
  type ReleaseDecisionActionReceiptPlanClass,
  type ReleaseDecisionActionReceiptVerdict,
  type ReleaseDecisionCloseoutRecordKind,
  type ReleaseDecisionCloseoutRecordState,
  type ReleaseDecisionCloseoutReasonId,
  type ReleaseDecisionCloseoutRelationSignal,
  type ReleaseDecisionCloseoutSourceState,
  type ReleaseDecisionCloseoutVerdict,
  type ReleaseDecisionTrendVerdict,
} from "../release-decision-closeout/types";
import type { CloseoutRecordFacts } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout/1` document. */
export interface IngestedCloseout {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-closeout/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded closeout rollup RE-DERIVES from its own recorded facets + policy. */
  readonly usable: boolean;
  /** The closeout's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: CloseoutRecordFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-closeout/1`. */
export const UNRECOGNIZED_CLOSEOUT: IngestedCloseout = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) closeout, carrying only its untrusted claimed verdict. */
function inconsistentCloseout(verdict: ReleaseDecisionCloseoutVerdict | null): IngestedCloseout {
  return { recognized: true, usable: false, verdict, facts: null };
}

/* ------------------------------------------------------------------ *
 *  Recorded blocks (validated into bounded shapes; nothing echoed)
 * ------------------------------------------------------------------ */

/** The recorded `closeout` rollup fields the recompute must reproduce for the record to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionCloseoutVerdict;
  readonly exitCode: number;
  readonly closed: boolean;
  readonly receiptState: ReleaseDecisionCloseoutSourceState;
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutReasonId[];
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "closeout-open" | null;
}

const ROLLUP_STRICT_FROM = ["closeout-open"] as const;
const CLOSEOUT_REASON_IDS = Object.keys(
  RELEASE_DECISION_CLOSEOUT_REASON_DETAIL,
) as ReleaseDecisionCloseoutReasonId[];

/** Validate the closeout's `closeout` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const closed = boolOf(rollup.closed);
  const receiptState = oneOf(rollup.receiptState, RELEASE_DECISION_CLOSEOUT_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(rollup.receiptVerdict, RELEASE_DECISION_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(rollup.planClass, RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES);
  const reasons = enumArray(rollup.reasons, CLOSEOUT_REASON_IDS);
  const blocking = intOf(rollup.blocking);
  const open = intOf(rollup.open);
  const incomplete = intOf(rollup.incomplete);
  const informational = intOf(rollup.informational);
  const relatedSupplied = intOf(rollup.relatedSupplied);
  const relatedCoherent = intOf(rollup.relatedCoherent);
  const relatedContradictory = intOf(rollup.relatedContradictory);
  const relatedBlocking = intOf(rollup.relatedBlocking);
  const requiredMissing = enumArray(rollup.requiredMissing, RELEASE_DECISION_CLOSEOUT_RECORD_KINDS);
  const strictOpen = boolOf(rollup.strictOpen);
  const strictOpenEscalated = boolOf(rollup.strictOpenEscalated);
  const strictOpenEscalatedFrom = nullableOneOf(rollup.strictOpenEscalatedFrom, ROLLUP_STRICT_FROM);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    closed === undefined ||
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
    closed,
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

/** The bounded `source` facets the closeout recorded (its primary receipt, reduced). */
interface RecordedSource {
  readonly state: ReleaseDecisionCloseoutSourceState;
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  readonly claimedPlanVerdict: ReleaseDecisionActionPlanVerdict | null;
  readonly sourceTrendVerdict: ReleaseDecisionTrendVerdict | null;
  readonly planUrgency: ReleaseDecisionActionPlanUrgency | null;
  readonly planActionClass: ReleaseDecisionActionPlanActionClass | null;
  readonly benignMonitor: boolean;
  readonly acksRequired: number;
  readonly acksSatisfied: number;
  readonly acksMissing: number;
  readonly receiptStrictOpen: boolean;
}

/** Validate the closeout's `source` block into a bounded {@link RecordedSource}, or `undefined`. */
function readRecordedSource(root: Obj): RecordedSource | undefined {
  const s = isObject(root.source) ? root.source : undefined;
  if (s === undefined) return undefined;
  const state = oneOf(s.state, RELEASE_DECISION_CLOSEOUT_SOURCE_STATES);
  const receiptVerdict = nullableOneOf(s.receiptVerdict, RELEASE_DECISION_ACTION_RECEIPT_VERDICTS);
  const planClass = nullableOneOf(s.planClass, RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES);
  const claimedPlanVerdict = nullableOneOf(s.claimedPlanVerdict, RELEASE_DECISION_ACTION_PLAN_VERDICTS);
  const sourceTrendVerdict = nullableOneOf(s.sourceTrendVerdict, RELEASE_DECISION_TREND_VERDICTS);
  const planUrgency = nullableOneOf(s.planUrgency, RELEASE_DECISION_ACTION_PLAN_URGENCIES);
  const planActionClass = nullableOneOf(s.planActionClass, RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES);
  const benignMonitor = boolOf(s.benignMonitor);
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
    planUrgency === undefined ||
    planActionClass === undefined ||
    benignMonitor === undefined ||
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
    planUrgency,
    planActionClass,
    benignMonitor,
    acksRequired,
    acksSatisfied,
    acksMissing,
    receiptStrictOpen,
  };
}

/**
 * Require the closeout's `source` block to be internally consistent with its own receipt coverage state: a `usable`
 * receipt carries a non-null plan verdict / class / urgency / action class with
 * `planClass === planClassForVerdict(claimedPlanVerdict)` and a non-null receipt verdict; a non-usable receipt carries
 * the null / zero / false surface Phase 64's builder always emits when the receipt was not usable. Catches a crudely
 * tampered source block (mirrors the Phase 64 receipt-side `sourceConsistent`); a fully self-consistent fabrication is
 * out of scope.
 */
function sourceConsistent(s: RecordedSource): boolean {
  if (s.state === "usable") {
    return (
      s.receiptVerdict !== null &&
      s.claimedPlanVerdict !== null &&
      s.planClass !== null &&
      s.planUrgency !== null &&
      s.planActionClass !== null &&
      s.planClass === planClassForVerdict(s.claimedPlanVerdict)
    );
  }
  // A non-usable receipt reduced to no facts: every facet is the null / zero / false default. An `unreadable` receipt
  // carries no claimed verdict either; a `tampered` receipt may surface its untrusted claim.
  const factsAbsent =
    s.planClass === null &&
    s.claimedPlanVerdict === null &&
    s.sourceTrendVerdict === null &&
    s.planUrgency === null &&
    s.planActionClass === null &&
    s.benignMonitor === false &&
    s.acksRequired === 0 &&
    s.acksSatisfied === 0 &&
    s.acksMissing === 0;
  return factsAbsent && (s.state === "tampered" || s.receiptVerdict === null);
}

/** One recorded related-record entry (a per-kind checklist row the closeout emitted). */
interface RecordedRelated {
  readonly kind: ReleaseDecisionCloseoutRecordKind;
  readonly required: boolean;
  readonly state: ReleaseDecisionCloseoutRecordState;
  readonly signal: ReleaseDecisionCloseoutRelationSignal;
  readonly verdict: string | null;
}

/**
 * Validate the closeout's `related` block into exactly one bounded {@link RecordedRelated} per kind, in the canonical
 * {@link RELEASE_DECISION_CLOSEOUT_RECORD_KINDS} order Phase 64 always emits, or `undefined` if malformed. The
 * per-kind `verdict` is validated against that kind's own verdict enum (nullable) so an off-enum token is a corrupt row.
 */
function readRecordedRelated(root: Obj): RecordedRelated[] | undefined {
  if (!Array.isArray(root.related) || root.related.length !== RELEASE_DECISION_CLOSEOUT_RECORD_KINDS.length) {
    return undefined;
  }
  const out: RecordedRelated[] = [];
  for (let i = 0; i < RELEASE_DECISION_CLOSEOUT_RECORD_KINDS.length; i++) {
    const expectedKind = RELEASE_DECISION_CLOSEOUT_RECORD_KINDS[i]!;
    const entry = root.related[i];
    if (!isObject(entry)) return undefined;
    const kind = oneOf(entry.kind, RELEASE_DECISION_CLOSEOUT_RECORD_KINDS);
    const required = boolOf(entry.required);
    const state = oneOf(entry.state, RELEASE_DECISION_CLOSEOUT_RECORD_STATES);
    const signal = oneOf(entry.signal, RELEASE_DECISION_CLOSEOUT_RELATION_SIGNALS);
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

/** Validate a related record's surfaced verdict against its kind's own verdict enum (nullable), else `undefined`. */
function readRelatedVerdict(kind: ReleaseDecisionCloseoutRecordKind, value: unknown): string | null | undefined {
  switch (kind) {
    case "plan":
      return nullableOneOf(value, RELEASE_DECISION_ACTION_PLAN_VERDICTS);
    case "trend":
      return nullableOneOf(value, RELEASE_DECISION_TREND_VERDICTS);
    case "index":
      return nullableOneOf(value, RELEASE_DECISION_INDEX_VERDICTS);
    case "decision":
      return nullableOneOf(value, RELEASE_DECISION_DECISIONS);
  }
}

/** The bounded `policy` block the closeout recorded. */
interface RecordedPolicy {
  readonly strictOpen: boolean;
  readonly require: {
    readonly plan: boolean;
    readonly trend: boolean;
    readonly decision: boolean;
    readonly index: boolean;
  };
}

/** Validate the closeout's `policy` block into a bounded {@link RecordedPolicy}, or `undefined`. */
function readRecordedPolicy(root: Obj): RecordedPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const strictOpen = boolOf(p.strictOpen);
  const req = isObject(p.require) ? p.require : undefined;
  if (strictOpen === undefined || req === undefined) return undefined;
  const plan = boolOf(req.plan);
  const trend = boolOf(req.trend);
  const decision = boolOf(req.decision);
  const index = boolOf(req.index);
  if (plan === undefined || trend === undefined || decision === undefined || index === undefined) {
    return undefined;
  }
  return { strictOpen, require: { plan, trend, decision, index } };
}

/* ------------------------------------------------------------------ *
 *  Re-derivation (mirrors release-decision-closeout/reduce.ts)
 * ------------------------------------------------------------------ */

/** The expected relation signal a usable `decision` record contributes, from its own decision (mirrors reduce.ts). */
function decisionSignal(verdict: string): ReleaseDecisionCloseoutRelationSignal {
  switch (verdict) {
    case "proceed":
      return "coherent";
    case "proceed-with-followup":
    case "hold":
      return "advisory";
    case "insufficient":
      return "insufficient";
    case "reject":
    case "invalid":
      return "blocking";
    default:
      return "coherent";
  }
}

/** The expected relation signal a usable `index` record contributes, from its own verdict (mirrors reduce.ts). */
function indexSignal(verdict: string): ReleaseDecisionCloseoutRelationSignal {
  switch (verdict) {
    case "stable":
      return "coherent";
    case "watch":
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

/**
 * Re-check each related record's recorded `signal` against the signal `computeCloseout` would compute, to the depth the
 * closeout record allows: a non-usable / absent record must carry `none`; a usable `decision` / `index` record's signal
 * must match the recompute from its own recorded verdict; a usable `trend` record's signal must match the recompute
 * against the recorded source-trend verdict; a usable `plan` record's cross-check facets were dropped by the closeout,
 * so its signal can only be structurally validated (`coherent` when no cross-check applies, else `coherent` /
 * `contradictory`). A hand-flipped signal on a decision / index / trend record is caught.
 */
function signalsConsistent(source: RecordedSource, related: readonly RecordedRelated[]): boolean {
  for (const r of related) {
    if (r.state !== "usable") {
      if (r.signal !== "none") return false;
      continue;
    }
    if (r.verdict === null) return false; // a usable record always surfaces a bounded verdict
    switch (r.kind) {
      case "decision":
        if (r.signal !== decisionSignal(r.verdict)) return false;
        break;
      case "index":
        if (r.signal !== indexSignal(r.verdict)) return false;
        break;
      case "trend": {
        const noCrossCheck = source.state !== "usable" || source.sourceTrendVerdict === null;
        const expected = noCrossCheck
          ? "coherent"
          : r.verdict === source.sourceTrendVerdict
            ? "coherent"
            : "contradictory";
        if (r.signal !== expected) return false;
        break;
      }
      case "plan": {
        const noCrossCheck = source.state !== "usable" || source.claimedPlanVerdict === null;
        if (noCrossCheck) {
          if (r.signal !== "coherent") return false;
        } else if (r.signal !== "coherent" && r.signal !== "contradictory") {
          return false;
        }
        break;
      }
    }
  }
  return true;
}

/** The fired receipt reason, keyed off the primary receipt's coverage state + (when usable) its own verdict. */
function receiptReason(source: RecordedSource): ReleaseDecisionCloseoutReasonId {
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
  kind: ReleaseDecisionCloseoutRecordKind,
  signal: ReleaseDecisionCloseoutRelationSignal,
): ReleaseDecisionCloseoutReasonId | null {
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
function recordReason(r: RecordedRelated): ReleaseDecisionCloseoutReasonId | null {
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
function verdictFrom(fired: readonly ReleaseDecisionCloseoutReasonId[]): ReleaseDecisionCloseoutVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "closeout-blocked";
  if (severities.includes("open")) return "closeout-open";
  if (severities.includes("incomplete")) return "closeout-incomplete";
  return "closed";
}

/** The exit code for a resolved closeout verdict. */
function exitFor(verdict: ReleaseDecisionCloseoutVerdict): number {
  switch (verdict) {
    case "closed":
      return RELEASE_DECISION_CLOSEOUT_EXIT.CLOSED;
    case "closeout-incomplete":
      return RELEASE_DECISION_CLOSEOUT_EXIT.INCOMPLETE;
    case "closeout-open":
      return RELEASE_DECISION_CLOSEOUT_EXIT.OPEN;
    case "closeout-blocked":
      return RELEASE_DECISION_CLOSEOUT_EXIT.BLOCKED;
  }
}

/** The re-derived closeout rollup fields the recorded rollup must reproduce (skips authored `detail`). */
interface DerivedRollup {
  readonly verdict: ReleaseDecisionCloseoutVerdict;
  readonly exitCode: number;
  readonly closed: boolean;
  readonly receiptState: ReleaseDecisionCloseoutSourceState;
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  readonly reasons: readonly ReleaseDecisionCloseoutReasonId[];
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly relatedSupplied: number;
  readonly relatedCoherent: number;
  readonly relatedContradictory: number;
  readonly relatedBlocking: number;
  readonly requiredMissing: readonly ReleaseDecisionCloseoutRecordKind[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "closeout-open" | null;
}

/**
 * Re-derive the closeout rollup from the record's OWN recorded `source` + `related` + `policy`, mirroring
 * `computeCloseout` in `release-decision-closeout/reduce.ts` but taking each related record's RECORDED signal as given
 * (the plan cross-check facets the closeout dropped cannot be recomputed here). Pure and deterministic.
 */
function deriveCloseoutRollup(
  source: RecordedSource,
  related: readonly RecordedRelated[],
  policy: RecordedPolicy,
): DerivedRollup {
  const fired: ReleaseDecisionCloseoutReasonId[] = [receiptReason(source)];
  const requiredMissing: ReleaseDecisionCloseoutRecordKind[] = [];
  for (const r of related) {
    const reason = recordReason(r);
    if (reason !== null) fired.push(reason);
    if (r.required && (r.state === "absent" || r.state === "unreadable")) requiredMissing.push(r.kind);
  }

  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "closeout-open" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const relatedCoherent = supplied.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = supplied.filter((r) => r.signal === "contradictory").length;
  const relatedBlocking = supplied.filter((r) => r.signal === "blocking" || r.state === "tampered").length;

  return {
    verdict,
    exitCode: exitFor(verdict),
    closed: verdict === "closed",
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
    strictOpenEscalatedFrom: strictOpenEscalated ? "closeout-open" : null,
  };
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: DerivedRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.closed === b.closed &&
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

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout/1` `root` to the bounded {@link IngestedCloseout}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_CLOSEOUT}. For a recognized closeout it validates the
 * recorded rollup + top-level facets + source + related + policy, then requires: (1) the source block is internally
 * consistent, (2) each related record's signal is consistent with its recorded verdict (to the depth the closeout
 * allows), (3) the top-level verdict / exit code / plan class equal the recorded rollup (Phase 64 mirrors them), (4)
 * the closeout's `policy.strictOpen` equals the recorded rollup's `strictOpen`, and (5) the recorded rollup RE-DERIVES
 * from the reconstructed source + related + policy. Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestCloseout(root: unknown): IngestedCloseout {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_SCHEMA) return UNRECOGNIZED_CLOSEOUT;

  const rollupObj = isObject(root.closeout) ? root.closeout : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_VERDICTS) ?? null)
    : (oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_VERDICTS) ?? null);

  if (rollupObj === undefined) return inconsistentCloseout(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentCloseout(claimed);

  // The top-level headline facets must equal the recorded rollup (Phase 64 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_VERDICTS);
  const topExitCode = intOf(root.exitCode);
  const topPlanClass = nullableOneOf(root.planClass, RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES);
  if (
    topVerdict === undefined ||
    topExitCode === undefined ||
    topPlanClass === undefined ||
    topVerdict !== recorded.verdict ||
    topExitCode !== recorded.exitCode ||
    topPlanClass !== recorded.planClass
  ) {
    return inconsistentCloseout(recorded.verdict);
  }

  const source = readRecordedSource(root);
  if (source === undefined || !sourceConsistent(source)) return inconsistentCloseout(recorded.verdict);

  const related = readRecordedRelated(root);
  if (related === undefined || !signalsConsistent(source, related)) return inconsistentCloseout(recorded.verdict);

  const policy = readRecordedPolicy(root);
  if (policy === undefined || policy.strictOpen !== recorded.strictOpen) {
    return inconsistentCloseout(recorded.verdict);
  }

  // Re-derive the closeout rollup from the record's OWN recorded facets + policy, and require the recorded rollup to
  // re-derive on every load-bearing field — so a hand-flipped closeout verdict / exit / rollup is caught.
  const rederived = deriveCloseoutRollup(source, related, policy);
  if (!sameRollup(rederived, recorded)) return inconsistentCloseout(recorded.verdict);

  const facts: CloseoutRecordFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    closed: recorded.closed,
    receiptState: recorded.receiptState,
    receiptVerdict: recorded.receiptVerdict,
    planClass: recorded.planClass,
    blocking: recorded.blocking,
    open: recorded.open,
    incomplete: recorded.incomplete,
    relatedContradictory: recorded.relatedContradictory,
    relatedBlocking: recorded.relatedBlocking,
    requiredMissing: recorded.requiredMissing.length,
    strictOpen: recorded.strictOpen,
    strictOpenEscalated: recorded.strictOpenEscalated,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
