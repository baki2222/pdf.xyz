/**
 * Pure, node-free **fold** for the release decision closeout governance finalize index trend action-plan execution
 * receipt (Phase 78).
 *
 * Turns the ingested plan (the trust boundary's output) + the applied policy (the operator's bounded acknowledgements +
 * `--strict-open`) into the ONE composite {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptRollup}
 * — verdict + exit code + the acknowledgement coverage a reviewer acts on — plus the closed set of
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReason} conditions that fired, the bounded
 * acknowledgement checklist, and the bounded next-action ids.
 *
 * The decision is a deterministic mapping over the plan's coverage state (`unreadable` / `tampered` / `usable`), and —
 * when usable — the plan's coarse CLASS (`clear` / `monitor` / `investigate` / `block`, or the plan's own `invalid`
 * verdict) against the acknowledgements it requires, with fail-closed severity precedence
 * `invalid > blocking > incomplete > informational`:
 *
 *  - unreadable plan (missing / unusable)                 => `invalid`    (nothing trustworthy to receipt; fails closed);
 *  - tampered plan (recorded decision does not re-derive) => `invalid`    (an untrustworthy plan);
 *  - a usable plan whose OWN verdict is `invalid`         => `invalid`    (regardless of the flags supplied);
 *  - a `block-release` plan                               => `blocked`    (the release stays held — acknowledging it
 *                                                                          records the hold, never a close-out);
 *  - a class ack supplied that contradicts the plan class => `blocked`    (a contradictory execution fact);
 *  - a `clear` / `monitor` / `investigate` plan not fully
 *    acknowledged                                         => `incomplete` (a coverage gap);
 *  - a usable `clear` / `monitor` / `investigate` plan
 *    with all required acknowledgements                   => `completed`.
 *
 * `--strict-open` escalates an otherwise-`incomplete` receipt (any missing required acknowledgement) to `blocked` (a hard
 * `closed-out or blocked` gate); it leaves `completed`, an already-`blocked`, and an `invalid` receipt alone. When that
 * escalation is the reason for the block, `strictOpenEscalated` is set and `strictOpenEscalatedFrom` records the verdict
 * it would have been.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAcknowledgement,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptNextActionId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReason,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
} from "./types";
import type { IngestedFinalizeIndexTrendActionPlan } from "./ingest";

/** MY coverage state of the ingested plan DOCUMENT, from its recognized / usable flags. */
export function sourceStateOf(
  ingested: IngestedFinalizeIndexTrendActionPlan,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptSourceState {
  if (!ingested.recognized) return "unreadable";
  if (!ingested.usable) return "tampered";
  return "usable";
}

/** The exit code for a resolved receipt verdict. */
function exitFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptExitCode {
  switch (verdict) {
    case "completed":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.COMPLETED;
    case "incomplete":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.INCOMPLETE;
    case "blocked":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.BLOCKED;
    case "invalid":
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.INVALID;
  }
}

/** Fold the fired reasons' severities into the composite verdict (precedence invalid > blocking > incomplete > else). */
function verdictFrom(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict {
  const severities = fired.map(
    (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity,
  );
  if (severities.includes("invalid")) return "invalid";
  if (severities.includes("blocking")) return "blocked";
  if (severities.includes("incomplete")) return "incomplete";
  return "completed";
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids, in canonical order. */
export function buildReasons(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReason[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS.filter((id) =>
    fired.includes(id),
  ).map((id) => ({
    id,
    severity: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].detail,
  }));
}

/** Which class-specific acks were supplied that do NOT match the plan class (contradictions). */
function mismatchedAcksFor(
  planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[] {
  const expected = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK[planClass];
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS.filter(
    (ack) => policy.ack[ack] && ack !== expected,
  );
}

/** The class-branch reason for a usable, closeable plan (excludes the mismatch + strict-open reasons, folded by the caller). */
function classReason(
  planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId {
  const { plan, executed, monitor, investigation, block } = policy.ack;
  switch (planClass) {
    case "clear":
      return plan ? "plan-acknowledged" : "plan-not-exercised";
    case "monitor":
      if (!plan) return "plan-not-exercised";
      return monitor && executed ? "monitor-acknowledged" : "monitor-incomplete";
    case "investigate":
      if (!plan) return "plan-not-exercised";
      return investigation && executed ? "investigation-acknowledged" : "investigation-incomplete";
    case "block":
      // A block plan is ALWAYS blocked (the release stays held). The critical safety ack decides which blocking reason:
      // unacknowledged, held-but-incomplete, or fully acknowledged (still held, never a close-out).
      if (!block) return "block-not-acknowledged";
      return plan && executed ? "block-acknowledged" : "block-acknowledgement-incomplete";
  }
}

/** The bounded acknowledgement checklist for the resolved required set (in {@link RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS} order). */
export function buildAcknowledgements(
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy,
  required: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAcknowledgement[] {
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS.map((id) => {
    const supplied = policy.ack[id];
    const isRequired = required.includes(id);
    return { id, supplied, required: isRequired, satisfied: !isRequired || supplied };
  });
}

/** The block-class blocking reasons (a `block-release` plan always yields one). */
const BLOCK_REASONS: ReadonlySet<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId> = new Set([
  "block-not-acknowledged",
  "block-acknowledgement-incomplete",
  "block-acknowledged",
]);

/** Derive the bounded, ordered, deduped next-action ids from the fired reasons + coverage gaps. */
function buildNextActions(
  fired: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId[],
  missingCount: number,
  mismatchedCount: number,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptNextActionId[] {
  const wanted = new Set<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptNextActionId>();
  for (const id of fired) {
    if (RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id].severity === "invalid") {
      wanted.add("recover-valid-plan");
    }
    if (BLOCK_REASONS.has(id)) wanted.add("hold-promotion");
  }
  if (mismatchedCount > 0) wanted.add("resolve-contradiction");
  if (missingCount > 0) wanted.add("supply-missing-ack");
  wanted.add("keep-action-receipt"); // always the last step — keep the content-free close-out record
  return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS.filter((id) =>
    wanted.has(id),
  );
}

/** The full outcome of the fold: the composite rollup, the fired reasons, the acknowledgement checklist, + next actions. */
export interface ComputedFinalizeIndexTrendActionReceipt {
  readonly rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptRollup;
  readonly reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReason[];
  readonly acknowledgements: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAcknowledgement[];
  readonly nextActions: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptNextActionId[];
}

/**
 * Compute the composite receipt rollup + fired reasons + acknowledgement checklist + next actions from the ingested plan
 * under the policy. Fail-closed: a missing / unreadable / tampered plan — or a usable plan whose own verdict is
 * `invalid` — is `invalid`; a `block-release` plan is `blocked`; a usable closeable plan resolves against the
 * acknowledgements its class requires; `--strict-open` escalates a missing-acknowledgement `incomplete` to `blocked`.
 */
export function computeReceipt(
  ingested: IngestedFinalizeIndexTrendActionPlan,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPolicy,
): ComputedFinalizeIndexTrendActionReceipt {
  const state = sourceStateOf(ingested);
  const facts = ingested.facts;

  const fired: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptReasonId[] = [];
  let planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null = null;
  let requiredAcks: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[] = [];
  let mismatchedAcks: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptAckId[] = [];

  if (state === "unreadable") {
    fired.push("plan-unreadable");
  } else if (state === "tampered") {
    fired.push("plan-tampered");
  } else if (facts!.planVerdict === "invalid") {
    // A usable plan whose OWN verdict is `invalid` (its source-trend input was untrustworthy): no closeable class, and
    // no acknowledgement can rescue it — invalid regardless of the flags supplied.
    fired.push("plan-invalid");
  } else {
    // Usable + closeable: resolve against the plan class + the operator's acknowledgements.
    planClass = facts!.planClass;
    const cls = planClass!;
    requiredAcks = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS[cls];
    mismatchedAcks = mismatchedAcksFor(cls, policy);
    if (mismatchedAcks.length > 0) fired.push("acknowledgement-mismatch");
    fired.push(classReason(cls, policy));
  }

  // Base verdict (before strict-open), then the surgical `--strict-open` escalation of a missing-ack incomplete.
  const baseVerdict = verdictFrom(fired);
  const strictOpenEscalated = baseVerdict === "incomplete" && policy.strictOpen;
  if (strictOpenEscalated) fired.push("strict-open-escalation");

  const reasons = buildReasons(fired);
  const orderedIds = reasons.map((r) => r.id);
  const verdict = verdictFrom(orderedIds);

  const invalid = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const incomplete = reasons.filter((r) => r.severity === "incomplete").length;
  const informational = reasons.filter((r) => r.severity === "informational").length;

  const suppliedAcks = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS.filter(
    (id) => policy.ack[id],
  );
  const missingAcks = requiredAcks.filter((id) => !policy.ack[id]);

  const detail = strictOpenEscalated
    ? RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_STRICT_OPEN_ESCALATED_SUMMARY
    : RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptRollup = {
    verdict,
    exitCode: exitFor(verdict),
    planClass,
    completed: verdict === "completed",
    reasons: orderedIds,
    invalid,
    blocking,
    incomplete,
    informational,
    requiredAcks,
    suppliedAcks,
    missingAcks,
    mismatchedAcks,
    strictOpen: policy.strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom: strictOpenEscalated ? "incomplete" : null,
    detail,
  };

  return {
    rollup,
    reasons,
    acknowledgements: buildAcknowledgements(policy, requiredAcks),
    nextActions: buildNextActions(orderedIds, missingAcks.length, mismatchedAcks.length),
  };
}
