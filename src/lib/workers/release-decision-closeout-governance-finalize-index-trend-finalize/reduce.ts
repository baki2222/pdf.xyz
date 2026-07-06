/**
 * Pure, node-free **fold** for the release decision closeout governance finalize index trend FINALIZATION record (Phase
 * 79).
 *
 * Turns the ingested primary receipt (the trust boundary's output) + the ingested source-chain records + the applied
 * policy (the `--require-<kind>` flags + `--strict-open`) into the ONE composite
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup} — verdict + exit code + the source-chain
 * coverage a reviewer acts on — plus the closed set of
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReason} conditions that fired, the bounded
 * source-chain checklist, the primary-receipt summary, and the coverage rollup.
 *
 * The decision is a deterministic mapping over the primary receipt's coverage state (`unreadable` / `tampered` /
 * `usable`) and — when usable — its OWN verdict, ESCALATED by each supplied source-chain record's cross-check + posture
 * signal, with fail-closed severity precedence `invalid > blocking > incomplete > open > informational` (note INCOMPLETE
 * outranks OPEN — a coverage gap is resolved before an advisory open follow-up):
 *
 *  - unreadable receipt (missing / wrong-schema)              => `finalize-invalid`    (nothing trustworthy to finalize);
 *  - tampered receipt (recorded decision does not re-derive)  => `finalize-invalid`    (an untrustworthy receipt);
 *  - any tampered supplied source-chain record                => `finalize-invalid`    (an untrustworthy input);
 *  - a usable receipt folds its OWN verdict:
 *      completed => `finalized` (baseline)   incomplete => `finalize-incomplete`
 *      blocked   => `finalize-blocked`        invalid    => `finalize-blocked`;
 *  - each supplied source-chain record then ESCALATES: a cross-check mismatch (a supplied record that disagrees with what
 *    its downstream record recorded) => `finalize-blocked`; a blocking posture => `finalize-blocked`; an inconclusive
 *    posture (or a missing required record / unreadable record) => `finalize-incomplete`; an advisory posture =>
 *    `finalize-open`.
 *
 * `--strict-open` escalates an otherwise-`finalize-open` result (an advisory source chain) OR a `finalize-incomplete`
 * result caused by an INCOMPLETE primary receipt to `finalize-blocked` (a hard `finalized or blocked` gate); it leaves
 * `finalized`, an incomplete caused only by a missing / unreadable / inconclusive record, an already-`finalize-blocked`,
 * and a `finalize-invalid` result alone. When that escalation is the reason for the block, `strictOpenEscalated` is set
 * and `strictOpenEscalatedFrom` records the verdict it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_COHERENT_REASON,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CONTRADICTION_REASON,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICT_SUMMARY,
  type FinalizeIndexTrendFinalizeReceiptFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedFacets,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedRecord,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSource,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
} from "./types";
import type {
  IngestedFinalizeIndexTrendFinalizeReceipt,
  IngestedFinalizeIndexTrendFinalizeRelated,
} from "./ingest";

/** MY coverage state of the ingested primary receipt DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(
  receipt: IngestedFinalizeIndexTrendFinalizeReceipt,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState {
  if (!receipt.recognized) return "unreadable";
  if (!receipt.usable) return "tampered";
  return "usable";
}

/** MY coverage state of one source-chain record, from its supplied / recognized / usable flags. */
export function recordStateOf(
  record: IngestedFinalizeIndexTrendFinalizeRelated,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState {
  if (!record.supplied) return "absent";
  if (!record.recognized) return "unreadable";
  if (!record.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved finalization verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup["exitCode"] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT_FOR_VERDICT[verdict];
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > incomplete > open > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL[id].severity);
  if (severities.includes("invalid")) return "finalize-invalid";
  if (severities.includes("blocking")) return "finalize-blocked";
  if (severities.includes("incomplete")) return "finalize-incomplete";
  if (severities.includes("open")) return "finalize-open";
  return "finalized";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_IDS.filter((id) => fired.includes(id)).map(
    (id) => ({
      id,
      severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL[id].severity,
      detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL[id].detail,
    }),
  );
}

/**
 * The bounded cross-check anchors — the facets each source-chain record is compared against, derived from the usable
 * primary receipt + the usable adjacent record one level down the chain. A `null` anchor means "no anchor available"
 * (the cross-check cannot contradict; the record still folds its own posture).
 */
interface CrossCheckAnchors {
  /** For the `plan` cross-check (from the receipt). */
  readonly planVerdict: FinalizeIndexTrendFinalizeReceiptFacts["claimedPlanVerdict"];
  readonly planUrgency: FinalizeIndexTrendFinalizeReceiptFacts["planUrgency"];
  readonly planActionClass: FinalizeIndexTrendFinalizeReceiptFacts["planActionClass"];
  readonly planSourceTrendVerdict: FinalizeIndexTrendFinalizeReceiptFacts["sourceTrendVerdict"];
  readonly planSourceLatestIndex: FinalizeIndexTrendFinalizeReceiptFacts["sourceLatestIndex"];
  /** For the `trend` cross-check (verdict from the receipt / plan; class + direction from the plan). */
  readonly trendVerdict: FinalizeIndexTrendFinalizeReceiptFacts["sourceTrendVerdict"];
  readonly trendClass: Extract<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedFacets, { kind: "trend" }>["trendClass"] | null;
  readonly trendDirection: Extract<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedFacets, { kind: "trend" }>["direction"] | null;
  /** For the `index` cross-check (the trend's newest-window posture, or the plan's newest window via the receipt). */
  readonly latestIndex: FinalizeIndexTrendFinalizeReceiptFacts["sourceLatestIndex"];
  /** For the `finalization` cross-check (the index's newest finalization posture). */
  readonly latestFinalization: Extract<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedFacets, { kind: "index" }>["latestFinalization"] | null;
}

/** Compute the cross-check anchors from the usable receipt facts + the usable source-chain records (by kind). */
function anchorsFrom(
  receiptFacts: FinalizeIndexTrendFinalizeReceiptFacts | null,
  byKind: ReadonlyMap<
    ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
    IngestedFinalizeIndexTrendFinalizeRelated
  >,
): CrossCheckAnchors {
  const planRec = byKind.get("plan");
  const trendRec = byKind.get("trend");
  const indexRec = byKind.get("index");
  const planFacets = planRec?.usable && planRec.facets?.kind === "plan" ? planRec.facets : null;
  const trendFacets = trendRec?.usable && trendRec.facets?.kind === "trend" ? trendRec.facets : null;
  const indexFacets = indexRec?.usable && indexRec.facets?.kind === "index" ? indexRec.facets : null;
  return {
    planVerdict: receiptFacts?.claimedPlanVerdict ?? null,
    planUrgency: receiptFacts?.planUrgency ?? null,
    planActionClass: receiptFacts?.planActionClass ?? null,
    planSourceTrendVerdict: receiptFacts?.sourceTrendVerdict ?? null,
    planSourceLatestIndex: receiptFacts?.sourceLatestIndex ?? null,
    // A usable plan's own recorded source-trend verdict equals the receipt's (the receipt copied it); prefer whichever is
    // present so the trend can still be cross-checked when the receipt is not usable but the plan is.
    trendVerdict: planFacets?.sourceTrendVerdict ?? receiptFacts?.sourceTrendVerdict ?? null,
    trendClass: planFacets?.sourceTrendClass ?? null,
    trendDirection: planFacets?.sourceArcDirection ?? null,
    latestIndex: trendFacets?.latestIndex ?? receiptFacts?.sourceLatestIndex ?? null,
    latestFinalization: indexFacets?.latestFinalization ?? null,
  };
}

/** The outcome of a record's cross-check against its downstream anchor: agreement, a disagreement, or no anchor. */
type CrossCheck = "match" | "mismatch" | "unknown";

/** Cross-check one usable record's bounded facets against its downstream anchor. */
function crossCheck(
  facets: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedFacets,
  anchors: CrossCheckAnchors,
): CrossCheck {
  switch (facets.kind) {
    case "plan": {
      // Compare against the plan verdict / urgency / action class / source-trend / latest-index the receipt recorded. If
      // the receipt had no trusted plan to record (its own plan was not usable), there is nothing to contradict.
      if (anchors.planVerdict === null) return "unknown";
      if (
        facets.verdict !== anchors.planVerdict ||
        facets.urgency !== anchors.planUrgency ||
        facets.actionClass !== anchors.planActionClass ||
        facets.sourceTrendVerdict !== anchors.planSourceTrendVerdict ||
        facets.sourceLatestIndex !== anchors.planSourceLatestIndex
      ) {
        return "mismatch";
      }
      return "match";
    }
    case "trend": {
      // Compare against the source-trend verdict / class / direction the plan (via the receipt) recorded.
      if (anchors.trendVerdict === null && anchors.trendClass === null && anchors.trendDirection === null) {
        return "unknown";
      }
      if (anchors.trendVerdict !== null && facets.verdict !== anchors.trendVerdict) return "mismatch";
      if (anchors.trendClass !== null && facets.trendClass !== anchors.trendClass) return "mismatch";
      if (anchors.trendDirection !== null && facets.direction !== anchors.trendDirection) return "mismatch";
      return "match";
    }
    case "index": {
      // Compare against the newest-window finalize-index posture the trend (or the plan, via the receipt) recorded.
      if (anchors.latestIndex === null) return "unknown";
      return facets.verdict === anchors.latestIndex ? "match" : "mismatch";
    }
    case "finalization": {
      // Compare against the newest finalization posture the index recorded.
      if (anchors.latestFinalization === null) return "unknown";
      return facets.verdict === anchors.latestFinalization ? "match" : "mismatch";
    }
  }
}

/** Fold a usable record's OWN bounded verdict into its posture signal (clean / advisory / inconclusive / blocking). */
function postureOf(
  facets: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedFacets,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal {
  switch (facets.kind) {
    case "plan":
      switch (facets.verdict) {
        case "clear":
          return "coherent";
        case "monitor":
          return "advisory";
        case "investigate":
          return "insufficient";
        case "block-release":
        case "invalid":
          return "blocking";
      }
      break;
    case "trend":
      switch (facets.verdict) {
        case "improving":
        case "stable":
          return "coherent";
        case "watch":
        case "degrading":
          return "advisory";
        case "insufficient":
          return "insufficient";
        case "blocked":
        case "invalid":
          return "blocking";
      }
      break;
    case "index":
      switch (facets.verdict) {
        case "indexed":
          return "coherent";
        case "index-open":
          return "advisory";
        case "index-incomplete":
          return "insufficient";
        case "index-blocked":
        case "index-invalid":
          return "blocking";
      }
      break;
    case "finalization":
      switch (facets.verdict) {
        case "finalized":
          return "coherent";
        case "finalize-open":
          return "advisory";
        case "finalize-incomplete":
          return "insufficient";
        case "finalize-blocked":
          return "blocking";
      }
      break;
  }
  // Unreachable for a bounded verdict; the deepest coherent default keeps the fold total.
  return "coherent";
}

/**
 * The bounded signal a usable source-chain record contributes. A cross-check MISMATCH is `contradictory` (fails closed);
 * otherwise the record folds its OWN bounded posture. A non-usable record contributes `none` (its state carries the
 * coverage).
 */
export function relationSignalFor(
  record: IngestedFinalizeIndexTrendFinalizeRelated,
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState,
  anchors: CrossCheckAnchors,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal {
  if (state !== "usable" || record.facets === null) return "none";
  if (crossCheck(record.facets, anchors) === "mismatch") return "contradictory";
  return postureOf(record.facets);
}

/** The reason a supplied / required source-chain record fires, keyed off its coverage state + required flag + signal. */
function recordReason(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordState,
  required: boolean,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId | null {
  switch (state) {
    case "absent":
      return required ? "required-record-missing" : null;
    case "unreadable":
      // A required-but-unreadable record is a required coverage gap; an optional one is a supplied-but-unreadable gap.
      return required ? "required-record-missing" : "related-unreadable";
    case "tampered":
      return "related-tampered";
    case "usable":
      switch (signal) {
        case "coherent":
          return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_COHERENT_REASON[kind];
        case "contradictory":
          return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CONTRADICTION_REASON[kind];
        case "advisory":
          return "source-chain-advisory";
        case "insufficient":
          return "source-chain-insufficient";
        case "blocking":
          return "source-chain-blocked";
        case "none":
          return null;
      }
  }
}

/** The reason the primary receipt fires, keyed off its coverage state + (when usable) its OWN verdict. */
function receiptReason(
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState,
  facts: FinalizeIndexTrendFinalizeReceiptFacts | null,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId {
  if (state === "unreadable") return "receipt-unreadable";
  if (state === "tampered") return "receipt-tampered";
  // Usable: fold the receipt's OWN verdict.
  switch (facts!.receiptVerdict) {
    case "completed":
      return "receipt-completed";
    case "incomplete":
      return "receipt-incomplete";
    case "blocked":
      return "receipt-blocked";
    case "invalid":
      return "receipt-invalid";
  }
}

/** Build the bounded primary-receipt summary the result records (content-free; safe defaults when not usable). */
export function buildFinalizeSource(
  receipt: IngestedFinalizeIndexTrendFinalizeReceipt,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSource {
  const state = sourceStateOf(receipt);
  const facts = state === "usable" ? receipt.facts : null;
  return {
    state,
    // A usable receipt's trusted verdict; a tampered receipt surfaces its untrusted claimed verdict.
    receiptVerdict: state === "usable" ? (facts?.receiptVerdict ?? null) : receipt.claimedVerdict,
    planClass: facts ? facts.planClass : null,
    claimedPlanVerdict: facts ? facts.claimedPlanVerdict : null,
    planUrgency: facts ? facts.planUrgency : null,
    planActionClass: facts ? facts.planActionClass : null,
    sourceTrendVerdict: facts ? facts.sourceTrendVerdict : null,
    sourceLatestIndex: facts ? facts.sourceLatestIndex : null,
    receiptSourceState: facts ? facts.receiptSourceState : null,
    acksRequired: facts ? facts.acksRequired : 0,
    acksSatisfied: facts ? facts.acksSatisfied : 0,
    acksMissing: facts ? facts.acksMissing : 0,
    receiptStrictOpen: facts ? facts.receiptStrictOpen : false,
  };
}

/** The full outcome of the fold: the composite rollup, the fired reasons, the source-chain checklist, + the coverage. */
export interface ComputedFinalizeIndexTrendFinalize {
  readonly rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup;
  readonly reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReason[];
  readonly related: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedRecord[];
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeCoverage;
}

/**
 * Compute the composite finalization rollup + fired reasons + source-chain checklist + coverage from the ingested primary
 * receipt + source-chain records under the policy. Fail-closed: an unreadable / tampered receipt is `finalize-invalid`; a
 * tampered supplied record is `finalize-invalid`; a usable receipt folds its own verdict; every supplied record can only
 * ESCALATE via the severity precedence; `--strict-open` escalates an open / incomplete-receipt finalization to
 * `finalize-blocked`.
 */
export function computeFinalizeIndexTrendFinalize(
  receipt: IngestedFinalizeIndexTrendFinalizeReceipt,
  records: readonly IngestedFinalizeIndexTrendFinalizeRelated[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy,
): ComputedFinalizeIndexTrendFinalize {
  const state = sourceStateOf(receipt);
  const receiptFacts = state === "usable" ? receipt.facts : null;

  // Index the ingested records by kind so the checklist is emitted in canonical order regardless of supply order.
  const byKind = new Map<
    ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
    IngestedFinalizeIndexTrendFinalizeRelated
  >();
  for (const r of records) byKind.set(r.kind, r);
  const anchors = anchorsFrom(receiptFacts, byKind);

  const fired: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeReasonId[] = [];
  fired.push(receiptReason(state, receiptFacts));

  const related: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRelatedRecord[] = [];
  const requiredMissing: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind[] = [];
  for (const kind of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS) {
    const record =
      byKind.get(kind) ??
      ({ kind, supplied: false, recognized: false, usable: false, verdict: null, facets: null } as const);
    const recordState = recordStateOf(record);
    const required = policy.require[kind];
    const signal = relationSignalFor(record, recordState, anchors);
    const reason = recordReason(kind, recordState, required, signal);
    if (reason !== null) fired.push(reason);
    if (required && (recordState === "absent" || recordState === "unreadable")) requiredMissing.push(kind);
    related.push({
      kind,
      required,
      state: recordState,
      signal,
      verdict: recordState === "usable" ? record.verdict : null,
    });
  }

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of an open finalization OR a
  // finalize-incomplete caused by an INCOMPLETE primary receipt.
  const baseVerdict = verdictFrom(fired);
  const receiptIncomplete = fired.includes("receipt-incomplete");
  const strictOpenEscalated =
    policy.strictOpen &&
    (baseVerdict === "finalize-open" || (baseVerdict === "finalize-incomplete" && receiptIncomplete));
  const strictOpenEscalatedFrom: "finalize-open" | "finalize-incomplete" | null = strictOpenEscalated
    ? (baseVerdict as "finalize-open" | "finalize-incomplete")
    : null;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const invalid = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const usableRecords = related.filter((r) => r.state === "usable").length;
  const tamperedRecords = related.filter((r) => r.state === "tampered").length;
  const unreadableRecords = related.filter((r) => r.state === "unreadable").length;
  const relatedCoherent = related.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = related.filter((r) => r.signal === "contradictory").length;
  const requiredRecords = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS.filter(
    (k) => policy.require[k],
  ).length;

  const coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeCoverage = {
    hasReceipt: state === "usable",
    receiptState: state,
    requiredRecords,
    suppliedRecords: supplied.length,
    usableRecords,
    missingRecords: requiredMissing.length,
    tamperedRecords,
    unreadableRecords,
    coherentRecords: relatedCoherent,
    contradictoryRecords: relatedContradictory,
  };

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRollup = {
    verdict,
    exitCode: exitFor(verdict),
    finalized: verdict === "finalized",
    receiptState: state,
    receiptVerdict: state === "usable" ? (receiptFacts?.receiptVerdict ?? null) : receipt.claimedVerdict,
    planClass: receiptFacts ? receiptFacts.planClass : null,
    reasons: orderedIds,
    invalid,
    blocking,
    incomplete,
    open,
    informational,
    relatedSupplied: supplied.length,
    relatedCoherent,
    relatedContradictory,
    requiredMissing,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom,
    detail,
  };

  return { rollup, reasons, related, coverage };
}
