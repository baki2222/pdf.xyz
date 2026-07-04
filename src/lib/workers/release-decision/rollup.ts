/**
 * Pure, node-free **rollup** for the release decision record ledger (Phase 59).
 *
 * Folds the reduced publish-pack summary (its bounded state + verdict), the reduced acknowledgement summary (its
 * bounded state + decision + note), and the coherence cross-check status into the ONE composite
 * {@link ReleaseDecisionDecision} + exit code a release ledger acts on. It first derives the closed set of
 * {@link ReleaseDecisionReasonId} conditions that fired, then resolves the decision with fail-closed precedence:
 *
 *  - `invalid` (worst) — an INVALID-INPUT reason fired: a missing / unreadable / tampered pack or acknowledgement, or a
 *    cross-check MISMATCH (the acknowledgement does not correspond to the supplied pack). An untrustworthy or incoherent
 *    pair dominates everything — a decision over it is meaningless (never a vacuous pass).
 *  - `reject` — no invalid input, but a BLOCKING reason fired: the acknowledgement is `rejected` / `needs-changes`, or
 *    the usable pack's own verdict is `blocked`. Do not proceed.
 *  - `insufficient` — no blocker, but an INSUFFICIENT reason fired: the pack is `incomplete`, or the acknowledgement is
 *    `deferred`. Checked after blocking so a real blocker is never masked, but before advisory so an inconclusive
 *    posture never masquerades as a mere advisory.
 *  - `hold` / `proceed-with-followup` — no blocker / insufficiency, but an ADVISORY reason fired. A `review` pack needs
 *    INTERNAL REVIEW → `hold` (the stronger advisory); otherwise the only concern is a recorded follow-up over a
 *    share-safe pack → `proceed-with-followup`.
 *  - `proceed` (best) — no reason fired: a usable `publishable` (share-safe) pack, a usable clean `accepted`
 *    acknowledgement with no note, and a `match` cross-check.
 *
 * The input pair is PRIMARY, exactly as the Phase 57 pack requires a usable governance bundle for a share-safe pack and
 * the Phase 58 ack requires a usable pack for a clean acknowledgement. Under `--strict`, a `proceed-with-followup`,
 * `hold`, OR `insufficient` posture is ESCALATED to `reject` — a hard "clean proceed or reject" gate (only a
 * `publishable` pack + a clean `accepted` acknowledgement + a `match` passes). The reasons are emitted in the stable
 * {@link RELEASE_DECISION_REASON_IDS} order — a superset view, so a reviewer sees every condition that applied.
 */

import {
  RELEASE_DECISION_EXIT_FOR_DECISION,
  RELEASE_DECISION_REASON_DETAIL,
  RELEASE_DECISION_REASON_IDS,
  RELEASE_DECISION_STRICT_ESCALATED_SUMMARY,
  RELEASE_DECISION_SUMMARY,
  type ReleaseDecisionAckSummary,
  type ReleaseDecisionCrossCheckStatus,
  type ReleaseDecisionDecision,
  type ReleaseDecisionPackSummary,
  type ReleaseDecisionReason,
  type ReleaseDecisionReasonId,
  type ReleaseDecisionRollup,
} from "./types";

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_DECISION_REASON_IDS} order. Each
 * reduces to a bounded, deterministic predicate over the two documents' already content-free states + verdicts /
 * decisions + the cross-check status; the per-id severity is authored in {@link RELEASE_DECISION_REASON_DETAIL}.
 */
export function deriveDecisionReasons(
  pack: ReleaseDecisionPackSummary,
  ack: ReleaseDecisionAckSummary,
  crossCheck: ReleaseDecisionCrossCheckStatus,
): ReleaseDecisionReasonId[] {
  const packVerdictIs = (v: string): boolean =>
    pack.state === "usable" && pack.verdict === v;
  const ackDecisionIs = (d: string): boolean =>
    ack.state === "usable" && ack.decision === d;
  const fired: Record<ReleaseDecisionReasonId, boolean> = {
    // Invalid input — a document can't be trusted, or the pair is incoherent.
    "pack-missing": pack.state === "absent",
    "pack-unreadable": pack.state === "unreadable",
    "pack-tampered": pack.state === "tampered",
    "ack-missing": ack.state === "absent",
    "ack-unreadable": ack.state === "unreadable",
    "ack-tampered": ack.state === "tampered",
    "cross-check-mismatch": crossCheck === "mismatch",
    // Blocking — do not proceed.
    "pack-blocked": packVerdictIs("blocked"),
    "ack-rejected": ackDecisionIs("rejected"),
    "ack-needs-changes": ackDecisionIs("needs-changes"),
    // Insufficient — evidence inconclusive.
    "pack-incomplete": packVerdictIs("incomplete"),
    "ack-deferred": ackDecisionIs("deferred"),
    // Advisory — a needs-review pack (hold) or a recorded follow-up (proceed-with-followup).
    "pack-review": packVerdictIs("review"),
    "ack-accepted-with-notes": ackDecisionIs("accepted-with-notes"),
    "ack-note-followup":
      ack.state === "usable" && ack.note !== null && ack.note !== "none",
  };
  return RELEASE_DECISION_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids. */
export function buildDecisionReasons(
  fired: readonly ReleaseDecisionReasonId[],
): ReleaseDecisionReason[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_DECISION_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite decision from the pack summary + the acknowledgement summary + the cross-check status.
 *
 * Fail-closed precedence: any invalid-input reason ⇒ `invalid`; else any blocking reason ⇒ `reject`; else any
 * insufficiency ⇒ `insufficient`; else any advisory ⇒ `hold` (a `review` pack) or `proceed-with-followup` (a recorded
 * follow-up); else `proceed`. When `--strict` escalated a `proceed-with-followup`, `hold`, or `insufficient` posture,
 * `strictEscalated` is set (and `strictEscalatedFrom` records which) so the summary explains the escalation (the record
 * would be that posture without the flag).
 */
export function computeDecisionRollup(
  pack: ReleaseDecisionPackSummary,
  ack: ReleaseDecisionAckSummary,
  crossCheck: ReleaseDecisionCrossCheckStatus,
  strict: boolean,
): { rollup: ReleaseDecisionRollup; reasons: ReleaseDecisionReason[] } {
  const firedIds = deriveDecisionReasons(pack, ack, crossCheck);
  const reasons = buildDecisionReasons(firedIds);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter(
    (r) => r.severity === "insufficient",
  ).length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;
  // Within the advisory band, a `review` pack (needs internal review) is a HOLD; otherwise the only advisory is a
  // recorded follow-up over a share-safe pack, which proceeds with the follow-up tracked.
  const needsHold = firedIds.includes("pack-review");

  // The base decision (before `--strict`), by fail-closed precedence.
  let baseDecision: ReleaseDecisionDecision;
  if (invalidInputs > 0) baseDecision = "invalid";
  else if (blocking > 0) baseDecision = "reject";
  else if (insufficiencies > 0) baseDecision = "insufficient";
  else if (advisories > 0)
    baseDecision = needsHold ? "hold" : "proceed-with-followup";
  else baseDecision = "proceed";

  // `--strict` escalates a PROCEED-WITH-FOLLOWUP, HOLD, or INSUFFICIENT posture (no blocker / invalid input) to a
  // rejection. A rejected / invalid / clean-proceed posture is untouched.
  const strictEscalatedFrom:
    "proceed-with-followup" | "hold" | "insufficient" | null =
    strict &&
    (baseDecision === "proceed-with-followup" ||
      baseDecision === "hold" ||
      baseDecision === "insufficient")
      ? baseDecision
      : null;
  const strictEscalated = strictEscalatedFrom !== null;
  const decision: ReleaseDecisionDecision = strictEscalated
    ? "reject"
    : baseDecision;

  const detail = strictEscalatedFrom
    ? RELEASE_DECISION_STRICT_ESCALATED_SUMMARY[strictEscalatedFrom]
    : RELEASE_DECISION_SUMMARY[decision];

  const rollup: ReleaseDecisionRollup = {
    decision,
    exitCode: RELEASE_DECISION_EXIT_FOR_DECISION[decision],
    proceed: decision === "proceed",
    reasons: firedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict,
    strictEscalated,
    strictEscalatedFrom,
    detail,
  };
  return { rollup, reasons };
}
