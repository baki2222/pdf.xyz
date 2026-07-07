/**
 * Pure, node-free **fold** for the release decision closeout governance finalize index trend finalize index trend
 * closeout bundle (Phase 84).
 *
 * Turns the ingested primary receipt (the trust boundary's output) + the ingested related records + the applied policy
 * (the `--require-*` flags + `--strict-open`) into the ONE composite
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutCoverage} — verdict + exit code +
 * the related-record coverage a reviewer acts on — plus the closed set of fired reasons, the bounded related-record
 * checklist, the bounded source-chain posture summary, and the ordered next-action checklist.
 *
 * The decision is a deterministic mapping over the primary receipt's coverage state (`unreadable` / `tampered` / `usable`)
 * and — when usable — its OWN verdict, ESCALATED by each supplied related record's cross-check / posture signal, with
 * fail-closed severity precedence `invalid > blocking > open > incomplete > informational`:
 *
 *  - unreadable / tampered receipt (untrustworthy)          => `invalid` (there is nothing trustworthy to close out);
 *  - a usable receipt folds its OWN verdict:
 *      completed => `closed` (baseline)   incomplete    => `incomplete`
 *      followup-open => `open`            blocked       => `blocked`   invalid => `invalid`;
 *  - each supplied related record then ESCALATES: a tampered / unreadable record => `blocked`; a cross-check mismatch (a
 *    supplied plan / trend that disagrees with the receipt) => `blocked`; a blocked finalization-index window => `blocked`;
 *    an advisory window posture => `open`; an insufficient window posture => `incomplete`; a missing required record =>
 *    `incomplete`.
 *
 * `--strict-open` escalates an otherwise-`open` result to `blocked` (a hard `closed or blocked` gate); it leaves `closed`,
 * `incomplete`, `invalid`, and an already-`blocked` result alone — so it never weakens invalid / incomplete precedence.
 * When that escalation is the reason for the block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the
 * verdict it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICT_SUMMARY,
  type CloseoutReceiptFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutNextAction,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutNextActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelatedRecord,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelationSignal,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutSourceChain,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "./types";
import type { IngestedCloseoutReceipt, IngestedRelatedRecord } from "./ingest";

/** MY coverage state of the ingested primary receipt DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(
  receipt: IngestedCloseoutReceipt,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutSourceState {
  if (!receipt.recognized) return "unreadable";
  if (!receipt.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved closeout verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutExitCode {
  switch (verdict) {
    case "closed":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.CLOSED;
    case "incomplete":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.INCOMPLETE;
    case "open":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.OPEN;
    case "blocked":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.BLOCKED;
    case "invalid":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.INVALID;
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > open > incomplete). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict {
  const severities = fired.map(
    (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL[id].severity,
  );
  if (severities.includes("invalid")) return "invalid";
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("open")) return "open";
  if (severities.includes("incomplete")) return "incomplete";
  return "closed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_IDS.filter((id) =>
    fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_REASON_DETAIL[id].detail,
  }));
}

/**
 * The bounded signal a usable related record contributes. Cross-check records (`plan` / `trend`) compare against what the
 * primary receipt recorded (a mismatch is `contradictory`); the source-chain `index` record folds its OWN bounded
 * posture. A non-usable record contributes `none` (its state carries the coverage).
 */
export function relationSignalFor(
  record: IngestedRelatedRecord,
  receiptFacts: CloseoutReceiptFacts | null,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelationSignal {
  if (record.state !== "usable" || record.facts === null) return "none";
  const facts = record.facts;
  switch (record.kind) {
    case "plan": {
      // Cross-check the supplied plan against the plan the receipt receipted. If the receipt has no trusted plan to
      // compare against (its own plan was not usable), we cannot contradict it → coherent context.
      if (receiptFacts === null || receiptFacts.claimedPlanVerdict === null) return "coherent";
      const matches =
        facts.verdict === receiptFacts.claimedPlanVerdict &&
        facts.planClass === receiptFacts.planClass &&
        facts.planUrgency === receiptFacts.planUrgency &&
        facts.planActionClass === receiptFacts.planActionClass &&
        facts.sourceTrendVerdict === receiptFacts.sourceTrendVerdict &&
        facts.sourceLatestIndex === receiptFacts.sourceLatestIndex;
      return matches ? "coherent" : "contradictory";
    }
    case "trend": {
      // Cross-check the supplied trend against the source-trend verdict the plan (via the receipt) recorded.
      if (receiptFacts === null || receiptFacts.sourceTrendVerdict === null) return "coherent";
      return facts.verdict === receiptFacts.sourceTrendVerdict ? "coherent" : "contradictory";
    }
    case "index": {
      // Fold the finalization-index window verdict's own posture: indexed → coherent, index-open → advisory,
      // index-incomplete → insufficient, index-blocked/index-invalid → blocking.
      switch (facts.verdict) {
        case "indexed":
          return "coherent";
        case "index-open":
          return "advisory";
        case "index-incomplete":
          return "insufficient";
        case "index-blocked":
        case "index-invalid":
          return "blocking";
        default:
          return "coherent";
      }
    }
  }
}

/** Whether a `--require-<kind>` was set for this record. */
function requiredFor(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutPolicy,
): boolean {
  return policy.require[kind];
}

/** The fired reason for a usable related record, keyed off its computed signal. */
function usableRecordReason(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId | null {
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
  record: IngestedRelatedRecord,
  required: boolean,
  signal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelationSignal,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId | null {
  switch (record.state) {
    case "absent":
      // A missing required record is a coverage gap; an absent optional record contributes nothing.
      return required ? "required-record-missing" : null;
    case "unreadable":
      // A supplied-but-unreadable record is a trust problem regardless of required: it can never close out the loop.
      return "related-unreadable";
    case "tampered":
      return "related-tampered";
    case "usable":
      return usableRecordReason(record.kind, signal);
  }
}

/** The reason the primary receipt fires, keyed off its coverage state + (when usable) its OWN verdict. */
function receiptReason(
  state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutSourceState,
  facts: CloseoutReceiptFacts | null,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId {
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
    case "invalid":
      return "receipt-invalid";
  }
}

/** Which next-action id (if any) a fired reason maps to. */
function nextActionForReason(
  id: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutNextActionId | null {
  switch (id) {
    case "receipt-unreadable":
    case "receipt-tampered":
    case "receipt-invalid":
      return "recover-valid-receipt";
    case "receipt-blocked":
      return "reconcile-blocked-receipt";
    case "related-tampered":
    case "related-unreadable":
      return "recover-related-record";
    case "plan-contradiction":
    case "trend-contradiction":
      return "reconcile-contradiction";
    case "source-chain-blocked":
      return "reconcile-source-chain";
    case "strict-open-escalation":
      return "review-strict-open";
    case "receipt-followup-open":
    case "source-chain-advisory":
      return "close-open-followup";
    case "required-record-missing":
      return "supply-required-record";
    case "receipt-incomplete":
    case "source-chain-insufficient":
      return "complete-evidence";
    default:
      return null;
  }
}

/** Build the ordered, deduped next-action checklist from the fired reasons (plus the always-on archive / out-of-band steps). */
function computeNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutNextAction[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutNextActionId>();
  for (const id of fired) {
    const next = nextActionForReason(id);
    if (next !== null) wanted.add(next);
  }
  // Always the last two steps: archive this content-free record, and record governance in its own systems.
  wanted.add("archive-closeout");
  wanted.add("record-governance-out-of-band");
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_IDS.filter((id) =>
    wanted.has(id),
  ).map((id) => ({
    id,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_NEXT_ACTION_DETAIL[id],
  }));
}

/** The full outcome of the fold: the composite coverage, the fired reasons, the related-record checklist, source chain, next actions. */
export interface ComputedCloseout {
  readonly coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutCoverage;
  readonly reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReason[];
  readonly related: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelatedRecord[];
  readonly sourceChain: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutSourceChain;
  readonly nextActions: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutNextAction[];
}

/**
 * Compute the composite closeout coverage + fired reasons + related-record checklist + source-chain posture + next
 * actions from the ingested primary receipt + related records under the policy. Fail-closed: an unreadable / tampered
 * receipt is `invalid`, a usable receipt folds its own verdict, and every supplied related record can only ESCALATE via
 * the severity precedence; `--strict-open` escalates an open closeout to `blocked`.
 */
export function computeCloseout(
  receipt: IngestedCloseoutReceipt,
  records: readonly IngestedRelatedRecord[],
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutPolicy,
): ComputedCloseout {
  const state = sourceStateOf(receipt);
  const receiptFacts = receipt.facts;

  // Index the ingested records by kind so the checklist is emitted in canonical order regardless of supply order.
  const byKind = new Map<
    ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind,
    IngestedRelatedRecord
  >();
  for (const r of records) byKind.set(r.kind, r);

  const fired: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutReasonId[] = [];
  fired.push(receiptReason(state, receiptFacts));

  const related: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelatedRecord[] = [];
  const requiredMissing: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRecordKind[] = [];
  let indexRecord: IngestedRelatedRecord | undefined;
  let indexSignal: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutRelationSignal = "none";
  for (const kind of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS) {
    const record = byKind.get(kind) ?? { kind, state: "absent" as const, facts: null };
    const required = requiredFor(kind, policy);
    const signal = relationSignalFor(record, receiptFacts);
    const reason = recordReason(record, required, signal);
    if (reason !== null) fired.push(reason);
    if (required && record.state === "absent") requiredMissing.push(kind);
    if (kind === "index") {
      indexRecord = record;
      indexSignal = signal;
    }
    related.push({
      kind,
      required,
      state: record.state,
      signal,
      verdict: record.state === "usable" && record.facts ? record.facts.verdict : null,
    });
  }

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of an open closeout.
  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "open" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);
  const nextActions = computeNextActions(orderedIds);

  const invalid = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const relatedCoherent = supplied.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = supplied.filter((r) => r.signal === "contradictory").length;
  const relatedBlocking = supplied.filter(
    (r) => r.signal === "blocking" || r.state === "tampered" || r.state === "unreadable",
  ).length;

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICT_SUMMARY[verdict];

  const coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutCoverage = {
    verdict,
    exitCode: exitFor(verdict),
    closed: verdict === "closed",
    receiptState: state,
    receiptVerdict: state === "usable" ? receiptFacts!.receiptVerdict : receipt.claimedVerdict,
    planClass: receiptFacts ? receiptFacts.planClass : null,
    reasons: orderedIds,
    invalid,
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
    strictOpenEscalatedFrom: strictOpenEscalated ? "open" : null,
    detail,
  };

  const sourceChain: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutSourceChain = {
    receiptTrendVerdict: receiptFacts ? receiptFacts.sourceTrendVerdict : null,
    receiptLatestIndex: receiptFacts ? receiptFacts.sourceLatestIndex : null,
    indexState: indexRecord ? indexRecord.state : "absent",
    indexVerdict:
      indexRecord && indexRecord.state === "usable" && indexRecord.facts
        ? (indexRecord.facts.verdict as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutSourceChain["indexVerdict"])
        : null,
    posture: indexSignal,
  };

  return { coverage, reasons, related, sourceChain, nextActions };
}
