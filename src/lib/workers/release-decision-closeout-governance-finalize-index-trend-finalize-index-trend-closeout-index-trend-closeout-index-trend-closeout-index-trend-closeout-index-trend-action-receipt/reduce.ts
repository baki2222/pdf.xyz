/**
 * Pure, node-free **fold** for the release decision closeout governance finalize index trend finalize index trend closeout index trend
 * action-plan execution receipt (Phase 88).
 *
 * Turns the ingested plan (the trust boundary's output) + the applied policy (the operator's bounded acknowledgements +
 * `--strict-open`) into the ONE composite
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptRollup} — verdict + exit code +
 * the acknowledgement coverage a reviewer acts on — plus the closed set of
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReason} conditions that fired,
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
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAckId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAcknowledgement,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptNextActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
} from "./types";
import type { IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan } from "./ingest";

/** MY coverage state of the ingested plan DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(
  ingested: IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved receipt verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptExitCode {
  switch (verdict) {
    case "completed":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT.COMPLETED;
    case "incomplete":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT.INCOMPLETE;
    case "followup-open":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT.FOLLOWUP_OPEN;
    case "blocked":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT.BLOCKED;
    case "invalid":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT.INVALID;
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > open > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict {
  const severities = fired.map(
    (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity,
  );
  if (severities.includes("invalid")) return "invalid";
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("open")) return "followup-open";
  if (severities.includes("incomplete")) return "incomplete";
  return "completed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_IDS.filter((id) =>
    fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].detail,
  }));
}

/** Which class-specific acks were supplied that do NOT match the plan class (contradictions). */
function mismatchedAcksFor(
  planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAckId[] {
  const expected = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK[planClass];
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS.filter(
    (ack) => policy.ack[ack] && ack !== expected,
  );
}

/** The class-branch reason for a usable plan (excludes the mismatch + strict-open reasons, folded by the caller). */
function classReason(
  planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReasonId {
  const { plan, clear, monitor, investigation, block } = policy.ack;
  switch (planClass) {
    case "clear":
      // A clear plan needs review + acceptance for routine monitoring; a missing acceptance is a coverage gap (no
      // follow-up to leave open), not an advisory follow-up.
      if (!plan) return "plan-not-exercised";
      return clear ? "clear-acknowledged" : "clear-not-accepted";
    case "monitor":
      if (!plan) return "plan-not-exercised";
      return monitor ? "monitor-acknowledged" : "monitor-followup-open";
    case "investigate":
      if (!plan) return "plan-not-exercised";
      return investigation ? "investigation-acknowledged" : "investigation-open";
    case "block":
      // A block plan stays held. The critical safety ack decides the reason: unacknowledged (blocking), held-but-
      // incomplete (the review ack absent → incomplete), or fully acknowledged-as-held (completed, still held).
      if (!block) return "block-not-acknowledged";
      return plan ? "block-acknowledged" : "block-acknowledgement-incomplete";
  }
}

/** The bounded acknowledgement checklist for the resolved required set (in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS} order). */
export function buildAcknowledgements(
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy,
  required: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAckId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAcknowledgement[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS.map((id) => {
    const supplied = policy.ack[id];
    const isRequired = required.includes(id);
    return { id, supplied, required: isRequired, satisfied: !isRequired || supplied };
  });
}

/** The block-class reasons (a `block-release` plan always yields one — held whether acknowledged or not). */
const BLOCK_REASONS: ReadonlySet<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReasonId> =
  new Set(["block-not-acknowledged", "block-acknowledgement-incomplete", "block-acknowledged"]);

/** Derive the bounded, ordered, deduped next-action ids from the fired reasons + coverage gaps. */
function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReasonId[],
  missingCount: number,
  mismatchedCount: number,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptNextActionId[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptNextActionId>();
  for (const id of fired) {
    if (RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity === "invalid") {
      wanted.add("recover-valid-plan");
    }
    if (BLOCK_REASONS.has(id)) wanted.add("hold-promotion");
  }
  if (mismatchedCount > 0) wanted.add("resolve-contradiction");
  if (missingCount > 0) wanted.add("supply-missing-ack");
  wanted.add("keep-action-receipt"); // always the last step — keep the content-free close-out record
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS.filter((id) =>
    wanted.has(id),
  );
}

/** The full outcome of the fold: the composite rollup, the fired reasons, the acknowledgement checklist, + next actions. */
export interface ComputedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt {
  readonly rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptRollup;
  readonly reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReason[];
  readonly acknowledgements: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAcknowledgement[];
  readonly nextActions: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptNextActionId[];
}

/**
 * Compute the composite receipt rollup + fired reasons + acknowledgement checklist + next actions from the ingested plan
 * under the policy. Fail-closed: a missing / unreadable / tampered / wrong-schema plan is `invalid`; a `block` plan not
 * acknowledged as held is `blocked`; a contradictory acknowledgement is `blocked`; a usable plan resolves against the
 * acknowledgements its class requires; `--strict-open` escalates an open follow-up to `blocked`.
 */
export function computeReceipt(
  ingested: IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy,
): ComputedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt {
  const state = sourceStateOf(ingested);
  const facts = ingested.facts;

  const fired: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptReasonId[] = [];
  let planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPlanClass | null = null;
  let requiredAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAckId[] = [];
  let mismatchedAcks: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAckId[] = [];

  if (state === "unreadable") {
    fired.push("plan-unreadable");
  } else if (state === "tampered") {
    fired.push("plan-tampered");
  } else {
    // Usable: resolve against the plan class + the operator's acknowledgements. A plan whose OWN verdict is `invalid`
    // resolves to the `block` class (its source-trend input was untrustworthy → the release stays held).
    planClass = facts!.planClass;
    const cls = planClass;
    requiredAcks = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS[cls];
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

  const suppliedAcks = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS.filter(
    (id) => policy.ack[id],
  );
  const missingAcks = requiredAcks.filter((id) => !policy.ack[id]);

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptRollup = {
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
