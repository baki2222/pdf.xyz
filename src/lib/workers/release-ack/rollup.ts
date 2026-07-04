/**
 * Pure, node-free **rollup** for the release evidence handoff acknowledgement receipt (Phase 58).
 *
 * Folds the reduced pack source (the acknowledged `pdfxyz.release-publish-pack/1`, its bounded state + verdict) and
 * the operator's bounded acknowledgement (decision + note + strict) into the ONE composite {@link ReleaseAckVerdict} +
 * exit code a handoff log acts on. It first derives the closed set of {@link ReleaseAckReasonId} conditions that
 * fired, then resolves the verdict with fail-closed precedence:
 *
 *  - `invalid` (worst) — an INVALID-INPUT reason fired: no pack, an unreadable pack, or a tampered pack (recognized
 *    but its recorded verdict does NOT re-derive). The input can't be trusted, so the acknowledgement is meaningless.
 *    A blocker on the INPUT dominates everything — a decision cannot rescue an untrustworthy pack (never a vacuous
 *    pass).
 *  - `rejected` — no invalid input, but a BLOCKING reason fired: the decision is `rejected` / `needs-changes`, or the
 *    usable pack's own verdict is `blocked`. Do not proceed.
 *  - `deferred` — no blocker, but an INSUFFICIENT reason fired: the decision is `deferred`, or the usable pack is
 *    `incomplete`. Checked after blocking so a real blocker is never masked, but before advisory so an
 *    insufficient posture never masquerades as a mere advisory.
 *  - `acknowledged-with-followup` — no blocker / insufficiency, but an ADVISORY reason fired: an `accepted-with-notes`
 *    decision, a `review` pack, or a recorded note class.
 *  - `acknowledged` (best) — no reason fired: an `accepted` decision over a usable, `publishable` pack with no note.
 *
 * The input is PRIMARY: an untrustworthy pack is `invalid` regardless of the decision, exactly as the Phase 57 pack
 * requires a usable governance bundle for a share-safe pack. Under `--strict`, an `acknowledged-with-followup` OR
 * `deferred` posture is ESCALATED to `rejected` — a hard "clean acceptance or reject" gate (only an `accepted`
 * decision over a `publishable` pack with no note passes). The reasons are emitted in the stable
 * {@link RELEASE_ACK_REASON_IDS} order — a superset view, so a reviewer sees every condition that applied.
 */

import {
  RELEASE_ACK_EXIT_FOR_VERDICT,
  RELEASE_ACK_REASON_DETAIL,
  RELEASE_ACK_REASON_IDS,
  RELEASE_ACK_STRICT_ESCALATED_SUMMARY,
  RELEASE_ACK_VERDICT_SUMMARY,
  type ReleaseAckAcknowledgement,
  type ReleaseAckReason,
  type ReleaseAckReasonId,
  type ReleaseAckRollup,
  type ReleaseAckSource,
  type ReleaseAckVerdict,
} from "./types";

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_ACK_REASON_IDS} order. Each
 * reduces to a bounded, deterministic predicate over the pack's already content-free state + verdict and the
 * operator's decision + note; the per-id severity is authored in {@link RELEASE_ACK_REASON_DETAIL}.
 */
export function deriveAckReasons(
  source: ReleaseAckSource,
  ack: ReleaseAckAcknowledgement,
): ReleaseAckReasonId[] {
  const usableVerdictIs = (v: string): boolean => source.state === "usable" && source.packVerdict === v;
  const fired: Record<ReleaseAckReasonId, boolean> = {
    // Invalid input — the pack can't be trusted.
    "pack-missing": source.state === "absent",
    "pack-unreadable": source.state === "unreadable",
    "pack-tampered": source.state === "tampered",
    // Blocking — do not proceed.
    "pack-blocked": usableVerdictIs("blocked"),
    "decision-needs-changes": ack.decision === "needs-changes",
    "decision-rejected": ack.decision === "rejected",
    // Insufficient — revisit later.
    "pack-incomplete": usableVerdictIs("incomplete"),
    "decision-deferred": ack.decision === "deferred",
    // Advisory — acknowledged, track a follow-up.
    "pack-review": usableVerdictIs("review"),
    "decision-accepted-with-notes": ack.decision === "accepted-with-notes",
    "note-followup": ack.note !== "none",
  };
  return RELEASE_ACK_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids. */
export function buildAckReasons(fired: readonly ReleaseAckReasonId[]): ReleaseAckReason[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_ACK_REASON_DETAIL[id].severity,
    detail: RELEASE_ACK_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite acknowledgement verdict from the pack source + the operator's acknowledgement.
 *
 * Fail-closed precedence: any invalid-input reason ⇒ `invalid`; else any blocking reason ⇒ `rejected`; else any
 * insufficiency ⇒ `deferred`; else any advisory ⇒ `acknowledged-with-followup`; else `acknowledged`. When `--strict`
 * escalated an `acknowledged-with-followup` or `deferred` posture, `strictEscalated` is set (and `strictEscalatedFrom`
 * records which) so the summary explains the escalation (the ack would be that posture without the flag).
 */
export function computeAckRollup(
  source: ReleaseAckSource,
  ack: ReleaseAckAcknowledgement,
): { rollup: ReleaseAckRollup; reasons: ReleaseAckReason[] } {
  const firedIds = deriveAckReasons(source, ack);
  const reasons = buildAckReasons(firedIds);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;

  // The base verdict (before `--strict`), by fail-closed precedence.
  let baseVerdict: ReleaseAckVerdict;
  if (invalidInputs > 0) baseVerdict = "invalid";
  else if (blocking > 0) baseVerdict = "rejected";
  else if (insufficiencies > 0) baseVerdict = "deferred";
  else if (advisories > 0) baseVerdict = "acknowledged-with-followup";
  else baseVerdict = "acknowledged";

  // `--strict` escalates an ACKNOWLEDGED-WITH-FOLLOWUP or DEFERRED posture (no blocker / invalid input) to a
  // rejection. A rejected / invalid / clean-acknowledged posture is untouched.
  const strictEscalatedFrom: "acknowledged-with-followup" | "deferred" | null =
    ack.strict && (baseVerdict === "acknowledged-with-followup" || baseVerdict === "deferred")
      ? baseVerdict
      : null;
  const strictEscalated = strictEscalatedFrom !== null;
  const verdict: ReleaseAckVerdict = strictEscalated ? "rejected" : baseVerdict;

  const detail = strictEscalatedFrom
    ? RELEASE_ACK_STRICT_ESCALATED_SUMMARY[strictEscalatedFrom]
    : RELEASE_ACK_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseAckRollup = {
    verdict,
    exitCode: RELEASE_ACK_EXIT_FOR_VERDICT[verdict],
    acknowledged: verdict === "acknowledged",
    reasons: firedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict: ack.strict,
    strictEscalated,
    strictEscalatedFrom,
    detail,
  };
  return { rollup, reasons };
}
