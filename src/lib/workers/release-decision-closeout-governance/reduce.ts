/**
 * Pure, node-free **fold** for the release decision closeout governance bundle (Phase 69).
 *
 * Turns the ingested primary receipt (the trust boundary's output) + the ingested related records + the applied policy
 * (the `--require-<kind>` flags + `--strict-open`) into the ONE composite {@link ReleaseDecisionCloseoutGovernanceRollup}
 * — verdict + exit code + the related-record coverage a reviewer acts on — plus the closed set of
 * {@link ReleaseDecisionCloseoutGovernanceReason} conditions that fired, the bounded related-record checklist, the
 * primary-receipt summary, and the coverage rollup.
 *
 * The decision is a deterministic mapping over the primary receipt's coverage state (`unreadable` / `tampered` /
 * `usable`) and — when usable — its OWN verdict, ESCALATED by each supplied related record's cross-check / posture signal,
 * with fail-closed severity precedence `blocking > open > incomplete > informational`:
 *
 *  - unreadable receipt (missing / unusable)                 => `governance-incomplete` (nothing to certify);
 *  - tampered receipt (recorded decision does not re-derive) => `governance-blocked` (an untrustworthy receipt);
 *  - a usable receipt folds its OWN verdict:
 *      completed => `closed` (baseline)      incomplete => `governance-incomplete`
 *      followup-open => `governance-open`     blocked    => `governance-blocked`;
 *  - each supplied related record then ESCALATES: a tampered record or a blocked source chain => `governance-blocked`; a
 *    cross-check mismatch (a supplied plan / trend that disagrees with the receipt) => `governance-blocked`; an advisory
 *    source-chain posture => `governance-open`; an insufficient posture or a missing required record =>
 *    `governance-incomplete`.
 *
 * `--strict-open` escalates an otherwise-`governance-open` result to `governance-blocked` (a hard `closed or blocked`
 * gate); it leaves `closed`, `governance-incomplete`, and an already-`governance-blocked` result alone. When that
 * escalation is the reason for the block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the verdict
 * it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICT_SUMMARY,
  type GovernanceReceiptFacts,
  type ReleaseDecisionCloseoutGovernanceCoverage,
  type ReleaseDecisionCloseoutGovernancePolicy,
  type ReleaseDecisionCloseoutGovernanceReason,
  type ReleaseDecisionCloseoutGovernanceReasonId,
  type ReleaseDecisionCloseoutGovernanceRecordKind,
  type ReleaseDecisionCloseoutGovernanceRecordState,
  type ReleaseDecisionCloseoutGovernanceRelatedRecord,
  type ReleaseDecisionCloseoutGovernanceRelationSignal,
  type ReleaseDecisionCloseoutGovernanceRollup,
  type ReleaseDecisionCloseoutGovernanceSource,
  type ReleaseDecisionCloseoutGovernanceSourceState,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "./types";
import type {
  IngestedCloseoutGovernanceReceipt,
  IngestedGovernanceRelatedRecord,
} from "./ingest";

/** MY coverage state of the ingested primary receipt DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(
  receipt: IngestedCloseoutGovernanceReceipt,
): ReleaseDecisionCloseoutGovernanceSourceState {
  if (!receipt.recognized) return "unreadable";
  if (!receipt.usable) return "tampered";
  return "usable";
}

/** MY coverage state of one related record, from its supplied / recognized / usable flags. */
export function recordStateOf(
  record: IngestedGovernanceRelatedRecord,
): ReleaseDecisionCloseoutGovernanceRecordState {
  if (!record.supplied) return "absent";
  if (!record.recognized) return "unreadable";
  if (!record.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved governance verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutGovernanceVerdict,
): ReleaseDecisionCloseoutGovernanceRollup["exitCode"] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT_FOR_VERDICT[verdict];
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceReasonId[],
): ReleaseDecisionCloseoutGovernanceVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "governance-blocked";
  if (severities.includes("open")) return "governance-open";
  if (severities.includes("incomplete")) return "governance-incomplete";
  return "closed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceReasonId[],
): ReleaseDecisionCloseoutGovernanceReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_DETAIL[id].detail,
  }));
}

/**
 * The bounded signal a usable related record contributes. Cross-check records (`plan` / `trend`) compare against what the
 * primary receipt recorded (a mismatch is `contradictory`); source-chain records (`index` / `closeout`) fold their OWN
 * bounded posture. A non-usable record contributes `none` (its state carries the coverage).
 */
export function relationSignalFor(
  record: IngestedGovernanceRelatedRecord,
  state: ReleaseDecisionCloseoutGovernanceRecordState,
  receiptFacts: GovernanceReceiptFacts | null,
): ReleaseDecisionCloseoutGovernanceRelationSignal {
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
      // Fold the closeout-index verdict's own posture.
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
    case "closeout": {
      // Fold the closeout bundle's own posture.
      switch (verdict) {
        case "closed":
          return "coherent";
        case "closeout-open":
          return "advisory";
        case "closeout-incomplete":
          return "insufficient";
        case "closeout-blocked":
          return "blocking";
        default:
          return "coherent";
      }
    }
  }
}

/** The fired reason for a usable related record, keyed off its computed signal. */
function usableRecordReason(
  kind: ReleaseDecisionCloseoutGovernanceRecordKind,
  signal: ReleaseDecisionCloseoutGovernanceRelationSignal,
): ReleaseDecisionCloseoutGovernanceReasonId | null {
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
  kind: ReleaseDecisionCloseoutGovernanceRecordKind,
  state: ReleaseDecisionCloseoutGovernanceRecordState,
  required: boolean,
  signal: ReleaseDecisionCloseoutGovernanceRelationSignal,
): ReleaseDecisionCloseoutGovernanceReasonId | null {
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
  state: ReleaseDecisionCloseoutGovernanceSourceState,
  facts: GovernanceReceiptFacts | null,
): ReleaseDecisionCloseoutGovernanceReasonId {
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
export function buildGovernanceSource(
  receipt: IngestedCloseoutGovernanceReceipt,
): ReleaseDecisionCloseoutGovernanceSource {
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
export interface ComputedGovernance {
  readonly rollup: ReleaseDecisionCloseoutGovernanceRollup;
  readonly reasons: ReleaseDecisionCloseoutGovernanceReason[];
  readonly related: ReleaseDecisionCloseoutGovernanceRelatedRecord[];
  readonly coverage: ReleaseDecisionCloseoutGovernanceCoverage;
}

/**
 * Compute the composite governance rollup + fired reasons + related-record checklist + coverage from the ingested primary
 * receipt + related records under the policy. Fail-closed: an unreadable receipt is `governance-incomplete`, a tampered
 * receipt is `governance-blocked`, a usable receipt folds its own verdict, and every supplied related record can only
 * ESCALATE via the severity precedence; `--strict-open` escalates an open governance to `governance-blocked`.
 */
export function computeGovernance(
  receipt: IngestedCloseoutGovernanceReceipt,
  records: readonly IngestedGovernanceRelatedRecord[],
  policy: ReleaseDecisionCloseoutGovernancePolicy,
): ComputedGovernance {
  const state = sourceStateOf(receipt);
  const receiptFacts = state === "usable" ? receipt.facts : null;

  // Index the ingested records by kind so the checklist is emitted in canonical order regardless of supply order.
  const byKind = new Map<ReleaseDecisionCloseoutGovernanceRecordKind, IngestedGovernanceRelatedRecord>();
  for (const r of records) byKind.set(r.kind, r);

  const fired: ReleaseDecisionCloseoutGovernanceReasonId[] = [];
  fired.push(receiptReason(state, receiptFacts));

  const related: ReleaseDecisionCloseoutGovernanceRelatedRecord[] = [];
  const requiredMissing: ReleaseDecisionCloseoutGovernanceRecordKind[] = [];
  for (const kind of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RECORD_KINDS) {
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

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of an open governance.
  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "governance-open" && policy.strictOpen;
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

  const coverage: ReleaseDecisionCloseoutGovernanceCoverage = {
    hasReceipt: state === "usable",
    relatedSupplied: supplied.length,
    relatedUsable,
    relatedCoherent,
    relatedContradictory,
    relatedBlocking,
  };

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceRollup = {
    verdict,
    exitCode: exitFor(verdict),
    closed: verdict === "closed",
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
    strictOpenEscalatedFrom: strictOpenEscalated ? "governance-open" : null,
    detail,
  };

  return { rollup, reasons, related, coverage };
}
