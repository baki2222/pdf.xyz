/**
 * Pure, node-free **reducer** for the release decision index trend summary (Phase 61).
 *
 * Turns the ingested windows (the trust boundary's output, oldest → newest) into the bounded, content-free sequence
 * the result records and the rollup folds. It:
 *  - applies the `--max-windows` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced),
 *    so the trend is over a bounded history;
 *  - reduces each considered window to a bounded {@link ReleaseDecisionTrendPoint} (a position, a coverage state, the
 *    trusted-or-claimed index verdict, a severity, the window's record count, an authored headline);
 *  - summarizes the window history into a bounded {@link ReleaseDecisionTrendSummary} (the per-window index-verdict
 *    distribution + the aggregate decision distribution over the usable windows, the newest / oldest usable verdict,
 *    the arc direction, and the single coarse trend class).
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator
 * or a byte to enter — not even an ingested window's own stamp (the trend carries only its own).
 */

import type { IngestedDecisionIndex } from "./ingest";
import {
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_INDEX_VERDICTS,
  WINDOW_VERDICT_RANK,
  WINDOW_VERDICT_SEVERITY,
  type DecisionIndexFacts,
  type ReleaseDecisionDecision,
  type ReleaseDecisionIndexVerdict,
  type ReleaseDecisionTrendClass,
  type ReleaseDecisionTrendDirection,
  type ReleaseDecisionTrendPoint,
  type ReleaseDecisionTrendSeverity,
  type ReleaseDecisionTrendSummary,
  type ReleaseDecisionTrendWindowState,
} from "./types";

/** The coverage state of one supplied window from its recognized / usable flags. */
export function pointState(recognized: boolean, usable: boolean): ReleaseDecisionTrendWindowState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + index verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionTrendWindowState,
  verdict: ReleaseDecisionIndexVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision index (unreadable — never echoed). It contributes no trend evidence (an untrustworthy input).`;
    case "tampered":
      return `#${n}: recognized, but its recorded index verdict / counts do NOT re-derive from its own ledger + sequence (tampered / corrupt — treated as an untrustworthy input). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision index).`;
  }
}

/** Reduce one ingested window at `position` (oldest = 0) to the bounded {@link ReleaseDecisionTrendPoint}. */
export function reduceWindow(position: number, ingested: IngestedDecisionIndex): ReleaseDecisionTrendPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const severity: ReleaseDecisionTrendSeverity | null =
    state === "usable" && verdict !== null ? WINDOW_VERDICT_SEVERITY[verdict] : null;
  const recordsConsidered = state === "usable" && ingested.facts !== null ? ingested.facts.recordsConsidered : 0;
  return {
    position,
    state,
    verdict,
    severity,
    recordsConsidered,
    detail: pointDetail(position, state, verdict),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) windows + how many older ones were dropped. */
export interface WindowedHistory {
  /** The windows considered by the trend, oldest → newest (the newest `maxWindows`). */
  readonly considered: readonly IngestedDecisionIndex[];
  /** How many window inputs were supplied (before the cap). */
  readonly windowsSupplied: number;
  /** True iff the cap dropped older windows. */
  readonly truncated: boolean;
  /** How many older windows were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-windows` window cap to the supplied windows (oldest → newest): keep the NEWEST `maxWindows`, drop
 * older ones, and surface how many were dropped (never a silent truncation). A `maxWindows` of 0 or less is treated as
 * "no windows considered" (an empty, insufficient history).
 */
export function applyWindow(list: readonly IngestedDecisionIndex[], maxWindows: number): WindowedHistory {
  const cap = Number.isSafeInteger(maxWindows) && maxWindows > 0 ? maxWindows : 0;
  const considered = cap >= list.length ? list : list.slice(list.length - cap);
  const droppedOldest = list.length - considered.length;
  return {
    considered,
    windowsSupplied: list.length,
    truncated: droppedOldest > 0,
    droppedOldest,
  };
}

/** Zeroed per-window index-verdict counts (all five keys present) — the deterministic base for the histogram. */
function zeroVerdictCounts(): Record<ReleaseDecisionIndexVerdict, number> {
  const counts = {} as Record<ReleaseDecisionIndexVerdict, number>;
  for (const v of RELEASE_DECISION_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/** Zeroed aggregate decision counts (all six keys present) — the deterministic base for the aggregate distribution. */
function zeroDecisionCounts(): Record<ReleaseDecisionDecision, number> {
  const counts = {} as Record<ReleaseDecisionDecision, number>;
  for (const d of RELEASE_DECISION_DECISIONS) counts[d] = 0;
  return counts;
}

/** The bounded arc from the oldest usable window to the newest, by index verdict rank. */
export function directionOf(
  usable: readonly ReleaseDecisionIndexVerdict[],
): ReleaseDecisionTrendDirection {
  if (usable.length < 2) return "unknown";
  const oldestRank = WINDOW_VERDICT_RANK[usable[0] as ReleaseDecisionIndexVerdict];
  const newestRank = WINDOW_VERDICT_RANK[usable[usable.length - 1] as ReleaseDecisionIndexVerdict];
  if (newestRank > oldestRank) return "degrading";
  if (newestRank < oldestRank) return "improving";
  return "flat";
}

/** True iff the newest usable window recorded more of `decision` than the oldest usable window (a rising pressure). */
function roseAcross(
  usableFacts: readonly DecisionIndexFacts[],
  decision: ReleaseDecisionDecision,
): boolean {
  if (usableFacts.length < 2) return false;
  const oldest = usableFacts[0] as DecisionIndexFacts;
  const newest = usableFacts[usableFacts.length - 1] as DecisionIndexFacts;
  return newest.decisionCounts[decision] > oldest.decisionCounts[decision];
}

/** The inputs the coarse trend-class derivation folds (all already bounded / content-free). */
interface TrendClassInputs {
  readonly windowsUnreadable: number;
  readonly windowsTampered: number;
  readonly windowsUsable: number;
  readonly onlyInsufficient: boolean;
  readonly verdictCounts: Readonly<Record<ReleaseDecisionIndexVerdict, number>>;
  readonly decisionCounts: Readonly<Record<ReleaseDecisionDecision, number>>;
  readonly direction: ReleaseDecisionTrendDirection;
  readonly holdRose: boolean;
  readonly followupRose: boolean;
}

/**
 * The single coarse trend class of the history, by worst-present + cross-window pressure (strict-INDEPENDENT), in the
 * precedence documented on {@link ReleaseDecisionTrendClass}: `invalid-input > rejection-present >
 * insufficient-evidence > hold-rising > followup-rising > improving > stable-watch > all-clear`.
 */
export function deriveTrendClass(p: TrendClassInputs): ReleaseDecisionTrendClass {
  if (p.windowsUnreadable + p.windowsTampered > 0) return "invalid-input";
  if (
    p.verdictCounts.blocked > 0 ||
    p.verdictCounts.invalid > 0 ||
    p.decisionCounts.reject > 0 ||
    p.decisionCounts.invalid > 0
  ) {
    return "rejection-present";
  }
  if (p.windowsUsable === 0 || p.onlyInsufficient) return "insufficient-evidence";
  if (p.holdRose) return "hold-rising";
  if (p.followupRose) return "followup-rising";
  if (p.direction === "improving") return "improving";
  if (
    p.verdictCounts.watch > 0 ||
    p.verdictCounts.insufficient > 0 ||
    p.decisionCounts.hold > 0 ||
    p.decisionCounts["proceed-with-followup"] > 0
  ) {
    return "stable-watch";
  }
  return "all-clear";
}

/** The reduced trend sequence + its bounded summary + the trusted usable-window verdict sequence + usable facts. */
export interface ReducedTrend {
  /** One reduced point per considered window, oldest → newest. */
  readonly points: readonly ReleaseDecisionTrendPoint[];
  /** The bounded history summary. */
  readonly summary: ReleaseDecisionTrendSummary;
  /** The usable windows' index verdicts, oldest → newest (trusted) — what the rollup folds. */
  readonly usableVerdicts: readonly ReleaseDecisionIndexVerdict[];
}

/**
 * Reduce the supplied windows (oldest → newest) into the bounded points + summary, under the window cap. The counts /
 * newest / oldest / direction / class are over the USABLE considered windows only (an unreadable / tampered window
 * contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceTrend(list: readonly IngestedDecisionIndex[], maxWindows: number): ReducedTrend {
  const window = applyWindow(list, maxWindows);
  const points = window.considered.map((ingested, i) => reduceWindow(i, ingested));

  const usableVerdicts: ReleaseDecisionIndexVerdict[] = [];
  const usableFacts: DecisionIndexFacts[] = [];
  const verdictCounts = zeroVerdictCounts();
  const decisionCounts = zeroDecisionCounts();
  let windowsUnreadable = 0;
  let windowsTampered = 0;
  let totalRecords = 0;
  let totalUsableRecords = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i] as ReleaseDecisionTrendPoint;
    const ingested = window.considered[i] as IngestedDecisionIndex;
    if (point.state === "usable" && point.verdict !== null && ingested.facts !== null) {
      const facts = ingested.facts;
      usableVerdicts.push(point.verdict);
      usableFacts.push(facts);
      verdictCounts[point.verdict] += 1;
      totalRecords += facts.recordsConsidered;
      totalUsableRecords += facts.recordsUsable;
      for (const d of RELEASE_DECISION_DECISIONS) decisionCounts[d] += facts.decisionCounts[d];
    } else if (point.state === "unreadable") {
      windowsUnreadable += 1;
    } else if (point.state === "tampered") {
      windowsTampered += 1;
    }
  }

  const newest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionIndexVerdict)
      : null;
  const oldest = usableVerdicts.length > 0 ? (usableVerdicts[0] as ReleaseDecisionIndexVerdict) : null;
  const direction = directionOf(usableVerdicts);
  const onlyInsufficient =
    usableVerdicts.length > 0 && verdictCounts.insufficient === usableVerdicts.length;

  const trendClass = deriveTrendClass({
    windowsUnreadable,
    windowsTampered,
    windowsUsable: usableVerdicts.length,
    onlyInsufficient,
    verdictCounts,
    decisionCounts,
    direction,
    holdRose: roseAcross(usableFacts, "hold"),
    followupRose: roseAcross(usableFacts, "proceed-with-followup"),
  });

  const summary: ReleaseDecisionTrendSummary = {
    windowsSupplied: window.windowsSupplied,
    windowsConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    windowsUsable: usableVerdicts.length,
    windowsUnreadable,
    windowsTampered,
    windowVerdictCounts: verdictCounts,
    totalRecords,
    totalUsableRecords,
    decisionCounts,
    newest,
    oldest,
    direction,
    trendClass,
  };

  return { points, summary, usableVerdicts };
}
