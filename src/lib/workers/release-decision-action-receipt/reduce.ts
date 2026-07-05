/**
 * Pure, node-free **fold** for the release decision action-plan execution receipt (Phase 63).
 *
 * Turns the ingested plan (the trust boundary's output) + the applied policy (the operator's bounded acknowledgements +
 * `--strict-open`) into the ONE composite {@link ReleaseDecisionActionReceiptRollup} — verdict + exit code + the
 * acknowledgement coverage a reviewer acts on — plus the closed set of {@link ReleaseDecisionActionReceiptReason}
 * conditions that fired and the bounded acknowledgement checklist.
 *
 * The decision is a deterministic mapping over the plan's coverage state (`unreadable` / `tampered` / `usable`), and —
 * when usable — the plan's coarse CLASS (`clear` / `monitor` / `investigate` / `block`) against the acknowledgements it
 * requires, with fail-closed severity precedence `blocking > open > incomplete > informational`:
 *
 *  - unreadable plan (missing / unusable)                 => `incomplete` (nothing to receipt; never a completed pass);
 *  - tampered plan (recorded decision does not re-derive) => `blocked`   (an untrustworthy plan);
 *  - a class ack supplied that contradicts the plan class => `blocked`   (a contradictory execution fact);
 *  - a `block` plan not acknowledged as held-blocked      => `blocked`   (`--ack-block` absent);
 *  - a `monitor` / `investigate` plan reviewed but its
 *    follow-up ack absent                                 => `followup-open` (an advisory open follow-up);
 *  - a plan not acknowledged as reviewed (`--ack-plan`),
 *    or a `block` plan held but missing a non-critical ack => `incomplete` (a coverage gap);
 *  - a usable plan with all required acknowledgements      => `completed`.
 *
 * `--strict-open` escalates an otherwise-`followup-open` receipt to `blocked` (a hard `closed-out or blocked` gate); it
 * leaves `completed`, `incomplete`, and an already-`blocked` receipt alone. When that escalation is the reason for the
 * block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the verdict it would have been.
 */

import {
  RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_ACTION_RECEIPT_VERDICT_SUMMARY,
  type ReleaseDecisionActionReceiptAckId,
  type ReleaseDecisionActionReceiptAcknowledgement,
  type ReleaseDecisionActionReceiptExitCode,
  type ReleaseDecisionActionReceiptPlanClass,
  type ReleaseDecisionActionReceiptPolicy,
  type ReleaseDecisionActionReceiptReason,
  type ReleaseDecisionActionReceiptReasonId,
  type ReleaseDecisionActionReceiptRollup,
  type ReleaseDecisionActionReceiptSourceState,
  type ReleaseDecisionActionReceiptVerdict,
} from "./types";
import type { IngestedPlan } from "./ingest";

/** MY coverage state of the ingested plan DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(ingested: IngestedPlan): ReleaseDecisionActionReceiptSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved receipt verdict. */
function exitFor(verdict: ReleaseDecisionActionReceiptVerdict): ReleaseDecisionActionReceiptExitCode {
  switch (verdict) {
    case "completed":
      return RELEASE_DECISION_ACTION_RECEIPT_EXIT.COMPLETED;
    case "incomplete":
      return RELEASE_DECISION_ACTION_RECEIPT_EXIT.INCOMPLETE;
    case "followup-open":
      return RELEASE_DECISION_ACTION_RECEIPT_EXIT.FOLLOWUP_OPEN;
    case "blocked":
      return RELEASE_DECISION_ACTION_RECEIPT_EXIT.BLOCKED;
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionActionReceiptReasonId[],
): ReleaseDecisionActionReceiptVerdict {
  const severities = fired.map((id) => RELEASE_DECISION_ACTION_RECEIPT_REASON_DETAIL[id].severity);
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("open")) return "followup-open";
  if (severities.includes("incomplete")) return "incomplete";
  return "completed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionActionReceiptReasonId[],
): ReleaseDecisionActionReceiptReason[] {
  return RELEASE_DECISION_ACTION_RECEIPT_REASON_IDS.filter((id) => fired.includes(id)).map((id) => ({
    id,
    severity: RELEASE_DECISION_ACTION_RECEIPT_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_ACTION_RECEIPT_REASON_DETAIL[id].detail,
  }));
}

/** Which class-specific acks were supplied that do NOT match the plan class (contradictions). */
function mismatchedAcksFor(
  planClass: ReleaseDecisionActionReceiptPlanClass,
  policy: ReleaseDecisionActionReceiptPolicy,
): ReleaseDecisionActionReceiptAckId[] {
  const expected = RELEASE_DECISION_ACTION_RECEIPT_CLASS_ACK[planClass];
  return RELEASE_DECISION_ACTION_RECEIPT_CLASS_ACKS.filter(
    (ack) => policy.ack[ack] && ack !== expected,
  );
}

/** The class-branch reason for a usable plan (excludes the mismatch + strict-open reasons, folded by the caller). */
function classReason(
  planClass: ReleaseDecisionActionReceiptPlanClass,
  policy: ReleaseDecisionActionReceiptPolicy,
): ReleaseDecisionActionReceiptReasonId {
  const { plan, followups, monitor, investigation, block } = policy.ack;
  switch (planClass) {
    case "clear":
      return plan ? "plan-acknowledged" : "plan-not-exercised";
    case "monitor":
      if (!plan) return "plan-not-exercised";
      return monitor && followups ? "monitor-followups-acknowledged" : "monitor-followup-open";
    case "investigate":
      if (!plan) return "plan-not-exercised";
      return investigation && followups ? "investigation-acknowledged" : "investigation-open";
    case "block":
      // The critical safety ack dominates: a block plan not confirmed held-blocked fails closed, regardless of review.
      if (!block) return "block-not-acknowledged";
      return plan && followups ? "block-acknowledged" : "block-acknowledgement-incomplete";
  }
}

/** The bounded acknowledgement checklist for the resolved required set (in {@link RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS} order). */
export function buildAcknowledgements(
  policy: ReleaseDecisionActionReceiptPolicy,
  required: readonly ReleaseDecisionActionReceiptAckId[],
): ReleaseDecisionActionReceiptAcknowledgement[] {
  return RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS.map((id) => {
    const supplied = policy.ack[id];
    const isRequired = required.includes(id);
    return { id, supplied, required: isRequired, satisfied: !isRequired || supplied };
  });
}

/** The full outcome of the fold: the composite rollup, the fired reasons, and the acknowledgement checklist. */
export interface ComputedReceipt {
  readonly rollup: ReleaseDecisionActionReceiptRollup;
  readonly reasons: ReleaseDecisionActionReceiptReason[];
  readonly acknowledgements: ReleaseDecisionActionReceiptAcknowledgement[];
}

/**
 * Compute the composite receipt rollup + fired reasons + acknowledgement checklist from the ingested plan under the
 * policy. Fail-closed: an unreadable plan is `incomplete`, a tampered plan is `blocked`, and a usable plan resolves
 * against the acknowledgements its class requires; `--strict-open` escalates an open follow-up to `blocked`.
 */
export function computeReceipt(
  ingested: IngestedPlan,
  policy: ReleaseDecisionActionReceiptPolicy,
): ComputedReceipt {
  const state = sourceStateOf(ingested);
  const planClass: ReleaseDecisionActionReceiptPlanClass | null = ingested.facts
    ? ingested.facts.planClass
    : null;

  const fired: ReleaseDecisionActionReceiptReasonId[] = [];
  let requiredAcks: readonly ReleaseDecisionActionReceiptAckId[] = [];
  let mismatchedAcks: ReleaseDecisionActionReceiptAckId[] = [];

  if (state === "unreadable") {
    fired.push("plan-unreadable");
  } else if (state === "tampered") {
    fired.push("plan-tampered");
  } else {
    // Usable: resolve against the plan class + the operator's acknowledgements.
    const cls = planClass!;
    requiredAcks = RELEASE_DECISION_ACTION_RECEIPT_REQUIRED_ACKS[cls];
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

  const suppliedAcks = RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS.filter((id) => policy.ack[id]);
  const missingAcks = requiredAcks.filter((id) => !policy.ack[id]);

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_ACTION_RECEIPT_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionActionReceiptRollup = {
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
