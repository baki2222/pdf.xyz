/**
 * Pure, node-free **document ingest** for the release decision closeout governance finalization bundle (Phase 74) — the
 * trust boundary and the no-leak core.
 *
 * The bundle composes a REQUIRED `pdfxyz.release-decision-closeout-governance-action-receipt/1` primary receipt plus up to
 * four OPTIONAL related records — a `pdfxyz.release-decision-closeout-governance-action-plan/1` (Phase 72), a
 * `pdfxyz.release-decision-closeout-governance-index-trend/1` (Phase 71), a `pdfxyz.release-decision-closeout-governance-index/1`
 * (Phase 70), and a `pdfxyz.release-decision-closeout-governance/1` (Phase 69). Even though each is already content-free,
 * every one is UNTRUSTED input here (a CI archive an operator points us at, a committed record, or a hand-crafted /
 * tampered file), and this module turns each parsed root into a bounded ingested shape, in the same paranoid spirit as the
 * rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a record. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-reason detail,
 *    an ingested record's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundaries.** Each related record is re-validated by the EXACT downstream boundary that already
 *    consumes it: the PLAN by the Phase 73 {@link ingestGovernancePlan}, the TREND by the Phase 72 {@link ingestGovernanceTrend},
 *    the INDEX by the Phase 71 {@link ingestGovernanceIndex}, the GOVERNANCE by the Phase 70 {@link ingestGovernance} — each of
 *    which reconstructs the record's own decision and re-runs the prior phase's reducer, so a hand-flipped verdict is
 *    caught as a tamper. The PRIMARY receipt (new here) reconstructs its Phase 73 plan-ingest from the source facets it
 *    recorded and RE-RUNS the Phase 73 {@link computeReceipt}, marking the receipt `usable` only if the recorded
 *    `governanceActionReceipt` rollup + top-level headline re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` source); a
 *    recognized-but-inconsistent record is `recognized = true, usable = false` (⇒ a `tampered` source, blocking); a
 *    coherent record yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: the primary receipt reduced its plan away into a bounded `source` summary + a receipt decision, so the
 * DEEPEST faithful check over a receipt is re-deriving its OWN decision from its recorded source facts — the receipt is
 * the atom of evidence here, as the plan was at Phase 73 and the trend was at Phase 71. It is NOT possible to re-derive
 * the inner plan (the receipt kept only the plan's bounded class / verdict / trend / index, not the trend's window
 * sequence), so a fully self-consistent FABRICATED receipt is out of scope for structural tamper-evidence, exactly as at
 * Phases 52–73; that would need a signature this offline bundle does not have. The cross-checks (in `./reduce`) add
 * inter-record coherence on top: a supplied plan / trend whose verdict disagrees with what the receipt recorded is a
 * contradiction, catching a swapped / edited record even when intra-record tamper-evidence cannot.
 *
 * SAFETY of the reuse: {@link computeReceipt} reads ONLY the reconstructed plan's `recognized` / `usable` flags and (when
 * usable) `facts.planClass`, plus the recorded policy — so filling the other reconstructed `facts` fields from the
 * receipt's own recorded source (never read by the reducer) cannot steer the recompute. (Verified against
 * `release-decision-closeout-governance-action-receipt/reduce.ts`; re-verify those field reads before trusting this
 * reconstruction.)
 */

import { ingestGovernance } from "../release-decision-closeout-governance-index/ingest";
import { ingestGovernanceIndex } from "../release-decision-closeout-governance-index-trend/ingest";
import { ingestGovernanceTrend } from "../release-decision-closeout-governance-action-plan/ingest";
import {
  UNRECOGNIZED_PLAN,
  ingestGovernancePlan,
  type IngestedGovernancePlan,
} from "../release-decision-closeout-governance-action-receipt/ingest";
import { computeReceipt } from "../release-decision-closeout-governance-action-receipt/reduce";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SOURCE_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS,
  planClassForVerdict,
  type GovernanceActionReceiptPlanFacts,
  type ReleaseDecisionCloseoutGovernanceActionReceiptAck,
  type ReleaseDecisionCloseoutGovernanceActionReceiptAckId,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceActionReceiptReasonId,
  type ReleaseDecisionCloseoutGovernanceActionReceiptRollup,
  type ReleaseDecisionCloseoutGovernanceActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
} from "../release-decision-closeout-governance-action-receipt/types";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS,
} from "../release-decision-closeout-governance-action-plan/types";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS } from "../release-decision-closeout-governance-index-trend/types";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS } from "../release-decision-closeout-governance-index/types";
import {
  type GovernanceFinalizeReceiptFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeRecordVerdict,
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

/** Validate an array field into a set of allowed enum ids, or `undefined` if any member is off-enum / not an array. */
function idSet<T extends string>(value: unknown, allowed: readonly T[]): Set<T> | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set<T>();
  for (const v of value) {
    const id = oneOf(v, allowed);
    if (id === undefined) return undefined;
    set.add(id);
  }
  return set;
}

/** Equal-as-set comparison for two id collections. */
function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 *  Primary receipt — reconstruct the Phase 73 plan-ingest, re-run computeReceipt
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting the primary `pdfxyz.release-decision-closeout-governance-action-receipt/1` document. */
export interface IngestedGovernanceFinalizeReceipt {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-closeout-governance-action-receipt/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded receipt decision RE-DERIVES from its own recorded source facts. */
  readonly usable: boolean;
  /** The receipt's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly claimedVerdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: GovernanceFinalizeReceiptFacts | null;
}

/** The bounded outcome for an input that was not a recognized primary receipt. */
export const UNRECOGNIZED_RECEIPT: IngestedGovernanceFinalizeReceipt = {
  recognized: false,
  usable: false,
  claimedVerdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) receipt, carrying only its untrusted claimed verdict. */
function inconsistentReceipt(
  verdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict | null,
): IngestedGovernanceFinalizeReceipt {
  return { recognized: true, usable: false, claimedVerdict: verdict, facts: null };
}

/** The recorded receipt-rollup fields the recompute must reproduce for the receipt to be `usable`. */
interface RecordedReceiptRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict;
  readonly exitCode: number;
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  readonly completed: boolean;
  readonly reasons: Set<ReleaseDecisionCloseoutGovernanceActionReceiptReasonId>;
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly requiredAcks: Set<ReleaseDecisionCloseoutGovernanceActionReceiptAckId>;
  readonly suppliedAcks: Set<ReleaseDecisionCloseoutGovernanceActionReceiptAckId>;
  readonly missingAcks: Set<ReleaseDecisionCloseoutGovernanceActionReceiptAckId>;
  readonly mismatchedAcks: Set<ReleaseDecisionCloseoutGovernanceActionReceiptAckId>;
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "followup-open" | null;
}

const STRICT_FROM_VALUES = ["followup-open"] as const;

/** Validate the receipt's `governanceActionReceipt` rollup block into the bounded {@link RecordedReceiptRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedReceiptRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const planClass = nullableOneOf(rollup.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES);
  const completed = boolOf(rollup.completed);
  const blocking = intOf(rollup.blocking);
  const open = intOf(rollup.open);
  const incomplete = intOf(rollup.incomplete);
  const informational = intOf(rollup.informational);
  const strictOpen = boolOf(rollup.strictOpen);
  const strictOpenEscalated = boolOf(rollup.strictOpenEscalated);
  const from = nullableOneOf(rollup.strictOpenEscalatedFrom, STRICT_FROM_VALUES);
  const reasons = idSet(rollup.reasons, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_REASON_IDS);
  const requiredAcks = idSet(rollup.requiredAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS);
  const suppliedAcks = idSet(rollup.suppliedAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS);
  const missingAcks = idSet(rollup.missingAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS);
  const mismatchedAcks = idSet(rollup.mismatchedAcks, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    planClass === undefined ||
    completed === undefined ||
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

/** The bounded source facets the receipt recorded (its own `source` block), needed to reconstruct the plan-ingest. */
interface RecordedSource {
  readonly state: ReleaseDecisionCloseoutGovernanceActionReceiptSourceState;
  readonly claimedPlanVerdict: GovernanceActionReceiptPlanFacts["planVerdict"] | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceActionReceiptPlanClass | null;
  readonly planUrgency: GovernanceActionReceiptPlanFacts["urgency"] | null;
  readonly planActionClass: GovernanceActionReceiptPlanFacts["actionClass"] | null;
  readonly sourceTrendVerdict: GovernanceActionReceiptPlanFacts["sourceTrendVerdict"];
  readonly sourceLatestIndex: GovernanceActionReceiptPlanFacts["sourceLatestIndex"];
  readonly blockingActions: number;
  readonly advisoryActions: number;
  readonly planStrictWatch: boolean;
}

/** Validate the receipt's `source` block into a bounded {@link RecordedSource}, or `undefined`. */
function readRecordedSource(root: Obj): RecordedSource | undefined {
  const s = isObject(root.source) ? root.source : undefined;
  if (s === undefined) return undefined;
  const state = oneOf(s.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SOURCE_STATES);
  const claimedPlanVerdict = nullableOneOf(s.claimedPlanVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_VERDICTS);
  const planClass = nullableOneOf(s.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES);
  const planUrgency = nullableOneOf(s.planUrgency, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_URGENCIES);
  const planActionClass = nullableOneOf(s.planActionClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_PLAN_ACTION_CLASSES);
  const sourceTrendVerdict = nullableOneOf(s.sourceTrendVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS);
  const sourceLatestIndex = nullableOneOf(s.sourceLatestIndex, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
  const blockingActions = intOf(s.blockingActions);
  const advisoryActions = intOf(s.advisoryActions);
  const planStrictWatch = boolOf(s.planStrictWatch);
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
    planStrictWatch === undefined
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
  };
}

/** Validate the receipt's `policy` block into the bounded Phase 73 {@link ReleaseDecisionCloseoutGovernanceActionReceiptPolicy}, or `undefined`. */
function readRecordedPolicy(root: Obj): ReleaseDecisionCloseoutGovernanceActionReceiptPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const strictOpen = boolOf(p.strictOpen);
  const ackObj = isObject(p.ack) ? p.ack : undefined;
  if (strictOpen === undefined || ackObj === undefined) return undefined;
  const ack = {} as Record<ReleaseDecisionCloseoutGovernanceActionReceiptAckId, boolean>;
  for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS) {
    const b = boolOf(ackObj[id]);
    if (b === undefined) return undefined;
    ack[id] = b;
  }
  return { strictOpen, ack: ack as ReleaseDecisionCloseoutGovernanceActionReceiptAck };
}

/**
 * Reconstruct the Phase 73 plan-ingest the receipt folded, from the receipt's recorded `source` coverage state + facets.
 * The reconstruction is faithful for {@link computeReceipt}, which reads only the reconstructed plan's `recognized` /
 * `usable` flags and (when usable) `facts.planClass`; the other `facts` fields are filled from the recorded source (never
 * read by the reducer) so no cast is needed. A usable source with a missing plan class is an internal inconsistency.
 */
function reconstructPlan(source: RecordedSource): IngestedGovernancePlan | undefined {
  if (source.state === "unreadable") return UNRECOGNIZED_PLAN;
  if (source.state === "tampered") {
    return { recognized: true, usable: false, claimedVerdict: source.claimedPlanVerdict, facts: null };
  }
  // A usable receipt's plan facets must all be present + internally consistent (Phase 73 sets them from the plan facts).
  if (
    source.claimedPlanVerdict === null ||
    source.planClass === null ||
    source.planUrgency === null ||
    source.planActionClass === null
  ) {
    return undefined;
  }
  if (source.planClass !== planClassForVerdict(source.claimedPlanVerdict)) return undefined;
  const facts: GovernanceActionReceiptPlanFacts = {
    planVerdict: source.claimedPlanVerdict,
    planClass: source.planClass,
    urgency: source.planUrgency,
    actionClass: source.planActionClass,
    sourceTrendVerdict: source.sourceTrendVerdict,
    sourceLatestIndex: source.sourceLatestIndex,
    blockingActions: source.blockingActions,
    advisoryActions: source.advisoryActions,
    planStrictWatch: source.planStrictWatch,
  };
  return { recognized: true, usable: true, claimedVerdict: source.claimedPlanVerdict, facts };
}

/** Whether the re-derived Phase 73 rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionCloseoutGovernanceActionReceiptRollup, b: RecordedReceiptRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.planClass === b.planClass &&
    a.completed === b.completed &&
    a.blocking === b.blocking &&
    a.open === b.open &&
    a.incomplete === b.incomplete &&
    a.informational === b.informational &&
    a.strictOpen === b.strictOpen &&
    a.strictOpenEscalated === b.strictOpenEscalated &&
    a.strictOpenEscalatedFrom === b.strictOpenEscalatedFrom &&
    sameSet(new Set(a.reasons), b.reasons) &&
    sameSet(new Set(a.requiredAcks), b.requiredAcks) &&
    sameSet(new Set(a.suppliedAcks), b.suppliedAcks) &&
    sameSet(new Set(a.missingAcks), b.missingAcks) &&
    sameSet(new Set(a.mismatchedAcks), b.mismatchedAcks)
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-governance-action-receipt/1` `root` to the bounded
 * {@link IngestedGovernanceFinalizeReceipt}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_RECEIPT}. For a recognized receipt it validates the recorded
 * rollup + source + policy, requires the top-level verdict / exit code / plan class to equal the recorded rollup (Phase
 * 73 mirrors them), reconstructs the plan-ingest from the recorded source, RE-RUNS the Phase 73 {@link computeReceipt},
 * and marks the receipt `usable` only if the recorded rollup re-derives on every load-bearing field. Any mismatch ⇒ a
 * tamper. Never throws / echoes input.
 */
export function ingestGovernanceFinalizeReceipt(root: unknown): IngestedGovernanceFinalizeReceipt {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_SCHEMA) {
    return UNRECOGNIZED_RECEIPT;
  }

  const rollupObj = isObject(root.governanceActionReceipt) ? root.governanceActionReceipt : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS) ?? null)
    : null;

  if (rollupObj === undefined) return inconsistentReceipt(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentReceipt(claimed);

  // The top-level headline facets must equal the recorded rollup (Phase 73 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS);
  const topExitCode = intOf(root.exitCode);
  const topPlanClass = nullableOneOf(root.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_PLAN_CLASSES);
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

  const source = readRecordedSource(root);
  if (source === undefined) return inconsistentReceipt(recorded.verdict);
  // The recorded rollup's plan class must equal the source's plan class (Phase 73 records both from the same plan).
  if (source.planClass !== recorded.planClass) return inconsistentReceipt(recorded.verdict);

  const policy = readRecordedPolicy(root);
  if (policy === undefined) return inconsistentReceipt(recorded.verdict);
  // The recorded rollup's strict-open flag must agree with the recorded policy (a smuggled inconsistent policy is a tamper).
  if (policy.strictOpen !== recorded.strictOpen) return inconsistentReceipt(recorded.verdict);

  // Reconstruct the plan-ingest the receipt folded, then RE-RUN the Phase 73 reducer and require the recorded rollup to
  // re-derive on every load-bearing field — so a hand-flipped receipt verdict / ack coverage / exit code is caught.
  const plan = reconstructPlan(source);
  if (plan === undefined) return inconsistentReceipt(recorded.verdict);
  const { rollup: rederived } = computeReceipt(plan, policy);
  if (!sameRollup(rederived, recorded)) return inconsistentReceipt(recorded.verdict);

  const facts: GovernanceFinalizeReceiptFacts = {
    receiptVerdict: recorded.verdict,
    planClass: recorded.planClass,
    claimedPlanVerdict: source.state === "usable" ? source.claimedPlanVerdict : null,
    sourceTrendVerdict: source.state === "usable" ? source.sourceTrendVerdict : null,
    sourceLatestIndex: source.state === "usable" ? source.sourceLatestIndex : null,
    receiptSourceState: source.state,
    receiptStrictOpen: policy.strictOpen,
    acksRequired: recorded.requiredAcks.size,
    acksSatisfied: recorded.requiredAcks.size - recorded.missingAcks.size,
    acksMissing: recorded.missingAcks.size,
  };
  return { recognized: true, usable: true, claimedVerdict: recorded.verdict, facts };
}

/* ------------------------------------------------------------------ *
 *  Related records — reuse the Phase 69–73 boundaries verbatim
 * ------------------------------------------------------------------ */

/** One ingested related record, normalized to the bounded shape the reducer folds. */
export interface IngestedGovernanceFinalizeRelatedRecord {
  readonly kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind;
  /** True iff a file was supplied for this record slot. */
  readonly supplied: boolean;
  /** True iff the parsed input carried the record's expected schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND self-consistent (its recorded decision re-derives). */
  readonly usable: boolean;
  /** The record's OWN (claimed) verdict — a bounded enum, or `null` when unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeRecordVerdict | null;
}

/** The bounded outcome for a related record slot that was not supplied. */
export function absentRecord(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
): IngestedGovernanceFinalizeRelatedRecord {
  return { kind, supplied: false, recognized: false, usable: false, verdict: null };
}

/**
 * Reduce one parsed related-record `root` of the given `kind` to the bounded {@link IngestedGovernanceFinalizeRelatedRecord},
 * reusing the tested downstream boundary that re-validates that record against itself. A non-object / wrong-schema input
 * is not recognized (⇒ an `unreadable` record); a recognized-but-self-inconsistent record is `usable = false` (⇒ a
 * `tampered` record). Never throws / echoes.
 */
export function ingestRelated(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  root: unknown,
): IngestedGovernanceFinalizeRelatedRecord {
  switch (kind) {
    case "plan": {
      const r = ingestGovernancePlan(root);
      return { kind, supplied: true, recognized: r.recognized, usable: r.usable, verdict: r.claimedVerdict };
    }
    case "trend": {
      const r = ingestGovernanceTrend(root);
      return { kind, supplied: true, recognized: r.recognized, usable: r.usable, verdict: r.verdict };
    }
    case "index": {
      const r = ingestGovernanceIndex(root);
      return { kind, supplied: true, recognized: r.recognized, usable: r.usable, verdict: r.verdict };
    }
    case "governance": {
      const r = ingestGovernance(root);
      return { kind, supplied: true, recognized: r.recognized, usable: r.usable, verdict: r.verdict };
    }
  }
}

/** One ingested primary receipt, plus whether a file was SUPPLIED for it. */
export interface GovernanceFinalizeReceiptIngest {
  /** True iff a primary receipt input was provided (always true — the CLI requires it). */
  readonly supplied: boolean;
  readonly ingested: IngestedGovernanceFinalizeReceipt;
}

/** The full set of ingested sources the reducer folds: the required primary receipt + the four related records. */
export interface IngestedGovernanceFinalizeSources {
  readonly receipt: GovernanceFinalizeReceiptIngest;
  readonly related: readonly IngestedGovernanceFinalizeRelatedRecord[];
}
