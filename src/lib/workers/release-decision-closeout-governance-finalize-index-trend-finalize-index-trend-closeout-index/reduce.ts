/**
 * Pure, node-free **reducer + fold** for the release decision closeout governance finalize index trend finalize index
 * trend closeout INDEX (Phase 85).
 *
 * Turns the ingested closeout records (the trust boundary's output, oldest → newest) into the bounded, content-free
 * sequence the result records AND folds them into the ONE composite index verdict a review acts on. It:
 *  - applies the `--max-closeouts` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced);
 *  - reduces each considered record to a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPoint}
 *    (a position, a coverage state, the trusted-or-claimed closeout verdict, the receipt state / verdict / plan class, a
 *    severity, an authored headline);
 *  - summarizes the window into a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage} +
 *    {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution} + newest-record
 *    {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexLatest} (the closeout-verdict histogram over
 *    the usable records, the newest / oldest usable verdict, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId} conditions
 *    that fired and resolves the composite {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict}
 *    with fail-closed severity precedence `invalid > blocking > open > incomplete > informational`, with the LATEST usable
 *    record as the primary driver and the bounded history thresholds as a secondary escalation.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator or a
 * byte to enter — not even an ingested record's own stamp (the index carries only its own).
 */

import {
  CLOSEOUT_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexLatest,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPoint,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict,
} from "./types";
import type { IngestedCloseout } from "./ingest";

/** The coverage state of one supplied record from its recognized / usable flags. */
export function pointState(
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRecordState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRecordState,
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict | null,
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
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPoint}.
 */
export function reduceRecord(
  position: number,
  ingested: IngestedCloseout,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexSeverity | null =
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
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_VERDICTS) counts[v] = 0;
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
  counts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict, number>>,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendClass {
  if (closeoutsTampered > 0 || closeoutsUnreadable > 0) return "invalid-present";
  if (counts.blocked > 0 || counts.invalid > 0) return "blocked-present";
  if (counts.open > 0) return "open-present";
  if (counts.incomplete > 0) return "incomplete-present";
  if (closeoutsUsable === 0) return "no-usable";
  return "all-closed";
}

/** The reduced index sequence + its bounded coverage / distribution summaries + the newest usable record summary. */
export interface ReducedCloseoutIndex {
  /** One reduced point per considered record, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPoint[];
  /** The bounded coverage summary. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage;
  /** The bounded closeout-verdict distribution over the usable records. */
  readonly distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution;
  /** The bounded summary of the newest usable record, or `null` if none is usable — what the fold keys on. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexLatest | null;
}

/**
 * Reduce the supplied records (oldest → newest) into the bounded points + coverage + distribution + latest summary, under
 * the window cap. The counts / newest / oldest / trend class are over the USABLE considered records only (an unreadable /
 * tampered record contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceIndex(list: readonly IngestedCloseout[], maxCloseouts: number): ReducedCloseoutIndex {
  const window = applyWindow(list, maxCloseouts);
  const points = window.considered.map((ingested, i) => reduceRecord(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict[] = [];
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
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict)
      : null;
  const oldest =
    usableVerdicts.length > 0
      ? (usableVerdicts[0] as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict)
      : null;

  const coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage = {
    closeoutsSupplied: window.closeoutsSupplied,
    closeoutsConsidered: window.considered.length,
    closeoutsUsable: usableVerdicts.length,
    closeoutsUnreadable,
    closeoutsTampered,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
  };

  const distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution = {
    verdictCounts,
    newest,
    oldest,
    trendClass: deriveTrendClass(usableVerdicts.length, closeoutsUnreadable, closeoutsTampered, verdictCounts),
  };

  const latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexLatest | null =
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
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS} order.
 * Each reduces to a bounded, deterministic predicate over the already content-free coverage + distribution summary + the
 * latest usable verdict + the policy thresholds; the per-id severity is authored in
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL}.
 * This is the STRICT-INDEPENDENT reason set (a `--strict-open` escalation is applied afterward in
 * {@link computeCloseoutIndexRollup}).
 */
export function deriveIndexReasons(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId[] {
  const c = distribution.verdictCounts;
  const latest = distribution.newest;
  const fired: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId, boolean> = {
    // Invalid — an untrustworthy input (TOP precedence).
    "closeout-tampered": coverage.closeoutsTampered > 0,
    "closeout-unreadable": coverage.closeoutsUnreadable > 0,
    // Blocking — a blocked history.
    "latest-blocked": latest === "blocked" || latest === "invalid",
    "blocked-in-history": c.blocked > 0 || c.invalid > 0,
    "strict-open-escalation": false, // applied by the rollup after the base verdict is known
    // Open — an advisory follow-up posture remains open.
    "latest-open": latest === "open",
    "open-threshold-exceeded": c.open > policy.maxOpen,
    // Incomplete — a coverage gap.
    "no-closeouts": coverage.closeoutsUsable === 0,
    "latest-incomplete": latest === "incomplete",
    "incomplete-threshold-exceeded": c.incomplete > policy.maxIncomplete,
    "latest-not-closed": policy.requireLatestClosed && coverage.closeoutsUsable > 0 && latest !== "closed",
    // Informational — a benign index marker.
    "latest-closed": latest === "closed",
    "history-coherent":
      coverage.closeoutsUsable > 0 &&
      c.closed === coverage.closeoutsUsable &&
      coverage.closeoutsUnreadable === 0 &&
      coverage.closeoutsTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS.filter(
    (id) => fired[id],
  );
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildIndexReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_IDS.filter(
    (id) => fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL[id].detail,
  }));
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > open > incomplete). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexVerdict {
  const severities = fired.map(
    (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_REASON_DETAIL[id].severity,
  );
  if (severities.includes("invalid")) return "index-invalid";
  if (severities.includes("blocking")) return "index-blocked";
  if (severities.includes("open")) return "index-open";
  if (severities.includes("incomplete")) return "index-incomplete";
  return "indexed";
}

/**
 * Compute the composite index verdict from the reduced coverage + distribution under the policy.
 *
 * Fail-closed precedence: any invalid reason (a tampered / unreadable record) ⇒ `index-invalid`; else any blocking reason
 * ⇒ `index-blocked`; else any open reason ⇒ `index-open`; else any incomplete reason ⇒ `index-incomplete`; else
 * `indexed`. When `--strict-open` is set and an open closeout is present in the considered history (and the base verdict
 * is not already blocked / invalid), the index escalates to `index-blocked` via a `strict-open-escalation` reason;
 * `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the base verdict it would have been.
 */
export function computeCloseoutIndexRollup(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexDistribution,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRollup;
  reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexReason[];
} {
  const baseFired = deriveIndexReasons(coverage, distribution, policy);
  const baseVerdict = verdictFrom(baseFired);

  // `--strict-open` escalates when an open closeout is present in the considered history, UNLESS the base is already
  // blocked / invalid (a stronger posture). This satisfies "any open closeout escalates to blocked".
  const anyOpen = distribution.verdictCounts.open > 0;
  const strictOpenEscalated =
    policy.strictOpen && anyOpen && baseVerdict !== "index-blocked" && baseVerdict !== "index-invalid";
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
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_EXIT_FOR_VERDICT[verdict],
    indexed: verdict === "indexed",
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
