/**
 * Pure, node-free **ingest** for the release decision closeout governance finalize index trend finalize index trend
 * closeout bundle (Phase 84) — the trust boundary and the no-leak core.
 *
 * The closeout composes ONE primary
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt/1` receipt
 * (REQUIRED) plus OPTIONAL related records (a `…-action-plan/1` plan, a `…-finalize-index-trend/1` trend, and a
 * `…-finalize-index/1` finalization-index window). Even though every one of these is already content-free, each is
 * UNTRUSTED input here (a CI artifact an operator points us at, a committed record, or a hand-crafted / tampered file),
 * and this module turns each parsed root into a bounded ingested shape, in the same paranoid spirit as the rest of the
 * worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of any record. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-reason detail,
 *    every record's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary.** The primary receipt re-derives its OWN Phase 83 decision: it records its bounded
 *    source facets (the plan coverage state its `source` block carries + the plan facets) and its recorded `actionReceipt`
 *    rollup, whose load-bearing output is the receipt verdict + acknowledgement coverage. So the deepest self-consistency
 *    check available is to RECONSTRUCT the Phase 83 plan-ingest the receipt folded (from `source.state` + the plan facets)
 *    and RE-RUN the Phase 83 {@link computeReceipt} reducer, requiring the recorded `actionReceipt` rollup to re-derive —
 *    so a hand-flipped receipt verdict / ack coverage / exit code is caught. Each related record is re-validated against
 *    ITSELF the same way, by reusing that phase's OWN ingest boundary
 *    ({@link ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan} for a plan, {@link ingestCloseoutIndexTrend} for a
 *    trend, {@link ingestCloseoutIndex} for a finalization-index window), each of which re-derives that record's decision.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `unreadable`; a recognized-but-inconsistent record is
 *    `tampered`; a coherent record yields reduced bounded facts (`usable`). The offending content is never echoed.
 *
 * A NOTE ON DEPTH: each record reduced its deeper inputs away into a bounded summary + a decision, so the DEEPEST faithful
 * check over a record is re-deriving its OWN decision from its recorded facets — the record is the atom of evidence here.
 * It is NOT possible to re-derive the inner chain (the receipt kept only the plan's bounded facets, not the trend's window
 * sequence), so a set of fully self-consistent FABRICATED records is out of scope for structural tamper-evidence; that
 * would need a signature this offline summary does not have. The CROSS-CHECK between records (does the supplied plan match
 * the plan the receipt receipted?) is the fold's job (`./reduce`), computed over these bounded ingested facts.
 */

import { ingestCloseoutIndexTrend } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/ingest";
import { ingestCloseoutIndex } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/ingest";
import {
  ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan,
  type IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt/ingest";
import { computeReceipt } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt/reduce";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  planClassForVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptAckId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt/types";
import type {
  CloseoutReceiptFacts,
  CloseoutRelatedFacts,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordState,
} from "./types";

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

/* ------------------------------------------------------------------ *
 *  Primary receipt: re-validate against itself
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting the primary action-plan execution receipt document. */
export interface IngestedCloseoutReceipt {
  /** True iff the input parsed to an object carrying the action-receipt schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded receipt decision RE-DERIVES from its own recorded source facets. */
  readonly usable: boolean;
  /** The receipt's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly claimedVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: CloseoutReceiptFacts | null;
}

/** The bounded outcome for an input that was not a recognized action-plan execution receipt. */
export const UNRECOGNIZED_RECEIPT: IngestedCloseoutReceipt = {
  recognized: false,
  usable: false,
  claimedVerdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) receipt, carrying only its untrusted claimed verdict. */
function inconsistentReceipt(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptVerdict | null,
): IngestedCloseoutReceipt {
  return { recognized: true, usable: false, claimedVerdict: verdict, facts: null };
}

/** The recorded `actionReceipt` rollup fields the recompute must reproduce for the receipt to be `usable`. */
interface RecordedReceiptRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptVerdict;
  readonly exitCode: number;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  readonly completed: boolean;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptReasonId[];
  readonly invalid: number;
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly requiredAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptAckId[];
  readonly suppliedAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptAckId[];
  readonly missingAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptAckId[];
  readonly mismatchedAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptAckId[];
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "followup-open" | null;
}

const RECEIPT_STRICT_FROM = ["followup-open"] as const;

/** Validate the receipt's `actionReceipt` rollup block into the bounded {@link RecordedReceiptRollup}, or `undefined`. */
function readRecordedReceiptRollup(rollup: Obj): RecordedReceiptRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const planClass = nullableOneOf(rollup.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
  const completed = boolOf(rollup.completed);
  const invalid = intOf(rollup.invalid);
  const blocking = intOf(rollup.blocking);
  const open = intOf(rollup.open);
  const incomplete = intOf(rollup.incomplete);
  const informational = intOf(rollup.informational);
  const strictOpen = boolOf(rollup.strictOpen);
  const strictOpenEscalated = boolOf(rollup.strictOpenEscalated);
  const from = nullableOneOf(rollup.strictOpenEscalatedFrom, RECEIPT_STRICT_FROM);
  const reasons = enumArray(rollup.reasons, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_IDS);
  const requiredAcks = enumArray(rollup.requiredAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS);
  const suppliedAcks = enumArray(rollup.suppliedAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS);
  const missingAcks = enumArray(rollup.missingAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS);
  const mismatchedAcks = enumArray(rollup.mismatchedAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    planClass === undefined ||
    completed === undefined ||
    invalid === undefined ||
    blocking === undefined ||
    open === undefined ||
    incomplete === undefined ||
    informational === undefined ||
    strictOpen === undefined ||
    strictOpenEscalated === undefined ||
    from === undefined ||
    reasons === undefined ||
    requiredAcks === undefined ||
    suppliedAcks === undefined ||
    missingAcks === undefined ||
    mismatchedAcks === undefined
  ) {
    return undefined;
  }
  return {
    verdict,
    exitCode,
    planClass,
    completed,
    reasons,
    invalid,
    blocking,
    open,
    incomplete,
    informational,
    requiredAcks,
    suppliedAcks,
    missingAcks,
    mismatchedAcks,
    strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom: from,
  };
}

/** The bounded `source` facets the receipt recorded (the plan it receipted, reduced). */
interface RecordedReceiptSource {
  readonly state: "unreadable" | "tampered" | "usable";
  readonly claimedPlanVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null;
  readonly planUrgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanUrgency | null;
  readonly planActionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanActionClass | null;
  readonly sourceTrendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendVerdict | null;
  readonly sourceLatestIndex: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict | null;
  readonly blockingActions: number;
  readonly advisoryActions: number;
  readonly planStrictWatch: boolean;
  readonly planRequireClean: boolean;
}

const RECEIPT_SOURCE_STATES = ["unreadable", "tampered", "usable"] as const;

/** Validate the receipt's `source` block into a bounded {@link RecordedReceiptSource}, or `undefined`. */
function readRecordedReceiptSource(root: Obj): RecordedReceiptSource | undefined {
  const s = isObject(root.source) ? root.source : undefined;
  if (s === undefined) return undefined;
  const state = oneOf(s.state, RECEIPT_SOURCE_STATES);
  const claimedPlanVerdict = nullableOneOf(s.claimedPlanVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_VERDICTS);
  const planClass = nullableOneOf(s.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
  const planUrgency = nullableOneOf(s.planUrgency, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_URGENCIES);
  const planActionClass = nullableOneOf(s.planActionClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES);
  const sourceTrendVerdict = nullableOneOf(s.sourceTrendVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS);
  const sourceLatestIndex = nullableOneOf(s.sourceLatestIndex, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);
  const blockingActions = intOf(s.blockingActions);
  const advisoryActions = intOf(s.advisoryActions);
  const planStrictWatch = boolOf(s.planStrictWatch);
  const planRequireClean = boolOf(s.planRequireClean);
  if (
    state === undefined ||
    claimedPlanVerdict === undefined ||
    planClass === undefined ||
    planUrgency === undefined ||
    planActionClass === undefined ||
    sourceTrendVerdict === undefined ||
    sourceLatestIndex === undefined ||
    blockingActions === undefined ||
    advisoryActions === undefined ||
    planStrictWatch === undefined ||
    planRequireClean === undefined
  ) {
    return undefined;
  }
  return {
    state,
    claimedPlanVerdict,
    planClass,
    planUrgency,
    planActionClass,
    sourceTrendVerdict,
    sourceLatestIndex,
    blockingActions,
    advisoryActions,
    planStrictWatch,
    planRequireClean,
  };
}

/** Validate the receipt's `policy` block into a Phase 83 receipt policy, or `undefined`. */
function readRecordedReceiptPolicy(
  root: Obj,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const strictOpen = boolOf(p.strictOpen);
  const ackObj = isObject(p.ack) ? p.ack : undefined;
  if (strictOpen === undefined || ackObj === undefined) return undefined;
  const plan = boolOf(ackObj.plan);
  const clear = boolOf(ackObj.clear);
  const monitor = boolOf(ackObj.monitor);
  const investigation = boolOf(ackObj.investigation);
  const block = boolOf(ackObj.block);
  if (
    plan === undefined ||
    clear === undefined ||
    monitor === undefined ||
    investigation === undefined ||
    block === undefined
  ) {
    return undefined;
  }
  return { strictOpen, ack: { plan, clear, monitor, investigation, block } };
}

/**
 * Require the receipt's `source` block to be internally consistent with its own coverage state: a `usable` source carries
 * a non-null plan verdict / class / urgency / action class with `planClass === planClassForVerdict(claimedPlanVerdict)`,
 * and a non-usable source carries the null / zero / false surface Phase 83's builder always emits when the receipted plan
 * was not usable. Catches a crudely tampered source block; a fully self-consistent fabrication is out of scope.
 */
function sourceConsistent(s: RecordedReceiptSource): boolean {
  if (s.state === "usable") {
    return (
      s.claimedPlanVerdict !== null &&
      s.planClass !== null &&
      s.planUrgency !== null &&
      s.planActionClass !== null &&
      s.planClass === planClassForVerdict(s.claimedPlanVerdict)
    );
  }
  // A non-usable receipted plan reduced to no facts: every plan facet is the null / zero / false default.
  const factsAbsent =
    s.planClass === null &&
    s.planUrgency === null &&
    s.planActionClass === null &&
    s.sourceTrendVerdict === null &&
    s.sourceLatestIndex === null &&
    s.blockingActions === 0 &&
    s.advisoryActions === 0 &&
    s.planStrictWatch === false &&
    s.planRequireClean === false;
  // An `unreadable` plan carries no claimed verdict either; a `tampered` plan may surface its untrusted claim.
  return factsAbsent && (s.state === "tampered" || s.claimedPlanVerdict === null);
}

/** Whether the re-derived receipt rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameReceiptRollup(
  a: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptRollup,
  b: RecordedReceiptRollup,
): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.planClass === b.planClass &&
    a.completed === b.completed &&
    a.invalid === b.invalid &&
    a.blocking === b.blocking &&
    a.open === b.open &&
    a.incomplete === b.incomplete &&
    a.informational === b.informational &&
    a.strictOpen === b.strictOpen &&
    a.strictOpenEscalated === b.strictOpenEscalated &&
    a.strictOpenEscalatedFrom === b.strictOpenEscalatedFrom &&
    sameStringSet(a.reasons, b.reasons) &&
    sameStringSet(a.requiredAcks, b.requiredAcks) &&
    sameStringSet(a.suppliedAcks, b.suppliedAcks) &&
    sameStringSet(a.missingAcks, b.missingAcks) &&
    sameStringSet(a.mismatchedAcks, b.mismatchedAcks)
  );
}

/**
 * Reconstruct the Phase 83 plan-ingest the receipt folded, from its recorded source coverage state + plan facets. Faithful
 * for {@link computeReceipt}, which reads only the `recognized` / `usable` flags and (when usable) `facts.planClass`; the
 * plan class is anchored to the recorded plan VERDICT via {@link planClassForVerdict}, and the other facts are filled from
 * the recorded source (never read by the reducer) so no cast is needed.
 */
function reconstructPlan(source: RecordedReceiptSource): IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan {
  if (source.state === "unreadable") {
    return { recognized: false, usable: false, claimedVerdict: null, facts: null };
  }
  if (source.state === "tampered") {
    return { recognized: true, usable: false, claimedVerdict: source.claimedPlanVerdict, facts: null };
  }
  // A usable source is guaranteed (by `sourceConsistent`) to carry non-null plan facets.
  const verdict = source.claimedPlanVerdict!;
  return {
    recognized: true,
    usable: true,
    claimedVerdict: verdict,
    facts: {
      planVerdict: verdict,
      planClass: planClassForVerdict(verdict),
      urgency: source.planUrgency!,
      actionClass: source.planActionClass!,
      sourceTrendVerdict: source.sourceTrendVerdict,
      sourceLatestIndex: source.sourceLatestIndex,
      blockingActions: source.blockingActions,
      advisoryActions: source.advisoryActions,
      planStrictWatch: source.planStrictWatch,
      planRequireClean: source.planRequireClean,
    },
  };
}

/**
 * Reduce one parsed action-plan execution receipt `root` to the bounded {@link IngestedCloseoutReceipt}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_RECEIPT}. For a recognized receipt it validates the recorded
 * rollup + top-level facets + source + policy, then requires: (1) the source block is internally consistent, (2) the
 * top-level verdict / exit code / plan class equal the recorded rollup (Phase 83 mirrors them), and (3) the recorded
 * rollup RE-DERIVES from the reconstructed plan-ingest + recorded policy via {@link computeReceipt}. Any mismatch ⇒ a
 * tamper. Never throws / echoes input.
 */
export function ingestReceipt(root: unknown): IngestedCloseoutReceipt {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_SCHEMA) {
    return UNRECOGNIZED_RECEIPT;
  }

  const rollupObj = isObject(root.actionReceipt) ? root.actionReceipt : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS) ?? null)
    : null;

  if (rollupObj === undefined) return inconsistentReceipt(claimed);
  const recorded = readRecordedReceiptRollup(rollupObj);
  if (recorded === undefined) return inconsistentReceipt(claimed);

  // The top-level headline facets must equal the recorded rollup (Phase 83 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS);
  const topExitCode = intOf(root.exitCode);
  const topPlanClass = nullableOneOf(root.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
  if (
    topVerdict === undefined ||
    topExitCode === undefined ||
    topPlanClass === undefined ||
    topVerdict !== recorded.verdict ||
    topExitCode !== recorded.exitCode ||
    topPlanClass !== recorded.planClass
  ) {
    return inconsistentReceipt(recorded.verdict);
  }

  const source = readRecordedReceiptSource(root);
  if (source === undefined || !sourceConsistent(source)) return inconsistentReceipt(recorded.verdict);

  const policy = readRecordedReceiptPolicy(root);
  // The receipt's `policy.strictOpen` must agree with the rollup's recorded `strictOpen` (a smuggled inconsistent policy
  // is a tamper). A real Phase 83 receipt always carries both, consistent.
  if (policy === undefined || policy.strictOpen !== recorded.strictOpen) {
    return inconsistentReceipt(recorded.verdict);
  }

  // Reconstruct the plan-ingest the receipt folded, then RE-RUN the Phase 83 reducer and require the recorded rollup to
  // re-derive on every load-bearing field — so a hand-flipped receipt verdict / ack coverage / exit code is caught.
  const plan = reconstructPlan(source);
  const { rollup: rederived } = computeReceipt(plan, policy);
  if (!sameReceiptRollup(rederived, recorded)) return inconsistentReceipt(recorded.verdict);

  const facts: CloseoutReceiptFacts = {
    receiptVerdict: recorded.verdict,
    planClass: source.planClass,
    claimedPlanVerdict: source.claimedPlanVerdict,
    sourceTrendVerdict: source.sourceTrendVerdict,
    sourceLatestIndex: source.sourceLatestIndex,
    planUrgency: source.planUrgency,
    planActionClass: source.planActionClass,
    blockingActions: source.blockingActions,
    advisoryActions: source.advisoryActions,
    planStrictWatch: source.planStrictWatch,
    planRequireClean: source.planRequireClean,
    acksRequired: recorded.requiredAcks.length,
    acksSatisfied: recorded.requiredAcks.length - recorded.missingAcks.length,
    acksMissing: recorded.missingAcks.length,
    receiptStrictOpen: recorded.strictOpen,
  };
  return { recognized: true, usable: true, claimedVerdict: recorded.verdict, facts };
}

/* ------------------------------------------------------------------ *
 *  Related records: reuse each phase's own ingest boundary
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting one OPTIONAL related record. */
export interface IngestedRelatedRecord {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind;
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordState;
  /** The bounded reduced facts (present only when `usable`; `null` otherwise). Its `verdict` is the record's own token. */
  readonly facts: CloseoutRelatedFacts | null;
}

/** Map a phase ingest's `{recognized, usable}` tri-state to a bounded closeout record state. */
function recordStateOf(
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** An absent related record of the given kind (no path supplied). */
export function absentRecord(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind,
): IngestedRelatedRecord {
  return { kind, state: "absent", facts: null };
}

/**
 * Ingest one OPTIONAL related record of `kind` from its parsed `root`, by reusing that phase's OWN ingest boundary. A
 * usable record surfaces its bounded facts (a `plan` record carries the plan facets the cross-check needs; the others
 * carry only their own primary token). A non-object / wrong-schema input is `unreadable`; a recognized-but-inconsistent
 * record is `tampered`. Never throws / echoes input.
 */
export function ingestRelated(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  root: unknown,
): IngestedRelatedRecord {
  switch (kind) {
    case "plan": {
      const p = ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan(root);
      const state = recordStateOf(p.recognized, p.usable);
      const facts: CloseoutRelatedFacts | null =
        state === "usable" && p.facts
          ? {
              verdict: p.facts.planVerdict,
              planClass: p.facts.planClass,
              planUrgency: p.facts.urgency,
              planActionClass: p.facts.actionClass,
              sourceTrendVerdict: p.facts.sourceTrendVerdict,
              sourceLatestIndex: p.facts.sourceLatestIndex,
            }
          : null;
      return { kind, state, facts };
    }
    case "trend": {
      const t = ingestCloseoutIndexTrend(root);
      const state = recordStateOf(t.recognized, t.usable);
      const facts: CloseoutRelatedFacts | null =
        state === "usable" && t.verdict !== null
          ? {
              verdict: t.verdict,
              planClass: null,
              planUrgency: null,
              planActionClass: null,
              sourceTrendVerdict: null,
              sourceLatestIndex: null,
            }
          : null;
      return { kind, state, facts };
    }
    case "index": {
      const i = ingestCloseoutIndex(root);
      const state = recordStateOf(i.recognized, i.usable);
      const facts: CloseoutRelatedFacts | null =
        state === "usable" && i.verdict !== null
          ? {
              verdict: i.verdict,
              planClass: null,
              planUrgency: null,
              planActionClass: null,
              sourceTrendVerdict: null,
              sourceLatestIndex: null,
            }
          : null;
      return { kind, state, facts };
    }
  }
}
