/**
 * Pure, node-free **fold** for the release decision closeout bundle (Phase 64).
 *
 * Turns the ingested primary receipt (the trust boundary's output) + the ingested related records + the applied policy
 * (the `--require-*` flags + `--strict-open`) into the ONE composite {@link ReleaseDecisionCloseoutRollup} — verdict +
 * exit code + the related-record coverage a reviewer acts on — plus the closed set of {@link ReleaseDecisionCloseoutReason}
 * conditions that fired and the bounded related-record checklist.
 *
 * The decision is a deterministic mapping over the primary receipt's coverage state (`unreadable` / `tampered` / `usable`)
 * and — when usable — its OWN verdict, ESCALATED by each supplied related record's cross-check / posture signal, with
 * fail-closed severity precedence `blocking > open > incomplete > informational`:
 *
 *  - unreadable receipt (missing / unusable)              => `closeout-incomplete` (nothing to close out);
 *  - tampered receipt (recorded decision does not re-derive) => `closeout-blocked` (an untrustworthy receipt);
 *  - a usable receipt folds its OWN verdict:
 *      completed => `closed` (baseline)   incomplete => `closeout-incomplete`
 *      followup-open => `closeout-open`   blocked    => `closeout-blocked`;
 *  - each supplied related record then ESCALATES: a tampered record or a blocked source chain => `closeout-blocked`; a
 *    cross-check mismatch (a supplied plan / trend that disagrees with the receipt) => `closeout-blocked`; an advisory
 *    decision / index posture => `closeout-open`; an insufficient posture or a missing required record => `closeout-incomplete`.
 *
 * `--strict-open` escalates an otherwise-`closeout-open` result to `closeout-blocked` (a hard `closed or blocked` gate); it
 * leaves `closed`, `closeout-incomplete`, and an already-`closeout-blocked` result alone. When that escalation is the
 * reason for the block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the verdict it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_EXIT,
  RELEASE_DECISION_CLOSEOUT_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutExitCode,
  type ReleaseDecisionCloseoutPolicy,
  type ReleaseDecisionCloseoutReason,
  type ReleaseDecisionCloseoutReasonId,
  type ReleaseDecisionCloseoutRecordKind,
  type ReleaseDecisionCloseoutRelatedRecord,
  type ReleaseDecisionCloseoutRelationSignal,
  type ReleaseDecisionCloseoutRollup,
  type ReleaseDecisionCloseoutSourceState,
  type ReleaseDecisionCloseoutVerdict,
} from "./types";
import type { CloseoutReceiptFacts } from "./types";
import type { IngestedCloseoutReceipt, IngestedRelatedRecord } from "./ingest";

/** MY coverage state of the ingested primary receipt DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(receipt: IngestedCloseoutReceipt): ReleaseDecisionCloseoutSourceState {
  if (!receipt.recognized) return "unreadable";
  if (!receipt.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved closeout verdict. */
function exitFor(verdict: ReleaseDecisionCloseoutVerdict): ReleaseDecisionCloseoutExitCode {
  switch (verdict) {
    case "closed":
      return RELEASE_DECISION_CLOSEOUT_EXIT.CLOSED;
    case "closeout-incomplete":
      return RELEASE_DECISION_CLOSEOUT_EXIT.INCOMPLETE;
    case "closeout-open":
      return RELEASE_DECISION_CLOSEOUT_EXIT.OPEN;
    case "closeout-blocked":
      return RELEASE_DECISION_CLOSEOUT_EXIT.BLOCKED;
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(fired: readonly ReleaseDecisionCloseoutReasonId[]): ReleaseDecisionCloseoutVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "closeout-blocked";
  if (severities.includes("open")) return "closeout-open";
  if (severities.includes("incomplete")) return "closeout-incomplete";
  return "closed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutReasonId[],
): ReleaseDecisionCloseoutReason[] {
  return RELEASE_DECISION_CLOSEOUT_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_REASON_DETAIL[id].detail,
  }));
}

/**
 * The bounded signal a usable related record contributes. Cross-check records (`plan` / `trend`) compare against what the
 * primary receipt recorded (a mismatch is `contradictory`); source-chain records (`decision` / `index`) fold their OWN
 * bounded posture. A non-usable record contributes `none` (its state carries the coverage).
 */
export function relationSignalFor(
  record: IngestedRelatedRecord,
  receiptFacts: CloseoutReceiptFacts | null,
): ReleaseDecisionCloseoutRelationSignal {
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
        facts.sourceTrendVerdict === receiptFacts.sourceTrendVerdict;
      return matches ? "coherent" : "contradictory";
    }
    case "trend": {
      // Cross-check the supplied trend against the source-trend verdict the plan (via the receipt) recorded.
      if (receiptFacts === null || receiptFacts.sourceTrendVerdict === null) return "coherent";
      return facts.verdict === receiptFacts.sourceTrendVerdict ? "coherent" : "contradictory";
    }
    case "index": {
      // Fold the decision-index verdict's own posture: stable → coherent, watch → advisory, insufficient →
      // insufficient, blocked/invalid → blocking.
      switch (facts.verdict) {
        case "stable":
          return "coherent";
        case "watch":
          return "advisory";
        case "insufficient":
          return "insufficient";
        case "blocked":
        case "invalid":
          return "blocking";
        default:
          return "coherent";
      }
    }
    case "decision": {
      // Fold the decision-ledger decision's own posture: proceed → coherent, followup/hold → advisory, insufficient →
      // insufficient, reject/invalid → blocking.
      switch (facts.verdict) {
        case "proceed":
          return "coherent";
        case "proceed-with-followup":
        case "hold":
          return "advisory";
        case "insufficient":
          return "insufficient";
        case "reject":
        case "invalid":
          return "blocking";
        default:
          return "coherent";
      }
    }
  }
}

/** Whether a `--require-<kind>` was set for this record. */
function requiredFor(kind: ReleaseDecisionCloseoutRecordKind, policy: ReleaseDecisionCloseoutPolicy): boolean {
  return policy.require[kind];
}

/** The fired reason for a usable related record, keyed off its computed signal. */
function usableRecordReason(
  kind: ReleaseDecisionCloseoutRecordKind,
  signal: ReleaseDecisionCloseoutRelationSignal,
): ReleaseDecisionCloseoutReasonId | null {
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
  signal: ReleaseDecisionCloseoutRelationSignal,
): ReleaseDecisionCloseoutReasonId | null {
  switch (record.state) {
    case "absent":
      return required ? "required-record-missing" : null;
    case "unreadable":
      // A required-but-unreadable record is a required coverage gap; an optional one is a supplied-but-unreadable gap.
      return required ? "required-record-missing" : "related-unreadable";
    case "tampered":
      return "related-tampered";
    case "usable":
      return usableRecordReason(record.kind, signal);
  }
}

/** The reason the primary receipt fires, keyed off its coverage state + (when usable) its OWN verdict. */
function receiptReason(
  state: ReleaseDecisionCloseoutSourceState,
  facts: CloseoutReceiptFacts | null,
): ReleaseDecisionCloseoutReasonId {
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

/** The full outcome of the fold: the composite rollup, the fired reasons, and the related-record checklist. */
export interface ComputedCloseout {
  readonly rollup: ReleaseDecisionCloseoutRollup;
  readonly reasons: ReleaseDecisionCloseoutReason[];
  readonly related: ReleaseDecisionCloseoutRelatedRecord[];
}

/**
 * Compute the composite closeout rollup + fired reasons + related-record checklist from the ingested primary receipt +
 * related records under the policy. Fail-closed: an unreadable receipt is `closeout-incomplete`, a tampered receipt is
 * `closeout-blocked`, a usable receipt folds its own verdict, and every supplied related record can only ESCALATE via the
 * severity precedence; `--strict-open` escalates an open closeout to `closeout-blocked`.
 */
export function computeCloseout(
  receipt: IngestedCloseoutReceipt,
  records: readonly IngestedRelatedRecord[],
  policy: ReleaseDecisionCloseoutPolicy,
): ComputedCloseout {
  const state = sourceStateOf(receipt);
  const receiptFacts = receipt.facts;

  // Index the ingested records by kind so the checklist is emitted in canonical order regardless of supply order.
  const byKind = new Map<ReleaseDecisionCloseoutRecordKind, IngestedRelatedRecord>();
  for (const r of records) byKind.set(r.kind, r);

  const fired: ReleaseDecisionCloseoutReasonId[] = [];
  fired.push(receiptReason(state, receiptFacts));

  const related: ReleaseDecisionCloseoutRelatedRecord[] = [];
  const requiredMissing: ReleaseDecisionCloseoutRecordKind[] = [];
  for (const kind of RELEASE_DECISION_CLOSEOUT_RECORD_KINDS) {
    const record = byKind.get(kind) ?? { kind, state: "absent" as const, facts: null };
    const required = requiredFor(kind, policy);
    const signal = relationSignalFor(record, receiptFacts);
    const reason = recordReason(record, required, signal);
    if (reason !== null) fired.push(reason);
    if (required && (record.state === "absent" || record.state === "unreadable")) requiredMissing.push(kind);
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
  const strictOpenEscalated = baseVerdict === "closeout-open" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const supplied = related.filter((r) => r.state !== "absent");
  const relatedCoherent = supplied.filter((r) => r.signal === "coherent").length;
  const relatedContradictory = supplied.filter((r) => r.signal === "contradictory").length;
  const relatedBlocking = supplied.filter((r) => r.signal === "blocking" || r.state === "tampered").length;

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutRollup = {
    verdict,
    exitCode: exitFor(verdict),
    closed: verdict === "closed",
    receiptState: state,
    receiptVerdict: state === "usable" ? receiptFacts!.receiptVerdict : receipt.claimedVerdict,
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
    strictOpenEscalatedFrom: strictOpenEscalated ? "closeout-open" : null,
    detail,
  };

  return { rollup, reasons, related };
}
