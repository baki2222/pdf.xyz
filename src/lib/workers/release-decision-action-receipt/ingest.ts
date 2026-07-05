/**
 * Pure, node-free **plan ingest** for the release decision action-plan execution receipt (Phase 63) — the trust
 * boundary and the no-leak core.
 *
 * The receipt records whether ONE `pdfxyz.release-decision-action-plan/1` plan had its required follow-ups
 * acknowledged. Even though the plan is already content-free, it is UNTRUSTED input here (a CI artifact an operator
 * points us at, a committed plan, or a hand-crafted / tampered file), and this module turns the parsed root into a
 * bounded ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of the plan. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-reason /
 *    per-action detail, the plan's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary.** A plan records its bounded source-trend facets (the trend coverage state its `source`
 *    block carries + the trusted `sourceTrendVerdict`) and its recorded `plan` rollup, whose load-bearing output is its
 *    plan verdict. So the deepest self-consistency check available is to RECONSTRUCT the Phase 62 trend-ingest the plan
 *    folded (from `source.state` + `sourceTrendVerdict` + `policy.strict`) and RE-RUN the Phase 62 {@link computeActionPlan}
 *    reducer, requiring the recorded `plan` rollup (verdict, urgency, action class, exit code, clear, benign flag, reason
 *    SET, the four severity counts, strict-escalation position) to re-derive — so a hand-flipped plan verdict / action
 *    class / exit code is caught. It ALSO requires the plan's TOP-LEVEL verdict / urgency / action class / exit code to
 *    equal its recorded rollup (Phase 62 mirrors them), so flipping either the headline or the nested rollup is a tamper.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` plan); a
 *    recognized-but-inconsistent plan is `recognized = true, usable = false` (⇒ a `tampered` plan); a coherent plan
 *    yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a plan reduced its source trend's window sequence away into a bounded source summary + a plan
 * decision, so the DEEPEST faithful check over a plan is re-deriving its OWN decision from its recorded source facts —
 * the plan is the atom of evidence here, as the trend was at Phase 62 and the report at Phase 53. It is NOT possible to
 * re-derive the inner trend (the plan kept only the trend's bounded verdict / class / arc, not its window sequence), so
 * a fully self-consistent FABRICATED plan is out of scope for structural tamper-evidence, exactly as at Phase 52–62;
 * that would need a signature this offline receipt does not have.
 *
 * SAFETY of the reuse: {@link computeActionPlan} reads ONLY the ingested trend's `recognized` / `usable` flags and (when
 * usable) `facts.verdict`, plus `policy.strict`; {@link buildActions} reads ONLY the fired reason ids + the action cap.
 * So neither recompute can be steered by a field the plan's recorded source cannot re-derive — the load-bearing fields
 * are read faithfully from the plan's own recorded source + rollup. (Verified against `release-decision-action-plan/plan.ts`
 * + `release-decision-action-plan/actions.ts` — re-verify those field reads before trusting this reconstruction.)
 */

import { buildActions } from "../release-decision-action-plan/actions";
import { computeActionPlan } from "../release-decision-action-plan/plan";
import {
  RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES,
  RELEASE_DECISION_ACTION_PLAN_REASON_IDS,
  RELEASE_DECISION_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_ACTION_PLAN_SOURCE_STATES,
  RELEASE_DECISION_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_ACTION_PLAN_VERDICTS,
  RELEASE_DECISION_TREND_CLASSES,
  RELEASE_DECISION_TREND_DIRECTIONS,
  RELEASE_DECISION_TREND_VERDICTS,
  type ActionPlanTrendFacts,
  type ReleaseDecisionActionPlanActionClass,
  type ReleaseDecisionActionPlanReasonId,
  type ReleaseDecisionActionPlanRollup,
  type ReleaseDecisionActionPlanSourceState,
  type ReleaseDecisionActionPlanUrgency,
  type ReleaseDecisionActionPlanVerdict,
  type ReleaseDecisionTrendClass,
  type ReleaseDecisionTrendDirection,
  type ReleaseDecisionTrendVerdict,
} from "../release-decision-action-plan/types";
import type { IngestedTrend } from "../release-decision-action-plan/ingest";
import { planClassForVerdict, type ActionReceiptPlanFacts } from "./types";

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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-action-plan/1` document. */
export interface IngestedPlan {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-action-plan/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded plan decision RE-DERIVES from its own recorded source facts. */
  readonly usable: boolean;
  /** The plan's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly claimedVerdict: ReleaseDecisionActionPlanVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: ActionReceiptPlanFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-action-plan/1`. */
export const UNRECOGNIZED_PLAN: IngestedPlan = {
  recognized: false,
  usable: false,
  claimedVerdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) plan, carrying only its untrusted claimed verdict. */
function inconsistentPlan(verdict: ReleaseDecisionActionPlanVerdict | null): IngestedPlan {
  return { recognized: true, usable: false, claimedVerdict: verdict, facts: null };
}

/** The recorded plan-rollup fields the recompute must reproduce for the plan to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionActionPlanVerdict;
  readonly urgency: ReleaseDecisionActionPlanUrgency;
  readonly actionClass: ReleaseDecisionActionPlanActionClass;
  readonly exitCode: number;
  readonly clear: boolean;
  readonly benignMonitor: boolean;
  readonly reasons: readonly ReleaseDecisionActionPlanReasonId[];
  readonly invalidInputs: number;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly strict: boolean;
  readonly strictEscalated: boolean;
  readonly strictEscalatedFrom: "monitor" | "investigate" | null;
}

const STRICT_FROM_VALUES = ["monitor", "investigate"] as const;

/** Validate the plan's `plan` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_ACTION_PLAN_VERDICTS);
  const urgency = oneOf(rollup.urgency, RELEASE_DECISION_ACTION_PLAN_URGENCIES);
  const actionClass = oneOf(rollup.actionClass, RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES);
  const exitCode = intOf(rollup.exitCode);
  const clear = boolOf(rollup.clear);
  const benignMonitor = boolOf(rollup.benignMonitor);
  const invalidInputs = intOf(rollup.invalidInputs);
  const blocking = intOf(rollup.blocking);
  const insufficiencies = intOf(rollup.insufficiencies);
  const advisories = intOf(rollup.advisories);
  const strict = boolOf(rollup.strict);
  const strictEscalated = boolOf(rollup.strictEscalated);
  const from = nullableOneOf(rollup.strictEscalatedFrom, STRICT_FROM_VALUES);
  if (
    verdict === undefined ||
    urgency === undefined ||
    actionClass === undefined ||
    exitCode === undefined ||
    clear === undefined ||
    benignMonitor === undefined ||
    invalidInputs === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    strict === undefined ||
    strictEscalated === undefined ||
    from === undefined ||
    !Array.isArray(rollup.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseDecisionActionPlanReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_ACTION_PLAN_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    urgency,
    actionClass,
    exitCode,
    clear,
    benignMonitor,
    reasons,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict,
    strictEscalated,
    strictEscalatedFrom: from,
  };
}

/** The bounded source facets the plan recorded, needed to reconstruct the Phase 62 trend-ingest + surface context. */
interface RecordedSource {
  /** The TREND's coverage state the plan recorded (the plan's own `source.state`, NOT my plan-doc state). */
  readonly trendState: ReleaseDecisionActionPlanSourceState;
  readonly windowsConsidered: number;
  readonly windowsUsable: number;
  readonly totalRecords: number;
  readonly sourceStrict: boolean;
}

/** Validate the plan's `source` block into a bounded {@link RecordedSource}, or `undefined`. */
function readRecordedSource(root: Obj): RecordedSource | undefined {
  const s = isObject(root.source) ? root.source : undefined;
  if (s === undefined) return undefined;
  const trendState = oneOf(s.state, RELEASE_DECISION_ACTION_PLAN_SOURCE_STATES);
  const windowsConsidered = intOf(s.windowsConsidered);
  const windowsUsable = intOf(s.windowsUsable);
  const totalRecords = intOf(s.totalRecords);
  const sourceStrict = boolOf(s.sourceStrict);
  if (
    trendState === undefined ||
    windowsConsidered === undefined ||
    windowsUsable === undefined ||
    totalRecords === undefined ||
    sourceStrict === undefined
  ) {
    return undefined;
  }
  return { trendState, windowsConsidered, windowsUsable, totalRecords, sourceStrict };
}

/**
 * Compare two `ReleaseDecisionActionPlanReasonId` lists as sets (order-independent, exact membership). Size-aware in
 * BOTH directions so a crafted duplicate-plus-omission recorded list (same length, different SET) cannot pass.
 */
function sameReasons(
  a: readonly ReleaseDecisionActionPlanReasonId[],
  b: readonly ReleaseDecisionActionPlanReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionActionPlanRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.urgency === b.urgency &&
    a.actionClass === b.actionClass &&
    a.exitCode === b.exitCode &&
    a.clear === b.clear &&
    a.benignMonitor === b.benignMonitor &&
    a.invalidInputs === b.invalidInputs &&
    a.blocking === b.blocking &&
    a.insufficiencies === b.insufficiencies &&
    a.advisories === b.advisories &&
    a.strict === b.strict &&
    a.strictEscalated === b.strictEscalated &&
    a.strictEscalatedFrom === b.strictEscalatedFrom &&
    sameReasons(a.reasons, b.reasons)
  );
}

/**
 * Reconstruct the Phase 62 trend-ingest the plan folded, from the plan's recorded trend coverage state + trusted trend
 * verdict / class / direction. The reconstruction is faithful for {@link computeActionPlan}, which reads only the
 * `recognized` / `usable` flags and (when usable) `facts.verdict`; the other `facts` fields are filled from the plan's
 * recorded source (never read by the reducer) so no cast is needed.
 */
function reconstructTrend(
  trendState: ReleaseDecisionActionPlanSourceState,
  trendVerdict: ReleaseDecisionTrendVerdict | null,
  trendClass: ReleaseDecisionTrendClass | null,
  direction: ReleaseDecisionTrendDirection | null,
  source: RecordedSource,
): IngestedTrend | undefined {
  if (trendState === "unreadable") {
    return { recognized: false, usable: false, verdict: null, facts: null };
  }
  if (trendState === "tampered") {
    return { recognized: true, usable: false, verdict: trendVerdict, facts: null };
  }
  // A usable trend MUST carry a trusted trend verdict / class / direction (Phase 62 sets them from the trend facts);
  // their absence is an internal inconsistency (a tamper).
  if (trendVerdict === null || trendClass === null || direction === null) return undefined;
  const facts: ActionPlanTrendFacts = {
    verdict: trendVerdict,
    // exitCode / clear are context the reducer does not read; fill deterministically from the trusted verdict.
    exitCode: 0,
    clear: trendVerdict === "stable" || trendVerdict === "improving",
    direction,
    trendClass,
    windowsConsidered: source.windowsConsidered,
    windowsUsable: source.windowsUsable,
    totalRecords: source.totalRecords,
    strict: source.sourceStrict,
  };
  return { recognized: true, usable: true, verdict: trendVerdict, facts };
}

/**
 * Reduce one parsed `pdfxyz.release-decision-action-plan/1` `root` to the bounded {@link IngestedPlan}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_PLAN}. For a recognized plan it validates the recorded
 * rollup + top-level facets + source + policy, then requires: (1) the top-level verdict / urgency / action class / exit
 * code equal the recorded rollup (Phase 62 mirrors them), and (2) the recorded rollup RE-DERIVES from the plan's own
 * recorded source (its trend coverage state + trusted trend verdict) + strict via {@link computeActionPlan}. Any
 * mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestPlan(root: unknown): IngestedPlan {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_ACTION_PLAN_SCHEMA) return UNRECOGNIZED_PLAN;

  const rollupObj = isObject(root.plan) ? root.plan : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_DECISION_ACTION_PLAN_VERDICTS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // plan verdict surfaced (untrusted) so the receipt can show what the plan asserted.
  if (rollupObj === undefined) return inconsistentPlan(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentPlan(claimed);

  // The top-level headline facets must equal the recorded rollup (Phase 62 mirrors them) — flipping either is a tamper.
  const topVerdict = oneOf(root.verdict, RELEASE_DECISION_ACTION_PLAN_VERDICTS);
  const topUrgency = oneOf(root.urgency, RELEASE_DECISION_ACTION_PLAN_URGENCIES);
  const topActionClass = oneOf(root.actionClass, RELEASE_DECISION_ACTION_PLAN_ACTION_CLASSES);
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

  // The trusted source-trend facets: non-null IFF the plan's trend was usable (Phase 62 sets them so). A mismatch —
  // e.g. a `usable` trend state with no trend verdict, or a trend verdict smuggled onto a non-usable trend — is a tamper.
  const sourceTrendVerdict = nullableOneOf(root.sourceTrendVerdict, RELEASE_DECISION_TREND_VERDICTS);
  const sourceTrendClass = nullableOneOf(root.sourceTrendClass, RELEASE_DECISION_TREND_CLASSES);
  const sourceArcDirection = nullableOneOf(root.sourceArcDirection, RELEASE_DECISION_TREND_DIRECTIONS);
  if (sourceTrendVerdict === undefined || sourceTrendClass === undefined || sourceArcDirection === undefined) {
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

  // The plan's `policy.strict` must agree with the rollup's recorded `strict` (a smuggled inconsistent policy is a
  // tamper); `policy.maxActions` bounds its own checklist. A real Phase 62 plan always carries both, consistent.
  const policyObj = isObject(root.policy) ? root.policy : undefined;
  const policyStrict = policyObj ? boolOf(policyObj.strict) : undefined;
  const policyMaxActions = policyObj ? intOf(policyObj.maxActions) : undefined;
  if (
    policyStrict === undefined ||
    policyMaxActions === undefined ||
    policyMaxActions < 1 ||
    policyStrict !== recorded.strict
  ) {
    return inconsistentPlan(recorded.verdict);
  }

  // Reconstruct the trend-ingest the plan folded, then RE-RUN the Phase 62 reducer and require the recorded rollup to
  // re-derive on every load-bearing field — so a hand-flipped plan verdict / action class / exit code is caught.
  const trend = reconstructTrend(source.trendState, sourceTrendVerdict, sourceTrendClass, sourceArcDirection, source);
  if (trend === undefined) return inconsistentPlan(recorded.verdict);

  const { rollup: rederived } = computeActionPlan(trend, {
    strict: recorded.strict,
    maxActions: policyMaxActions,
  });
  if (!sameRollup(rederived, recorded)) return inconsistentPlan(recorded.verdict);

  // Trusted: derive the bounded action counts from the RE-DERIVED checklist (never the recorded `actions` array).
  const actions = buildActions(rederived.reasons, policyMaxActions);
  const blockingActions = actions.items.filter((a) => a.blocking).length;
  const advisoryActions = actions.items.filter((a) => a.expectation === "recommended").length;

  const facts: ActionReceiptPlanFacts = {
    planVerdict: recorded.verdict,
    planClass: planClassForVerdict(recorded.verdict),
    urgency: recorded.urgency,
    actionClass: recorded.actionClass,
    benignMonitor: recorded.benignMonitor,
    sourceTrendVerdict,
    blockingActions,
    advisoryActions,
    planStrict: recorded.strict,
  };
  return { recognized: true, usable: true, claimedVerdict: recorded.verdict, facts };
}
