/**
 * Pure, node-free **trend ingest** for the release decision closeout governance finalize index trend finalize index trend action plan (Phase
 * 77) — the trust boundary and the no-leak core.
 *
 * The plan translates ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1` summary into a bounded
 * operator follow-up plan. Even though the trend is already content-free, it is UNTRUSTED input here (a CI artifact an
 * operator points us at, a committed trend, or a hand-crafted / tampered file), and this module turns the parsed root
 * into a bounded ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of the trend. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-window / per-
 *    reason detail, the trend's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary — TWICE.** A Phase 81 trend records its history as a spread bounded summary (its
 *    `coverage` + `windowDistribution` + `finalizationDistribution` + `latest` + `trend` blocks) plus a per-window
 *    `points` sequence and a top-level `verdict` / `exitCode` / `reasons`. So the deepest self-consistency check
 *    available is two reuses of the Phase 81 reducers:
 *      (B) RECONSTRUCT the trend's OWN summary from its recorded blocks and RE-RUN {@link computeTrendRollup} over it +
 *          the recorded policy, and require the recorded top-level `verdict` / `exitCode` / arc `direction` / `class` and
 *          reason SET to re-derive — so a hand-flipped trend verdict (or a smuggled inconsistent policy that would change
 *          a `--strict-open` escalation) is caught;
 *      (A) RE-DERIVE the summary's point-derivable fields from the trend's OWN `points` sequence (the window states +
 *          index verdicts + finalization counts, the arc direction via {@link directionOf}, the newest / oldest usable
 *          verdict, the trend class via {@link deriveTrendClass}, and the window arithmetic) and require them to match the
 *          reconstructed summary — so a lied window distribution (even one consistent with a flipped verdict) is caught
 *          against the sequence it claims to summarize.
 *    The trend is `usable` only if BOTH re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` trend); a
 *    recognized-but-inconsistent trend is `recognized = true, usable = false` (⇒ a `tampered` trend); a coherent trend
 *    yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a trend reduced its per-window finalization RECORDS + per-window finalization distributions away into
 * a bounded summary + a per-window POSTURE sequence, so the DEEPEST faithful check over a trend is re-deriving its
 * verdict from its own summary AND re-checking that summary against its own posture sequence — the trend is the atom of
 * evidence here, exactly as the finalize index was at Phase 81. Fields the trend REDUCED AWAY and the posture sequence
 * cannot re-derive (the aggregate `finalizationVerdictCounts` + `totalUsableFinalizations` and the newest-window
 * `latest` object's non-verdict fields, which need per-window finalization facts the posture sequence dropped) are
 * validated as bounded SHAPE only and surfaced as recorded context; they never change the load-bearing plan verdict,
 * which keys on the RE-DERIVED trend verdict. A fully self-consistent FABRICATED trend (real-looking summary + verdict +
 * sequence) is out of scope for structural tamper-evidence, exactly as at Phases 52–76; that would need a signature this
 * offline planner does not have.
 *
 * SAFETY of the reuse: {@link computeTrendRollup} reads ONLY the summary's `windowVerdictCounts` +
 * `windowsUsable` / `windowsUnreadable` / `windowsTampered` + `direction` + `newest` + `trendClass`, and
 * `policy.strictOpen` / `requireLatestIndexed`; {@link directionOf} reads ONLY the usable windows' index verdicts;
 * {@link deriveTrendClass} reads ONLY the usable / unreadable / tampered counts + histogram + newest + direction. So
 * neither recompute can be steered by a field the posture sequence cannot re-derive — the load-bearing fields are read
 * faithfully from the trend's own summary + sequence. (Verified against
 * `release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/{reduce,build}.ts` — re-verify those field reads before
 * trusting this reconstruction.)
 */

import {
  computeTrendRollup,
  deriveTrendClass,
  directionOf,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/reduce";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_SEVERITIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_WINDOW_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS,
  WINDOW_VERDICT_SEVERITY,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendLatest,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendSummary,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendWindowState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/types";
import type { FinalizeIndexTrendActionPlanFacts } from "./types";

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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1` document. */
export interface IngestedFinalizeIndexTrend {
  /** True iff the input parsed to an object carrying the finalize-index-trend schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded trend verdict + summary RE-DERIVE from its own summary + sequence. */
  readonly usable: boolean;
  /** The trend's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: FinalizeIndexTrendActionPlanFacts | null;
}

/** The bounded outcome for an input that was not a recognized finalize-index trend. */
export const UNRECOGNIZED_TREND: IngestedFinalizeIndexTrend = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) trend, carrying only its untrusted claimed verdict. */
function inconsistentTrend(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict | null,
): IngestedFinalizeIndexTrend {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** Validate the trend's `policy` block into a bounded Phase 81 policy, or `undefined`. */
function readPolicy(root: Obj): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const maxWindows = intOf(p.maxWindows);
  const strictOpen = boolOf(p.strictOpen);
  const requireLatestIndexed = boolOf(p.requireLatestIndexed);
  if (maxWindows === undefined || maxWindows < 1 || strictOpen === undefined || requireLatestIndexed === undefined) {
    return undefined;
  }
  return { maxWindows, strictOpen, requireLatestIndexed };
}

/** Validate the trend's newest-usable-window `latest` block into a bounded shape (null-or-object), or `undefined`. */
function readLatest(
  value: unknown,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendLatest | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const verdict = oneOf(value.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS);
  const indexed = boolOf(value.indexed);
  const finalizationsConsidered = intOf(value.finalizationsConsidered);
  const finalizationsUsable = intOf(value.finalizationsUsable);
  const latestFinalization = nullableOneOf(value.latestFinalization, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const strictOpen = boolOf(value.strictOpen);
  if (
    verdict === undefined ||
    indexed === undefined ||
    finalizationsConsidered === undefined ||
    finalizationsUsable === undefined ||
    latestFinalization === undefined ||
    strictOpen === undefined
  ) {
    return undefined;
  }
  return { verdict, indexed, finalizationsConsidered, finalizationsUsable, latestFinalization, strictOpen };
}

/**
 * Reconstruct the trend's OWN bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendSummary} from its
 * recorded `coverage` + `windowDistribution` + `finalizationDistribution` + `latest` + `trend` result blocks, or
 * `undefined` if any block is malformed. This is the inverse of the Phase 81 `build`'s summary → result-blocks mapping.
 */
function reconstructSummary(
  root: Obj,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendSummary | undefined {
  const coverage = isObject(root.coverage) ? root.coverage : undefined;
  const windowDistribution = isObject(root.windowDistribution) ? root.windowDistribution : undefined;
  const finalizationDistribution = isObject(root.finalizationDistribution) ? root.finalizationDistribution : undefined;
  const arc = isObject(root.trend) ? root.trend : undefined;
  if (coverage === undefined || windowDistribution === undefined || finalizationDistribution === undefined || arc === undefined) {
    return undefined;
  }

  const windowsSupplied = intOf(coverage.windowsSupplied);
  const windowsConsidered = intOf(coverage.windowsConsidered);
  const windowsUsable = intOf(coverage.windowsUsable);
  const windowsUnreadable = intOf(coverage.windowsUnreadable);
  const windowsTampered = intOf(coverage.windowsTampered);
  const truncated = boolOf(coverage.truncated);
  const droppedOldest = intOf(coverage.droppedOldest);

  const windowVerdictCounts = readCounts(windowDistribution.verdictCounts, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS);
  const newest = nullableOneOf(windowDistribution.newest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS);
  const oldest = nullableOneOf(windowDistribution.oldest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS);

  const finalizationVerdictCounts = readCounts(finalizationDistribution.verdictCounts, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const totalFinalizations = intOf(finalizationDistribution.totalConsidered);
  const totalUsableFinalizations = intOf(finalizationDistribution.totalUsable);

  const latest = readLatest(root.latest);
  const direction = oneOf(arc.direction, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_DIRECTIONS);
  const trendClass = oneOf(arc.class, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLASSES);

  if (
    windowsSupplied === undefined ||
    windowsConsidered === undefined ||
    windowsUsable === undefined ||
    windowsUnreadable === undefined ||
    windowsTampered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined ||
    windowVerdictCounts === undefined ||
    newest === undefined ||
    oldest === undefined ||
    finalizationVerdictCounts === undefined ||
    totalFinalizations === undefined ||
    totalUsableFinalizations === undefined ||
    latest === undefined ||
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
    newest,
    oldest,
    totalFinalizations,
    totalUsableFinalizations,
    finalizationVerdictCounts,
    latest,
    direction,
    trendClass,
  };
}

/** One validated point from the trend's own `points` sequence — enough to re-derive the summary distribution. */
interface ValidatedPoint {
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendWindowState;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict | null;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendSeverity | null;
  readonly finalizationsConsidered: number;
}

/**
 * Validate the trend's `points` array into a bounded sequence, or `undefined`. A usable point must carry a non-null
 * index verdict whose severity matches `WINDOW_VERDICT_SEVERITY` (a real Phase 81 usable point always does); an off-shape
 * / self-inconsistent point makes the whole trend a tamper.
 */
function readPoints(root: Obj): ValidatedPoint[] | undefined {
  if (!Array.isArray(root.points)) return undefined;
  const out: ValidatedPoint[] = [];
  for (const raw of root.points) {
    if (!isObject(raw)) return undefined;
    const position = intOf(raw.position);
    const state = oneOf(raw.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_WINDOW_STATES);
    const verdict = nullableOneOf(raw.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS);
    const latestFinalization = nullableOneOf(raw.latestFinalization, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
    const severity = nullableOneOf(raw.severity, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_SEVERITIES);
    const finalizationsConsidered = intOf(raw.finalizationsConsidered);
    if (
      position === undefined ||
      state === undefined ||
      verdict === undefined ||
      latestFinalization === undefined ||
      severity === undefined ||
      finalizationsConsidered === undefined
    ) {
      return undefined;
    }
    if (state === "usable") {
      // A usable point must carry a trusted index verdict + a severity that re-derives from that verdict.
      if (verdict === null || severity !== WINDOW_VERDICT_SEVERITY[verdict]) return undefined;
    }
    out.push({ state, verdict, severity, finalizationsConsidered });
  }
  return out;
}

/**
 * Validate the trend's top-level `reasons` array into a bounded set of reason ids, or `undefined`. Each recorded reason
 * must carry a known id AND the AUTHORED severity for that id (a smuggled off-severity reason is a tamper).
 */
function readReasonIds(root: Obj): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendReasonId[] | undefined {
  if (!Array.isArray(root.reasons)) return undefined;
  const out: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendReasonId[] = [];
  for (const raw of root.reasons) {
    if (!isObject(raw)) return undefined;
    const id = oneOf(raw.id, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_REASON_IDS);
    const severity = oneOf(raw.severity, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_SEVERITIES);
    if (id === undefined || severity === undefined) return undefined;
    if (severity !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_REASON_DETAIL[id].severity) {
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
  a: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendReasonId[],
  b: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** Zeroed per-window index-verdict counts (all five keys present) — the deterministic base for re-derivation. */
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * Whether the reconstructed summary's POINT-DERIVABLE fields (the window states + index-verdict distribution, newest /
 * oldest, arc direction, trend class, total finalizations) + window arithmetic re-derive from the trend's own posture
 * sequence. The aggregate `finalizationVerdictCounts` / `totalUsableFinalizations` and the `latest` object's non-verdict
 * fields are NOT re-derivable from the posture sequence (the trend reduced its per-window finalization facts away) and
 * are validated as bounded shape only — they never change the plan.
 */
function summaryMatchesSequence(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendSummary,
  points: readonly ValidatedPoint[],
): boolean {
  const verdictCounts = zeroVerdictCounts();
  const usableVerdicts: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict[] = [];
  let windowsUnreadable = 0;
  let windowsTampered = 0;
  let totalFinalizations = 0;

  for (const p of points) {
    if (p.state === "usable" && p.verdict !== null) {
      usableVerdicts.push(p.verdict);
      verdictCounts[p.verdict] += 1;
      totalFinalizations += p.finalizationsConsidered;
    } else if (p.state === "unreadable") {
      windowsUnreadable += 1;
    } else if (p.state === "tampered") {
      windowsTampered += 1;
    }
  }

  const newest = usableVerdicts.length > 0 ? usableVerdicts[usableVerdicts.length - 1]! : null;
  const oldest = usableVerdicts.length > 0 ? usableVerdicts[0]! : null;
  const direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendDirection = directionOf(usableVerdicts);
  const trendClass = deriveTrendClass(
    usableVerdicts.length,
    windowsUnreadable,
    windowsTampered,
    verdictCounts,
    newest,
    direction,
  );

  const sameVerdictCounts = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS.every(
    (v) => verdictCounts[v] === summary.windowVerdictCounts[v],
  );

  return (
    summary.windowsConsidered === points.length &&
    summary.windowsUsable === usableVerdicts.length &&
    summary.windowsUnreadable === windowsUnreadable &&
    summary.windowsTampered === windowsTampered &&
    summary.totalFinalizations === totalFinalizations &&
    summary.newest === newest &&
    summary.oldest === oldest &&
    summary.direction === direction &&
    summary.trendClass === trendClass &&
    sameVerdictCounts
  );
}

/** Whether the reconstructed summary's window arithmetic is internally consistent with its own sequence + window cap. */
function windowArithmeticOk(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendSummary,
  maxWindows: number,
): boolean {
  return (
    summary.windowsSupplied >= summary.windowsConsidered &&
    summary.droppedOldest === summary.windowsSupplied - summary.windowsConsidered &&
    summary.truncated === summary.droppedOldest > 0 &&
    summary.windowsConsidered <= maxWindows
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1` `root` to the bounded
 * {@link IngestedFinalizeIndexTrend}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_TREND}. For a recognized trend it validates the recorded
 * top-level verdict + exit + reasons + policy + summary blocks + points, then requires BOTH: (B) the recorded top-level
 * verdict / exit / arc / reason SET RE-DERIVE from the reconstructed summary + policy via {@link computeTrendRollup}, and
 * (A) the reconstructed summary's point-derivable fields RE-DERIVE from the trend's own posture sequence with consistent
 * window arithmetic. Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestFinalizeIndexTrend(root: unknown): IngestedFinalizeIndexTrend {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_SCHEMA) {
    return UNRECOGNIZED_TREND;
  }

  const claimed = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS) ?? null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // trend verdict surfaced (untrusted) so the plan can show what the trend asserted.
  const verdict = oneOf(root.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_VERDICTS);
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

  // (B) Re-derive the trend rollup from the trend's OWN reconstructed summary + policy, exactly as the Phase 81 CLI did,
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
  if (!windowArithmeticOk(summary, policy.maxWindows) || !summaryMatchesSequence(summary, points)) {
    return inconsistentTrend(verdict);
  }

  const facts: FinalizeIndexTrendActionPlanFacts = {
    verdict,
    exitCode,
    clean: verdict === "stable" || verdict === "improving",
    latest: summary.newest,
    direction: summary.direction,
    trendClass: summary.trendClass,
    windowsConsidered: summary.windowsConsidered,
    windowsUsable: summary.windowsUsable,
    totalFinalizations: summary.totalFinalizations,
    strictOpen: policy.strictOpen,
  };
  return { recognized: true, usable: true, verdict, facts };
}
