/**
 * Pure, node-free **rollup** for the release decision index trend summary (Phase 61).
 *
 * Folds the reduced history (the per-window index-verdict distribution + the arc direction over a bounded window) and
 * the applied policy into the ONE composite {@link ReleaseDecisionTrendVerdict} + exit code a governance review acts
 * on. It first derives the closed set of {@link ReleaseDecisionTrendReasonId} conditions that fired, then resolves the
 * verdict with fail-closed precedence over the reasons, refined by the arc DIRECTION:
 *
 *  - `invalid` (worst) — an INVALID-INPUT reason fired: a supplied window was unreadable or is recognized but
 *    self-inconsistent (a tamper). An untrustworthy input dominates — a trend over it cannot be trusted.
 *  - `blocked` — no invalid input, but a BLOCKING reason fired: a usable window is a `blocked` / `invalid` index, or
 *    `--strict` escalated a non-clean history. A rejected / untrustworthy window is a blocking trend outcome.
 *  - `insufficient` — no blocker, but an INSUFFICIENT reason fired: zero usable windows, or every usable window is an
 *    `insufficient` index. Checked after blocking so a real blocker is never masked, but before the advisory /
 *    directional band so an inconclusive history never masquerades as a mere advisory (and never as a clean pass).
 *  - `degrading` — no blocker / insufficiency, and the arc DEGRADED (the newest usable window is worse than the oldest).
 *  - `improving` — no blocker / insufficiency, the arc IMPROVED, and the newest usable window is a clean `stable` index
 *    (the decisions recovered to clean). A clean code `0`, distinguished from `stable` by the recovering arc.
 *  - `watch` — no blocker / insufficiency and the arc is flat / mixed, but an ADVISORY concern is present: a usable
 *    window is a `watch` / `insufficient` index.
 *  - `stable` (best) — no reason fired: every usable window is a clean `stable` index, and at least one is usable.
 *
 * The reasons are emitted in the stable {@link RELEASE_DECISION_TREND_REASON_IDS} order — a superset view, so a
 * reviewer sees every condition that applied, not only the winning one. Under `--strict`, ANY non-`stable` usable
 * window ESCALATES the history to `blocked` — a hard "all-stable or block" gate; when that escalation is the ONLY
 * blocker, `strictEscalated` is set (and `strictEscalatedFrom` records the verdict it would have been) so the summary
 * explains it. A `blocked` / `invalid` window, or a clean `stable` / `improving` history, is untouched by `--strict`.
 */

import {
  RELEASE_DECISION_TREND_EXIT_FOR_VERDICT,
  RELEASE_DECISION_TREND_REASON_DETAIL,
  RELEASE_DECISION_TREND_REASON_IDS,
  RELEASE_DECISION_TREND_STRICT_ESCALATED_SUMMARY,
  RELEASE_DECISION_TREND_VERDICT_SUMMARY,
  type ReleaseDecisionIndexVerdict,
  type ReleaseDecisionTrendPolicy,
  type ReleaseDecisionTrendReason,
  type ReleaseDecisionTrendReasonId,
  type ReleaseDecisionTrendRollup,
  type ReleaseDecisionTrendSummary,
  type ReleaseDecisionTrendVerdict,
} from "./types";

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_DECISION_TREND_REASON_IDS} order.
 * Each reduces to a bounded, deterministic predicate over the already content-free summary + the policy; the per-id
 * severity is authored in {@link RELEASE_DECISION_TREND_REASON_DETAIL}.
 */
export function deriveTrendReasons(
  summary: ReleaseDecisionTrendSummary,
  policy: ReleaseDecisionTrendPolicy,
): ReleaseDecisionTrendReasonId[] {
  const c = summary.windowVerdictCounts;
  const onlyInsufficient = summary.windowsUsable > 0 && c.insufficient === summary.windowsUsable;
  const hasNonStableUsable = summary.windowsUsable > 0 && c.stable < summary.windowsUsable;

  const fired: Record<ReleaseDecisionTrendReasonId, boolean> = {
    // Invalid input — a window can't be trusted.
    "window-unreadable": summary.windowsUnreadable > 0,
    "window-tampered": summary.windowsTampered > 0,
    // Blocking — a decision batch was not / must not be trusted.
    "window-blocked": c.blocked > 0,
    "window-invalid": c.invalid > 0,
    "strict-nonclean": policy.strict && hasNonStableUsable,
    // Insufficient — the history is inconclusive.
    "no-usable-windows": summary.windowsUsable === 0,
    "only-insufficient": onlyInsufficient,
    // Advisory — a worsening arc or a standing concern.
    "trend-degrading": summary.direction === "degrading",
    "window-watch": c.watch > 0,
    "window-insufficient": c.insufficient > 0 && !onlyInsufficient,
  };
  return RELEASE_DECISION_TREND_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids. */
export function buildTrendReasons(
  fired: readonly ReleaseDecisionTrendReasonId[],
): ReleaseDecisionTrendReason[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_DECISION_TREND_REASON_DETAIL[id].severity,
    detail: RELEASE_DECISION_TREND_REASON_DETAIL[id].detail,
  }));
}

/**
 * Resolve the composite trend verdict from the fired reasons + the arc direction. Fail-closed precedence
 * `invalid > blocked > insufficient`, then the directional band (`degrading` / `improving` / `watch` / `stable`).
 */
function resolveVerdict(
  fired: ReadonlySet<ReleaseDecisionTrendReasonId>,
  direction: ReleaseDecisionTrendSummary["direction"],
  newest: ReleaseDecisionIndexVerdict | null,
): ReleaseDecisionTrendVerdict {
  const invalidInput = fired.has("window-unreadable") || fired.has("window-tampered");
  const blocking = fired.has("window-blocked") || fired.has("window-invalid") || fired.has("strict-nonclean");
  const insufficient = fired.has("no-usable-windows") || fired.has("only-insufficient");
  if (invalidInput) return "invalid";
  if (blocking) return "blocked";
  if (insufficient) return "insufficient";
  // All usable windows are now `stable` / `watch` / `insufficient`, ≥1 usable, not all-insufficient, no bad input.
  if (direction === "degrading") return "degrading";
  if (direction === "improving" && newest === "stable") return "improving";
  const advisory =
    fired.has("trend-degrading") || fired.has("window-watch") || fired.has("window-insufficient");
  return advisory ? "watch" : "stable";
}

/**
 * Compute the composite trend verdict from the reduced summary under the policy.
 *
 * Fail-closed precedence refined by the arc direction (see {@link resolveVerdict}). When `--strict` escalated a
 * non-clean history to `blocked` AND that escalation is the only blocker, `strictEscalated` is set and
 * `strictEscalatedFrom` records the verdict the trend would have been without the flag, so the summary explains it.
 */
export function computeTrendRollup(
  summary: ReleaseDecisionTrendSummary,
  policy: ReleaseDecisionTrendPolicy,
): { rollup: ReleaseDecisionTrendRollup; reasons: ReleaseDecisionTrendReason[] } {
  const firedIds = deriveTrendReasons(summary, policy);
  const reasons = buildTrendReasons(firedIds);
  const firedSet = new Set(firedIds);

  const invalidInputs = reasons.filter((r) => r.severity === "invalid").length;
  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;

  const verdict = resolveVerdict(firedSet, summary.direction, summary.newest);

  // The block is a `--strict` ESCALATION iff strict-nonclean is the ONLY blocking reason (no blocked / invalid window)
  // and there is no untrustworthy input. Then, absent the flag, the trend would be the directional / insufficient band.
  const strictEscalated =
    policy.strict &&
    verdict === "blocked" &&
    firedSet.has("strict-nonclean") &&
    !firedSet.has("window-blocked") &&
    !firedSet.has("window-invalid") &&
    invalidInputs === 0;

  // What the trend would be without `--strict` (drop the strict-only reason and re-resolve).
  const baseIds = new Set(deriveTrendReasons(summary, { ...policy, strict: false }));
  const base = resolveVerdict(baseIds, summary.direction, summary.newest);
  const strictEscalatedFrom: "watch" | "degrading" | "improving" | "insufficient" | null =
    strictEscalated &&
    (base === "watch" || base === "degrading" || base === "improving" || base === "insufficient")
      ? base
      : null;

  const detail = strictEscalatedFrom
    ? RELEASE_DECISION_TREND_STRICT_ESCALATED_SUMMARY[strictEscalatedFrom]
    : RELEASE_DECISION_TREND_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseDecisionTrendRollup = {
    verdict,
    exitCode: RELEASE_DECISION_TREND_EXIT_FOR_VERDICT[verdict],
    clear: verdict === "stable" || verdict === "improving",
    reasons: firedIds,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    direction: summary.direction,
    strict: policy.strict,
    strictEscalated,
    strictEscalatedFrom,
    detail,
  };
  return { rollup, reasons };
}
