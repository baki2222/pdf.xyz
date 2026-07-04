/**
 * Pure, node-free **reducer** for the release decision ledger index (Phase 60).
 *
 * Turns the ingested records (the trust boundary's output, oldest → newest) into the bounded, content-free sequence
 * the result records and the rollup folds. It:
 *  - applies the `--max-records` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced),
 *    so the index is over a bounded batch;
 *  - reduces each considered record to a bounded {@link ReleaseDecisionIndexPoint} (a position, a coverage state,
 *    the trusted-or-claimed decision, a cross-check status, a severity, an authored headline);
 *  - summarizes the window into a bounded {@link ReleaseDecisionIndexLedger} (decision + cross-check distributions
 *    over the usable records, the newest / oldest usable decision, and the single coarse trend class).
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a
 * locator or a byte to enter — not even an ingested record's own stamp (the index carries only its own).
 */

import {
  DECISION_SEVERITY,
  RELEASE_DECISION_CROSS_CHECKS,
  RELEASE_DECISION_DECISIONS,
  type ReleaseDecisionCrossCheckStatus,
  type ReleaseDecisionDecision,
  type ReleaseDecisionIndexLedger,
  type ReleaseDecisionIndexPoint,
  type ReleaseDecisionIndexRecordState,
  type ReleaseDecisionIndexSeverity,
  type ReleaseDecisionIndexTrendClass,
} from "./types";
import type { IngestedDecision } from "./ingest";

/** The coverage state of one supplied record from its recognized / usable flags. */
export function pointState(recognized: boolean, usable: boolean): ReleaseDecisionIndexRecordState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + decision. */
function pointDetail(
  position: number,
  state: ReleaseDecisionIndexRecordState,
  decision: ReleaseDecisionDecision | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision record (unreadable — never echoed). It contributes no ledger evidence (an untrustworthy input).`;
    case "tampered":
      return `#${n}: recognized, but its recorded decision does NOT re-derive from its own summaries (tampered / corrupt — treated as an untrustworthy input). Claimed: ${decision ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${decision ?? "n/a"} (a self-consistent release decision record).`;
  }
}

/** Reduce one ingested record at `position` (oldest = 0) to the bounded {@link ReleaseDecisionIndexPoint}. */
export function reduceRecord(position: number, ingested: IngestedDecision): ReleaseDecisionIndexPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  // Trusted decision + cross-check + severity only from a usable record; a tampered record surfaces its untrusted claim.
  const decision = ingested.decision;
  const crossCheck: ReleaseDecisionCrossCheckStatus | null =
    state === "usable" && ingested.facts !== null ? ingested.facts.crossCheck : null;
  const severity: ReleaseDecisionIndexSeverity | null =
    state === "usable" && decision !== null ? DECISION_SEVERITY[decision] : null;
  return {
    position,
    state,
    decision,
    crossCheck,
    severity,
    detail: pointDetail(position, state, decision),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) records + how many older ones were dropped. */
export interface WindowedRecords {
  /** The records considered by the index, oldest → newest (the newest `maxRecords`). */
  readonly considered: readonly IngestedDecision[];
  /** How many record inputs were supplied (before the cap). */
  readonly recordsSupplied: number;
  /** True iff the cap dropped older records. */
  readonly truncated: boolean;
  /** How many older records were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-records` window cap to the supplied records (oldest → newest): keep the NEWEST `maxRecords`, drop
 * older ones, and surface how many were dropped (never a silent truncation). A `maxRecords` of 0 or less is treated
 * as "no records considered" (an empty, inconclusive window).
 */
export function applyWindow(list: readonly IngestedDecision[], maxRecords: number): WindowedRecords {
  const cap = Number.isSafeInteger(maxRecords) && maxRecords > 0 ? maxRecords : 0;
  const considered = cap >= list.length ? list : list.slice(list.length - cap);
  const droppedOldest = list.length - considered.length;
  return {
    considered,
    recordsSupplied: list.length,
    truncated: droppedOldest > 0,
    droppedOldest,
  };
}

/** Zeroed decision counts (all six keys present) — the deterministic base for the histogram. */
function zeroDecisionCounts(): Record<ReleaseDecisionDecision, number> {
  const counts = {} as Record<ReleaseDecisionDecision, number>;
  for (const d of RELEASE_DECISION_DECISIONS) counts[d] = 0;
  return counts;
}

/** Zeroed cross-check counts (all three keys present) — the deterministic base for the source-posture tally. */
function zeroCrossCheckCounts(): Record<ReleaseDecisionCrossCheckStatus, number> {
  const counts = {} as Record<ReleaseDecisionCrossCheckStatus, number>;
  for (const c of RELEASE_DECISION_CROSS_CHECKS) counts[c] = 0;
  return counts;
}

/**
 * The single coarse trend class of the window, by worst-present (strict-INDEPENDENT), with the SAME precedence the
 * verdict uses: `invalid-input > rejection-present > insufficient-evidence > hold-present > followup-present >
 * all-clear`. `rejection-present` covers both a `reject` and an `invalid` decision; `insufficient-evidence` covers
 * both zero usable records and an `insufficient` decision.
 */
export function deriveTrendClass(
  recordsUsable: number,
  unreadableOrTampered: number,
  counts: Readonly<Record<ReleaseDecisionDecision, number>>,
): ReleaseDecisionIndexTrendClass {
  if (unreadableOrTampered > 0) return "invalid-input";
  if (counts.reject > 0 || counts.invalid > 0) return "rejection-present";
  if (recordsUsable === 0 || counts.insufficient > 0) return "insufficient-evidence";
  if (counts.hold > 0) return "hold-present";
  if (counts["proceed-with-followup"] > 0) return "followup-present";
  return "all-clear";
}

/** The reduced index sequence + its bounded ledger summary + the trusted usable-decision sequence. */
export interface ReducedIndex {
  /** One reduced point per considered record, oldest → newest. */
  readonly points: readonly ReleaseDecisionIndexPoint[];
  /** The bounded ledger summary. */
  readonly ledger: ReleaseDecisionIndexLedger;
  /** The usable records' decisions, oldest → newest (trusted) — what the rollup folds. */
  readonly usableDecisions: readonly ReleaseDecisionDecision[];
}

/**
 * Reduce the supplied records (oldest → newest) into the bounded points + ledger summary, under the window cap. The
 * counts / newest / oldest / trend class are over the USABLE considered records only (an unreadable / tampered
 * record contributes no trusted decision), so the summary never fabricates a posture.
 */
export function reduceIndex(list: readonly IngestedDecision[], maxRecords: number): ReducedIndex {
  const window = applyWindow(list, maxRecords);
  const points = window.considered.map((ingested, i) => reduceRecord(i, ingested));

  const usableDecisions: ReleaseDecisionDecision[] = [];
  const decisionCounts = zeroDecisionCounts();
  const crossCheckCounts = zeroCrossCheckCounts();
  let recordsUnreadable = 0;
  let recordsTampered = 0;
  for (const point of points) {
    if (point.state === "usable" && point.decision !== null) {
      usableDecisions.push(point.decision);
      decisionCounts[point.decision] += 1;
      if (point.crossCheck !== null) crossCheckCounts[point.crossCheck] += 1;
    } else if (point.state === "unreadable") {
      recordsUnreadable += 1;
    } else if (point.state === "tampered") {
      recordsTampered += 1;
    }
  }

  const newest =
    usableDecisions.length > 0
      ? (usableDecisions[usableDecisions.length - 1] as ReleaseDecisionDecision)
      : null;
  const oldest = usableDecisions.length > 0 ? (usableDecisions[0] as ReleaseDecisionDecision) : null;

  const ledger: ReleaseDecisionIndexLedger = {
    recordsSupplied: window.recordsSupplied,
    recordsConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    recordsUsable: usableDecisions.length,
    recordsUnreadable,
    recordsTampered,
    decisionCounts,
    crossCheckCounts,
    newest,
    oldest,
    trendClass: deriveTrendClass(
      usableDecisions.length,
      recordsUnreadable + recordsTampered,
      decisionCounts,
    ),
  };

  return { points, ledger, usableDecisions };
}
