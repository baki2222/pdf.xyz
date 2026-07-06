/**
 * Pure, node-free **reducer + fold** for the release decision closeout governance finalize index (Phase 75).
 *
 * Turns the ingested finalization bundles (the trust boundary's output, oldest → newest) into the bounded, content-free
 * sequence the result records AND folds them into the ONE composite index verdict a review acts on. It:
 *  - applies the `--max-finalizations` window cap (keeping the NEWEST N, never silently — the count dropped is
 *    surfaced);
 *  - reduces each considered bundle to a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexPoint} (a
 *    position, a coverage state, the trusted-or-claimed finalization verdict, the receipt state / verdict / plan class, a
 *    severity, an authored headline);
 *  - summarizes the window into a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage} +
 *    {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution} + newest-bundle
 *    {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexLatest} (the finalization-verdict histogram over the usable
 *    records, the newest / oldest usable verdict, and the single coarse trend class);
 *  - derives the closed set of {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId} conditions that fired and
 *    resolves the composite {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict} with fail-closed severity
 *    precedence `invalid > blocking > open > incomplete > informational`, with the LATEST usable bundle as the primary
 *    driver and the bounded history thresholds as a secondary escalation.
 *
 * It derives only bounded fields and never reaches past the already-reduced facts, so there is nowhere for a locator or
 * a byte to enter — not even an ingested bundle's own stamp (the index carries only its own).
 */

import {
  FINALIZE_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexLatest,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexPoint,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "./types";
import type { IngestedFinalize } from "./ingest";

/** The coverage state of one supplied bundle from its recognized / usable flags. */
export function pointState(
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexRecordState {
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** A one-line, content-free headline authored from the position + state + verdict. */
function pointDetail(
  position: number,
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexRecordState,
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict | null,
): string {
  const n = position + 1;
  switch (state) {
    case "unreadable":
      return `#${n}: supplied, but not a recognized release decision closeout governance finalize bundle (unreadable — never echoed). It is an untrustworthy input (fails closed to INVALID).`;
    case "tampered":
      return `#${n}: recognized, but its recorded finalization rollup does NOT re-derive from its own recorded facets (tampered / corrupt — an untrustworthy input, fails closed to INVALID). Claimed: ${verdict ?? "n/a"}.`;
    case "usable":
      return `#${n}: ${verdict ?? "n/a"} (a self-consistent release decision closeout governance finalize bundle).`;
  }
}

/**
 * Reduce one ingested bundle at `position` (oldest = 0) to the bounded
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexPoint}.
 */
export function reduceRecord(
  position: number,
  ingested: IngestedFinalize,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexPoint {
  const state = pointState(ingested.recognized, ingested.usable);
  const verdict = ingested.verdict;
  const facts = state === "usable" ? ingested.facts : null;
  const severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexSeverity | null =
    state === "usable" && verdict !== null ? FINALIZE_VERDICT_SEVERITY[verdict] : null;
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

/** The bounded outcome of the window cap: the considered (newest N) bundles + how many older ones were dropped. */
export interface WindowedFinalize {
  /** The bundles considered by the index, oldest → newest (the newest `maxFinalizations`). */
  readonly considered: readonly IngestedFinalize[];
  /** How many finalization inputs were supplied (before the cap). */
  readonly finalizationsSupplied: number;
  /** True iff the cap dropped older bundles. */
  readonly truncated: boolean;
  /** How many older bundles were dropped by the cap. */
  readonly droppedOldest: number;
}

/**
 * Apply the `--max-finalizations` window cap to the supplied bundles (oldest → newest): keep the NEWEST
 * `maxFinalizations`, drop older ones, and surface how many were dropped (never a silent truncation). A
 * `maxFinalizations` of 0 or less is treated as "no bundles considered" (an empty, inconclusive window).
 */
export function applyWindow(list: readonly IngestedFinalize[], maxFinalizations: number): WindowedFinalize {
  const cap = Number.isSafeInteger(maxFinalizations) && maxFinalizations > 0 ? maxFinalizations : 0;
  const considered = cap >= list.length ? list : list.slice(list.length - cap);
  const droppedOldest = list.length - considered.length;
  return {
    considered,
    finalizationsSupplied: list.length,
    truncated: droppedOldest > 0,
    droppedOldest,
  };
}

/** Zeroed finalization-verdict counts (all four keys present) — the deterministic base for the histogram. */
function zeroVerdictCounts(): Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number> {
  const counts = {} as Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>;
  for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * The single coarse trend class of the window, by worst-present (strict-INDEPENDENT), with severity precedence
 * `invalid (tampered OR unreadable) > blocked > open > incomplete > all-finalized`, and `no-usable` when the window has
 * zero usable bundles and no other signal.
 */
export function deriveTrendClass(
  finalizationsUsable: number,
  finalizationsUnreadable: number,
  finalizationsTampered: number,
  counts: Readonly<Record<ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>>,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendClass {
  if (finalizationsTampered > 0 || finalizationsUnreadable > 0) return "invalid-present";
  if (counts["finalize-blocked"] > 0) return "blocked-present";
  if (counts["finalize-open"] > 0) return "open-present";
  if (counts["finalize-incomplete"] > 0) return "incomplete-present";
  if (finalizationsUsable === 0) return "no-usable";
  return "all-finalized";
}

/** The reduced index sequence + its bounded coverage / distribution summaries + the newest usable bundle summary. */
export interface ReducedFinalizeIndex {
  /** One reduced point per considered bundle, oldest → newest. */
  readonly points: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexPoint[];
  /** The bounded coverage summary. */
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage;
  /** The bounded finalization-verdict distribution over the usable records. */
  readonly distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution;
  /** The bounded summary of the newest usable bundle, or `null` if none is usable — what the fold keys on. */
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexLatest | null;
}

/**
 * Reduce the supplied bundles (oldest → newest) into the bounded points + coverage + distribution + latest summary,
 * under the window cap. The counts / newest / oldest / trend class are over the USABLE considered records only (an
 * unreadable / tampered record contributes no trusted verdict), so the summary never fabricates a posture.
 */
export function reduceIndex(list: readonly IngestedFinalize[], maxFinalizations: number): ReducedFinalizeIndex {
  const window = applyWindow(list, maxFinalizations);
  const points = window.considered.map((ingested, i) => reduceRecord(i, ingested));

  const usableVerdicts: ReleaseDecisionCloseoutGovernanceFinalizeVerdict[] = [];
  const verdictCounts = zeroVerdictCounts();
  let finalizationsUnreadable = 0;
  let finalizationsTampered = 0;
  // The newest usable ingested bundle's facts (for the `latest` summary object).
  let newestUsable: IngestedFinalize | null = null;
  for (const ingested of window.considered) {
    const state = pointState(ingested.recognized, ingested.usable);
    if (state === "usable" && ingested.verdict !== null) {
      usableVerdicts.push(ingested.verdict);
      verdictCounts[ingested.verdict] += 1;
      newestUsable = ingested;
    } else if (state === "unreadable") {
      finalizationsUnreadable += 1;
    } else if (state === "tampered") {
      finalizationsTampered += 1;
    }
  }

  const newest =
    usableVerdicts.length > 0
      ? (usableVerdicts[usableVerdicts.length - 1] as ReleaseDecisionCloseoutGovernanceFinalizeVerdict)
      : null;
  const oldest =
    usableVerdicts.length > 0 ? (usableVerdicts[0] as ReleaseDecisionCloseoutGovernanceFinalizeVerdict) : null;

  const coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage = {
    finalizationsSupplied: window.finalizationsSupplied,
    finalizationsConsidered: window.considered.length,
    finalizationsUsable: usableVerdicts.length,
    finalizationsUnreadable,
    finalizationsTampered,
    truncated: window.truncated,
    droppedOldest: window.droppedOldest,
  };

  const distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution = {
    verdictCounts,
    newest,
    oldest,
    trendClass: deriveTrendClass(usableVerdicts.length, finalizationsUnreadable, finalizationsTampered, verdictCounts),
  };

  const latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexLatest | null =
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
 * {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_IDS} order. Each reduces to a bounded, deterministic
 * predicate over the already content-free coverage + distribution summary + the latest usable verdict + the policy
 * thresholds; the per-id severity is authored in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_DETAIL}.
 * This is the STRICT-INDEPENDENT reason set (a `--strict-open` escalation is applied afterward in
 * {@link computeFinalizeIndexRollup}).
 */
export function deriveIndexReasons(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId[] {
  const c = distribution.verdictCounts;
  const latest = distribution.newest;
  const fired: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId, boolean> = {
    // Invalid — an untrustworthy input (TOP precedence).
    "finalization-tampered": coverage.finalizationsTampered > 0,
    "finalization-unreadable": coverage.finalizationsUnreadable > 0,
    // Blocking — a blocked history.
    "latest-blocked": latest === "finalize-blocked",
    "blocked-in-history": c["finalize-blocked"] > 0,
    "strict-open-escalation": false, // applied by the rollup after the base verdict is known
    // Open — an advisory follow-up posture remains open.
    "latest-open": latest === "finalize-open",
    "open-threshold-exceeded": c["finalize-open"] > policy.maxOpen,
    // Incomplete — a coverage gap.
    "no-finalizations": coverage.finalizationsUsable === 0,
    "latest-incomplete": latest === "finalize-incomplete",
    "incomplete-threshold-exceeded": c["finalize-incomplete"] > policy.maxIncomplete,
    "latest-not-finalized": policy.requireLatestFinalized && coverage.finalizationsUsable > 0 && latest !== "finalized",
    // Informational — a benign index marker.
    "latest-finalized": latest === "finalized",
    "history-coherent":
      coverage.finalizationsUsable > 0 &&
      c.finalized === coverage.finalizationsUsable &&
      coverage.finalizationsUnreadable === 0 &&
      coverage.finalizationsTampered === 0,
  };
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildIndexReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_DETAIL[id].detail,
  }));
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > open > incomplete). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_REASON_DETAIL[id].severity);
  if (severities.includes("invalid")) return "index-invalid";
  if (severities.includes("blocking")) return "index-blocked";
  if (severities.includes("open")) return "index-open";
  if (severities.includes("incomplete")) return "index-incomplete";
  return "indexed";
}

/**
 * Compute the composite index verdict from the reduced coverage + distribution under the policy.
 *
 * Fail-closed precedence: any invalid reason (a tampered / unreadable bundle) ⇒ `index-invalid`; else any blocking
 * reason ⇒ `index-blocked`; else any open reason ⇒ `index-open`; else any incomplete reason ⇒ `index-incomplete`; else
 * `indexed`. When `--strict-open` is set and an open finalization is present in the considered history (and the base
 * verdict is not already blocked / invalid), the index escalates to `index-blocked` via a `strict-open-escalation`
 * reason; `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the base verdict it would have been.
 */
export function computeFinalizeIndexRollup(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexDistribution,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy,
): {
  rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexRollup;
  reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexReason[];
} {
  const baseFired = deriveIndexReasons(coverage, distribution, policy);
  const baseVerdict = verdictFrom(baseFired);

  // `--strict-open` escalates when an open finalization is present in the considered history, UNLESS the base is
  // already blocked / invalid (a stronger posture). This satisfies "any open finalization escalates to blocked".
  const anyOpen = distribution.verdictCounts["finalize-open"] > 0;
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
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexRollup = {
    verdict,
    exitCode: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT_FOR_VERDICT[verdict],
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
