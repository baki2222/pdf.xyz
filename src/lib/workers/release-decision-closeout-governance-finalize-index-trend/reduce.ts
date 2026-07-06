/**
 * Pure, node-free **reducer + fold** for the release decision closeout governance finalize index trend (Phase 76).
 *
 * Turns the ingested windows (the trust boundary's output, oldest → newest) into the bounded, content-free sequence the
 * result records AND folds them into the ONE composite trend verdict a governance review acts on. It:
 *  - applies the `--max-windows` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced);
 *  - reduces each considered window to a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint} (a
 *    position, a coverage state, the trusted-or-claimed index verdict, the window's own latest finalization verdict, a
 *    severity, its finalization count, an authored headline);
 *  - summarizes the history into a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary} (the
 *    per-window index-verdict distribution + the aggregate finalization distribution over the usable windows, the newest
 *    / oldest usable verdict, the newest-usable-window summary, the arc direction, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId} conditions that fired
 *    and resolves the composite {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict} with fail-closed
 *    precedence `invalid > blocking > insufficient`, then the directional band (`degrading` / `improving` / `watch` /
 *    `stable`), with the LATEST usable window as the primary driver and the ordered arc as the refinement.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator or
 * a byte to enter — not even an ingested window's own stamp (the trend carries only its own).
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  WINDOW_VERDICT_RANK,
  WINDOW_VERDICT_SEVERITY,
  type FinalizeIndexFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendLatest,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendWindowState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "./types";
import type { IngestedFinalizeIndex } from "./ingest";

/** The coverage state of one supplied window from its recognized / usable flags. */
export function pointState(
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendWindowState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + index verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendWindowState,
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision closeout governance finalize index (unreadable — never echoed). It contributes no trend evidence (an untrustworthy input).`;
    case "tampered":
      return `#${n}: recognized, but its recorded index verdict / counts do NOT re-derive from its own coverage + distribution + sequence (tampered / corrupt — treated as an untrustworthy input). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision closeout governance finalize index).`;
  }
}

/**
 * Reduce one ingested window at `position` (oldest = 0) to the bounded
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint}.
 */
export function reduceWindow(
  position: number,
  ingested: IngestedFinalizeIndex,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSeverity | null =
    state === "usable" && verdict !== null ? WINDOW_VERDICT_SEVERITY[verdict] : null;
  return {
    position,
    state,
    verdict,
    latestFinalization: facts ? facts.latestFinalization : null,
    severity,
    finalizationsConsidered: facts ? facts.finalizationsConsidered : 0,
    detail: pointDetail(position, state, verdict),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) windows + how many older ones were dropped. */
export interface WindowedHistory {
  /** The windows considered by the trend, oldest → newest (the newest `maxWindows`). */
  readonly considered: readonly IngestedFinalizeIndex[];
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
export function applyWindow(list: readonly IngestedFinalizeIndex[], maxWindows: number): WindowedHistory {
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
function zeroWindowVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS) counts[v] = 0;
  return counts;
}

/** Zeroed aggregate finalization-verdict counts (all four keys present) — the deterministic base for the distribution. */
function zeroFinalizationVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * The bounded arc from the OLDEST usable window to the NEWEST, by index verdict rank over the whole ordered sequence:
 * `unknown` (< 2 usable), `stable` (all ranks equal), `improving` (newest cleaner than oldest AND monotonically
 * non-worsening), `degrading` (newest worse than oldest AND monotonically non-improving), else `mixed` (non-monotonic).
 */
export function directionOf(
  usable: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection {
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
 * The single coarse trend class of the history, by worst-present + arc (strict-INDEPENDENT), in the precedence
 * documented on {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass}: `invalid > blocked > insufficient >
 * regressing > recovering > clean`.
 */
export function deriveTrendClass(
  windowsUsable: number,
  windowsUnreadable: number,
  windowsTampered: number,
  counts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict, number>>,
  newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null,
  direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass {
  if (windowsUnreadable > 0 || windowsTampered > 0) return "invalid";
  if (counts["index-blocked"] > 0 || counts["index-invalid"] > 0) return "blocked";
  const onlyIncomplete = windowsUsable > 0 && counts["index-incomplete"] === windowsUsable;
  if (windowsUsable === 0 || onlyIncomplete || newest === "index-incomplete") return "insufficient";
  if (newest === "index-open" || direction === "degrading") return "regressing";
  const olderNonIndexed = counts["index-open"] + counts["index-incomplete"] > 0;
  if (newest === "indexed" && (olderNonIndexed || direction === "improving")) return "recovering";
  return "clean";
}

/** The reduced trend sequence + its bounded summary + the trusted usable-window verdict sequence. */
export interface ReducedTrend {
  /** One reduced point per considered window, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint[];
  /** The bounded history summary. */
  readonly summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary;
  /** The usable windows' index verdicts, oldest → newest (trusted) — what the fold keys on. */
  readonly usableVerdicts: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict[];
}

/**
 * Reduce the supplied windows (oldest → newest) into the bounded points + summary, under the window cap. The counts /
 * newest / oldest / direction / class / latest are over the USABLE considered windows only (an unreadable / tampered
 * window contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceTrend(list: readonly IngestedFinalizeIndex[], maxWindows: number): ReducedTrend {
  const window = applyWindow(list, maxWindows);
  const points = window.considered.map((ingested, i) => reduceWindow(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict[] = [];
  const windowVerdictCounts = zeroWindowVerdictCounts();
  const finalizationVerdictCounts = zeroFinalizationVerdictCounts();
  let windowsUnreadable = 0;
  let windowsTampered = 0;
  let totalFinalizations = 0;
  let totalUsableFinalizations = 0;
  // The newest usable ingested window's facts (for the `latest` summary object).
  let newestUsableFacts: FinalizeIndexFacts | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPoint;
    const ingested = window.considered[i] as IngestedFinalizeIndex;
    if (point.state === "usable" && point.verdict !== null && ingested.facts !== null) {
      const facts = ingested.facts;
      usableVerdicts.push(point.verdict);
      windowVerdictCounts[point.verdict] += 1;
      totalFinalizations += facts.finalizationsConsidered;
      totalUsableFinalizations += facts.finalizationsUsable;
      for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) {
        finalizationVerdictCounts[v] += facts.finalizationVerdictCounts[v];
      }
      newestUsableFacts = facts;
    } else if (point.state === "unreadable") {
      windowsUnreadable += 1;
    } else if (point.state === "tampered") {
      windowsTampered += 1;
    }
  }

  const newest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict)
      : null;
  const oldest =
    usableVerdicts.length > 0 ? (usableVerdicts[0] as ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict) : null;
  const direction = directionOf(usableVerdicts);

  const latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendLatest | null =
    newestUsableFacts !== null
      ? {
          verdict: newestUsableFacts.verdict,
          indexed: newestUsableFacts.indexed,
          finalizationsConsidered: newestUsableFacts.finalizationsConsidered,
          finalizationsUsable: newestUsableFacts.finalizationsUsable,
          latestFinalization: newestUsableFacts.latestFinalization,
          strictOpen: newestUsableFacts.strictOpen,
        }
      : null;

  const summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary = {
    windowsSupplied: window.windowsSupplied,
    windowsConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    windowsUsable: usableVerdicts.length,
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
    trendClass: deriveTrendClass(
      usableVerdicts.length,
      windowsUnreadable,
      windowsTampered,
      windowVerdictCounts,
      newest,
      direction,
    ),
  };

  return { points, summary, usableVerdicts };
}

/* ------------------------------------------------------------------ *
 *  The composite trend fold (latest-focused + ordered arc)
 * ------------------------------------------------------------------ */

/**
 * Derive the closed set of reason conditions that fired, in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_IDS} order. Each reduces to a bounded,
 * deterministic predicate over the already content-free summary + the policy; the per-id severity is authored in
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_DETAIL}. This is the STRICT-INDEPENDENT reason
 * set (a `--strict-open` escalation is applied afterward in {@link computeTrendRollup}).
 */
export function deriveTrendReasons(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId[] {
  const c = summary.windowVerdictCounts;
  const usable = summary.windowsUsable;
  const newest = summary.newest;
  const onlyIncomplete = usable > 0 && c["index-incomplete"] === usable;
  const fired: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId, boolean> = {
    // Invalid input — a window can't be trusted (TOP precedence).
    "window-unreadable": summary.windowsUnreadable > 0,
    "window-tampered": summary.windowsTampered > 0,
    // Blocking — a finalization history was not / must not be trusted.
    "window-index-blocked": c["index-blocked"] > 0,
    "window-index-invalid": c["index-invalid"] > 0,
    "strict-open-escalation": false, // applied by the rollup after the base verdict is known
    // Insufficient — the history is inconclusive.
    "no-usable-windows": usable === 0,
    "latest-incomplete": newest === "index-incomplete",
    "only-incomplete": onlyIncomplete,
    // Advisory — a worsening arc or a standing concern.
    "latest-open": newest === "index-open",
    "trend-degrading": summary.direction === "degrading",
    "window-open": c["index-open"] > 0,
    "window-incomplete": c["index-incomplete"] > 0 && !onlyIncomplete && newest !== "index-incomplete",
    "require-latest-miss": policy.requireLatestIndexed && usable > 0 && newest !== "indexed",
    // Informational — a benign trend marker.
    "latest-indexed": newest === "indexed",
    "trend-improving": summary.direction === "improving",
    "history-coherent":
      usable > 0 && c.indexed === usable && summary.windowsUnreadable === 0 && summary.windowsTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildTrendReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_IDS.filter((id) => fired.includes(id)).map(
    (id) => ({
      id,
      severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_DETAIL[id].severity,
      detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_REASON_DETAIL[id].detail,
    }),
  );
}

/**
 * Resolve the composite trend verdict from the fired reasons + the arc direction + the latest verdict. Fail-closed
 * precedence `invalid > blocked > insufficient`, then the directional band (`degrading` / `improving` / `watch` /
 * `stable`).
 */
function resolveVerdict(
  fired: ReadonlySet<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReasonId>,
  direction: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendDirection,
  newest: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict | null,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict {
  const invalidInput = fired.has("window-unreadable") || fired.has("window-tampered");
  const blocking =
    fired.has("window-index-blocked") || fired.has("window-index-invalid") || fired.has("strict-open-escalation");
  const insufficient =
    fired.has("no-usable-windows") || fired.has("latest-incomplete") || fired.has("only-incomplete");
  if (invalidInput) return "invalid";
  if (blocking) return "blocked";
  if (insufficient) return "insufficient";
  // ≥1 usable window, latest ∈ {indexed, index-open}, no blocked / invalid usable window, no untrustworthy input.
  if (newest === "index-open" || direction === "degrading") return "degrading";
  // latest === "indexed" now (index-incomplete → insufficient; index-blocked / index-invalid → blocked above).
  if (direction === "improving") return "improving";
  // direction stable / mixed / unknown, latest indexed.
  const advisory =
    fired.has("window-open") ||
    fired.has("window-incomplete") ||
    fired.has("require-latest-miss") ||
    fired.has("trend-degrading");
  return advisory ? "watch" : "stable";
}

/**
 * Compute the composite trend verdict from the reduced summary under the policy.
 *
 * Fail-closed precedence refined by the arc direction (see {@link resolveVerdict}). When `--strict-open` escalated a
 * non-indexed usable window to `blocked` AND that escalation is the only blocker, `strictOpenEscalated` is set and
 * `strictOpenEscalatedFrom` records the verdict the trend would have been without the flag, so the summary explains it.
 * A base `blocked` / `invalid` verdict is untouched by `--strict-open` (invalid precedence is never weakened).
 */
export function computeTrendRollup(
  summary: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendSummary,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendRollup;
  reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendReason[];
} {
  const baseFired = deriveTrendReasons(summary, policy);
  const baseVerdict = resolveVerdict(new Set(baseFired), summary.direction, summary.newest);

  // `--strict-open` escalates when a non-indexed usable window is present, UNLESS the base is already blocked / invalid
  // (a stronger posture). This satisfies "any non-indexed usable window escalates to blocked without weakening invalid".
  const anyNonIndexed = summary.windowsUsable > 0 && summary.windowVerdictCounts.indexed < summary.windowsUsable;
  const strictOpenEscalated =
    policy.strictOpen && anyNonIndexed && baseVerdict !== "blocked" && baseVerdict !== "invalid";
  const firedIds = strictOpenEscalated ? [...baseFired, "strict-open-escalation" as const] : baseFired;
  const reasons = buildTrendReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = resolveVerdict(new Set(orderedIds), summary.direction, summary.newest);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const strictOpenEscalatedFrom = strictOpenEscalated ? baseVerdict : null;
  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_EXIT_FOR_VERDICT[verdict],
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
    requireLatestIndexed: policy.requireLatestIndexed,
    detail,
  };
  return { rollup, reasons };
}
