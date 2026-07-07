/**
 * Pure, node-free **trend ingest** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend action plan (Phase 97) — the trust boundary and the no-leak core.
 *
 * The plan translates ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1`
 * summary into a bounded operator follow-up plan. Even though the trend is already content-free, it is UNTRUSTED input
 * here (a CI artifact an operator points us at, a committed trend, or a hand-crafted / tampered file), and this module
 * turns the parsed root into a bounded ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of the trend. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-window / per-
 *    reason detail, the trend's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary — TWICE.** A Phase 96 trend records its history as a spread bounded summary (its
 *    `coverage` + `windowDistribution` + `closeoutDistribution` + `latest` + `trend` blocks) plus a per-window
 *    `points` sequence and a top-level `verdict` / `exitCode` / `reasons`. So the deepest self-consistency check
 *    available is two reuses of the Phase 96 reducers:
 *      (B) RECONSTRUCT the trend's OWN summary from its recorded blocks and RE-RUN {@link computeTrendRollup} over it +
 *          the recorded policy, and require the recorded top-level `verdict` / `exitCode` / arc `direction` / `class` and
 *          reason SET to re-derive — so a hand-flipped trend verdict (or a smuggled inconsistent policy that would change
 *          a `--strict-open` escalation) is caught;
 *      (A) RE-DERIVE the summary's point-derivable fields from the trend's OWN `points` sequence (the window states +
 *          index verdicts + closeout counts, the arc direction via {@link directionOf}, the newest / oldest usable
 *          verdict, the trend class via {@link deriveTrendClass}, and the window arithmetic) and require them to match the
 *          reconstructed summary — so a lied window distribution (even one consistent with a flipped verdict) is caught
 *          against the sequence it claims to summarize.
 *    The trend is `usable` only if BOTH re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` trend); a
 *    recognized-but-inconsistent trend is `recognized = true, usable = false` (⇒ a `tampered` trend); a coherent trend
 *    yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a trend reduced its per-window closeout RECORDS + per-window closeout distributions away into a bounded
 * summary + a per-window POSTURE sequence, so the DEEPEST faithful check over a trend is re-deriving its verdict from its
 * own summary AND re-checking that summary against its own posture sequence — the trend is the atom of evidence here,
 * exactly as the closeout index was at Phase 95. Fields the trend REDUCED AWAY and the posture sequence cannot re-derive
 * (the aggregate `closeoutVerdictCounts` + `totalUsableCloseouts` and the newest-window `latest` object's non-verdict
 * fields, which need per-window closeout facts the posture sequence dropped) are validated as bounded SHAPE only and
 * surfaced as recorded context; they never change the load-bearing plan verdict, which keys on the RE-DERIVED trend
 * verdict. A fully self-consistent FABRICATED trend (real-looking summary + verdict + sequence) is out of scope for
 * structural tamper-evidence, exactly as at the earlier rungs; that would need a signature this offline planner does not
 * have.
 *
 * SAFETY of the reuse: {@link computeTrendRollup} reads ONLY the summary's `indexVerdictCounts` +
 * `indexesUsable` / `indexesUnreadable` / `indexesTampered` + `direction` + `newest` + `trendClass`, and
 * `policy.maxBlocked` / `maxOpen` / `maxIncomplete` / `strictOpen` / `requireLatestAllClosed`; {@link directionOf} reads
 * ONLY the usable windows' index verdicts; {@link deriveTrendClass} reads ONLY the usable / unreadable / tampered counts +
 * histogram + newest + direction. So neither recompute can be steered by a field the posture sequence cannot re-derive —
 * the load-bearing fields are read faithfully from the trend's own summary + sequence. (Verified against
 * `release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/{reduce,build}.ts` —
 * re-verify those field reads before trusting this reconstruction.)
 */

import {
  computeTrendRollup,
  deriveTrendClass,
  directionOf,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/reduce";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SEVERITIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_WINDOW_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS,
  WINDOW_VERDICT_SEVERITY,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendLatest,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/types";
import type { CloseoutIndexTrendActionPlanFacts } from "./types";

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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-…-closeout-index-trend/1` document. */
export interface IngestedCloseoutIndexTrend {
  /** True iff the input parsed to an object carrying the closeout-index-trend schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded trend verdict + summary RE-DERIVE from its own summary + sequence. */
  readonly usable: boolean;
  /** The trend's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: CloseoutIndexTrendActionPlanFacts | null;
}

/** The bounded outcome for an input that was not a recognized closeout-index trend. */
export const UNRECOGNIZED_TREND: IngestedCloseoutIndexTrend = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) trend, carrying only its untrusted claimed verdict. */
function inconsistentTrend(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict | null,
): IngestedCloseoutIndexTrend {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** Validate the trend's `policy` block into a bounded Phase 96 policy, or `undefined`. */
function readPolicy(
  root: Obj,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const maxIndexes = intOf(p.maxIndexes);
  const maxOpen = intOf(p.maxOpen);
  const maxIncomplete = intOf(p.maxIncomplete);
  const maxBlocked = intOf(p.maxBlocked);
  const strictOpen = boolOf(p.strictOpen);
  const requireLatestAllClosed = boolOf(p.requireLatestAllClosed);
  if (
    maxIndexes === undefined ||
    maxIndexes < 1 ||
    maxOpen === undefined ||
    maxIncomplete === undefined ||
    maxBlocked === undefined ||
    strictOpen === undefined ||
    requireLatestAllClosed === undefined
  ) {
    return undefined;
  }
  return { maxIndexes, maxOpen, maxIncomplete, maxBlocked, strictOpen, requireLatestAllClosed };
}

/** Validate the trend's newest-usable-window `latest` block into a bounded shape (null-or-object), or `undefined`. */
function readLatest(
  value: unknown,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendLatest | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const verdict = oneOf(value.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);
  const allClosed = boolOf(value.allClosed);
  const closeoutsConsidered = intOf(value.closeoutsConsidered);
  const closeoutsUsable = intOf(value.closeoutsUsable);
  const latestCloseout = nullableOneOf(value.latestCloseout, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS);
  const strictOpen = boolOf(value.strictOpen);
  if (
    verdict === undefined ||
    allClosed === undefined ||
    closeoutsConsidered === undefined ||
    closeoutsUsable === undefined ||
    latestCloseout === undefined ||
    strictOpen === undefined
  ) {
    return undefined;
  }
  return { verdict, allClosed, closeoutsConsidered, closeoutsUsable, latestCloseout, strictOpen };
}

/**
 * Reconstruct the trend's OWN bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary}
 * from its recorded `coverage` + `windowDistribution` + `closeoutDistribution` + `latest` + `trend` result blocks, or
 * `undefined` if any block is malformed. This is the inverse of the Phase 96 `build`'s summary → result-blocks mapping.
 */
function reconstructSummary(
  root: Obj,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary | undefined {
  const coverage = isObject(root.coverage) ? root.coverage : undefined;
  const windowDistribution = isObject(root.windowDistribution) ? root.windowDistribution : undefined;
  const closeoutDistribution = isObject(root.closeoutDistribution) ? root.closeoutDistribution : undefined;
  const arc = isObject(root.trend) ? root.trend : undefined;
  if (coverage === undefined || windowDistribution === undefined || closeoutDistribution === undefined || arc === undefined) {
    return undefined;
  }

  const indexesSupplied = intOf(coverage.indexesSupplied);
  const indexesConsidered = intOf(coverage.indexesConsidered);
  const indexesUsable = intOf(coverage.indexesUsable);
  const indexesUnreadable = intOf(coverage.indexesUnreadable);
  const indexesTampered = intOf(coverage.indexesTampered);
  const truncated = boolOf(coverage.truncated);
  const droppedOldest = intOf(coverage.droppedOldest);

  const indexVerdictCounts = readCounts(windowDistribution.verdictCounts, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);
  const newest = nullableOneOf(windowDistribution.newest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);
  const oldest = nullableOneOf(windowDistribution.oldest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);

  const closeoutVerdictCounts = readCounts(closeoutDistribution.verdictCounts, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS);
  const totalCloseouts = intOf(closeoutDistribution.totalConsidered);
  const totalUsableCloseouts = intOf(closeoutDistribution.totalUsable);

  const latest = readLatest(root.latest);
  const direction = oneOf(arc.direction, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_DIRECTIONS);
  const trendClass = oneOf(arc.class, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLASSES);

  if (
    indexesSupplied === undefined ||
    indexesConsidered === undefined ||
    indexesUsable === undefined ||
    indexesUnreadable === undefined ||
    indexesTampered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined ||
    indexVerdictCounts === undefined ||
    newest === undefined ||
    oldest === undefined ||
    closeoutVerdictCounts === undefined ||
    totalCloseouts === undefined ||
    totalUsableCloseouts === undefined ||
    latest === undefined ||
    direction === undefined ||
    trendClass === undefined
  ) {
    return undefined;
  }

  return {
    indexesSupplied,
    indexesConsidered,
    truncated,
    droppedOldest,
    indexesUsable,
    indexesUnreadable,
    indexesTampered,
    indexVerdictCounts,
    newest,
    oldest,
    totalCloseouts,
    totalUsableCloseouts,
    closeoutVerdictCounts,
    latest,
    direction,
    trendClass,
  };
}

/** One validated point from the trend's own `points` sequence — enough to re-derive the summary distribution. */
interface ValidatedPoint {
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowState;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity | null;
  readonly closeoutsConsidered: number;
}

/**
 * Validate the trend's `points` array into a bounded sequence, or `undefined`. A usable point must carry a non-null
 * index verdict whose severity matches `WINDOW_VERDICT_SEVERITY` (a real Phase 96 usable point always does); an off-shape
 * / self-inconsistent point makes the whole trend a tamper.
 */
function readPoints(root: Obj): ValidatedPoint[] | undefined {
  if (!Array.isArray(root.points)) return undefined;
  const out: ValidatedPoint[] = [];
  for (const raw of root.points) {
    if (!isObject(raw)) return undefined;
    const position = intOf(raw.position);
    const state = oneOf(raw.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_WINDOW_STATES);
    const verdict = nullableOneOf(raw.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS);
    const latestCloseout = nullableOneOf(raw.latestCloseout, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS);
    const severity = nullableOneOf(raw.severity, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SEVERITIES);
    const closeoutsConsidered = intOf(raw.closeoutsConsidered);
    if (
      position === undefined ||
      state === undefined ||
      verdict === undefined ||
      latestCloseout === undefined ||
      severity === undefined ||
      closeoutsConsidered === undefined
    ) {
      return undefined;
    }
    if (state === "usable") {
      // A usable point must carry a trusted index verdict + a severity that re-derives from that verdict.
      if (verdict === null || severity !== WINDOW_VERDICT_SEVERITY[verdict]) return undefined;
    }
    out.push({ state, verdict, severity, closeoutsConsidered });
  }
  return out;
}

/**
 * Validate the trend's top-level `reasons` array into a bounded set of reason ids, or `undefined`. Each recorded reason
 * must carry a known id AND the AUTHORED severity for that id (a smuggled off-severity reason is a tamper).
 */
function readReasonIds(root: Obj): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[] | undefined {
  if (!Array.isArray(root.reasons)) return undefined;
  const out: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[] = [];
  for (const raw of root.reasons) {
    if (!isObject(raw)) return undefined;
    const id = oneOf(raw.id, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS);
    const severity = oneOf(raw.severity, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SEVERITIES);
    if (id === undefined || severity === undefined) return undefined;
    if (severity !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL[id].severity) {
      return undefined;
    }
    out.push(id);
  }
  return out;
}

/**
 * Compare two reason-id lists as sets (order-independent, exact membership). Size-aware in BOTH directions so a crafted
 * duplicate-plus-omission recorded list (same length, different SET) cannot pass.
 */
function sameReasons(
  a: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[],
  b: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** Zeroed per-window index-verdict counts (all five keys present) — the deterministic base for re-derivation. */
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * Whether the reconstructed summary's POINT-DERIVABLE fields (the window states + index-verdict distribution, newest /
 * oldest, arc direction, trend class, total closeouts) + window arithmetic re-derive from the trend's own posture
 * sequence. The aggregate `closeoutVerdictCounts` / `totalUsableCloseouts` and the `latest` object's non-verdict fields
 * are NOT re-derivable from the posture sequence (the trend reduced its per-window closeout facts away) and are validated
 * as bounded shape only — they never change the plan.
 */
function summaryMatchesSequence(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary,
  points: readonly ValidatedPoint[],
): boolean {
  const verdictCounts = zeroVerdictCounts();
  const usableVerdicts: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict[] = [];
  let indexesUnreadable = 0;
  let indexesTampered = 0;
  let totalCloseouts = 0;

  for (const p of points) {
    if (p.state === "usable" && p.verdict !== null) {
      usableVerdicts.push(p.verdict);
      verdictCounts[p.verdict] += 1;
      totalCloseouts += p.closeoutsConsidered;
    } else if (p.state === "unreadable") {
      indexesUnreadable += 1;
    } else if (p.state === "tampered") {
      indexesTampered += 1;
    }
  }

  const newest = usableVerdicts.length > 0 ? usableVerdicts[usableVerdicts.length - 1]! : null;
  const oldest = usableVerdicts.length > 0 ? usableVerdicts[0]! : null;
  const direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection = directionOf(usableVerdicts);
  const trendClass = deriveTrendClass(
    usableVerdicts.length,
    indexesUnreadable,
    indexesTampered,
    verdictCounts,
    newest,
    direction,
  );

  const sameVerdictCounts = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS.every(
    (v) => verdictCounts[v] === summary.indexVerdictCounts[v],
  );

  return (
    summary.indexesConsidered === points.length &&
    summary.indexesUsable === usableVerdicts.length &&
    summary.indexesUnreadable === indexesUnreadable &&
    summary.indexesTampered === indexesTampered &&
    summary.totalCloseouts === totalCloseouts &&
    summary.newest === newest &&
    summary.oldest === oldest &&
    summary.direction === direction &&
    summary.trendClass === trendClass &&
    sameVerdictCounts
  );
}

/** Whether the reconstructed summary's window arithmetic is internally consistent with its own sequence + window cap. */
function windowArithmeticOk(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary,
  maxIndexes: number,
): boolean {
  return (
    summary.indexesSupplied >= summary.indexesConsidered &&
    summary.droppedOldest === summary.indexesSupplied - summary.indexesConsidered &&
    summary.truncated === summary.droppedOldest > 0 &&
    summary.indexesConsidered <= maxIndexes
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-…-closeout-index-trend/1` `root` to the bounded
 * {@link IngestedCloseoutIndexTrend}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_TREND}. For a recognized trend it validates the recorded
 * top-level verdict + exit + reasons + policy + summary blocks + points, then requires BOTH: (B) the recorded top-level
 * verdict / exit / arc / reason SET RE-DERIVE from the reconstructed summary + policy via {@link computeTrendRollup}, and
 * (A) the reconstructed summary's point-derivable fields RE-DERIVE from the trend's own posture sequence with consistent
 * window arithmetic. Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestCloseoutIndexTrend(root: unknown): IngestedCloseoutIndexTrend {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_SCHEMA) {
    return UNRECOGNIZED_TREND;
  }

  const claimed = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS) ?? null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // trend verdict surfaced (untrusted) so the plan can show what the trend asserted.
  const verdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS);
  const exitCode = intOf(root.exitCode);
  if (verdict === undefined || exitCode === undefined) return inconsistentTrend(claimed);

  const policy = readPolicy(root);
  if (policy === undefined) return inconsistentTrend(verdict);

  const summary = reconstructSummary(root);
  if (summary === undefined) return inconsistentTrend(verdict);

  const points = readPoints(root);
  if (points === undefined) return inconsistentTrend(verdict);

  const recordedReasons = readReasonIds(root);
  if (recordedReasons === undefined) return inconsistentTrend(verdict);

  // (B) Re-derive the trend rollup from the trend's OWN reconstructed summary + policy, exactly as the Phase 96 CLI did,
  // and require the recorded top-level verdict / exit / arc / reason SET to match.
  const { rollup: rederived } = computeTrendRollup(summary, policy);
  if (
    rederived.verdict !== verdict ||
    rederived.exitCode !== exitCode ||
    rederived.direction !== summary.direction ||
    rederived.trendClass !== summary.trendClass ||
    !sameReasons(rederived.reasons, recordedReasons)
  ) {
    return inconsistentTrend(verdict);
  }

  // (A) Re-check the reconstructed summary's point-derivable fields + arithmetic against the trend's OWN posture
  // sequence, so a lied distribution consistent with the verdict is still caught.
  if (!windowArithmeticOk(summary, policy.maxIndexes) || !summaryMatchesSequence(summary, points)) {
    return inconsistentTrend(verdict);
  }

  const facts: CloseoutIndexTrendActionPlanFacts = {
    verdict,
    exitCode,
    clean: verdict === "stable" || verdict === "improving",
    latest: summary.newest,
    direction: summary.direction,
    trendClass: summary.trendClass,
    indexesConsidered: summary.indexesConsidered,
    indexesUsable: summary.indexesUsable,
    totalCloseouts: summary.totalCloseouts,
    strictOpen: policy.strictOpen,
  };
  return { recognized: true, usable: true, verdict, facts };
}
