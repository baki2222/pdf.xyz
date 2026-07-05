/**
 * Pure, node-free **fold** for the release decision closeout governance finalization bundle (Phase 74).
 *
 * Turns the ingested primary receipt (the trust boundary's output) + the ingested related records + the applied policy
 * (the `--require-<kind>` flags + `--strict-open`) into the ONE composite
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeRollup} — verdict + exit code + the related-record coverage a reviewer
 * acts on — plus the closed set of {@link ReleaseDecisionCloseoutGovernanceFinalizeReason} conditions that fired, the
 * bounded related-record checklist, the primary-receipt summary, and the coverage rollup.
 *
 * The decision is a deterministic mapping over the primary receipt's coverage state (`unreadable` / `tampered` /
 * `usable`) and — when usable — its OWN verdict, ESCALATED by each supplied related record's cross-check / posture signal,
 * with fail-closed severity precedence `blocking > open > incomplete > informational`:
 *
 *  - unreadable receipt (missing / unusable)                 => `finalize-incomplete` (nothing to finalize);
 *  - tampered receipt (recorded decision does not re-derive) => `finalize-blocked` (an untrustworthy receipt);
 *  - a usable receipt folds its OWN verdict:
 *      completed => `finalized` (baseline)   incomplete => `finalize-incomplete`
 *      followup-open => `finalize-open`       blocked    => `finalize-blocked`;
 *  - each supplied related record then ESCALATES: a tampered record or a blocked source chain => `finalize-blocked`; a
 *    cross-check mismatch (a supplied plan / trend that disagrees with the receipt) => `finalize-blocked`; an advisory
 *    source-chain posture => `finalize-open`; an insufficient posture or a missing required record =>
 *    `finalize-incomplete`.
 *
 * `--strict-open` escalates an otherwise-`finalize-open` result to `finalize-blocked` (a hard `finalized or blocked`
 * gate); it leaves `finalized`, `finalize-incomplete`, and an already-`finalize-blocked` result alone. When that
 * escalation is the reason for the block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the verdict
 * it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICT_SUMMARY,
  type GovernanceFinalizeReceiptFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizePolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord,
  type ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal,
  type ReleaseDecisionCloseoutGovernanceFinalizeRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeSource,
  type ReleaseDecisionCloseoutGovernanceFinalizeSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "./types";
import type {
  IngestedGovernanceFinalizeReceipt,
  IngestedGovernanceFinalizeRelatedRecord,
} from "./ingest";

/** MY coverage state of the ingested primary receipt DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(
  receipt: IngestedGovernanceFinalizeReceipt,
): ReleaseDecisionCloseoutGovernanceFinalizeSourceState {
  if (!receipt.recognized) return "unreadable";
  if (!receipt.usable) return "tampered";
  return "usable";
}

/** MY coverage state of one related record, from its supplied / recognized / usable flags. */
export function recordStateOf(
  record: IngestedGovernanceFinalizeRelatedRecord,
): ReleaseDecisionCloseoutGovernanceFinalizeRecordState {
  if (!record.supplied) return "absent";
  if (!record.recognized) return "unreadable";
  if (!record.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved finalization verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeRollup["exitCode"] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_EXIT_FOR_VERDICT[verdict];
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "finalize-blocked";
  if (severities.includes("open")) return "finalize-open";
  if (severities.includes("incomplete")) return "finalize-incomplete";
  return "finalized";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_REASON_DETAIL[id].detail,
  }));
}

/**
 * The bounded signal a usable related record contributes. Cross-check records (`plan` / `trend`) compare against what the
 * primary receipt recorded (a mismatch is `contradictory`); source-chain records (`index` / `governance`) fold their OWN
 * bounded posture. A non-usable record contributes `none` (its state carries the coverage).
 */
export function relationSignalFor(
  record: IngestedGovernanceFinalizeRelatedRecord,
  state: ReleaseDecisionCloseoutGovernanceFinalizeRecordState,
  receiptFacts: GovernanceFinalizeReceiptFacts | null,
): ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal {
  if (state !== "usable" || record.verdict === null) return "none";
  const verdict = record.verdict;
  switch (record.kind) {
    case "plan": {
      // Cross-check the supplied plan against the plan verdict the receipt recorded. If the receipt has no trusted plan
      // to compare against (its own plan was not usable), we cannot contradict it → coherent context.
      if (receiptFacts === null || receiptFacts.claimedPlanVerdict === null) return "coherent";
      return verdict === receiptFacts.claimedPlanVerdict ? "coherent" : "contradictory";
    }
    case "trend": {
      // Cross-check the supplied trend against the source-trend verdict the plan (via the receipt) recorded.
      if (receiptFacts === null || receiptFacts.sourceTrendVerdict === null) return "coherent";
      return verdict === receiptFacts.sourceTrendVerdict ? "coherent" : "contradictory";
    }
    case "index": {
      // Fold the governance-index verdict's own posture.
      switch (verdict) {
        case "indexed":
          return "coherent";
        case "index-open":
          return "advisory";
        case "index-incomplete":
          return "insufficient";
        case "index-blocked":
          return "blocking";
        default:
          return "coherent";
      }
    }
    case "governance": {
      // Fold the governance bundle's own posture.
      switch (verdict) {
        case "closed":
          return "coherent";
        case "governance-open":
          return "advisory";
        case "governance-incomplete":
          return "insufficient";
        case "governance-blocked":
          return "blocking";
        default:
          return "coherent";
      }
    }
  }
}

/** The fired reason for a usable related record, keyed off its computed signal. */
function usableRecordReason(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeReasonId | null {
  switch (signal) {
    case "coherent":
      if (kind === "plan") return "plan-coherent";
      if (kind === "trend") return "trend-coherent";
      return "source-chain-coherent";
    case "contradictory":
      // Only cross-check records (plan / trend) can contradict.
      return kind === "plan" ? "plan-contradiction" : kind === "trend" ? "trend-contradiction" : null;
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

/** The reason a supplied / required related record fires, keyed off its coverage state + required flag. */
function recordReason(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  state: ReleaseDecisionCloseoutGovernanceFinalizeRecordState,
  required: boolean,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeReasonId | null {
  switch (state) {
    case "absent":
      return required ? "required-record-missing" : null;
    case "unreadable":
      // A required-but-unreadable record is a required coverage gap; an optional one is a supplied-but-unreadable gap.
      return required ? "required-record-missing" : "related-unreadable";
    case "tampered":
      return "related-tampered";
    case "usable":
      return usableRecordReason(kind, signal);
  }
}

/** The reason the primary receipt fires, keyed off its coverage state + (when usable) its OWN verdict. */
function receiptReason(
  state: ReleaseDecisionCloseoutGovernanceFinalizeSourceState,
  facts: GovernanceFinalizeReceiptFacts | null,
): ReleaseDecisionCloseoutGovernanceFinalizeReasonId {
  if (state === "unreadable") return "receipt-unreadable";
  if (state === "tampered") return "receipt-tampered";
  // Usable: fold the receipt's OWN verdict.
  switch (facts!.receiptVerdict) {
    case "completed":
      return "receipt-completed";
    case "incomplete":
      return "receipt-incomplete";
    case "followup-open":
      return "receipt-followup-open";
    case "blocked":
      return "receipt-blocked";
  }
}

/** Build the bounded primary-receipt summary the result records (content-free; safe defaults when not usable). */
export function buildGovernanceFinalizeSource(
  receipt: IngestedGovernanceFinalizeReceipt,
): ReleaseDecisionCloseoutGovernanceFinalizeSource {
  const state = sourceStateOf(receipt);
  const facts = state === "usable" ? receipt.facts : null;
  return {
    state,
    // A usable receipt's trusted verdict; a tampered receipt surfaces its untrusted claimed verdict.
    receiptVerdict: state === "usable" ? (facts?.receiptVerdict ?? null) : receipt.claimedVerdict,
    planClass: facts ? facts.planClass : null,
    claimedPlanVerdict: facts ? facts.claimedPlanVerdict : null,
    sourceTrendVerdict: facts ? facts.sourceTrendVerdict : null,
    sourceLatestIndex: facts ? facts.sourceLatestIndex : null,
    receiptSourceState: facts ? facts.receiptSourceState : null,
    acksRequired: facts ? facts.acksRequired : 0,
    acksSatisfied: facts ? facts.acksSatisfied : 0,
    acksMissing: facts ? facts.acksMissing : 0,
    receiptStrictOpen: facts ? facts.receiptStrictOpen : false,
  };
}

/** The full outcome of the fold: the composite rollup, the fired reasons, the related-record checklist, + the coverage. */
export interface ComputedGovernanceFinalize {
  readonly rollup: ReleaseDecisionCloseoutGovernanceFinalizeRollup;
  readonly reasons: ReleaseDecisionCloseoutGovernanceFinalizeReason[];
  readonly related: ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord[];
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeCoverage;
}

/**
 * Compute the composite finalization rollup + fired reasons + related-record checklist + coverage from the ingested
 * primary receipt + related records under the policy. Fail-closed: an unreadable receipt is `finalize-incomplete`, a
 * tampered receipt is `finalize-blocked`, a usable receipt folds its own verdict, and every supplied related record can
 * only ESCALATE via the severity precedence; `--strict-open` escalates an open finalization to `finalize-blocked`.
 */
export function computeGovernanceFinalize(
  receipt: IngestedGovernanceFinalizeReceipt,
  records: readonly IngestedGovernanceFinalizeRelatedRecord[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizePolicy,
): ComputedGovernanceFinalize {
  const state = sourceStateOf(receipt);
  const receiptFacts = state === "usable" ? receipt.facts : null;

  // Index the ingested records by kind so the checklist is emitted in canonical order regardless of supply order.
  const byKind = new Map<ReleaseDecisionCloseoutGovernanceFinalizeRecordKind, IngestedGovernanceFinalizeRelatedRecord>();
  for (const r of records) byKind.set(r.kind, r);

  const fired: ReleaseDecisionCloseoutGovernanceFinalizeReasonId[] = [];
  fired.push(receiptReason(state, receiptFacts));

  const related: ReleaseDecisionCloseoutGovernanceFinalizeRelatedRecord[] = [];
  const requiredMissing: ReleaseDecisionCloseoutGovernanceFinalizeRecordKind[] = [];
  for (const kind of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS) {
    const record = byKind.get(kind) ?? {
      kind,
      supplied: false as const,
      recognized: false as const,
      usable: false as const,
      verdict: null,
    };
    const recordState = recordStateOf(record);
    const required = policy.require[kind];
    const signal = relationSignalFor(record, recordState, receiptFacts);
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

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of an open finalization.
  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "finalize-open" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const relatedUsable = related.filter((r) => r.state === "usable").length;
  const relatedCoherent = supplied.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = supplied.filter((r) => r.signal === "contradictory").length;
  const relatedBlocking = supplied.filter((r) => r.signal === "blocking" || r.state === "tampered").length;

  const coverage: ReleaseDecisionCloseoutGovernanceFinalizeCoverage = {
    hasReceipt: state === "usable",
    relatedSupplied: supplied.length,
    relatedUsable,
    relatedCoherent,
    relatedContradictory,
    relatedBlocking,
  };

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeRollup = {
    verdict,
    exitCode: exitFor(verdict),
    finalized: verdict === "finalized",
    receiptState: state,
    receiptVerdict: state === "usable" ? (receiptFacts?.receiptVerdict ?? null) : receipt.claimedVerdict,
    planClass: receiptFacts ? receiptFacts.planClass : null,
    reasons: orderedIds,
    blocking,
    open,
    incomplete,
    informational,
    relatedSupplied: supplied.length,
    relatedCoherent,
    relatedContradictory,
    relatedBlocking,
    requiredMissing,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom: strictOpenEscalated ? "finalize-open" : null,
    detail,
  };

  return { rollup, reasons, related, coverage };
}
