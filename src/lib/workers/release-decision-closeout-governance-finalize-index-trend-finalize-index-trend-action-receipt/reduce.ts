/**
 * Pure, node-free **fold** for the release decision closeout governance finalize index trend finalize index trend
 * action-plan execution receipt (Phase 83).
 *
 * Turns the ingested plan (the trust boundary's output) + the applied policy (the operator's bounded acknowledgements +
 * `--strict-open`) into the ONE composite
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptRollup} — verdict + exit code +
 * the acknowledgement coverage a reviewer acts on — plus the closed set of
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReason} conditions that fired,
 * the bounded acknowledgement checklist, and the bounded next-action ids.
 *
 * The decision is a deterministic mapping over the plan's coverage state (`unreadable` / `tampered` / `usable`), and —
 * when usable — the plan's coarse CLASS (`clear` / `monitor` / `investigate` / `block`) against the acknowledgements it
 * requires, with fail-closed severity precedence `invalid > blocking > open > incomplete > informational`:
 *
 *  - unreadable plan (missing / unusable / wrong-schema)  => `invalid`      (nothing trustworthy to receipt; fails closed);
 *  - tampered plan (recorded decision does not re-derive) => `invalid`      (an untrustworthy plan);
 *  - a class ack supplied that contradicts the plan class => `blocked`      (a contradictory execution fact);
 *  - a `block` plan not acknowledged as held-blocked      => `blocked`      (`--ack-block` absent);
 *  - a `monitor` / `investigate` plan reviewed but its
 *    follow-up ack absent                                 => `followup-open`(an advisory open follow-up);
 *  - a plan not acknowledged as reviewed (`--ack-plan`),
 *    or a `block` plan held but missing a non-critical ack => `incomplete`  (a coverage gap);
 *  - a usable plan with all required acknowledgements      => `completed`.
 *
 * A `block-release` plan whose acks are all present is `completed` — but the receipt records the release as HELD, never
 * promoted. A trustworthy plan whose OWN verdict is `invalid` maps to the `block` class (its source-trend input was
 * untrustworthy, so the release stays held); the receipt's own `invalid` verdict is reserved for an untrustworthy plan
 * DOCUMENT (unreadable / tampered / wrong schema).
 *
 * `--strict-open` escalates an otherwise-`followup-open` receipt to `blocked` (a hard `closed-out or blocked` gate); it
 * leaves `completed`, `incomplete`, an already-`blocked`, and an `invalid` receipt alone. When that escalation is the
 * reason for the block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the verdict it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAcknowledgement,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptNextActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict,
} from "./types";
import type { IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan } from "./ingest";

/** MY coverage state of the ingested plan DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(
  ingested: IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved receipt verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptExitCode {
  switch (verdict) {
    case "completed":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.COMPLETED;
    case "incomplete":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.INCOMPLETE;
    case "followup-open":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.FOLLOWUP_OPEN;
    case "blocked":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.BLOCKED;
    case "invalid":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.INVALID;
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptVerdict {
  const severities = fired.map(
    (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity,
  );
  if (severities.includes("invalid")) return "invalid";
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("open")) return "followup-open";
  if (severities.includes("incomplete")) return "incomplete";
  return "completed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS.filter((id) =>
    fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].detail,
  }));
}

/** Which class-specific acks were supplied that do NOT match the plan class (contradictions). */
function mismatchedAcksFor(
  planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[] {
  const expected = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK[planClass];
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS.filter(
    (ack) => policy.ack[ack] && ack !== expected,
  );
}

/** The class-branch reason for a usable plan (excludes the mismatch + strict-open reasons, folded by the caller). */
function classReason(
  planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId {
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
      // A block plan stays held. The critical safety ack decides the reason: unacknowledged (blocking), held-but-
      // incomplete (a non-critical ack absent → incomplete), or fully acknowledged-as-held (completed, still held).
      if (!block) return "block-not-acknowledged";
      return plan && followups ? "block-acknowledged" : "block-acknowledgement-incomplete";
  }
}

/** The bounded acknowledgement checklist for the resolved required set (in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS} order). */
export function buildAcknowledgements(
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy,
  required: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAcknowledgement[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS.map((id) => {
    const supplied = policy.ack[id];
    const isRequired = required.includes(id);
    return { id, supplied, required: isRequired, satisfied: !isRequired || supplied };
  });
}

/** The block-class reasons (a `block-release` plan always yields one — held whether acknowledged or not). */
const BLOCK_REASONS: ReadonlySet<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId> =
  new Set(["block-not-acknowledged", "block-acknowledgement-incomplete", "block-acknowledged"]);

/** Derive the bounded, ordered, deduped next-action ids from the fired reasons + coverage gaps. */
function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId[],
  missingCount: number,
  mismatchedCount: number,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptNextActionId[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptNextActionId>();
  for (const id of fired) {
    if (RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity === "invalid") {
      wanted.add("recover-valid-plan");
    }
    if (BLOCK_REASONS.has(id)) wanted.add("hold-promotion");
  }
  if (mismatchedCount > 0) wanted.add("resolve-contradiction");
  if (missingCount > 0) wanted.add("supply-missing-ack");
  wanted.add("keep-action-receipt"); // always the last step — keep the content-free close-out record
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS.filter((id) =>
    wanted.has(id),
  );
}

/** The full outcome of the fold: the composite rollup, the fired reasons, the acknowledgement checklist, + next actions. */
export interface ComputedFinalizeIndexTrendFinalizeIndexTrendActionReceipt {
  readonly rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptRollup;
  readonly reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReason[];
  readonly acknowledgements: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAcknowledgement[];
  readonly nextActions: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptNextActionId[];
}

/**
 * Compute the composite receipt rollup + fired reasons + acknowledgement checklist + next actions from the ingested plan
 * under the policy. Fail-closed: a missing / unreadable / tampered / wrong-schema plan is `invalid`; a `block` plan not
 * acknowledged as held is `blocked`; a contradictory acknowledgement is `blocked`; a usable plan resolves against the
 * acknowledgements its class requires; `--strict-open` escalates an open follow-up to `blocked`.
 */
export function computeReceipt(
  ingested: IngestedFinalizeIndexTrendFinalizeIndexTrendActionPlan,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPolicy,
): ComputedFinalizeIndexTrendFinalizeIndexTrendActionReceipt {
  const state = sourceStateOf(ingested);
  const facts = ingested.facts;

  const fired: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptReasonId[] = [];
  let planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptPlanClass | null = null;
  let requiredAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[] = [];
  let mismatchedAcks: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptAckId[] = [];

  if (state === "unreadable") {
    fired.push("plan-unreadable");
  } else if (state === "tampered") {
    fired.push("plan-tampered");
  } else {
    // Usable: resolve against the plan class + the operator's acknowledgements. A plan whose OWN verdict is `invalid`
    // resolves to the `block` class (its source-trend input was untrustworthy → the release stays held).
    planClass = facts!.planClass;
    const cls = planClass;
    requiredAcks = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS[cls];
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

  const invalid = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const open = reasons.filter((r) => r.severity === "open").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const suppliedAcks = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS.filter(
    (id) => policy.ack[id],
  );
  const missingAcks = requiredAcks.filter((id) => !policy.ack[id]);

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptRollup = {
    verdict,
    exitCode: exitFor(verdict),
    planClass,
    completed: verdict === "completed",
    reasons: orderedIds,
    invalid,
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

  return {
    rollup,
    reasons,
    acknowledgements: buildAcknowledgements(policy, requiredAcks),
    nextActions: buildNextActions(orderedIds, missingAcks.length, mismatchedAcks.length),
  };
}
