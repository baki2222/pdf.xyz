/**
 * Pure, node-free **fold** for the release decision closeout action-plan execution receipt (Phase 68).
 *
 * Turns the ingested plan (the trust boundary's output) + the applied policy (the operator's bounded acknowledgements +
 * `--strict-open`) into the ONE composite {@link ReleaseDecisionCloseoutActionReceiptRollup} — verdict + exit code + the
 * acknowledgement coverage a reviewer acts on — plus the closed set of {@link ReleaseDecisionCloseoutActionReceiptReason}
 * conditions that fired and the bounded acknowledgement checklist.
 *
 * The decision is a deterministic mapping over the plan's coverage state (`unreadable` / `tampered` / `usable`), and —
 * when usable — the plan's coarse CLASS (`clear` / `investigate` / `monitor` / `block`) against the acknowledgements it
 * requires, with fail-closed severity precedence `blocking > open > incomplete > informational`:
 *
 *  - unreadable plan (missing / unusable)                 => `blocked`   (nothing trustworthy to receipt; fails closed);
 *  - tampered plan (recorded decision does not re-derive) => `blocked`   (an untrustworthy plan);
 *  - a class ack supplied that contradicts the plan class => `blocked`   (a contradictory execution fact);
 *  - a `block` plan not acknowledged as held-blocked      => `blocked`   (`--ack-block` absent);
 *  - a `monitor` plan reviewed but its follow-up ack
 *    absent                                               => `followup-open` (an open monitor follow-up);
 *  - a `clear` / `investigate` plan not fully acknowledged,
 *    or a `block` plan held but missing a non-critical ack => `incomplete` (a coverage gap);
 *  - a usable plan with all required acknowledgements      => `completed`.
 *
 * `--strict-open` escalates an otherwise-`followup-open` receipt to `blocked` (a hard `closed-out or blocked` gate); it
 * leaves `completed`, `incomplete`, and an already-`blocked` receipt alone. When that escalation is the reason for the
 * block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the verdict it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutActionReceiptAckId,
  type ReleaseDecisionCloseoutActionReceiptAcknowledgement,
  type ReleaseDecisionCloseoutActionReceiptExitCode,
  type ReleaseDecisionCloseoutActionReceiptPlanClass,
  type ReleaseDecisionCloseoutActionReceiptPolicy,
  type ReleaseDecisionCloseoutActionReceiptReason,
  type ReleaseDecisionCloseoutActionReceiptReasonId,
  type ReleaseDecisionCloseoutActionReceiptRollup,
  type ReleaseDecisionCloseoutActionReceiptSourceState,
  type ReleaseDecisionCloseoutActionReceiptVerdict,
} from "./types";
import type { IngestedCloseoutPlan } from "./ingest";

/** MY coverage state of the ingested plan DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(ingested: IngestedCloseoutPlan): ReleaseDecisionCloseoutActionReceiptSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved receipt verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutActionReceiptVerdict,
): ReleaseDecisionCloseoutActionReceiptExitCode {
  switch (verdict) {
    case "completed":
      return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.COMPLETED;
    case "incomplete":
      return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.INCOMPLETE;
    case "followup-open":
      return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.FOLLOWUP_OPEN;
    case "blocked":
      return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.BLOCKED;
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutActionReceiptReasonId[],
): ReleaseDecisionCloseoutActionReceiptVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("open")) return "followup-open";
  if (severities.includes("incomplete")) return "incomplete";
  return "completed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutActionReceiptReasonId[],
): ReleaseDecisionCloseoutActionReceiptReason[] {
  return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL[id].detail,
  }));
}

/** Which class-specific acks were supplied that do NOT match the plan class (contradictions). */
function mismatchedAcksFor(
  planClass: ReleaseDecisionCloseoutActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutActionReceiptPolicy,
): ReleaseDecisionCloseoutActionReceiptAckId[] {
  const expected = RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACK[planClass];
  return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACKS.filter(
    (ack) => policy.ack[ack] && ack !== expected,
  );
}

/** The class-branch reason for a usable plan (excludes the mismatch + strict-open reasons, folded by the caller). */
function classReason(
  planClass: ReleaseDecisionCloseoutActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutActionReceiptPolicy,
): ReleaseDecisionCloseoutActionReceiptReasonId {
  const { plan, executed, monitor, investigation, block } = policy.ack;
  switch (planClass) {
    case "clear":
      return plan ? "plan-acknowledged" : "plan-not-exercised";
    case "investigate":
      if (!plan) return "plan-not-exercised";
      // A `trend-incomplete` coverage gap closes out only when the investigation is acknowledged AND the follow-up was
      // executed; an unfinished investigation is a coverage gap (incomplete), never an open advisory follow-up.
      return investigation && executed ? "investigation-acknowledged" : "investigation-incomplete";
    case "monitor":
      if (!plan) return "plan-not-exercised";
      return monitor && executed ? "monitor-acknowledged" : "monitor-followup-open";
    case "block":
      // The critical safety ack dominates: a block plan not confirmed held-blocked fails closed, regardless of review.
      if (!block) return "block-not-acknowledged";
      return plan && executed ? "block-acknowledged" : "block-acknowledgement-incomplete";
  }
}

/** The bounded acknowledgement checklist for the resolved required set (in {@link RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_ACK_IDS} order). */
export function buildAcknowledgements(
  policy: ReleaseDecisionCloseoutActionReceiptPolicy,
  required: readonly ReleaseDecisionCloseoutActionReceiptAckId[],
): ReleaseDecisionCloseoutActionReceiptAcknowledgement[] {
  return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_ACK_IDS.map((id) => {
    const supplied = policy.ack[id];
    const isRequired = required.includes(id);
    return { id, supplied, required: isRequired, satisfied: !isRequired || supplied };
  });
}

/** The full outcome of the fold: the composite rollup, the fired reasons, and the acknowledgement checklist. */
export interface ComputedReceipt {
  readonly rollup: ReleaseDecisionCloseoutActionReceiptRollup;
  readonly reasons: ReleaseDecisionCloseoutActionReceiptReason[];
  readonly acknowledgements: ReleaseDecisionCloseoutActionReceiptAcknowledgement[];
}

/**
 * Compute the composite receipt rollup + fired reasons + acknowledgement checklist from the ingested plan under the
 * policy. Fail-closed: an unreadable / tampered plan is `blocked`, and a usable plan resolves against the
 * acknowledgements its class requires; `--strict-open` escalates an open monitor follow-up to `blocked`.
 */
export function computeReceipt(
  ingested: IngestedCloseoutPlan,
  policy: ReleaseDecisionCloseoutActionReceiptPolicy,
): ComputedReceipt {
  const state = sourceStateOf(ingested);
  const planClass: ReleaseDecisionCloseoutActionReceiptPlanClass | null = ingested.facts
    ? ingested.facts.planClass
    : null;

  const fired: ReleaseDecisionCloseoutActionReceiptReasonId[] = [];
  let requiredAcks: readonly ReleaseDecisionCloseoutActionReceiptAckId[] = [];
  let mismatchedAcks: ReleaseDecisionCloseoutActionReceiptAckId[] = [];

  if (state === "unreadable") {
    fired.push("plan-unreadable");
  } else if (state === "tampered") {
    fired.push("plan-tampered");
  } else {
    // Usable: resolve against the plan class + the operator's acknowledgements.
    const cls = planClass!;
    requiredAcks = RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS[cls];
    mismatchedAcks = mismatchedAcksFor(cls, policy);
    if (mismatchedAcks.length > 0) fired.push("acknowledgement-mismatch");
    fired.push(classReason(cls, policy));
  }

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of an open follow-up.
  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "followup-open" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const suppliedAcks = RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_ACK_IDS.filter((id) => policy.ack[id]);
  const missingAcks = requiredAcks.filter((id) => !policy.ack[id]);

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutActionReceiptRollup = {
    verdict,
    exitCode: exitFor(verdict),
    planClass,
    completed: verdict === "completed",
    reasons: orderedIds,
    blocking,
    open,
    incomplete,
    informational,
    requiredAcks,
    suppliedAcks,
    missingAcks,
    mismatchedAcks,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom: strictOpenEscalated ? "followup-open" : null,
    detail,
  };

  return { rollup, reasons, acknowledgements: buildAcknowledgements(policy, requiredAcks) };
}
