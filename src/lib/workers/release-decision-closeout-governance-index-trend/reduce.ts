/**
 * Pure, node-free **reducer + fold** for the release decision closeout governance index trend (Phase 71).
 *
 * Turns the ingested windows (the trust boundary's output, oldest → newest) into the bounded, content-free sequence the
 * result records AND folds them into the ONE composite trend verdict a governance review acts on. It:
 *  - applies the `--max-indexes` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced);
 *  - reduces each considered window to a bounded {@link ReleaseDecisionCloseoutGovernanceIndexTrendPoint} (a position, a
 *    coverage state, the trusted-or-claimed index verdict, the window's own latest governance verdict, a severity, its
 *    governance count, an authored headline);
 *  - summarizes the history into a bounded {@link ReleaseDecisionCloseoutGovernanceIndexTrendSummary} (the per-window
 *    index-verdict distribution + the aggregate governance distribution over the usable windows, the newest / oldest
 *    usable verdict, the arc direction, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutGovernanceIndexTrendReasonId} conditions that fired and
 *    resolves the composite {@link ReleaseDecisionCloseoutGovernanceIndexTrendVerdict} with fail-closed severity
 *    precedence `blocking > watch > incomplete > informational`, with the LATEST usable window as the primary driver,
 *    the bounded history thresholds as a secondary escalation, and the worsening arc as an advisory.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator or
 * a byte to enter — not even an ingested window's own stamp (the trend carries only its own).
 */

import {
  INDEX_VERDICT_RANK,
  INDEX_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_STRICT_WATCH_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceIndexTrendPoint,
  type ReleaseDecisionCloseoutGovernanceIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceIndexTrendReason,
  type ReleaseDecisionCloseoutGovernanceIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceIndexTrendRollup,
  type ReleaseDecisionCloseoutGovernanceIndexTrendSeverity,
  type ReleaseDecisionCloseoutGovernanceIndexTrendSummary,
  type ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceIndexTrendWindowState,
  type ReleaseDecisionCloseoutGovernanceIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "./types";
import type { IngestedGovernanceIndex } from "./ingest";

/** The coverage state of one supplied window from its recognized / usable flags. */
export function pointState(
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionCloseoutGovernanceIndexTrendWindowState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + index verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutGovernanceIndexTrendWindowState,
  verdict: ReleaseDecisionCloseoutGovernanceIndexVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision closeout governance index (unreadable — never echoed). It contributes no trend evidence (a coverage gap).`;
    case "tampered":
      return `#${n}: recognized, but its recorded index verdict / counts do NOT re-derive from its own ledger + sequence (tampered / corrupt — treated as an untrustworthy input). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision closeout governance index).`;
  }
}

/**
 * Reduce one ingested window at `position` (oldest = 0) to the bounded
 * {@link ReleaseDecisionCloseoutGovernanceIndexTrendPoint}.
 */
export function reduceWindow(
  position: number,
  ingested: IngestedGovernanceIndex,
): ReleaseDecisionCloseoutGovernanceIndexTrendPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutGovernanceIndexTrendSeverity | null =
    state === "usable" && verdict !== null ? INDEX_VERDICT_SEVERITY[verdict] : null;
  return {
    position,
    state,
    verdict,
    latestGovernance: facts ? facts.latestGovernance : null,
    severity,
    governanceConsidered: facts ? facts.governanceConsidered : 0,
    detail: pointDetail(position, state, verdict),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) windows + how many older ones were dropped. */
export interface WindowedHistory {
  /** The windows considered by the trend, oldest → newest (the newest `maxIndexes`). */
  readonly considered: readonly IngestedGovernanceIndex[];
  /** How many window inputs were supplied (before the cap). */
  readonly indexesSupplied: number;
  /** True iff the cap dropped older windows. */
  readonly truncated: boolean;
  /** How many older windows were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-indexes` window cap to the supplied windows (oldest → newest): keep the NEWEST `maxIndexes`, drop
 * older ones, and surface how many were dropped (never a silent truncation). A `maxIndexes` of 0 or less is treated as
 * "no windows considered" (an empty, incomplete history).
 */
export function applyWindow(
  list: readonly IngestedGovernanceIndex[],
  maxIndexes: number,
): WindowedHistory {
  const cap = Number.isSafeInteger(maxIndexes) && maxIndexes > 0 ? maxIndexes : 0;
  const considered = cap >= list.length ? list : list.slice(list.length - cap);
  const droppedOldest = list.length - considered.length;
  return {
    considered,
    indexesSupplied: list.length,
    truncated: droppedOldest > 0,
    droppedOldest,
  };
}

/** Zeroed per-window index-verdict counts (all four keys present) — the deterministic base for the histogram. */
function zeroIndexVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceIndexVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceIndexVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/** Zeroed aggregate governance-verdict counts (all four keys present) — the deterministic base for the distribution. */
function zeroGovernanceVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS) counts[v] = 0;
  return counts;
}

/** The bounded arc from the oldest usable window to the newest, by index verdict rank. */
export function directionOf(
  usable: readonly ReleaseDecisionCloseoutGovernanceIndexVerdict[],
): ReleaseDecisionCloseoutGovernanceIndexTrendDirection {
  if (usable.length < 2) return "unknown";
  const oldestRank = INDEX_VERDICT_RANK[usable[0] as ReleaseDecisionCloseoutGovernanceIndexVerdict];
  const newestRank = INDEX_VERDICT_RANK[usable[usable.length - 1] as ReleaseDecisionCloseoutGovernanceIndexVerdict];
  if (newestRank > oldestRank) return "degrading";
  if (newestRank < oldestRank) return "improving";
  return "flat";
}

/**
 * The single coarse trend class of the history, by worst-present (strict-INDEPENDENT), with severity precedence
 * `tampered > blocked > watch > incomplete (usable incomplete OR unreadable) > all-indexed`, and `no-usable` when the
 * history has zero usable windows and no other signal.
 */
export function deriveTrendClass(
  indexesUsable: number,
  indexesUnreadable: number,
  indexesTampered: number,
  counts: Readonly<Record<ReleaseDecisionCloseoutGovernanceIndexVerdict, number>>,
): ReleaseDecisionCloseoutGovernanceIndexTrendClass {
  if (indexesTampered > 0) return "tampered-present";
  if (counts["index-blocked"] > 0) return "blocked-present";
  if (counts["index-open"] > 0) return "watch-present";
  if (counts["index-incomplete"] > 0 || indexesUnreadable > 0) return "incomplete-present";
  if (indexesUsable === 0) return "no-usable";
  return "all-indexed";
}

/** The reduced trend sequence + its bounded summary + the trusted usable-window verdict sequence. */
export interface ReducedTrend {
  /** One reduced point per considered window, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceIndexTrendPoint[];
  /** The bounded history summary. */
  readonly summary: ReleaseDecisionCloseoutGovernanceIndexTrendSummary;
  /** The usable windows' index verdicts, oldest → newest (trusted) — what the fold keys on. */
  readonly usableVerdicts: readonly ReleaseDecisionCloseoutGovernanceIndexVerdict[];
}

/**
 * Reduce the supplied windows (oldest → newest) into the bounded points + summary, under the window cap. The counts /
 * newest / oldest / direction / class are over the USABLE considered windows only (an unreadable / tampered window
 * contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceTrend(
  list: readonly IngestedGovernanceIndex[],
  maxIndexes: number,
): ReducedTrend {
  const window = applyWindow(list, maxIndexes);
  const points = window.considered.map((ingested, i) => reduceWindow(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutGovernanceIndexVerdict[] = [];
  const indexVerdictCounts = zeroIndexVerdictCounts();
  const governanceVerdictCounts = zeroGovernanceVerdictCounts();
  let indexesUnreadable = 0;
  let indexesTampered = 0;
  let totalGovernance = 0;
  let totalUsableGovernance = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i] as ReleaseDecisionCloseoutGovernanceIndexTrendPoint;
    const ingested = window.considered[i] as IngestedGovernanceIndex;
    if (point.state === "usable" && point.verdict !== null && ingested.facts !== null) {
      const facts = ingested.facts;
      usableVerdicts.push(point.verdict);
      indexVerdictCounts[point.verdict] += 1;
      totalGovernance += facts.governanceConsidered;
      totalUsableGovernance += facts.governanceUsable;
      for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS) {
        governanceVerdictCounts[v] += facts.governanceVerdictCounts[v];
      }
    } else if (point.state === "unreadable") {
      indexesUnreadable += 1;
    } else if (point.state === "tampered") {
      indexesTampered += 1;
    }
  }

  const newest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutGovernanceIndexVerdict)
      : null;
  const oldest =
    usableVerdicts.length > 0 ? (usableVerdicts[0] as ReleaseDecisionCloseoutGovernanceIndexVerdict) : null;
  const direction = directionOf(usableVerdicts);

  const summary: ReleaseDecisionCloseoutGovernanceIndexTrendSummary = {
    indexesSupplied: window.indexesSupplied,
    indexesConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    indexesUsable: usableVerdicts.length,
    indexesUnreadable,
    indexesTampered,
    indexVerdictCounts,
    totalGovernance,
    totalUsableGovernance,
    governanceVerdictCounts,
    newest,
    oldest,
    direction,
    trendClass: deriveTrendClass(usableVerdicts.length, indexesUnreadable, indexesTampered, indexVerdictCounts),
  };

  return { points, summary, usableVerdicts };
}

/* ------------------------------------------------------------------ *
 *  The composite trend fold (latest-focused + history thresholds + arc)
 * ------------------------------------------------------------------ */

/**
 * Derive the closed set of reason conditions that fired, in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS} order. Each reduces to a bounded, deterministic
 * predicate over the already content-free summary + the policy thresholds; the per-id severity is authored in
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL}. This is the STRICT-INDEPENDENT reason set (a
 * `--strict-watch` escalation is applied afterward in {@link computeTrendRollup}).
 */
export function deriveTrendReasons(
  summary: ReleaseDecisionCloseoutGovernanceIndexTrendSummary,
  policy: ReleaseDecisionCloseoutGovernanceIndexTrendPolicy,
): ReleaseDecisionCloseoutGovernanceIndexTrendReasonId[] {
  const c = summary.indexVerdictCounts;
  const newest = summary.newest;
  const fired: Record<ReleaseDecisionCloseoutGovernanceIndexTrendReasonId, boolean> = {
    // Blocking — an untrustworthy / blocked history.
    "index-tampered": summary.indexesTampered > 0,
    "latest-blocked": newest === "index-blocked",
    "blocked-threshold-exceeded": c["index-blocked"] > policy.maxBlocked,
    "strict-watch-escalation": false, // applied by the rollup after the base verdict is known
    // Watch — an advisory / worsening posture.
    "latest-open": newest === "index-open",
    "open-threshold-exceeded": c["index-open"] > policy.maxOpen,
    "trend-degrading": summary.direction === "degrading",
    // Incomplete — a coverage gap.
    "no-indexes": summary.indexesUsable === 0,
    "index-unreadable": summary.indexesUnreadable > 0,
    "latest-incomplete": newest === "index-incomplete",
    "incomplete-threshold-exceeded": c["index-incomplete"] > policy.maxIncomplete,
    // Informational — a benign trend marker.
    "latest-indexed": newest === "indexed",
    "trend-improving": summary.direction === "improving",
    "history-coherent":
      summary.indexesUsable > 0 &&
      c.indexed === summary.indexesUsable &&
      summary.indexesUnreadable === 0 &&
      summary.indexesTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildTrendReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceIndexTrendReasonId[],
): ReleaseDecisionCloseoutGovernanceIndexTrendReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL[id].detail,
  }));
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > watch > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceIndexTrendReasonId[],
): ReleaseDecisionCloseoutGovernanceIndexTrendVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "trend-blocked";
  if (severities.includes("watch")) return "trend-watch";
  if (severities.includes("incomplete")) return "trend-incomplete";
  return "trend-stable";
}

/**
 * Compute the composite trend verdict from the reduced summary + the policy.
 *
 * Fail-closed precedence: any blocking reason ⇒ `trend-blocked`; else any watch reason ⇒ `trend-watch`; else any
 * incomplete reason ⇒ `trend-incomplete`; else `trend-stable`. When `--strict-watch` escalated a base `trend-watch` to
 * `trend-blocked`, `strictWatchEscalated` is set (and `strictWatchEscalatedFrom` records it) so the summary explains
 * the escalation (the trend would be `trend-watch` without the flag). A base `trend-blocked` / `trend-incomplete` /
 * `trend-stable` verdict is untouched by `--strict-watch`.
 */
export function computeTrendRollup(
  summary: ReleaseDecisionCloseoutGovernanceIndexTrendSummary,
  policy: ReleaseDecisionCloseoutGovernanceIndexTrendPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceIndexTrendRollup;
  reasons: ReleaseDecisionCloseoutGovernanceIndexTrendReason[];
} {
  const baseFired = deriveTrendReasons(summary, policy);
  const baseVerdict = verdictFrom(baseFired);

  const strictWatchEscalated = baseVerdict === "trend-watch" && policy.strictWatch;
  const firedIds = strictWatchEscalated ? [...baseFired, "strict-watch-escalation" as const] : baseFired;
  const reasons = buildTrendReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const watch = reasons.filter((r) => r.severity === "watch").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const detail = strictWatchEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_STRICT_WATCH_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceIndexTrendRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT_FOR_VERDICT[verdict],
    stable: verdict === "trend-stable",
    latest: summary.newest,
    reasons: orderedIds,
    blocking,
    watch,
    incomplete,
    informational,
    direction: summary.direction,
    strictWatch: policy.strictWatch,
    strictWatchEscalated,
    strictWatchEscalatedFrom: strictWatchEscalated ? "trend-watch" : null,
    detail,
  };
  return { rollup, reasons };
}
