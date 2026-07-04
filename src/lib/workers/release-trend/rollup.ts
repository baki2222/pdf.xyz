/**
 * Pure, node-free **rollup** for the release evidence trend summary (Phase 53).
 *
 * Folds the reduced history (the recommendation distribution + coverage states over a bounded window) and the
 * applied policy into the ONE composite {@link ReleaseTrendVerdict} + exit code a governance review acts on. It
 * first derives the closed set of {@link ReleaseTrendReasonId} conditions that fired, then resolves the verdict
 * with fail-closed precedence:
 *
 *  - `failing` (worst) — a BLOCKING reason fired: a supplied report is recognized but self-inconsistent (a
 *    tamper), the NEWEST usable report is `hold-fail`, the `hold-fail` count exceeded `--max-hold-fail`, or
 *    `--require-latest-ready` was set and the newest report is not `promote-ready`. A blocker dominates.
 *  - `unknown` — the history is INSUFFICIENT: a report was unreadable, no report was usable, or the newest
 *    usable report is `needs-evidence`. Checked after blocking so a real blocker is never masked, but before
 *    advisory so an insufficient posture never masquerades as a mere advisory (and never as a vacuous stable).
 *  - `warning` — no blocker and sufficient history, but an ADVISORY reason fired: the newest usable report is
 *    `hold-warning`, the `hold-warning` count exceeded `--max-hold-warning`, or the posture degraded versus the
 *    previous report.
 *  - `stable` (best) — a clean window: no tampered / unreadable report, the newest usable report is
 *    `promote-ready`, and no threshold was breached.
 *
 * The NEWEST usable report is always authoritative — a `hold-fail` tip fails the trend even when its count is
 * within a tolerated `--max-hold-fail` (the threshold tolerates HISTORICAL noise, never a currently-failing
 * tip). The reasons are emitted in the stable {@link RELEASE_TREND_REASON_IDS} order — a superset view, so a
 * reader sees every condition that applied, not only the winning one.
 */

import { recommendationRank } from "./reduce";
import {
  RELEASE_TREND_EXIT_FOR_VERDICT,
  RELEASE_TREND_READY_ESCALATED_SUMMARY,
  RELEASE_TREND_REASON_DETAIL,
  RELEASE_TREND_REASON_IDS,
  RELEASE_TREND_VERDICT_SUMMARY,
  type ReleaseReportRecommendation,
  type ReleaseTrendHistory,
  type ReleaseTrendPolicy,
  type ReleaseTrendReason,
  type ReleaseTrendReasonId,
  type ReleaseTrendRollup,
  type ReleaseTrendVerdict,
} from "./types";

/** The blocking reasons OTHER than the enforced not-ready tip — used to tell an "escalated" failing apart. */
const OTHER_BLOCKERS: readonly ReleaseTrendReasonId[] = [
  "report-tampered",
  "latest-hold-fail",
  "repeated-hold-fail",
];

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_TREND_REASON_IDS} order.
 * Each reduces to a bounded, deterministic predicate over the already content-free history + the trusted usable
 * sequence + the policy; the per-id severity is authored in {@link RELEASE_TREND_REASON_DETAIL}.
 */
export function deriveTrendReasons(
  history: ReleaseTrendHistory,
  usableRecommendations: readonly ReleaseReportRecommendation[],
  policy: ReleaseTrendPolicy,
): ReleaseTrendReasonId[] {
  const newest = history.newest;
  const previous =
    usableRecommendations.length >= 2
      ? (usableRecommendations[usableRecommendations.length - 2] as ReleaseReportRecommendation)
      : null;
  const holdFailCount = history.counts["hold-fail"];
  const holdWarnCount = history.counts["hold-warning"];

  const fired: Record<ReleaseTrendReasonId, boolean> = {
    "report-tampered": history.reportsTampered > 0,
    "latest-hold-fail": newest === "hold-fail",
    "repeated-hold-fail": holdFailCount > policy.maxHoldFail,
    // The enforced-ready policy only asserts over a KNOWN newest (a usable tip); with no usable report it stays
    // an insufficiency (`no-usable-reports`), never a fabricated blocker.
    "latest-not-ready": policy.requireLatestReady && newest !== null && newest !== "promote-ready",
    "report-unreadable": history.reportsUnreadable > 0,
    "no-usable-reports": history.reportsUsable === 0,
    "latest-needs-evidence": newest === "needs-evidence",
    "latest-hold-warning": newest === "hold-warning",
    "repeated-hold-warning": holdWarnCount > policy.maxHoldWarning,
    "trend-degraded":
      previous !== null && newest !== null && recommendationRank(newest) > recommendationRank(previous),
  };
  return RELEASE_TREND_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids. */
export function buildTrendReasons(fired: readonly ReleaseTrendReasonId[]): ReleaseTrendReason[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_TREND_REASON_DETAIL[id].severity,
    detail: RELEASE_TREND_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite trend verdict from the reduced history + the trusted usable sequence under the policy.
 *
 * Fail-closed precedence: any blocking reason ⇒ `failing`; else any insufficiency ⇒ `unknown`; else any advisory
 * ⇒ `warning`; else `stable`. When the ONLY blocker is the enforced not-ready tip (`--require-latest-ready`),
 * `readyEscalated` is set so the summary explains the escalation (the trend would be `warning` / `unknown`
 * without the flag).
 */
export function computeTrendRollup(
  history: ReleaseTrendHistory,
  usableRecommendations: readonly ReleaseReportRecommendation[],
  policy: ReleaseTrendPolicy,
): { rollup: ReleaseTrendRollup; reasons: ReleaseTrendReason[] } {
  const firedIds = deriveTrendReasons(history, usableRecommendations, policy);
  const reasons = buildTrendReasons(firedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;

  let verdict: ReleaseTrendVerdict;
  if (blocking > 0) verdict = "failing";
  else if (insufficiencies > 0) verdict = "unknown";
  else if (advisories > 0) verdict = "warning";
  else verdict = "stable";

  // The failing trend is an ESCALATION iff the enforced not-ready tip is the ONLY blocker (no tamper / hold-fail
  // newest / breached hold-fail threshold). Then, absent the flag, the trend would be advisory / insufficient.
  const readyEscalated =
    firedIds.includes("latest-not-ready") && !OTHER_BLOCKERS.some((id) => firedIds.includes(id));

  const detail = readyEscalated
    ? RELEASE_TREND_READY_ESCALATED_SUMMARY
    : RELEASE_TREND_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseTrendRollup = {
    verdict,
    exitCode: RELEASE_TREND_EXIT_FOR_VERDICT[verdict],
    stable: verdict === "stable",
    reasons: firedIds,
    blocking,
    insufficiencies,
    advisories,
    requireLatestReady: policy.requireLatestReady,
    readyEscalated,
    detail,
  };
  return { rollup, reasons };
}
