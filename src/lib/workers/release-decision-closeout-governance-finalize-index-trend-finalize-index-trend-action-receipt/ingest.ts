/**
 * Pure, node-free **plan ingest** for the release decision closeout governance finalize index trend finalize index trend action-plan execution
 * receipt (Phase 78) — the trust boundary and the no-leak core.
 *
 * The receipt records whether ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` plan
 * had its required acknowledgements supplied. Even though the plan is already content-free, it is UNTRUSTED input here (a
 * CI artifact an operator points us at, a committed plan, or a hand-crafted / tampered file), and this module turns the
 * parsed root into a bounded ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of the plan. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-reason /
 *    per-action detail, the plan's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary.** A plan records its bounded source-trend facets (the finalize-index trend coverage
 *    state its `source` block carries + the trusted `sourceTrendVerdict` / `sourceTrendClass` / `sourceArcDirection` /
 *    `sourceLatestIndex`) and its recorded `actionPlan` rollup, whose load-bearing output is its plan verdict. So the
 *    deepest self-consistency check available is to RECONSTRUCT the Phase 77 trend-ingest the plan folded (from
 *    `source.state` + the trusted source-trend facets) and RE-RUN the Phase 77 {@link computeActionPlan} reducer,
 *    requiring the recorded `actionPlan` rollup (verdict, urgency, action class, exit code, clear, reason SET, the five
 *    severity counts, both escalation flags + position) to re-derive — so a hand-flipped plan verdict / action class /
 *    exit code is caught. It ALSO requires the plan's TOP-LEVEL verdict / urgency / action class / exit code to equal its
 *    recorded rollup (Phase 77 mirrors them), so flipping either the headline or the nested rollup is a tamper.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` plan); a
 *    recognized-but-inconsistent plan is `recognized = true, usable = false` (⇒ a `tampered` plan); a coherent plan
 *    yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a plan reduced its source trend's window sequence away into a bounded source summary + a plan
 * decision, so the DEEPEST faithful check over a plan is re-deriving its OWN decision from its recorded source facts —
 * the plan is the atom of evidence here, as the trend was at Phase 77. It is NOT possible to re-derive the inner trend
 * (the plan kept only the trend's bounded verdict / class / arc / latest, not its window sequence), so a fully
 * self-consistent FABRICATED plan is out of scope for structural tamper-evidence, exactly as at Phases 52–77; that would
 * need a signature this offline receipt does not have.
 *
 * SAFETY of the reuse: {@link computeActionPlan} reads ONLY the ingested trend's `recognized` / `usable` flags and (when
 * usable) `facts.verdict`; {@link buildActions} reads ONLY the fired reason ids. So neither recompute can be steered by a
 * field the plan's recorded source cannot re-derive — the load-bearing fields are read faithfully from the plan's own
 * recorded source + rollup. (Verified against
 * `release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/{actions,build}.ts` — re-verify those field
 * reads before trusting this reconstruction.)
 */

import {
  buildActions,
  computeActionPlan,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/actions";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SOURCE_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
  type FinalizeIndexTrendActionPlanFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanActionClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanUrgency,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/types";
import type { IngestedFinalizeIndexTrend } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/ingest";
import { planClassForVerdict, type FinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanFacts } from "./types";

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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` document. */
export interface IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan {
  /** True iff the input parsed to an object carrying the finalize-index-trend-finalize-index-trend action-plan schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded plan decision RE-DERIVES from its own recorded source facts. */
  readonly usable: boolean;
  /** The plan's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly claimedVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: FinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanFacts | null;
}

/** The bounded outcome for an input that was not a recognized `...-finalize-index-trend-finalize-index-trend-action-plan/1`. */
export const UNRECOGNIZED_PLAN: IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan = {
  recognized: false,
  usable: false,
  claimedVerdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) plan, carrying only its untrusted claimed verdict. */
function inconsistentPlan(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict | null,
): IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan {
  return { recognized: true, usable: false, claimedVerdict: verdict, facts: null };
}

/** The recorded plan-rollup fields the recompute must reproduce for the plan to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanVerdict;
  readonly urgency: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanUrgency;
  readonly actionClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanActionClass;
  readonly exitCode: number;
  readonly clear: boolean;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanReasonId[];
  readonly invalidInputs: number;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly informationals: number;
  readonly strictWatch: boolean;
  readonly requireClean: boolean;
  readonly strictWatchEscalated: boolean;
  readonly requireCleanEscalated: boolean;
  readonly escalatedFrom: "monitor" | "investigate" | null;
}

const ESCALATED_FROM_VALUES = ["monitor", "investigate"] as const;

/** Validate the plan's `actionPlan` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS);
  const urgency = oneOf(rollup.urgency, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES);
  const actionClass = oneOf(rollup.actionClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES);
  const exitCode = intOf(rollup.exitCode);
  const clear = boolOf(rollup.clear);
  const invalidInputs = intOf(rollup.invalidInputs);
  const blocking = intOf(rollup.blocking);
  const insufficiencies = intOf(rollup.insufficiencies);
  const advisories = intOf(rollup.advisories);
  const informationals = intOf(rollup.informationals);
  const strictWatch = boolOf(rollup.strictWatch);
  const requireClean = boolOf(rollup.requireClean);
  const strictWatchEscalated = boolOf(rollup.strictWatchEscalated);
  const requireCleanEscalated = boolOf(rollup.requireCleanEscalated);
  const escalatedFrom = nullableOneOf(rollup.escalatedFrom, ESCALATED_FROM_VALUES);
  if (
    verdict === undefined ||
    urgency === undefined ||
    actionClass === undefined ||
    exitCode === undefined ||
    clear === undefined ||
    invalidInputs === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    informationals === undefined ||
    strictWatch === undefined ||
    requireClean === undefined ||
    strictWatchEscalated === undefined ||
    requireCleanEscalated === undefined ||
    escalatedFrom === undefined ||
    !Array.isArray(rollup.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    urgency,
    actionClass,
    exitCode,
    clear,
    reasons,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    informationals,
    strictWatch,
    requireClean,
    strictWatchEscalated,
    requireCleanEscalated,
    escalatedFrom,
  };
}

/** The bounded source facets the plan recorded, needed to reconstruct the Phase 77 trend-ingest + surface context. */
interface RecordedSource {
  /** The TREND's coverage state the plan recorded (the plan's own `source.state`, NOT my plan-doc state). */
  readonly trendState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanSourceState;
  /** The trend's CLAIMED verdict (null when the trend was unreadable). */
  readonly claimedVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict | null;
  readonly windowsConsidered: number;
  readonly windowsUsable: number;
  readonly totalFinalizations: number;
  readonly sourceStrictOpen: boolean;
}

/** Validate the plan's `source` block into a bounded {@link RecordedSource}, or `undefined`. */
function readRecordedSource(root: Obj): RecordedSource | undefined {
  const s = isObject(root.source) ? root.source : undefined;
  if (s === undefined) return undefined;
  const trendState = oneOf(s.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SOURCE_STATES);
  const claimedVerdict = nullableOneOf(s.claimedVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS);
  const windowsConsidered = intOf(s.windowsConsidered);
  const windowsUsable = intOf(s.windowsUsable);
  const totalFinalizations = intOf(s.totalFinalizations);
  const sourceStrictOpen = boolOf(s.sourceStrictOpen);
  if (
    trendState === undefined ||
    claimedVerdict === undefined ||
    windowsConsidered === undefined ||
    windowsUsable === undefined ||
    totalFinalizations === undefined ||
    sourceStrictOpen === undefined
  ) {
    return undefined;
  }
  // The trend's claimed verdict is present exactly when the trend was NOT unreadable (Phase 77 records
  // `source.claimedVerdict = ingested.verdict`, which is null only for an unreadable trend).
  if ((claimedVerdict === null) !== (trendState === "unreadable")) return undefined;
  return { trendState, claimedVerdict, windowsConsidered, windowsUsable, totalFinalizations, sourceStrictOpen };
}

/**
 * Compare two `ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanReasonId` lists as sets (order-independent,
 * exact membership). Size-aware in BOTH directions so a crafted duplicate-plus-omission recorded list (same length,
 * different SET) cannot pass.
 */
function sameReasons(
  a: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanReasonId[],
  b: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.urgency === b.urgency &&
    a.actionClass === b.actionClass &&
    a.exitCode === b.exitCode &&
    a.clear === b.clear &&
    a.invalidInputs === b.invalidInputs &&
    a.blocking === b.blocking &&
    a.insufficiencies === b.insufficiencies &&
    a.advisories === b.advisories &&
    a.informationals === b.informationals &&
    a.strictWatch === b.strictWatch &&
    a.requireClean === b.requireClean &&
    a.strictWatchEscalated === b.strictWatchEscalated &&
    a.requireCleanEscalated === b.requireCleanEscalated &&
    a.escalatedFrom === b.escalatedFrom &&
    sameReasons(a.reasons, b.reasons)
  );
}

/**
 * Reconstruct the Phase 77 trend-ingest the plan folded, from the plan's recorded trend coverage state + trusted trend
 * verdict / class / direction / latest. The reconstruction is faithful for {@link computeActionPlan}, which reads only
 * the `recognized` / `usable` flags and (when usable) `facts.verdict`; the other `facts` fields are filled from the
 * plan's recorded source (never read by the reducer) so no cast is needed.
 */
function reconstructTrend(
  source: RecordedSource,
  trendVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict | null,
  trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendClass | null,
  direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendDirection | null,
  latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict | null,
): IngestedFinalizeIndexTrend | undefined {
  if (source.trendState === "unreadable") {
    return { recognized: false, usable: false, verdict: null, facts: null };
  }
  if (source.trendState === "tampered") {
    return { recognized: true, usable: false, verdict: source.claimedVerdict, facts: null };
  }
  // A usable trend MUST carry a trusted trend verdict / class / direction (Phase 77 sets them from the trend facts);
  // their absence is an internal inconsistency (a tamper).
  if (trendVerdict === null || trendClass === null || direction === null) return undefined;
  const facts: FinalizeIndexTrendActionPlanFacts = {
    verdict: trendVerdict,
    // exitCode / clean are context the reducer does not read; fill deterministically from the trusted verdict.
    exitCode: 0,
    clean: trendVerdict === "stable" || trendVerdict === "improving",
    latest,
    direction,
    trendClass,
    windowsConsidered: source.windowsConsidered,
    windowsUsable: source.windowsUsable,
    totalFinalizations: source.totalFinalizations,
    strictOpen: source.sourceStrictOpen,
  };
  return { recognized: true, usable: true, verdict: trendVerdict, facts };
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/1` `root` to the
 * bounded {@link IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_PLAN}. For a recognized plan it validates the recorded rollup
 * + top-level facets + source + policy, then requires: (1) the top-level verdict / urgency / action class / exit code
 * equal the recorded rollup (Phase 77 mirrors them), and (2) the recorded rollup RE-DERIVES from the plan's own recorded
 * source (its trend coverage state + trusted trend verdict) + strict-watch / require-clean via {@link computeActionPlan}.
 * Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(root: unknown): IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA) {
    return UNRECOGNIZED_PLAN;
  }

  const rollupObj = isObject(root.actionPlan) ? root.actionPlan : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS) ?? null)
    : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // plan verdict surfaced (untrusted) so the receipt can show what the plan asserted.
  if (rollupObj === undefined) return inconsistentPlan(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentPlan(claimed);

  // The top-level headline facets must equal the recorded rollup (Phase 77 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS);
  const topUrgency = oneOf(root.urgency, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES);
  const topActionClass = oneOf(root.actionClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_CLASSES);
  const topExitCode = intOf(root.exitCode);
  if (
    topVerdict === undefined ||
    topUrgency === undefined ||
    topActionClass === undefined ||
    topExitCode === undefined ||
    topVerdict !== recorded.verdict ||
    topUrgency !== recorded.urgency ||
    topActionClass !== recorded.actionClass ||
    topExitCode !== recorded.exitCode
  ) {
    return inconsistentPlan(recorded.verdict);
  }

  const source = readRecordedSource(root);
  if (source === undefined) return inconsistentPlan(recorded.verdict);

  // The trusted source-trend facets: non-null IFF the plan's trend was usable (Phase 77 sets them so). A mismatch —
  // e.g. a `usable` trend state with no trend verdict, or a trend verdict smuggled onto a non-usable trend — is a tamper.
  const sourceTrendVerdict = nullableOneOf(root.sourceTrendVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS);
  const sourceTrendClass = nullableOneOf(root.sourceTrendClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLASSES);
  const sourceArcDirection = nullableOneOf(root.sourceArcDirection, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_DIRECTIONS);
  const sourceLatestIndex = nullableOneOf(root.sourceLatestIndex, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS);
  if (
    sourceTrendVerdict === undefined ||
    sourceTrendClass === undefined ||
    sourceArcDirection === undefined ||
    sourceLatestIndex === undefined
  ) {
    return inconsistentPlan(recorded.verdict);
  }
  const trendUsable = source.trendState === "usable";
  if (
    trendUsable !== (sourceTrendVerdict !== null) ||
    trendUsable !== (sourceTrendClass !== null) ||
    trendUsable !== (sourceArcDirection !== null)
  ) {
    return inconsistentPlan(recorded.verdict);
  }
  // The newest usable index posture is surfaced context (never read by the reducer). It must be null when the trend is
  // not usable; when usable it may be null (an insufficient trend has no usable window). When usable, the trusted trend
  // verdict must agree with the trend's own claimed verdict (Phase 77 records both from the same trend facts).
  if (!trendUsable && sourceLatestIndex !== null) return inconsistentPlan(recorded.verdict);
  if (trendUsable && sourceTrendVerdict !== source.claimedVerdict) return inconsistentPlan(recorded.verdict);

  // The plan's `policy.strictWatch` / `policy.requireClean` must agree with the rollup's recorded flags (a smuggled
  // inconsistent policy is a tamper). A real Phase 77 plan always carries both, consistent.
  const policyObj = isObject(root.policy) ? root.policy : undefined;
  const policyStrictWatch = policyObj ? boolOf(policyObj.strictWatch) : undefined;
  const policyRequireClean = policyObj ? boolOf(policyObj.requireClean) : undefined;
  if (
    policyStrictWatch === undefined ||
    policyRequireClean === undefined ||
    policyStrictWatch !== recorded.strictWatch ||
    policyRequireClean !== recorded.requireClean
  ) {
    return inconsistentPlan(recorded.verdict);
  }

  // Reconstruct the trend-ingest the plan folded, then RE-RUN the Phase 77 reducer and require the recorded rollup to
  // re-derive on every load-bearing field — so a hand-flipped plan verdict / action class / exit code is caught.
  const trend = reconstructTrend(source, sourceTrendVerdict, sourceTrendClass, sourceArcDirection, sourceLatestIndex);
  if (trend === undefined) return inconsistentPlan(recorded.verdict);

  const { rollup: rederived } = computeActionPlan(trend, {
    strictWatch: recorded.strictWatch,
    requireClean: recorded.requireClean,
  });
  if (!sameRollup(rederived, recorded)) return inconsistentPlan(recorded.verdict);

  // Trusted: derive the bounded action counts from the RE-DERIVED checklist (never the recorded `plan` array).
  const actions = buildActions(rederived.reasons);
  const blockingActions = actions.filter((a) => a.blocking).length;
  const advisoryActions = actions.filter((a) => a.expectation === "recommended").length;

  const facts: FinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanFacts = {
    planVerdict: recorded.verdict,
    planClass: planClassForVerdict(recorded.verdict),
    urgency: recorded.urgency,
    actionClass: recorded.actionClass,
    sourceTrendVerdict,
    sourceLatestIndex,
    blockingActions,
    advisoryActions,
    planStrictWatch: recorded.strictWatch,
    planRequireClean: recorded.requireClean,
  };
  return { recognized: true, usable: true, claimedVerdict: recorded.verdict, facts };
}
