/**
 * Pure, node-free **reducer + fold** for the release decision closeout governance index (Phase 70).
 *
 * Turns the ingested governance bundles (the trust boundary's output, oldest → newest) into the bounded, content-free
 * sequence the result records AND folds them into the ONE composite index verdict a review acts on. It:
 *  - applies the `--max-governance` window cap (keeping the NEWEST N, never silently — the count dropped is surfaced);
 *  - reduces each considered bundle to a bounded {@link ReleaseDecisionCloseoutGovernanceIndexPoint} (a position, a
 *    coverage state, the trusted-or-claimed governance verdict, the receipt verdict / plan class, a severity, an
 *    authored headline);
 *  - summarizes the window into a bounded {@link ReleaseDecisionCloseoutGovernanceIndexLedger} (the governance-verdict
 *    distribution over the usable records, the newest / oldest usable verdict, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutGovernanceIndexReasonId} conditions that fired and resolves
 *    the composite {@link ReleaseDecisionCloseoutGovernanceIndexVerdict} with fail-closed severity precedence
 *    `blocking > open > incomplete > informational`, with the LATEST usable bundle as the primary driver and the
 *    bounded history thresholds as a secondary escalation.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator or
 * a byte to enter — not even an ingested bundle's own stamp (the index carries only its own).
 */

import {
  GOVERNANCE_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceIndexLedger,
  type ReleaseDecisionCloseoutGovernanceIndexPoint,
  type ReleaseDecisionCloseoutGovernanceIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceIndexReason,
  type ReleaseDecisionCloseoutGovernanceIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceIndexRecordState,
  type ReleaseDecisionCloseoutGovernanceIndexRollup,
  type ReleaseDecisionCloseoutGovernanceIndexSeverity,
  type ReleaseDecisionCloseoutGovernanceIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "./types";
import type { IngestedGovernance } from "./ingest";

/** The coverage state of one supplied bundle from its recognized / usable flags. */
export function pointState(recognized: boolean, usable: boolean): ReleaseDecisionCloseoutGovernanceIndexRecordState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutGovernanceIndexRecordState,
  verdict: ReleaseDecisionCloseoutGovernanceVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision closeout governance bundle (unreadable — never echoed). It contributes no ledger evidence (a coverage gap).`;
    case "tampered":
      return `#${n}: recognized, but its recorded governance rollup does NOT re-derive from its own recorded facets (tampered / corrupt — treated as an untrustworthy input). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision closeout governance bundle).`;
  }
}

/**
 * Reduce one ingested bundle at `position` (oldest = 0) to the bounded
 * {@link ReleaseDecisionCloseoutGovernanceIndexPoint}.
 */
export function reduceRecord(
  position: number,
  ingested: IngestedGovernance,
): ReleaseDecisionCloseoutGovernanceIndexPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutGovernanceIndexSeverity | null =
    state === "usable" && verdict !== null ? GOVERNANCE_VERDICT_SEVERITY[verdict] : null;
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

/** The bounded outcome of the window cap: the considered (newest N) bundles + how many older ones were dropped. */
export interface WindowedGovernance {
  /** The bundles considered by the index, oldest → newest (the newest `maxGovernance`). */
  readonly considered: readonly IngestedGovernance[];
  /** How many governance inputs were supplied (before the cap). */
  readonly governanceSupplied: number;
  /** True iff the cap dropped older bundles. */
  readonly truncated: boolean;
  /** How many older bundles were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-governance` window cap to the supplied bundles (oldest → newest): keep the NEWEST `maxGovernance`,
 * drop older ones, and surface how many were dropped (never a silent truncation). A `maxGovernance` of 0 or less is
 * treated as "no bundles considered" (an empty, inconclusive window).
 */
export function applyWindow(list: readonly IngestedGovernance[], maxGovernance: number): WindowedGovernance {
  const cap = Number.isSafeInteger(maxGovernance) && maxGovernance > 0 ? maxGovernance : 0;
  const considered = cap >= list.length ? list : list.slice(list.length - cap);
  const droppedOldest = list.length - considered.length;
  return {
    considered,
    governanceSupplied: list.length,
    truncated: droppedOldest > 0,
    droppedOldest,
  };
}

/** Zeroed governance-verdict counts (all four keys present) — the deterministic base for the histogram. */
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * The single coarse trend class of the window, by worst-present (strict-INDEPENDENT), with severity precedence
 * `tampered > blocked > open > incomplete (usable incomplete OR unreadable) > all-closed`, and `no-usable` when the
 * window has zero usable bundles and no other signal.
 */
export function deriveTrendClass(
  governanceUsable: number,
  governanceUnreadable: number,
  governanceTampered: number,
  counts: Readonly<Record<ReleaseDecisionCloseoutGovernanceVerdict, number>>,
): ReleaseDecisionCloseoutGovernanceIndexTrendClass {
  if (governanceTampered > 0) return "tampered-present";
  if (counts["governance-blocked"] > 0) return "blocked-present";
  if (counts["governance-open"] > 0) return "open-present";
  if (counts["governance-incomplete"] > 0 || governanceUnreadable > 0) return "incomplete-present";
  if (governanceUsable === 0) return "no-usable";
  return "all-closed";
}

/** The reduced index sequence + its bounded ledger summary + the latest usable bundle verdict. */
export interface ReducedGovernanceIndex {
  /** One reduced point per considered bundle, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceIndexPoint[];
  /** The bounded ledger summary. */
  readonly ledger: ReleaseDecisionCloseoutGovernanceIndexLedger;
  /** The latest (newest) usable bundle's verdict, or `null` if none is usable — what the fold keys on. */
  readonly latest: ReleaseDecisionCloseoutGovernanceVerdict | null;
}

/**
 * Reduce the supplied bundles (oldest → newest) into the bounded points + ledger summary, under the window cap. The
 * counts / newest / oldest / trend class are over the USABLE considered records only (an unreadable / tampered record
 * contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceIndex(list: readonly IngestedGovernance[], maxGovernance: number): ReducedGovernanceIndex {
  const window = applyWindow(list, maxGovernance);
  const points = window.considered.map((ingested, i) => reduceRecord(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutGovernanceVerdict[] = [];
  const verdictCounts = zeroVerdictCounts();
  let governanceUnreadable = 0;
  let governanceTampered = 0;
  for (const point of points) {
    if (point.state === "usable" && point.verdict !== null) {
      usableVerdicts.push(point.verdict);
      verdictCounts[point.verdict] += 1;
    } else if (point.state === "unreadable") {
      governanceUnreadable += 1;
    } else if (point.state === "tampered") {
      governanceTampered += 1;
    }
  }

  const latest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutGovernanceVerdict)
      : null;
  const oldest = usableVerdicts.length > 0 ? (usableVerdicts[0] as ReleaseDecisionCloseoutGovernanceVerdict) : null;

  const ledger: ReleaseDecisionCloseoutGovernanceIndexLedger = {
    governanceSupplied: window.governanceSupplied,
    governanceConsidered: window.considered.length,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
    governanceUsable: usableVerdicts.length,
    governanceUnreadable,
    governanceTampered,
    verdictCounts,
    newest: latest,
    oldest,
    trendClass: deriveTrendClass(
      usableVerdicts.length,
      governanceUnreadable,
      governanceTampered,
      verdictCounts,
    ),
  };

  return { points, ledger, latest };
}

/* ------------------------------------------------------------------ *
 *  The composite index fold (latest-focused + history thresholds)
 * ------------------------------------------------------------------ */

/**
 * Derive the closed set of reason conditions that fired, in canonical
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS} order. Each reduces to a bounded, deterministic
 * predicate over the already content-free ledger summary + the latest usable verdict + the policy thresholds; the
 * per-id severity is authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_DETAIL}. This is the
 * STRICT-INDEPENDENT reason set (a `--strict-open` escalation is applied afterward in
 * {@link computeGovernanceIndexRollup}).
 */
export function deriveIndexReasons(
  ledger: ReleaseDecisionCloseoutGovernanceIndexLedger,
  latest: ReleaseDecisionCloseoutGovernanceVerdict | null,
  policy: ReleaseDecisionCloseoutGovernanceIndexPolicy,
): ReleaseDecisionCloseoutGovernanceIndexReasonId[] {
  const c = ledger.verdictCounts;
  const fired: Record<ReleaseDecisionCloseoutGovernanceIndexReasonId, boolean> = {
    // Blocking — an untrustworthy / blocked history.
    "governance-tampered": ledger.governanceTampered > 0,
    "latest-blocked": latest === "governance-blocked",
    "blocked-threshold-exceeded": c["governance-blocked"] > policy.maxBlocked,
    "strict-open-escalation": false, // applied by the rollup after the base verdict is known
    // Open — an advisory follow-up posture remains open.
    "latest-open": latest === "governance-open",
    "open-threshold-exceeded": c["governance-open"] > policy.maxOpen,
    // Incomplete — a coverage gap.
    "no-governance": ledger.governanceUsable === 0,
    "governance-unreadable": ledger.governanceUnreadable > 0,
    "latest-incomplete": latest === "governance-incomplete",
    "incomplete-threshold-exceeded": c["governance-incomplete"] > policy.maxIncomplete,
    // Informational — a benign index marker.
    "latest-closed": latest === "closed",
    "history-coherent":
      ledger.governanceUsable > 0 &&
      c.closed === ledger.governanceUsable &&
      ledger.governanceUnreadable === 0 &&
      ledger.governanceTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildIndexReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceIndexReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_DETAIL[id].detail,
  }));
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceIndexVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_REASON_DETAIL[id].severity);
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
export function computeGovernanceIndexRollup(
  ledger: ReleaseDecisionCloseoutGovernanceIndexLedger,
  latest: ReleaseDecisionCloseoutGovernanceVerdict | null,
  policy: ReleaseDecisionCloseoutGovernanceIndexPolicy,
): { rollup: ReleaseDecisionCloseoutGovernanceIndexRollup; reasons: ReleaseDecisionCloseoutGovernanceIndexReason[] } {
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
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceIndexRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_EXIT_FOR_VERDICT[verdict],
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
