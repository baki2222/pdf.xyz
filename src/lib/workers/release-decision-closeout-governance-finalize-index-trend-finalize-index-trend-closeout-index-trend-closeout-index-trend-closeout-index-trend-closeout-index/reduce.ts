/**
 * Pure, node-free **reducer + fold** for the release decision closeout governance finalize index trend finalize index
 * trend closeout INDEX (Phase 90).
 *
 * Turns the ingested closeout records (the trust boundary's output, oldest → newest) into the bounded, content-free
 * sequence the result records AND folds them into the ONE composite index verdict a review acts on. It:
 *  - applies the `--max-closeouts` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced);
 *  - reduces each considered record to a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPoint}
 *    (a position, a coverage state, the trusted-or-claimed closeout verdict, the receipt state / verdict / plan class, a
 *    severity, an authored headline);
 *  - summarizes the window into a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage} +
 *    {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution} + newest-record
 *    {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexLatest} (the closeout-verdict histogram over
 *    the usable records, the newest / oldest usable verdict, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId} conditions
 *    that fired and resolves the composite {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict}
 *    with fail-closed severity precedence `invalid > blocking > open > incomplete > informational`, with the LATEST usable
 *    record as the primary driver and the bounded history thresholds as a secondary escalation.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator or a
 * byte to enter — not even an ingested record's own stamp (the index carries only its own).
 */

import {
  CLOSEOUT_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexLatest,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPoint,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "./types";
import type { IngestedCloseout } from "./ingest";

/** The coverage state of one supplied record from its recognized / usable flags. */
export function pointState(
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRecordState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRecordState,
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision closeout governance finalize-index-trend closeout record (unreadable — never echoed). It is an untrustworthy input (fails closed to INVALID).`;
    case "tampered":
      return `#${n}: recognized, but its recorded closeout coverage rollup does NOT re-derive from its own recorded facets (tampered / corrupt — an untrustworthy input, fails closed to INVALID). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision closeout governance finalize-index-trend closeout record).`;
  }
}

/**
 * Reduce one ingested record at `position` (oldest = 0) to the bounded
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPoint}.
 */
export function reduceRecord(
  position: number,
  ingested: IngestedCloseout,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexSeverity | null =
    state === "usable" && verdict !== null ? CLOSEOUT_VERDICT_SEVERITY[verdict] : null;
  return {
    position,
    state,
    verdict,
    receiptState: facts ? facts.receiptState : null,
    receiptVerdict: facts ? facts.receiptVerdict : null,
    planClass: facts ? facts.planClass : null,
    severity,
    detail: pointDetail(position, state, verdict),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) records + how many older ones were dropped. */
export interface WindowedCloseout {
  /** The records considered by the index, oldest → newest (the newest `maxCloseouts`). */
  readonly considered: readonly IngestedCloseout[];
  /** How many closeout inputs were supplied (before the cap). */
  readonly closeoutsSupplied: number;
  /** True iff the cap dropped older records. */
  readonly truncated: boolean;
  /** How many older records were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-closeouts` window cap to the supplied records (oldest → newest): keep the NEWEST `maxCloseouts`, drop
 * older ones, and surface how many were dropped (never a silent truncation). A `maxCloseouts` of 0 or less is treated as
 * "no records considered" (an empty, inconclusive window).
 */
export function applyWindow(list: readonly IngestedCloseout[], maxCloseouts: number): WindowedCloseout {
  const cap = Number.isSafeInteger(maxCloseouts) && maxCloseouts > 0 ? maxCloseouts : 0;
  const considered = cap >= list.length ? list : list.slice(list.length - cap);
  const droppedOldest = list.length - considered.length;
  return {
    considered,
    closeoutsSupplied: list.length,
    truncated: droppedOldest > 0,
    droppedOldest,
  };
}

/** Zeroed closeout-verdict counts (all five keys present) — the deterministic base for the histogram. */
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * The single coarse trend class of the window, by worst-present (strict-INDEPENDENT), with severity precedence
 * `invalid (tampered OR unreadable) > blocked > open > incomplete > all-closed`, and `no-usable` when the window has zero
 * usable records and no other signal.
 */
export function deriveTrendClass(
  closeoutsUsable: number,
  closeoutsUnreadable: number,
  closeoutsTampered: number,
  counts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict, number>>,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendClass {
  if (closeoutsTampered > 0 || closeoutsUnreadable > 0 || counts.invalid > 0) return "invalid-present";
  if (counts.blocked > 0) return "blocked-present";
  if (counts.open > 0) return "open-present";
  if (counts.incomplete > 0) return "incomplete-present";
  if (closeoutsUsable === 0) return "no-usable";
  return "all-closed";
}

/** The reduced index sequence + its bounded coverage / distribution summaries + the newest usable record summary. */
export interface ReducedCloseoutIndex {
  /** One reduced point per considered record, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPoint[];
  /** The bounded coverage summary. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage;
  /** The bounded closeout-verdict distribution over the usable records. */
  readonly distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution;
  /** The bounded summary of the newest usable record, or `null` if none is usable — what the fold keys on. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexLatest | null;
}

/**
 * Reduce the supplied records (oldest → newest) into the bounded points + coverage + distribution + latest summary, under
 * the window cap. The counts / newest / oldest / trend class are over the USABLE considered records only (an unreadable /
 * tampered record contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceIndex(list: readonly IngestedCloseout[], maxCloseouts: number): ReducedCloseoutIndex {
  const window = applyWindow(list, maxCloseouts);
  const points = window.considered.map((ingested, i) => reduceRecord(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict[] = [];
  const verdictCounts = zeroVerdictCounts();
  let closeoutsUnreadable = 0;
  let closeoutsTampered = 0;
  // The newest usable ingested record's facts (for the `latest` summary object).
  let newestUsable: IngestedCloseout | null = null;
  for (const ingested of window.considered) {
    const state = pointState(ingested.recognized, ingested.usable);
    if (state === "usable" && ingested.verdict !== null) {
      usableVerdicts.push(ingested.verdict);
      verdictCounts[ingested.verdict] += 1;
      newestUsable = ingested;
    } else if (state === "unreadable") {
      closeoutsUnreadable += 1;
    } else if (state === "tampered") {
      closeoutsTampered += 1;
    }
  }

  const newest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict)
      : null;
  const oldest =
    usableVerdicts.length > 0
      ? (usableVerdicts[0] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict)
      : null;

  const coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage = {
    closeoutsSupplied: window.closeoutsSupplied,
    closeoutsConsidered: window.considered.length,
    closeoutsUsable: usableVerdicts.length,
    closeoutsUnreadable,
    closeoutsTampered,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
  };

  const distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution = {
    verdictCounts,
    newest,
    oldest,
    trendClass: deriveTrendClass(usableVerdicts.length, closeoutsUnreadable, closeoutsTampered, verdictCounts),
  };

  const latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexLatest | null =
    newestUsable !== null && newestUsable.facts !== null
      ? {
          verdict: newestUsable.facts.verdict,
          receiptState: newestUsable.facts.receiptState,
          receiptVerdict: newestUsable.facts.receiptVerdict,
          planClass: newestUsable.facts.planClass,
          relatedSupplied: newestUsable.facts.relatedSupplied,
          relatedContradictory: newestUsable.facts.relatedContradictory,
          relatedBlocking: newestUsable.facts.relatedBlocking,
          strictOpen: newestUsable.facts.strictOpen,
        }
      : null;

  return { points, coverage, distribution, latest };
}

/* ------------------------------------------------------------------ *
 *  The composite index fold (latest-focused + history thresholds)
 * ------------------------------------------------------------------ */

/**
 * Derive the closed set of reason conditions that fired, in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS} order.
 * Each reduces to a bounded, deterministic predicate over the already content-free coverage + distribution summary + the
 * latest usable verdict + the policy thresholds; the per-id severity is authored in
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL}.
 * This is the STRICT-INDEPENDENT reason set (a `--strict-open` escalation is applied afterward in
 * {@link computeCloseoutIndexRollup}).
 */
export function deriveIndexReasons(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId[] {
  const c = distribution.verdictCounts;
  const latest = distribution.newest;
  // "Older" = the window EXCLUDING the latest usable record. The latest is never tolerated by a threshold (its own
  // reason always fires); only the older records are counted against `--max-open` / `--max-incomplete`.
  const olderOpen = c.open - (latest === "open" ? 1 : 0);
  const olderIncomplete = c.incomplete - (latest === "incomplete" ? 1 : 0);
  const fired: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId, boolean> = {
    // Invalid — an untrustworthy input OR nothing trustworthy to index (TOP precedence).
    "closeout-tampered": coverage.closeoutsTampered > 0,
    "closeout-unreadable": coverage.closeoutsUnreadable > 0,
    "no-closeouts": coverage.closeoutsUsable === 0,
    "invalid-in-history": c.invalid > 0,
    // Blocking — a blocked history (any blocked closeout; never threshold-tolerated).
    "latest-blocked": latest === "blocked",
    "blocked-in-history": c.blocked > 0,
    "strict-open-escalation": false, // applied by the rollup after the base verdict is known
    // Open — an advisory follow-up posture remains open.
    "latest-open": latest === "open",
    "open-threshold-exceeded": olderOpen > policy.maxOpen,
    // Incomplete — a coverage gap.
    "latest-incomplete": latest === "incomplete",
    "incomplete-threshold-exceeded": olderIncomplete > policy.maxIncomplete,
    // Informational — a benign index marker.
    "latest-closed": latest === "closed",
    "history-coherent":
      coverage.closeoutsUsable > 0 &&
      c.closed === coverage.closeoutsUsable &&
      coverage.closeoutsUnreadable === 0 &&
      coverage.closeoutsTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS.filter(
    (id) => fired[id],
  );
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildIndexReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS.filter(
    (id) => fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL[id].detail,
  }));
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > open > incomplete). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict {
  const severities = fired.map(
    (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL[id].severity,
  );
  if (severities.includes("invalid")) return "invalid";
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("open")) return "open";
  if (severities.includes("incomplete")) return "incomplete";
  return "all-closed";
}

/**
 * Compute the composite index verdict from the reduced coverage + distribution under the policy.
 *
 * Fail-closed precedence: any invalid reason (a tampered / unreadable record) ⇒ `invalid`; else any blocking reason
 * ⇒ `blocked`; else any open reason ⇒ `open`; else any incomplete reason ⇒ `incomplete`; else
 * `all-closed`. When `--strict-open` is set and an open closeout is present in the considered history (and the base verdict
 * is not already blocked / invalid), the index escalates to `blocked` via a `strict-open-escalation` reason;
 * `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the base verdict it would have been.
 */
export function computeCloseoutIndexRollup(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexDistribution,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRollup;
  reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexReason[];
} {
  const baseFired = deriveIndexReasons(coverage, distribution, policy);
  const baseVerdict = verdictFrom(baseFired);

  // `--strict-open` escalates when the base verdict is OPEN or INCOMPLETE (an open / incomplete window) to a hard block —
  // the mission's "strict-open escalates any open/incomplete window to blocked". A base that is already blocked / invalid
  // is a stronger posture and is left untouched (`verdictFrom` above never yields open/incomplete in that case).
  const strictOpenEscalated = policy.strictOpen && (baseVerdict === "open" || baseVerdict === "incomplete");
  const firedIds = strictOpenEscalated ? [...baseFired, "strict-open-escalation" as const] : baseFired;
  const reasons = buildIndexReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const invalid = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_EXIT_FOR_VERDICT[verdict],
    allClosed: verdict === "all-closed",
    latest: distribution.newest,
    oldest: distribution.oldest,
    trendClass: distribution.trendClass,
    reasons: orderedIds,
    invalid,
    blocking,
    open,
    incomplete,
    informational,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom: strictOpenEscalated ? baseVerdict : null,
    detail,
  };
  return { rollup, reasons };
}
