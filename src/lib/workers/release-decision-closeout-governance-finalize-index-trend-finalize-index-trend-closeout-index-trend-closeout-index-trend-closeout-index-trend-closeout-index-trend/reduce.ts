/**
 * Pure, node-free **reducer + fold** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend (Phase 96).
 *
 * Turns the ingested windows (the trust boundary's output, oldest → newest) into the bounded, content-free sequence the
 * result records AND folds them into the ONE composite trend verdict a governance review acts on. It:
 *  - applies the `--max-indexes` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced);
 *  - reduces each considered window to a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint}
 *    (a position, a coverage state, the trusted-or-claimed index verdict, the window's own latest closeout verdict, a
 *    severity, its closeout count, an authored headline);
 *  - summarizes the history into a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary}
 *    (the per-window index-verdict distribution + the aggregate closeout distribution over the usable windows, the newest /
 *    oldest usable verdict, the newest-usable-window summary, the arc direction, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId}
 *    conditions that fired and resolves the composite
 *    {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict} with fail-closed
 *    precedence `invalid > blocking > insufficient`, then the directional band (`degrading` / `watch` / `improving` /
 *    `stable`), with the LATEST usable window as the primary driver, the bounded history thresholds as a secondary
 *    escalation, and the ordered arc as the refinement.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator or a
 * byte to enter — not even an ingested window's own stamp (the trend carries only its own).
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS,
  WINDOW_VERDICT_RANK,
  WINDOW_VERDICT_SEVERITY,
  type CloseoutIndexFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendLatest,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "./types";
import type { IngestedCloseoutIndex } from "./ingest";

/** The coverage state of one supplied window from its recognized / usable flags. */
export function pointState(
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + index verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendWindowState,
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision closeout-index window (unreadable — never echoed). It contributes no trend evidence (an untrustworthy input).`;
    case "tampered":
      return `#${n}: recognized, but its recorded index verdict / counts do NOT re-derive from its own coverage + distribution + sequence (tampered / corrupt — treated as an untrustworthy input). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision closeout-index window).`;
  }
}

/**
 * Reduce one ingested window at `position` (oldest = 0) to the bounded
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint}.
 */
export function reduceWindow(
  position: number,
  ingested: IngestedCloseoutIndex,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSeverity | null =
    state === "usable" && verdict !== null ? WINDOW_VERDICT_SEVERITY[verdict] : null;
  return {
    position,
    state,
    verdict,
    latestCloseout: facts ? facts.latestCloseout : null,
    severity,
    closeoutsConsidered: facts ? facts.closeoutsConsidered : 0,
    detail: pointDetail(position, state, verdict),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) windows + how many older ones were dropped. */
export interface WindowedHistory {
  /** The windows considered by the trend, oldest → newest (the newest `maxIndexes`). */
  readonly considered: readonly IngestedCloseoutIndex[];
  /** How many window inputs were supplied (before the cap). */
  readonly indexesSupplied: number;
  /** True iff the cap dropped older windows. */
  readonly truncated: boolean;
  /** How many older windows were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-indexes` window cap to the supplied windows (oldest → newest): keep the NEWEST `maxIndexes`, drop older
 * ones, and surface how many were dropped (never a silent truncation). A `maxIndexes` of 0 or less is treated as "no windows
 * considered" (an empty, insufficient history).
 */
export function applyWindow(
  list: readonly IngestedCloseoutIndex[],
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

/** Zeroed per-window index-verdict counts (all five keys present) — the deterministic base for the histogram. */
function zeroIndexVerdictCounts(): Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  number
> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/** Zeroed aggregate closeout-verdict counts (all five keys present) — the deterministic base for the distribution. */
function zeroCloseoutVerdictCounts(): Record<
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
  number
> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * The bounded arc from the OLDEST usable window to the NEWEST, by index verdict rank over the whole ordered sequence:
 * `unknown` (< 2 usable), `stable` (all ranks equal), `improving` (newest cleaner than oldest AND monotonically
 * non-worsening), `degrading` (newest worse than oldest AND monotonically non-improving), else `mixed` (non-monotonic).
 */
export function directionOf(
  usable: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection {
  if (usable.length < 2) return "unknown";
  const ranks = usable.map((v) => WINDOW_VERDICT_RANK[v]);
  const first = ranks[0] as number;
  const last = ranks[ranks.length - 1] as number;
  let nonIncreasing = true;
  let nonDecreasing = true;
  for (let i = 1; i < ranks.length; i++) {
    const prev = ranks[i - 1] as number;
    const cur = ranks[i] as number;
    if (cur > prev) nonIncreasing = false;
    if (cur < prev) nonDecreasing = false;
  }
  if (first === last) return nonIncreasing && nonDecreasing ? "stable" : "mixed";
  if (last < first) return nonIncreasing ? "improving" : "mixed";
  return nonDecreasing ? "degrading" : "mixed";
}

/**
 * The single coarse trend class of the history, by worst-present + arc (strict-INDEPENDENT, threshold-INDEPENDENT), in the
 * precedence documented on {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass}:
 * `invalid > blocked > no-usable > insufficient > regressing > watch > recovering > clean`.
 */
export function deriveTrendClass(
  indexesUsable: number,
  indexesUnreadable: number,
  indexesTampered: number,
  counts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict, number>>,
  newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null,
  direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass {
  if (indexesUnreadable > 0 || indexesTampered > 0) return "invalid";
  if (counts["blocked"] > 0 || counts["invalid"] > 0) return "blocked";
  if (indexesUsable === 0) return "no-usable";
  const onlyIncomplete = counts["incomplete"] === indexesUsable;
  if (newest === "incomplete" || onlyIncomplete) return "insufficient";
  if (newest === "open" || direction === "degrading") return "regressing";
  // Latest is `all-closed` now. An arc that recovered to a clean latest is `recovering`; an unchanging clean latest with a
  // RESIDUAL older open / incomplete window is `watch`; a fully all-closed history is `clean`.
  if (direction === "improving") return "recovering";
  const residualConcern = counts["open"] > 0 || counts["incomplete"] > 0;
  if (residualConcern) return "watch";
  return "clean";
}

/** The reduced trend sequence + its bounded summary + the trusted usable-window verdict sequence. */
export interface ReducedTrend {
  /** One reduced point per considered window, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint[];
  /** The bounded history summary. */
  readonly summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary;
  /** The usable windows' index verdicts, oldest → newest (trusted) — what the fold keys on. */
  readonly usableVerdicts: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict[];
}

/**
 * Reduce the supplied windows (oldest → newest) into the bounded points + summary, under the window cap. The counts / newest
 * / oldest / direction / class / latest are over the USABLE considered windows only (an unreadable / tampered window
 * contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceTrend(list: readonly IngestedCloseoutIndex[], maxIndexes: number): ReducedTrend {
  const window = applyWindow(list, maxIndexes);
  const points = window.considered.map((ingested, i) => reduceWindow(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict[] = [];
  const indexVerdictCounts = zeroIndexVerdictCounts();
  const closeoutVerdictCounts = zeroCloseoutVerdictCounts();
  let indexesUnreadable = 0;
  let indexesTampered = 0;
  let totalCloseouts = 0;
  let totalUsableCloseouts = 0;
  // The newest usable ingested window's facts (for the `latest` summary object).
  let newestUsableFacts: CloseoutIndexFacts | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPoint;
    const ingested = window.considered[i] as IngestedCloseoutIndex;
    if (point.state === "usable" && point.verdict !== null && ingested.facts !== null) {
      const facts = ingested.facts;
      usableVerdicts.push(point.verdict);
      indexVerdictCounts[point.verdict] += 1;
      totalCloseouts += facts.closeoutsConsidered;
      totalUsableCloseouts += facts.closeoutsUsable;
      for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) {
        closeoutVerdictCounts[v] += facts.closeoutVerdictCounts[v];
      }
      newestUsableFacts = facts;
    } else if (point.state === "unreadable") {
      indexesUnreadable += 1;
    } else if (point.state === "tampered") {
      indexesTampered += 1;
    }
  }

  const newest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict)
      : null;
  const oldest =
    usableVerdicts.length > 0
      ? (usableVerdicts[0] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict)
      : null;
  const direction = directionOf(usableVerdicts);

  const latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendLatest | null =
    newestUsableFacts !== null
      ? {
          verdict: newestUsableFacts.verdict,
          allClosed: newestUsableFacts.allClosed,
          closeoutsConsidered: newestUsableFacts.closeoutsConsidered,
          closeoutsUsable: newestUsableFacts.closeoutsUsable,
          latestCloseout: newestUsableFacts.latestCloseout,
          strictOpen: newestUsableFacts.strictOpen,
        }
      : null;

  const summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary = {
    indexesSupplied: window.indexesSupplied,
    indexesConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    indexesUsable: usableVerdicts.length,
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
    trendClass: deriveTrendClass(usableVerdicts.length, indexesUnreadable, indexesTampered, indexVerdictCounts, newest, direction),
  };

  return { points, summary, usableVerdicts };
}

/* ------------------------------------------------------------------ *
 *  The composite trend fold (latest-focused + history thresholds + ordered arc)
 * ------------------------------------------------------------------ */

/**
 * Derive the closed set of reason conditions that fired, in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS}
 * order. Each reduces to a bounded, deterministic predicate over the already content-free summary + the policy thresholds;
 * the per-id severity is authored in
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL}.
 * This is the STRICT-INDEPENDENT reason set (a `--strict-open` escalation is applied afterward in {@link computeTrendRollup}).
 */
export function deriveTrendReasons(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[] {
  const c = summary.indexVerdictCounts;
  const usable = summary.indexesUsable;
  const newest = summary.newest;
  const blockedCount = c["blocked"] + c["invalid"];
  // "Older" = the window EXCLUDING the latest usable window. The latest is never tolerated by a threshold (its own
  // reason always fires); only the OLDER windows are counted against `--max-open` / `--max-incomplete`.
  const olderOpen = c["open"] - (newest === "open" ? 1 : 0);
  const olderIncomplete = c["incomplete"] - (newest === "incomplete" ? 1 : 0);
  const fired: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId, boolean> = {
    // Invalid input — a window can't be trusted (TOP precedence).
    "index-unreadable": summary.indexesUnreadable > 0,
    "index-tampered": summary.indexesTampered > 0,
    // Blocking — a closeout history was not / must not be trusted.
    "latest-blocked": newest === "blocked" || newest === "invalid",
    "blocked-threshold-exceeded": blockedCount > policy.maxBlocked,
    "strict-open-escalation": false, // applied by the rollup after the base verdict is known
    // Insufficient — the history is inconclusive.
    "no-indexes": usable === 0,
    "latest-incomplete": newest === "incomplete",
    "incomplete-threshold-exceeded": olderIncomplete > policy.maxIncomplete,
    // Advisory — a worsening arc or a standing open concern.
    "latest-open": newest === "open",
    "open-threshold-exceeded": olderOpen > policy.maxOpen,
    "trend-degrading": summary.direction === "degrading",
    "require-latest-miss": policy.requireLatestAllClosed && usable > 0 && newest !== "all-closed",
    // Informational — a benign trend marker.
    "latest-all-closed": newest === "all-closed",
    "trend-improving": summary.direction === "improving",
    "history-coherent":
      usable > 0 && c["all-closed"] === usable && summary.indexesUnreadable === 0 && summary.indexesTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS.filter(
    (id) => fired[id],
  );
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildTrendReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_IDS.filter(
    (id) => fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_REASON_DETAIL[id].detail,
  }));
}

/**
 * Resolve the composite trend verdict from the fired reasons + the arc direction + the latest verdict. Fail-closed
 * precedence `invalid > blocking > insufficient`, then the directional band (`degrading` if the latest is open or the arc
 * degraded; `watch` if an open posture exceeds the threshold; `improving` if the arc recovered; else `stable`).
 */
function resolveVerdict(
  fired: ReadonlySet<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReasonId>,
  direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendDirection,
  newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict | null,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict {
  const invalidInput = fired.has("index-unreadable") || fired.has("index-tampered");
  const blocking =
    fired.has("latest-blocked") || fired.has("blocked-threshold-exceeded") || fired.has("strict-open-escalation");
  const insufficient =
    fired.has("no-indexes") || fired.has("latest-incomplete") || fired.has("incomplete-threshold-exceeded");
  if (invalidInput) return "invalid";
  if (blocking) return "blocked";
  if (insufficient) return "insufficient";
  // ≥1 usable window, latest ∈ {all-closed, open}, no blocked / invalid window over threshold, no untrustworthy input,
  // no incomplete latest / breach.
  if (newest === "open" || direction === "degrading") return "degrading";
  // latest === "all-closed" now (incomplete → insufficient; blocked / invalid → blocked above).
  if (direction === "improving") return "improving";
  // direction stable / mixed / unknown, latest all-closed: a residual open past the open threshold is a watch.
  return fired.has("open-threshold-exceeded") ? "watch" : "stable";
}

/**
 * Compute the composite trend verdict from the reduced summary under the policy.
 *
 * Fail-closed precedence refined by the arc direction (see {@link resolveVerdict}). When `--strict-open` escalated a base
 * `watch` / `degrading` / `insufficient` trend to `blocked`, `strictOpenEscalated` is set and `strictOpenEscalatedFrom`
 * records the verdict the trend would have been without the flag, so the summary explains it. A base `blocked` / `invalid`
 * / `improving` / `stable` verdict is untouched by `--strict-open` (the invalid precedence is never weakened, and a clean
 * trend is never escalated).
 */
export function computeTrendRollup(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendSummary,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendRollup;
  reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendReason[];
} {
  const baseFired = deriveTrendReasons(summary, policy);
  const baseVerdict = resolveVerdict(new Set(baseFired), summary.direction, summary.newest);

  // `--strict-open` escalates any non-stable / non-improving USABLE trend — watch / degrading / insufficient — to a hard
  // block, UNLESS the base is already blocked / invalid (a stronger posture) or clean (stable / improving). This satisfies
  // the mission's "strict-open escalates watch / degrading / insufficient to blocked, never weakening invalid / blocked".
  const strictOpenEscalated =
    policy.strictOpen &&
    (baseVerdict === "watch" || baseVerdict === "degrading" || baseVerdict === "insufficient");
  const firedIds = strictOpenEscalated ? [...baseFired, "strict-open-escalation" as const] : baseFired;
  const reasons = buildTrendReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = resolveVerdict(new Set(orderedIds), summary.direction, summary.newest);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const strictOpenEscalatedFrom = strictOpenEscalated
    ? (baseVerdict as "watch" | "degrading" | "insufficient")
    : null;
  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_EXIT_FOR_VERDICT[verdict],
    clean: verdict === "stable" || verdict === "improving",
    latest: summary.newest,
    reasons: orderedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    informational,
    direction: summary.direction,
    trendClass: summary.trendClass,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom,
    requireLatestAllClosed: policy.requireLatestAllClosed,
    detail,
  };
  return { rollup, reasons };
}
