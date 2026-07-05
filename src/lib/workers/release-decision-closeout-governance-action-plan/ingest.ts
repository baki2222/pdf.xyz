/**
 * Pure, node-free **trend ingest** for the release decision closeout governance index trend action plan (Phase 72) — the
 * trust boundary and the no-leak core.
 *
 * The plan translates ONE `pdfxyz.release-decision-closeout-governance-index-trend/1` summary into a bounded operator
 * follow-up plan. Even though the trend is already content-free, it is UNTRUSTED input here (a CI artifact an operator
 * points us at, a committed trend, or a hand-crafted / tampered file), and this module turns the parsed root into a
 * bounded ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of the trend. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, per-window / per-
 *    reason detail, the trend's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary — TWICE.** A trend records both a `summary` (its bounded per-window index-verdict
 *    distribution + arc + class) and a per-window `points` sequence, and its load-bearing output is its
 *    `governanceIndexTrend` verdict. So the deepest self-consistency check available is two reuses of the Phase 71
 *    reducers:
 *      (B) RE-RUN {@link computeTrendRollup} over the trend's OWN recorded summary + recorded policy, and require the
 *          recorded `governanceIndexTrend` rollup (verdict, exit code, stable, latest, reason SET, the four severity
 *          counts, direction, strict-watch escalation) to re-derive — so a hand-flipped trend verdict is caught;
 *      (A) RE-DERIVE the summary's point-derivable fields from the trend's OWN `points` sequence (the window states +
 *          index verdicts + governance counts, the arc direction via {@link directionOf}, the newest / oldest usable
 *          verdict, the trend class via {@link deriveTrendClass}, and the window arithmetic) and require them to match
 *          the recorded summary — so a lied window distribution (even one consistent with a flipped verdict) is caught
 *          against the sequence it claims to summarize.
 *    The trend is `usable` only if BOTH re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` trend); a
 *    recognized-but-inconsistent trend is `recognized = true, usable = false` (⇒ a `tampered` trend); a coherent trend
 *    yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a trend reduced its per-window governance RECORDS + per-window governance distributions away into a
 * bounded summary + a per-window POSTURE sequence, so the DEEPEST faithful check over a trend is re-deriving its verdict
 * from its own summary AND re-checking that summary against its own posture sequence — the trend is the atom of evidence
 * here, exactly as the closeout-index trend was at Phase 67. Fields the trend REDUCED AWAY and the posture sequence
 * cannot re-derive (the aggregate `governanceVerdictCounts` + `totalUsableGovernance`, which need per-window governance
 * facts the posture sequence dropped) are validated as bounded SHAPE only and surfaced as recorded context; they never
 * change the load-bearing plan verdict, which keys on the RE-DERIVED trend verdict. A fully self-consistent FABRICATED
 * trend (real-looking summary + verdict + sequence) is out of scope for structural tamper-evidence, exactly as at Phases
 * 52–71; that would need a signature this offline planner does not have.
 *
 * SAFETY of the reuse: {@link computeTrendRollup} reads ONLY the summary's `indexVerdictCounts` +
 * `indexesUsable` / `indexesUnreadable` / `indexesTampered` + `direction` + `newest` + `trendClass`, and
 * `policy.strictWatch` / thresholds; {@link directionOf} reads ONLY the usable windows' index verdicts;
 * {@link deriveTrendClass} reads ONLY the usable / unreadable / tampered counts + the index-verdict histogram. So neither
 * recompute can be steered by a field the posture sequence cannot re-derive — the load-bearing fields are read faithfully
 * from the trend's own summary + sequence. (Verified against `release-decision-closeout-governance-index-trend/reduce.ts`
 * — re-verify those field reads before trusting this reconstruction.)
 */

import {
  deriveTrendClass,
  directionOf,
  computeTrendRollup,
} from "../release-decision-closeout-governance-index-trend/reduce";
import {
  INDEX_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_DIRECTIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SEVERITIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_WINDOW_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceIndexTrendRollup,
  type ReleaseDecisionCloseoutGovernanceIndexTrendSeverity,
  type ReleaseDecisionCloseoutGovernanceIndexTrendSummary,
  type ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceIndexTrendWindowState,
  type ReleaseDecisionCloseoutGovernanceIndexVerdict,
} from "../release-decision-closeout-governance-index-trend/types";
import type { GovernanceActionPlanTrendFacts } from "./types";

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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-governance-index-trend/1` document. */
export interface IngestedGovernanceTrend {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-closeout-governance-index-trend/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded trend verdict + summary RE-DERIVE from its own summary + sequence. */
  readonly usable: boolean;
  /** The trend's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: GovernanceActionPlanTrendFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-closeout-governance-index-trend/1`. */
export const UNRECOGNIZED_TREND: IngestedGovernanceTrend = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) trend, carrying only its untrusted claimed verdict. */
function inconsistentTrend(
  verdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict | null,
): IngestedGovernanceTrend {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** The recorded trend-rollup fields the recompute must reproduce for the trend to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict;
  readonly exitCode: number;
  readonly stable: boolean;
  readonly latest: ReleaseDecisionCloseoutGovernanceIndexVerdict | null;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceIndexTrendReasonId[];
  readonly blocking: number;
  readonly watch: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly direction: ReleaseDecisionCloseoutGovernanceIndexTrendDirection;
  readonly strictWatch: boolean;
  readonly strictWatchEscalated: boolean;
  readonly strictWatchEscalatedFrom: "trend-watch" | null;
}

const ROLLUP_STRICT_FROM = ["trend-watch"] as const;

/** Validate the trend's `governanceIndexTrend` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const stable = boolOf(rollup.stable);
  const latest = nullableOneOf(rollup.latest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
  const blocking = intOf(rollup.blocking);
  const watch = intOf(rollup.watch);
  const incomplete = intOf(rollup.incomplete);
  const informational = intOf(rollup.informational);
  const direction = oneOf(rollup.direction, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_DIRECTIONS);
  const strictWatch = boolOf(rollup.strictWatch);
  const strictWatchEscalated = boolOf(rollup.strictWatchEscalated);
  const from = nullableOneOf(rollup.strictWatchEscalatedFrom, ROLLUP_STRICT_FROM);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    stable === undefined ||
    latest === undefined ||
    blocking === undefined ||
    watch === undefined ||
    incomplete === undefined ||
    informational === undefined ||
    direction === undefined ||
    strictWatch === undefined ||
    strictWatchEscalated === undefined ||
    from === undefined ||
    !Array.isArray(rollup.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseDecisionCloseoutGovernanceIndexTrendReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    stable,
    latest,
    reasons,
    blocking,
    watch,
    incomplete,
    informational,
    direction,
    strictWatch,
    strictWatchEscalated,
    strictWatchEscalatedFrom: from,
  };
}

/**
 * Validate the trend's `summary` block into a bounded {@link ReleaseDecisionCloseoutGovernanceIndexTrendSummary}, or
 * `undefined`.
 */
function readSummary(root: Obj): ReleaseDecisionCloseoutGovernanceIndexTrendSummary | undefined {
  const s = isObject(root.summary) ? root.summary : undefined;
  if (s === undefined) return undefined;

  const indexesSupplied = intOf(s.indexesSupplied);
  const indexesConsidered = intOf(s.indexesConsidered);
  const truncated = boolOf(s.truncated);
  const droppedOldest = intOf(s.droppedOldest);
  const indexesUsable = intOf(s.indexesUsable);
  const indexesUnreadable = intOf(s.indexesUnreadable);
  const indexesTampered = intOf(s.indexesTampered);
  const indexVerdictCounts = readCounts(s.indexVerdictCounts, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
  const totalGovernance = intOf(s.totalGovernance);
  const totalUsableGovernance = intOf(s.totalUsableGovernance);
  const governanceVerdictCounts = readCounts(s.governanceVerdictCounts, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS);
  const newest = nullableOneOf(s.newest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
  const oldest = nullableOneOf(s.oldest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
  const direction = oneOf(s.direction, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_DIRECTIONS);
  const trendClass = oneOf(s.trendClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CLASSES);
  if (
    indexesSupplied === undefined ||
    indexesConsidered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined ||
    indexesUsable === undefined ||
    indexesUnreadable === undefined ||
    indexesTampered === undefined ||
    indexVerdictCounts === undefined ||
    totalGovernance === undefined ||
    totalUsableGovernance === undefined ||
    governanceVerdictCounts === undefined ||
    newest === undefined ||
    oldest === undefined ||
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
    totalGovernance,
    totalUsableGovernance,
    governanceVerdictCounts,
    newest,
    oldest,
    direction,
    trendClass,
  };
}

/** One validated point from the trend's own `points` sequence — enough to re-derive the summary distribution. */
interface ValidatedPoint {
  readonly state: ReleaseDecisionCloseoutGovernanceIndexTrendWindowState;
  readonly verdict: ReleaseDecisionCloseoutGovernanceIndexVerdict | null;
  readonly severity: ReleaseDecisionCloseoutGovernanceIndexTrendSeverity | null;
  readonly governanceConsidered: number;
}

/**
 * Validate the trend's `points` array into a bounded sequence, or `undefined`. A usable point must carry a non-null
 * index verdict whose severity matches `INDEX_VERDICT_SEVERITY` (a real Phase 71 usable point always does); an off-shape
 * / self-inconsistent point makes the whole trend a tamper.
 */
function readPoints(root: Obj): ValidatedPoint[] | undefined {
  if (!Array.isArray(root.points)) return undefined;
  const out: ValidatedPoint[] = [];
  for (const raw of root.points) {
    if (!isObject(raw)) return undefined;
    const position = intOf(raw.position);
    const state = oneOf(raw.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_WINDOW_STATES);
    const verdict = nullableOneOf(raw.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS);
    const latestGovernance = nullableOneOf(raw.latestGovernance, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS);
    const severity = nullableOneOf(raw.severity, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SEVERITIES);
    const governanceConsidered = intOf(raw.governanceConsidered);
    if (
      position === undefined ||
      state === undefined ||
      verdict === undefined ||
      latestGovernance === undefined ||
      severity === undefined ||
      governanceConsidered === undefined
    ) {
      return undefined;
    }
    if (state === "usable") {
      // A usable point must carry a trusted index verdict + a severity that re-derives from that verdict.
      if (verdict === null || severity !== INDEX_VERDICT_SEVERITY[verdict]) return undefined;
    }
    out.push({ state, verdict, severity, governanceConsidered });
  }
  return out;
}

/**
 * Compare two `ReleaseDecisionCloseoutGovernanceIndexTrendReasonId` lists as sets (order-independent, exact membership).
 * Size-aware in BOTH directions so a crafted duplicate-plus-omission recorded list (same length, different SET) cannot
 * pass.
 */
function sameReasons(
  a: readonly ReleaseDecisionCloseoutGovernanceIndexTrendReasonId[],
  b: readonly ReleaseDecisionCloseoutGovernanceIndexTrendReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionCloseoutGovernanceIndexTrendRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.stable === b.stable &&
    a.latest === b.latest &&
    a.blocking === b.blocking &&
    a.watch === b.watch &&
    a.incomplete === b.incomplete &&
    a.informational === b.informational &&
    a.direction === b.direction &&
    a.strictWatch === b.strictWatch &&
    a.strictWatchEscalated === b.strictWatchEscalated &&
    a.strictWatchEscalatedFrom === b.strictWatchEscalatedFrom &&
    sameReasons(a.reasons, b.reasons)
  );
}

/** Zeroed per-window index-verdict counts (all four keys present) — the deterministic base for re-derivation. */
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceIndexVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceIndexVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * Whether the recorded summary's POINT-DERIVABLE fields (the window states + index-verdict distribution, newest / oldest,
 * arc direction, trend class, total governance) + window arithmetic re-derive from the trend's own posture sequence. The
 * aggregate `governanceVerdictCounts` / `totalUsableGovernance` are NOT re-derivable from the posture sequence (the trend
 * reduced its per-window governance facts away) and are validated as bounded shape only — they never change the plan.
 */
function summaryMatchesSequence(
  summary: ReleaseDecisionCloseoutGovernanceIndexTrendSummary,
  points: readonly ValidatedPoint[],
): boolean {
  const verdictCounts = zeroVerdictCounts();
  const usableVerdicts: ReleaseDecisionCloseoutGovernanceIndexVerdict[] = [];
  let indexesUnreadable = 0;
  let indexesTampered = 0;
  let totalGovernance = 0;

  for (const p of points) {
    if (p.state === "usable" && p.verdict !== null) {
      usableVerdicts.push(p.verdict);
      verdictCounts[p.verdict] += 1;
      totalGovernance += p.governanceConsidered;
    } else if (p.state === "unreadable") {
      indexesUnreadable += 1;
    } else if (p.state === "tampered") {
      indexesTampered += 1;
    }
  }

  const newest = usableVerdicts.length > 0 ? usableVerdicts[usableVerdicts.length - 1] : null;
  const oldest = usableVerdicts.length > 0 ? usableVerdicts[0] : null;
  const direction = directionOf(usableVerdicts);
  const trendClass = deriveTrendClass(
    usableVerdicts.length,
    indexesUnreadable,
    indexesTampered,
    verdictCounts,
  );

  const sameVerdictCounts = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS.every(
    (v) => verdictCounts[v] === summary.indexVerdictCounts[v],
  );

  return (
    summary.indexesConsidered === points.length &&
    summary.indexesUsable === usableVerdicts.length &&
    summary.indexesUnreadable === indexesUnreadable &&
    summary.indexesTampered === indexesTampered &&
    summary.totalGovernance === totalGovernance &&
    summary.newest === newest &&
    summary.oldest === oldest &&
    summary.direction === direction &&
    summary.trendClass === trendClass &&
    sameVerdictCounts
  );
}

/** Whether the recorded summary's window arithmetic is internally consistent with its own sequence + the window cap. */
function windowArithmeticOk(
  summary: ReleaseDecisionCloseoutGovernanceIndexTrendSummary,
  maxIndexes: number,
): boolean {
  return (
    summary.indexesSupplied >= summary.indexesConsidered &&
    summary.droppedOldest === summary.indexesSupplied - summary.indexesConsidered &&
    summary.truncated === summary.droppedOldest > 0 &&
    summary.indexesConsidered <= maxIndexes
  );
}

/** The bounded `policy` block the trend recorded (its own window cap + thresholds + strict-watch flag). */
interface RecordedPolicy {
  readonly maxIndexes: number;
  readonly maxOpen: number;
  readonly maxIncomplete: number;
  readonly maxBlocked: number;
  readonly strictWatch: boolean;
}

/** Validate the trend's `policy` block into a bounded {@link RecordedPolicy}, or `undefined`. */
function readPolicy(root: Obj): RecordedPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const maxIndexes = intOf(p.maxIndexes);
  const maxOpen = intOf(p.maxOpen);
  const maxIncomplete = intOf(p.maxIncomplete);
  const maxBlocked = intOf(p.maxBlocked);
  const strictWatch = boolOf(p.strictWatch);
  if (
    maxIndexes === undefined ||
    maxIndexes < 1 ||
    maxOpen === undefined ||
    maxIncomplete === undefined ||
    maxBlocked === undefined ||
    strictWatch === undefined
  ) {
    return undefined;
  }
  return { maxIndexes, maxOpen, maxIncomplete, maxBlocked, strictWatch };
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-governance-index-trend/1` `root` to the bounded
 * {@link IngestedGovernanceTrend}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_TREND}. For a recognized trend it validates the recorded
 * rollup + summary + policy + points, then requires BOTH: (B) the recorded rollup RE-DERIVES from the recorded summary +
 * policy via {@link computeTrendRollup}, and (A) the recorded summary's point-derivable fields RE-DERIVE from the
 * trend's own posture sequence with consistent window arithmetic. Any mismatch ⇒ a tamper. Never throws / echoes input.
 */
export function ingestGovernanceTrend(root: unknown): IngestedGovernanceTrend {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_SCHEMA) {
    return UNRECOGNIZED_TREND;
  }

  const rollupObj = isObject(root.governanceIndexTrend) ? root.governanceIndexTrend : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS) ?? null)
    : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // trend verdict surfaced (untrusted) so the plan can show what the trend asserted.
  if (rollupObj === undefined) return inconsistentTrend(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentTrend(claimed);

  const summary = readSummary(root);
  if (summary === undefined) return inconsistentTrend(recorded.verdict);

  const points = readPoints(root);
  if (points === undefined) return inconsistentTrend(recorded.verdict);

  // The trend's `policy.strictWatch` must agree with the rollup's recorded `strictWatch` (a smuggled inconsistent policy
  // is a tamper). A real Phase 71 trend always carries both, equal; the thresholds bound its own window history.
  const policy = readPolicy(root);
  if (policy === undefined || policy.strictWatch !== recorded.strictWatch) {
    return inconsistentTrend(recorded.verdict);
  }

  const trendPolicy: ReleaseDecisionCloseoutGovernanceIndexTrendPolicy = {
    maxIndexes: policy.maxIndexes,
    maxOpen: policy.maxOpen,
    maxIncomplete: policy.maxIncomplete,
    maxBlocked: policy.maxBlocked,
    strictWatch: recorded.strictWatch,
  };

  // (B) Re-derive the trend verdict from the trend's OWN recorded summary + policy, exactly as the Phase 71 CLI did, and
  // require the recorded rollup to match in every load-bearing field.
  const { rollup: rederived } = computeTrendRollup(summary, trendPolicy);
  if (!sameRollup(rederived, recorded)) return inconsistentTrend(recorded.verdict);

  // (A) Re-check the recorded summary's point-derivable fields + arithmetic against the trend's OWN posture sequence, so
  // a lied distribution consistent with the verdict is still caught.
  if (!windowArithmeticOk(summary, policy.maxIndexes) || !summaryMatchesSequence(summary, points)) {
    return inconsistentTrend(recorded.verdict);
  }

  const facts: GovernanceActionPlanTrendFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    stable: recorded.stable,
    latest: summary.newest,
    direction: summary.direction as ReleaseDecisionCloseoutGovernanceIndexTrendDirection,
    trendClass: summary.trendClass as ReleaseDecisionCloseoutGovernanceIndexTrendClass,
    windowsConsidered: summary.indexesConsidered,
    windowsUsable: summary.indexesUsable,
    totalGovernance: summary.totalGovernance,
    strictWatch: recorded.strictWatch,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
