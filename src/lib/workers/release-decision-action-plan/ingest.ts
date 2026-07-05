/**
 * Pure, node-free **trend ingest** for the release decision trend action plan (Phase 62) — the trust boundary and the
 * no-leak core.
 *
 * The plan translates ONE `pdfxyz.release-decision-trend/1` summary into a bounded operator follow-up plan. Even though
 * the trend is already content-free, it is UNTRUSTED input here (a CI artifact an operator points us at, a committed
 * trend, or a hand-crafted / tampered file), and this module turns the parsed root into a bounded ingested shape, in the
 * same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of the trend. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-window / per-
 *    reason detail, the trend's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary — TWICE.** A trend records both a `summary` (its bounded window-verdict distribution +
 *    arc + class) and a per-window `points` sequence, and its load-bearing output is its `trend` verdict. So the
 *    deepest self-consistency check available is two reuses of the Phase 61 reducers:
 *      (B) RE-RUN {@link computeTrendRollup} over the trend's OWN recorded summary + recorded policy, and require the
 *          recorded `trend` rollup (verdict, exit code, clear, reason SET, the four severity counts, direction, strict-
 *          escalation position) to re-derive — so a hand-flipped trend verdict is caught;
 *      (A) RE-DERIVE the summary's point-derivable fields from the trend's OWN `points` sequence (the window states +
 *          verdicts + records, the arc direction via {@link directionOf}, the newest / oldest usable verdict, and the
 *          window arithmetic) and require them to match the recorded summary — so a lied window distribution (even one
 *          consistent with a flipped verdict) is caught against the sequence it claims to summarize.
 *    The trend is `usable` only if BOTH re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` trend); a
 *    recognized-but-inconsistent trend is `recognized = true, usable = false` (⇒ a `tampered` trend); a coherent trend
 *    yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a trend reduced its decision RECORDS and per-window decision facts away into a bounded summary + a
 * per-window POSTURE sequence, so the DEEPEST faithful check over a trend is re-deriving its verdict from its own
 * summary AND re-checking that summary against its own posture sequence — the trend is the atom of evidence here, as the
 * report was at Phase 53 and the decision index at Phase 61. Fields the trend REDUCED AWAY and the sequence cannot
 * re-derive (the aggregate `decisionCounts`, `totalUsableRecords`, and `trendClass` — which need per-window decision
 * facts the posture sequence dropped) are validated as bounded SHAPE only and surfaced as recorded context; they never
 * change the load-bearing plan verdict, which keys on the RE-DERIVED trend verdict. A fully self-consistent FABRICATED
 * trend (real-looking summary + verdict + sequence) is out of scope for structural tamper-evidence, exactly as at Phase
 * 52–61; that would need a signature this offline planner does not have.
 *
 * SAFETY of the reuse: {@link computeTrendRollup} reads ONLY the summary's `windowVerdictCounts` +
 * `windowsUsable` / `windowsUnreadable` / `windowsTampered` + `direction` + `newest`, and `policy.strict`;
 * {@link directionOf} reads ONLY the usable windows' index verdicts. So neither recompute can be steered by a field the
 * posture sequence cannot re-derive — the load-bearing fields are read faithfully from the trend's own summary +
 * sequence. (Verified against `release-decision-trend/rollup.ts` + `release-decision-trend/reduce.ts` — re-verify those
 * field reads before trusting this reconstruction.)
 */

import { directionOf } from "../release-decision-trend/reduce";
import { computeTrendRollup } from "../release-decision-trend/rollup";
import {
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_INDEX_VERDICTS,
  RELEASE_DECISION_TREND_CLASSES,
  RELEASE_DECISION_TREND_DIRECTIONS,
  RELEASE_DECISION_TREND_REASON_IDS,
  RELEASE_DECISION_TREND_SCHEMA,
  RELEASE_DECISION_TREND_SEVERITIES,
  RELEASE_DECISION_TREND_VERDICTS,
  RELEASE_DECISION_TREND_WINDOW_STATES,
  WINDOW_VERDICT_SEVERITY,
  type ReleaseDecisionIndexVerdict,
  type ReleaseDecisionTrendClass,
  type ReleaseDecisionTrendDirection,
  type ReleaseDecisionTrendPolicy,
  type ReleaseDecisionTrendReasonId,
  type ReleaseDecisionTrendRollup,
  type ReleaseDecisionTrendSeverity,
  type ReleaseDecisionTrendSummary,
  type ReleaseDecisionTrendVerdict,
  type ReleaseDecisionTrendWindowState,
} from "../release-decision-trend/types";
import type { ActionPlanTrendFacts } from "./types";

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

/** Read a full `Record<K, number>` from `obj` over exactly `keys` (every key a non-negative int), or `undefined`. */
function readCounts<K extends string>(obj: unknown, keys: readonly K[]): Record<K, number> | undefined {
  if (!isObject(obj)) return undefined;
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const n = intOf(obj[key]);
    if (n === undefined) return undefined;
    out[key] = n;
  }
  return out;
}

/** The bounded outcome of ingesting a `pdfxyz.release-decision-trend/1` document. */
export interface IngestedTrend {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-trend/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded trend verdict + summary RE-DERIVE from its own summary + sequence. */
  readonly usable: boolean;
  /** The trend's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionTrendVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: ActionPlanTrendFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-trend/1`. */
export const UNRECOGNIZED_TREND: IngestedTrend = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) trend, carrying only its untrusted claimed verdict. */
function inconsistentTrend(verdict: ReleaseDecisionTrendVerdict | null): IngestedTrend {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** The recorded trend-rollup fields the recompute must reproduce for the trend to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionTrendVerdict;
  readonly exitCode: number;
  readonly clear: boolean;
  readonly reasons: readonly ReleaseDecisionTrendReasonId[];
  readonly invalidInputs: number;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly direction: ReleaseDecisionTrendDirection;
  readonly strict: boolean;
  readonly strictEscalated: boolean;
  readonly strictEscalatedFrom: "watch" | "degrading" | "improving" | "insufficient" | null;
}

const STRICT_FROM_VALUES = ["watch", "degrading", "improving", "insufficient"] as const;

/** Validate the trend's `trend` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_TREND_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const clear = boolOf(rollup.clear);
  const invalidInputs = intOf(rollup.invalidInputs);
  const blocking = intOf(rollup.blocking);
  const insufficiencies = intOf(rollup.insufficiencies);
  const advisories = intOf(rollup.advisories);
  const direction = oneOf(rollup.direction, RELEASE_DECISION_TREND_DIRECTIONS);
  const strict = boolOf(rollup.strict);
  const strictEscalated = boolOf(rollup.strictEscalated);
  const from = nullableOneOf(rollup.strictEscalatedFrom, STRICT_FROM_VALUES);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    clear === undefined ||
    invalidInputs === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    direction === undefined ||
    strict === undefined ||
    strictEscalated === undefined ||
    from === undefined ||
    !Array.isArray(rollup.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseDecisionTrendReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_TREND_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    clear,
    reasons,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    direction,
    strict,
    strictEscalated,
    strictEscalatedFrom: from,
  };
}

/** Validate the trend's `summary` block into a bounded {@link ReleaseDecisionTrendSummary}, or `undefined`. */
function readSummary(root: Obj): ReleaseDecisionTrendSummary | undefined {
  const s = isObject(root.summary) ? root.summary : undefined;
  if (s === undefined) return undefined;

  const windowsSupplied = intOf(s.windowsSupplied);
  const windowsConsidered = intOf(s.windowsConsidered);
  const truncated = boolOf(s.truncated);
  const droppedOldest = intOf(s.droppedOldest);
  const windowsUsable = intOf(s.windowsUsable);
  const windowsUnreadable = intOf(s.windowsUnreadable);
  const windowsTampered = intOf(s.windowsTampered);
  const windowVerdictCounts = readCounts(s.windowVerdictCounts, RELEASE_DECISION_INDEX_VERDICTS);
  const totalRecords = intOf(s.totalRecords);
  const totalUsableRecords = intOf(s.totalUsableRecords);
  const decisionCounts = readCounts(s.decisionCounts, RELEASE_DECISION_DECISIONS);
  const newest = nullableOneOf(s.newest, RELEASE_DECISION_INDEX_VERDICTS);
  const oldest = nullableOneOf(s.oldest, RELEASE_DECISION_INDEX_VERDICTS);
  const direction = oneOf(s.direction, RELEASE_DECISION_TREND_DIRECTIONS);
  const trendClass = oneOf(s.trendClass, RELEASE_DECISION_TREND_CLASSES);
  if (
    windowsSupplied === undefined ||
    windowsConsidered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined ||
    windowsUsable === undefined ||
    windowsUnreadable === undefined ||
    windowsTampered === undefined ||
    windowVerdictCounts === undefined ||
    totalRecords === undefined ||
    totalUsableRecords === undefined ||
    decisionCounts === undefined ||
    newest === undefined ||
    oldest === undefined ||
    direction === undefined ||
    trendClass === undefined
  ) {
    return undefined;
  }
  return {
    windowsSupplied,
    windowsConsidered,
    truncated,
    droppedOldest,
    windowsUsable,
    windowsUnreadable,
    windowsTampered,
    windowVerdictCounts,
    totalRecords,
    totalUsableRecords,
    decisionCounts,
    newest,
    oldest,
    direction,
    trendClass,
  };
}

/** One validated point from the trend's own `points` sequence — enough to re-derive the summary distribution. */
interface ValidatedPoint {
  readonly state: ReleaseDecisionTrendWindowState;
  readonly verdict: ReleaseDecisionIndexVerdict | null;
  readonly severity: ReleaseDecisionTrendSeverity | null;
  readonly recordsConsidered: number;
}

/**
 * Validate the trend's `points` array into a bounded sequence, or `undefined`. A usable point must carry a non-null
 * index verdict whose severity matches `WINDOW_VERDICT_SEVERITY` (a real Phase 61 usable point always does); an off-
 * shape / self-inconsistent point makes the whole trend a tamper.
 */
function readPoints(root: Obj): ValidatedPoint[] | undefined {
  if (!Array.isArray(root.points)) return undefined;
  const out: ValidatedPoint[] = [];
  for (const raw of root.points) {
    if (!isObject(raw)) return undefined;
    const position = intOf(raw.position);
    const state = oneOf(raw.state, RELEASE_DECISION_TREND_WINDOW_STATES);
    const verdict = nullableOneOf(raw.verdict, RELEASE_DECISION_INDEX_VERDICTS);
    const severity = nullableOneOf(raw.severity, RELEASE_DECISION_TREND_SEVERITIES);
    const recordsConsidered = intOf(raw.recordsConsidered);
    if (
      position === undefined ||
      state === undefined ||
      verdict === undefined ||
      severity === undefined ||
      recordsConsidered === undefined
    ) {
      return undefined;
    }
    if (state === "usable") {
      // A usable point must carry a trusted index verdict + a severity that re-derives from that verdict.
      if (verdict === null || severity !== WINDOW_VERDICT_SEVERITY[verdict]) return undefined;
    }
    out.push({ state, verdict, severity, recordsConsidered });
  }
  return out;
}

/**
 * Compare two `ReleaseDecisionTrendReasonId` lists as sets (order-independent, exact membership). Size-aware in BOTH
 * directions so a crafted duplicate-plus-omission recorded list (same length, different SET) cannot pass.
 */
function sameReasons(
  a: readonly ReleaseDecisionTrendReasonId[],
  b: readonly ReleaseDecisionTrendReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionTrendRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.clear === b.clear &&
    a.invalidInputs === b.invalidInputs &&
    a.blocking === b.blocking &&
    a.insufficiencies === b.insufficiencies &&
    a.advisories === b.advisories &&
    a.direction === b.direction &&
    a.strict === b.strict &&
    a.strictEscalated === b.strictEscalated &&
    a.strictEscalatedFrom === b.strictEscalatedFrom &&
    sameReasons(a.reasons, b.reasons)
  );
}

/** Zeroed per-window index-verdict counts (all five keys present) — the deterministic base for re-derivation. */
function zeroVerdictCounts(): Record<ReleaseDecisionIndexVerdict, number> {
  const counts = {} as Record<ReleaseDecisionIndexVerdict, number>;
  for (const v of RELEASE_DECISION_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * Whether the recorded summary's POINT-DERIVABLE fields (the window states + verdict distribution, newest / oldest,
 * arc direction, total records) + window arithmetic re-derive from the trend's own posture sequence. The aggregate
 * `decisionCounts` / `totalUsableRecords` / `trendClass` are NOT re-derivable from the posture sequence (the trend
 * reduced its per-window decision facts away) and are validated as bounded shape only — they never change the plan.
 */
function summaryMatchesSequence(
  summary: ReleaseDecisionTrendSummary,
  points: readonly ValidatedPoint[],
): boolean {
  const verdictCounts = zeroVerdictCounts();
  const usableVerdicts: ReleaseDecisionIndexVerdict[] = [];
  let windowsUnreadable = 0;
  let windowsTampered = 0;
  let totalRecords = 0;

  for (const p of points) {
    if (p.state === "usable" && p.verdict !== null) {
      usableVerdicts.push(p.verdict);
      verdictCounts[p.verdict] += 1;
      totalRecords += p.recordsConsidered;
    } else if (p.state === "unreadable") {
      windowsUnreadable += 1;
    } else if (p.state === "tampered") {
      windowsTampered += 1;
    }
  }

  const newest = usableVerdicts.length > 0 ? usableVerdicts[usableVerdicts.length - 1] : null;
  const oldest = usableVerdicts.length > 0 ? usableVerdicts[0] : null;
  const direction = directionOf(usableVerdicts);

  const sameVerdictCounts = RELEASE_DECISION_INDEX_VERDICTS.every(
    (v) => verdictCounts[v] === summary.windowVerdictCounts[v],
  );

  return (
    summary.windowsConsidered === points.length &&
    summary.windowsUsable === usableVerdicts.length &&
    summary.windowsUnreadable === windowsUnreadable &&
    summary.windowsTampered === windowsTampered &&
    summary.totalRecords === totalRecords &&
    summary.newest === newest &&
    summary.oldest === oldest &&
    summary.direction === direction &&
    sameVerdictCounts
  );
}

/** Whether the recorded summary's window arithmetic is internally consistent with its own sequence + the window cap. */
function windowArithmeticOk(summary: ReleaseDecisionTrendSummary, maxWindows: number): boolean {
  return (
    summary.windowsSupplied >= summary.windowsConsidered &&
    summary.droppedOldest === summary.windowsSupplied - summary.windowsConsidered &&
    summary.truncated === summary.droppedOldest > 0 &&
    summary.windowsConsidered <= maxWindows
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-trend/1` `root` to the bounded {@link IngestedTrend}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_TREND}. For a recognized trend it validates the recorded
 * rollup + summary + policy + points, then requires BOTH: (B) the recorded rollup RE-DERIVES from the recorded summary
 * + policy via {@link computeTrendRollup}, and (A) the recorded summary's point-derivable fields RE-DERIVE from the
 * trend's own posture sequence with consistent window arithmetic. Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestTrend(root: unknown): IngestedTrend {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_TREND_SCHEMA) return UNRECOGNIZED_TREND;

  const rollupObj = isObject(root.trend) ? root.trend : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_DECISION_TREND_VERDICTS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // trend verdict surfaced (untrusted) so the plan can show what the trend asserted.
  if (rollupObj === undefined) return inconsistentTrend(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentTrend(claimed);

  const summary = readSummary(root);
  if (summary === undefined) return inconsistentTrend(recorded.verdict);

  const points = readPoints(root);
  if (points === undefined) return inconsistentTrend(recorded.verdict);

  // The trend's `policy.strict` must agree with the rollup's recorded `strict` (a smuggled inconsistent policy is a
  // tamper). A real Phase 61 trend always carries both, equal; `policy.maxWindows` bounds its own window history.
  const policyObj = isObject(root.policy) ? root.policy : undefined;
  const policyStrict = policyObj ? boolOf(policyObj.strict) : undefined;
  const policyMaxWindows = policyObj ? intOf(policyObj.maxWindows) : undefined;
  if (
    policyStrict === undefined ||
    policyMaxWindows === undefined ||
    policyMaxWindows < 1 ||
    policyStrict !== recorded.strict
  ) {
    return inconsistentTrend(recorded.verdict);
  }

  const policy: ReleaseDecisionTrendPolicy = { maxWindows: policyMaxWindows, strict: recorded.strict };

  // (B) Re-derive the trend verdict from the trend's OWN recorded summary + strict, exactly as the Phase 61 CLI did,
  // and require the recorded rollup to match in every load-bearing field.
  const { rollup: rederived } = computeTrendRollup(summary, policy);
  if (!sameRollup(rederived, recorded)) return inconsistentTrend(recorded.verdict);

  // (A) Re-check the recorded summary's point-derivable fields + arithmetic against the trend's OWN posture sequence,
  // so a lied distribution consistent with the verdict is still caught.
  if (!windowArithmeticOk(summary, policyMaxWindows) || !summaryMatchesSequence(summary, points)) {
    return inconsistentTrend(recorded.verdict);
  }

  const facts: ActionPlanTrendFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    clear: recorded.clear,
    direction: summary.direction as ReleaseDecisionTrendDirection,
    trendClass: summary.trendClass as ReleaseDecisionTrendClass,
    windowsConsidered: summary.windowsConsidered,
    windowsUsable: summary.windowsUsable,
    totalRecords: summary.totalRecords,
    strict: recorded.strict,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
