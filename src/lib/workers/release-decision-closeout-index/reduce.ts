/**
 * Pure, node-free **reducer + fold** for the release decision closeout index (Phase 65).
 *
 * Turns the ingested closeouts (the trust boundary's output, oldest → newest) into the bounded, content-free sequence
 * the result records AND folds them into the ONE composite index verdict a review acts on. It:
 *  - applies the `--max-closeouts` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced);
 *  - reduces each considered closeout to a bounded {@link ReleaseDecisionCloseoutIndexPoint} (a position, a coverage
 *    state, the trusted-or-claimed closeout verdict, the receipt verdict / plan class, a severity, an authored
 *    headline);
 *  - summarizes the window into a bounded {@link ReleaseDecisionCloseoutIndexLedger} (the closeout-verdict distribution
 *    over the usable records, the newest / oldest usable verdict, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutIndexReasonId} conditions that fired and resolves the
 *    composite {@link ReleaseDecisionCloseoutIndexVerdict} with fail-closed severity precedence
 *    `blocking > open > incomplete > informational`, with the LATEST usable closeout as the primary driver and the
 *    bounded history thresholds as a secondary escalation.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator
 * or a byte to enter — not even an ingested closeout's own stamp (the index carries only its own).
 */

import {
  CLOSEOUT_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_INDEX_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_INDEX_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_VERDICTS,
  type ReleaseDecisionCloseoutIndexLedger,
  type ReleaseDecisionCloseoutIndexPoint,
  type ReleaseDecisionCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutIndexReason,
  type ReleaseDecisionCloseoutIndexReasonId,
  type ReleaseDecisionCloseoutIndexRecordState,
  type ReleaseDecisionCloseoutIndexRollup,
  type ReleaseDecisionCloseoutIndexSeverity,
  type ReleaseDecisionCloseoutIndexTrendClass,
  type ReleaseDecisionCloseoutIndexVerdict,
  type ReleaseDecisionCloseoutVerdict,
} from "./types";
import type { IngestedCloseout } from "./ingest";

/** The coverage state of one supplied closeout from its recognized / usable flags. */
export function pointState(recognized: boolean, usable: boolean): ReleaseDecisionCloseoutIndexRecordState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutIndexRecordState,
  verdict: ReleaseDecisionCloseoutVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision closeout (unreadable — never echoed). It contributes no ledger evidence (a coverage gap).`;
    case "tampered":
      return `#${n}: recognized, but its recorded closeout rollup does NOT re-derive from its own recorded facets (tampered / corrupt — treated as an untrustworthy input). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision closeout).`;
  }
}

/** Reduce one ingested closeout at `position` (oldest = 0) to the bounded {@link ReleaseDecisionCloseoutIndexPoint}. */
export function reduceRecord(position: number, ingested: IngestedCloseout): ReleaseDecisionCloseoutIndexPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutIndexSeverity | null =
    state === "usable" && verdict !== null ? CLOSEOUT_VERDICT_SEVERITY[verdict] : null;
  return {
    position,
    state,
    verdict,
    receiptVerdict: facts ? facts.receiptVerdict : null,
    planClass: facts ? facts.planClass : null,
    severity,
    detail: pointDetail(position, state, verdict),
  };
}

/** The bounded outcome of the window cap: the considered (newest N) closeouts + how many older ones were dropped. */
export interface WindowedCloseouts {
  /** The closeouts considered by the index, oldest → newest (the newest `maxCloseouts`). */
  readonly considered: readonly IngestedCloseout[];
  /** How many closeout inputs were supplied (before the cap). */
  readonly closeoutsSupplied: number;
  /** True iff the cap dropped older closeouts. */
  readonly truncated: boolean;
  /** How many older closeouts were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-closeouts` window cap to the supplied closeouts (oldest → newest): keep the NEWEST `maxCloseouts`,
 * drop older ones, and surface how many were dropped (never a silent truncation). A `maxCloseouts` of 0 or less is
 * treated as "no closeouts considered" (an empty, inconclusive window).
 */
export function applyWindow(list: readonly IngestedCloseout[], maxCloseouts: number): WindowedCloseouts {
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

/** Zeroed closeout-verdict counts (all four keys present) — the deterministic base for the histogram. */
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * The single coarse trend class of the window, by worst-present (strict-INDEPENDENT), with severity precedence
 * `tampered > blocked > open > incomplete (usable incomplete OR unreadable) > all-closed`, and `no-usable` when the
 * window has zero usable closeouts and no other signal.
 */
export function deriveTrendClass(
  closeoutsUsable: number,
  closeoutsUnreadable: number,
  closeoutsTampered: number,
  counts: Readonly<Record<ReleaseDecisionCloseoutVerdict, number>>,
): ReleaseDecisionCloseoutIndexTrendClass {
  if (closeoutsTampered > 0) return "tampered-present";
  if (counts["closeout-blocked"] > 0) return "blocked-present";
  if (counts["closeout-open"] > 0) return "open-present";
  if (counts["closeout-incomplete"] > 0 || closeoutsUnreadable > 0) return "incomplete-present";
  if (closeoutsUsable === 0) return "no-usable";
  return "all-closed";
}

/** The reduced index sequence + its bounded ledger summary + the latest usable closeout verdict. */
export interface ReducedCloseoutIndex {
  /** One reduced point per considered closeout, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutIndexPoint[];
  /** The bounded ledger summary. */
  readonly ledger: ReleaseDecisionCloseoutIndexLedger;
  /** The latest (newest) usable closeout's verdict, or `null` if none is usable — what the fold keys on. */
  readonly latest: ReleaseDecisionCloseoutVerdict | null;
}

/**
 * Reduce the supplied closeouts (oldest → newest) into the bounded points + ledger summary, under the window cap. The
 * counts / newest / oldest / trend class are over the USABLE considered records only (an unreadable / tampered record
 * contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceIndex(list: readonly IngestedCloseout[], maxCloseouts: number): ReducedCloseoutIndex {
  const window = applyWindow(list, maxCloseouts);
  const points = window.considered.map((ingested, i) => reduceRecord(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutVerdict[] = [];
  const verdictCounts = zeroVerdictCounts();
  let closeoutsUnreadable = 0;
  let closeoutsTampered = 0;
  for (const point of points) {
    if (point.state === "usable" && point.verdict !== null) {
      usableVerdicts.push(point.verdict);
      verdictCounts[point.verdict] += 1;
    } else if (point.state === "unreadable") {
      closeoutsUnreadable += 1;
    } else if (point.state === "tampered") {
      closeoutsTampered += 1;
    }
  }

  const latest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutVerdict)
      : null;
  const oldest = usableVerdicts.length > 0 ? (usableVerdicts[0] as ReleaseDecisionCloseoutVerdict) : null;

  const ledger: ReleaseDecisionCloseoutIndexLedger = {
    closeoutsSupplied: window.closeoutsSupplied,
    closeoutsConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    closeoutsUsable: usableVerdicts.length,
    closeoutsUnreadable,
    closeoutsTampered,
    verdictCounts,
    newest: latest,
    oldest,
    trendClass: deriveTrendClass(
      usableVerdicts.length,
      closeoutsUnreadable,
      closeoutsTampered,
      verdictCounts,
    ),
  };

  return { points, ledger, latest };
}

/* ------------------------------------------------------------------ *
 *  The composite index fold (latest-focused + history thresholds)
 * ------------------------------------------------------------------ */

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS}
 * order. Each reduces to a bounded, deterministic predicate over the already content-free ledger summary + the latest
 * usable verdict + the policy thresholds; the per-id severity is authored in
 * {@link RELEASE_DECISION_CLOSEOUT_INDEX_REASON_DETAIL}. This is the STRICT-INDEPENDENT reason set (a `--strict-open`
 * escalation is applied afterward in {@link computeCloseoutIndexRollup}).
 */
export function deriveIndexReasons(
  ledger: ReleaseDecisionCloseoutIndexLedger,
  latest: ReleaseDecisionCloseoutVerdict | null,
  policy: ReleaseDecisionCloseoutIndexPolicy,
): ReleaseDecisionCloseoutIndexReasonId[] {
  const c = ledger.verdictCounts;
  const fired: Record<ReleaseDecisionCloseoutIndexReasonId, boolean> = {
    // Blocking — an untrustworthy / blocked history.
    "closeout-tampered": ledger.closeoutsTampered > 0,
    "latest-blocked": latest === "closeout-blocked",
    "blocked-threshold-exceeded": c["closeout-blocked"] > policy.maxBlocked,
    "strict-open-escalation": false, // applied by the rollup after the base verdict is known
    // Open — an advisory follow-up posture remains open.
    "latest-open": latest === "closeout-open",
    "open-threshold-exceeded": c["closeout-open"] > policy.maxOpen,
    // Incomplete — a coverage gap.
    "no-closeouts": ledger.closeoutsUsable === 0,
    "closeout-unreadable": ledger.closeoutsUnreadable > 0,
    "latest-incomplete": latest === "closeout-incomplete",
    "incomplete-threshold-exceeded": c["closeout-incomplete"] > policy.maxIncomplete,
    // Informational — a benign index marker.
    "latest-closed": latest === "closed",
    "history-coherent":
      ledger.closeoutsUsable > 0 &&
      c.closed === ledger.closeoutsUsable &&
      ledger.closeoutsUnreadable === 0 &&
      ledger.closeoutsTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildIndexReasons(
  fired: readonly ReleaseDecisionCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutIndexReason[] {
  return RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_INDEX_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_INDEX_REASON_DETAIL[id].detail,
  }));
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutIndexReasonId[],
): ReleaseDecisionCloseoutIndexVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_INDEX_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "index-blocked";
  if (severities.includes("open")) return "index-open";
  if (severities.includes("incomplete")) return "index-incomplete";
  return "indexed";
}

/**
 * Compute the composite index verdict from the reduced ledger + latest usable verdict under the policy.
 *
 * Fail-closed precedence: any blocking reason ⇒ `index-blocked`; else any open reason ⇒ `index-open`; else any
 * incomplete reason ⇒ `index-incomplete`; else `indexed`. When `--strict-open` escalated a base `index-open` to
 * `index-blocked`, `strictOpenEscalated` is set (and `strictOpenEscalatedFrom` records it) so the summary explains the
 * escalation (the index would be `index-open` without the flag). A base `index-blocked` / `index-incomplete` /
 * `indexed` verdict is untouched by `--strict-open`.
 */
export function computeCloseoutIndexRollup(
  ledger: ReleaseDecisionCloseoutIndexLedger,
  latest: ReleaseDecisionCloseoutVerdict | null,
  policy: ReleaseDecisionCloseoutIndexPolicy,
): { rollup: ReleaseDecisionCloseoutIndexRollup; reasons: ReleaseDecisionCloseoutIndexReason[] } {
  const baseFired = deriveIndexReasons(ledger, latest, policy);
  const baseVerdict = verdictFrom(baseFired);

  const strictOpenEscalated = baseVerdict === "index-open" && policy.strictOpen;
  const firedIds = strictOpenEscalated ? [...baseFired, "strict-open-escalation" as const] : baseFired;
  const reasons = buildIndexReasons(firedIds);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_INDEX_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_INDEX_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutIndexRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_INDEX_EXIT_FOR_VERDICT[verdict],
    indexed: verdict === "indexed",
    latest,
    reasons: orderedIds,
    blocking,
    open,
    incomplete,
    informational,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom: strictOpenEscalated ? "index-open" : null,
    detail,
  };
  return { rollup, reasons };
}
