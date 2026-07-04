/**
 * Pure, node-free **rollup** for the release decision ledger index (Phase 60).
 *
 * Folds the reduced ledger summary (the decision distribution + record-state counts over a bounded window) and the
 * applied policy into the ONE composite {@link ReleaseDecisionIndexVerdict} + exit code a review acts on. It first
 * derives the closed set of {@link ReleaseDecisionIndexReasonId} conditions that fired, then resolves the verdict
 * with fail-closed precedence:
 *
 *  - `invalid` (worst) — an INVALID-INPUT reason fired: a supplied record was unreadable or is recognized but
 *    self-inconsistent (a tamper). An untrustworthy input dominates everything — an index over it cannot be trusted.
 *  - `blocked` — no invalid input, but a BLOCKING reason fired: a usable record decided `reject` or `invalid`. A
 *    rejected / untrustworthy-pair release is a blocking ledger outcome.
 *  - `insufficient` — no blocker, but an INSUFFICIENT reason fired: zero usable records, or a usable record decided
 *    `insufficient`. Checked after blocking so a real blocker is never masked, but before advisory so an
 *    inconclusive batch never masquerades as a mere advisory (and never as a vacuous stable).
 *  - `watch` — no blocker / insufficiency, but an ADVISORY reason fired: a usable record decided
 *    `proceed-with-followup` or `hold`.
 *  - `stable` (best) — no reason fired: every usable record decided a clean `proceed`, and at least one is usable.
 *
 * The reasons are emitted in the stable {@link RELEASE_DECISION_INDEX_REASON_IDS} order — a superset view, so a
 * reviewer sees every condition that applied, not only the winning one. Under `--strict`, a `watch` or
 * `insufficient` batch is ESCALATED to `blocked` — a hard "clean proceed or block" gate (only a batch whose every
 * usable record is a clean `proceed`, with no untrustworthy input, passes). A `blocked` / `invalid` / `stable`
 * verdict is untouched by `--strict`.
 */

import {
  RELEASE_DECISION_INDEX_EXIT_FOR_VERDICT,
  RELEASE_DECISION_INDEX_REASON_DETAIL,
  RELEASE_DECISION_INDEX_REASON_IDS,
  RELEASE_DECISION_INDEX_STRICT_ESCALATED_SUMMARY,
  RELEASE_DECISION_INDEX_VERDICT_SUMMARY,
  type ReleaseDecisionIndexLedger,
  type ReleaseDecisionIndexPolicy,
  type ReleaseDecisionIndexReason,
  type ReleaseDecisionIndexReasonId,
  type ReleaseDecisionIndexRollup,
  type ReleaseDecisionIndexVerdict,
} from "./types";

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_DECISION_INDEX_REASON_IDS}
 * order. Each reduces to a bounded, deterministic predicate over the already content-free ledger summary; the per-id
 * severity is authored in {@link RELEASE_DECISION_INDEX_REASON_DETAIL}.
 */
export function deriveIndexReasons(ledger: ReleaseDecisionIndexLedger): ReleaseDecisionIndexReasonId[] {
  const c = ledger.decisionCounts;
  const fired: Record<ReleaseDecisionIndexReasonId, boolean> = {
    // Invalid input — a record can't be trusted.
    "record-unreadable": ledger.recordsUnreadable > 0,
    "record-tampered": ledger.recordsTampered > 0,
    // Blocking — a release was not / must not proceed.
    "decision-rejected": c.reject > 0,
    "decision-invalid": c.invalid > 0,
    // Insufficient — the batch is inconclusive.
    "no-usable-records": ledger.recordsUsable === 0,
    "decision-insufficient": c.insufficient > 0,
    // Advisory — a follow-up or a needs-review release.
    "decision-hold": c.hold > 0,
    "decision-followup": c["proceed-with-followup"] > 0,
  };
  return RELEASE_DECISION_INDEX_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids. */
export function buildIndexReasons(
  fired: readonly ReleaseDecisionIndexReasonId[],
): ReleaseDecisionIndexReason[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_DECISION_INDEX_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_INDEX_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite index verdict from the reduced ledger under the policy.
 *
 * Fail-closed precedence: any invalid-input reason ⇒ `invalid`; else any blocking reason ⇒ `blocked`; else any
 * insufficiency ⇒ `insufficient`; else any advisory ⇒ `watch`; else `stable`. When `--strict` escalated a `watch`
 * or `insufficient` batch to `blocked`, `strictEscalated` is set (and `strictEscalatedFrom` records which) so the
 * summary explains the escalation (the index would be that verdict without the flag).
 */
export function computeIndexRollup(
  ledger: ReleaseDecisionIndexLedger,
  policy: ReleaseDecisionIndexPolicy,
): { rollup: ReleaseDecisionIndexRollup; reasons: ReleaseDecisionIndexReason[] } {
  const firedIds = deriveIndexReasons(ledger);
  const reasons = buildIndexReasons(firedIds);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;

  // The base verdict (before `--strict`), by fail-closed precedence.
  let baseVerdict: ReleaseDecisionIndexVerdict;
  if (invalidInputs > 0) baseVerdict = "invalid";
  else if (blocking > 0) baseVerdict = "blocked";
  else if (insufficiencies > 0) baseVerdict = "insufficient";
  else if (advisories > 0) baseVerdict = "watch";
  else baseVerdict = "stable";

  // `--strict` escalates a WATCH or INSUFFICIENT batch (no blocker / invalid input) to a blocked batch. A
  // blocked / invalid / clean-stable batch is untouched.
  const strictEscalatedFrom: "watch" | "insufficient" | null =
    policy.strict && (baseVerdict === "watch" || baseVerdict === "insufficient") ? baseVerdict : null;
  const strictEscalated = strictEscalatedFrom !== null;
  const verdict: ReleaseDecisionIndexVerdict = strictEscalated ? "blocked" : baseVerdict;

  const detail = strictEscalatedFrom
    ? RELEASE_DECISION_INDEX_STRICT_ESCALATED_SUMMARY[strictEscalatedFrom]
    : RELEASE_DECISION_INDEX_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionIndexRollup = {
    verdict,
    exitCode: RELEASE_DECISION_INDEX_EXIT_FOR_VERDICT[verdict],
    stable: verdict === "stable",
    reasons: firedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict: policy.strict,
    strictEscalated,
    strictEscalatedFrom,
    detail,
  };
  return { rollup, reasons };
}
