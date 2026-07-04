/**
 * Pure, node-free **rollup** for the release evidence governance bundle (Phase 54).
 *
 * Folds the three reduced sources (a `pdfxyz.release-trend/1` PRIMARY window signal + an optional latest
 * `pdfxyz.release-report/1` + an optional latest `pdfxyz.release-audit/1`) and the applied policy into the ONE
 * composite {@link ReleaseGovernanceVerdict} + exit code a governance review acts on. It first derives the
 * closed set of {@link ReleaseGovernanceReasonId} conditions that fired, then resolves the verdict with
 * fail-closed precedence:
 *
 *  - `blocked` (worst) — a BLOCKING reason fired: a supplied document is recognized but self-inconsistent (a
 *    tamper), the trend is `failing`, the latest report is `hold-fail`, or the latest audit reported a blocking
 *    regression. A blocker dominates.
 *  - `incomplete` — the evidence is INSUFFICIENT: the PRIMARY trend is absent / unreadable / `unknown`, a
 *    supplied latest document was unreadable / indeterminate, or a required document was missing. Checked after
 *    blocking so a real blocker is never masked, but before advisory so an insufficient / trend-absent posture
 *    never masquerades as a mere advisory (and never as a vacuous healthy).
 *  - `watch` — no blocker and sufficient evidence, but an ADVISORY reason fired (a warning trend, a hold-warning
 *    report, an audit drift, or a drift between the latest report and the trend). Under `--strict-watch`, an
 *    advisory-only posture is ESCALATED to `blocked`.
 *  - `healthy` (best) — the PRIMARY trend is usable and `stable`, and every supplied latest source is clean.
 *
 * The PRIMARY trend is REQUIRED for the best outcome — a latest report / audit can only BLOCK or FLAG the
 * window, never GRANT a healthy on its own (an absent / unusable trend is `trend-missing` / `trend-unreadable`
 * → insufficient → `incomplete`), exactly like the Phase 52 report requires a bundle for a promote. The reasons
 * are emitted in the stable {@link RELEASE_GOVERNANCE_REASON_IDS} order — a superset view, so a reviewer sees
 * every condition that applied, not only the winning one.
 */

import {
  RELEASE_GOVERNANCE_EXIT_FOR_VERDICT,
  RELEASE_GOVERNANCE_REASON_DETAIL,
  RELEASE_GOVERNANCE_REASON_IDS,
  RELEASE_GOVERNANCE_STRICT_WATCH_ESCALATED_SUMMARY,
  RELEASE_GOVERNANCE_VERDICT_SUMMARY,
  type ReleaseGovernancePolicy,
  type ReleaseGovernanceReason,
  type ReleaseGovernanceReasonId,
  type ReleaseGovernanceRollup,
  type ReleaseGovernanceSource,
  type ReleaseGovernanceVerdict,
} from "./types";
import type { ReleaseReportRecommendation } from "../release-report/types";

/** The three reduced sources, keyed by id, that the fold reads. */
export interface GovernanceSources {
  readonly trend: ReleaseGovernanceSource;
  readonly report: ReleaseGovernanceSource;
  readonly audit: ReleaseGovernanceSource;
}

/** True iff a usable source's own verdict equals `verdict`. */
function usableVerdictIs(source: ReleaseGovernanceSource, verdict: string): boolean {
  return source.state === "usable" && source.verdict === verdict;
}

/** The trend's own newest usable report recommendation, or `null` (only from a usable trend source). */
function trendNewest(trend: ReleaseGovernanceSource): ReleaseReportRecommendation | null {
  if (trend.id === "trend" && trend.state === "usable" && trend.facts !== null) return trend.facts.newest;
  return null;
}

/**
 * True iff the latest usable report's recommendation differs from the trend's own newest report — the two
 * independent evidence sources disagree (one may be stale, or the latest release post-dates the trend window).
 * Only meaningful when BOTH are usable and the trend has a known newest report. Content-free (a bounded enum
 * compare), never load-bearing beyond advisory.
 */
function reportTrendMismatch(trend: ReleaseGovernanceSource, report: ReleaseGovernanceSource): boolean {
  const newest = trendNewest(trend);
  if (newest === null) return false;
  if (report.id !== "report" || report.state !== "usable" || report.verdict === null) return false;
  return report.verdict !== newest;
}

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_GOVERNANCE_REASON_IDS}
 * order. Each reduces to a bounded, deterministic predicate over the three sources' already content-free state +
 * verdict (+ the trend's newest, for the cross-check) + the policy; the per-id severity is authored in
 * {@link RELEASE_GOVERNANCE_REASON_DETAIL}.
 */
export function deriveGovernanceReasons(
  sources: GovernanceSources,
  policy: ReleaseGovernancePolicy,
): ReleaseGovernanceReasonId[] {
  const { trend, report, audit } = sources;
  const fired: Record<ReleaseGovernanceReasonId, boolean> = {
    // Blocking
    "trend-tampered": trend.state === "tampered",
    "trend-failing": usableVerdictIs(trend, "failing"),
    "report-tampered": report.state === "tampered",
    "report-hold-fail": usableVerdictIs(report, "hold-fail"),
    "audit-tampered": audit.state === "tampered",
    "audit-regressed": usableVerdictIs(audit, "fail"),
    // Insufficient
    "trend-missing": trend.state === "absent",
    "trend-unreadable": trend.state === "unreadable",
    "trend-unknown": usableVerdictIs(trend, "unknown"),
    "report-unreadable": report.state === "unreadable",
    "report-needs-evidence": usableVerdictIs(report, "needs-evidence"),
    "report-missing": policy.requireReport && report.state === "absent",
    "audit-unreadable": audit.state === "unreadable",
    "audit-inconclusive": usableVerdictIs(audit, "unknown"),
    "audit-missing": policy.requireAudit && audit.state === "absent",
    // Advisory
    "trend-warning": usableVerdictIs(trend, "warning"),
    "report-hold-warning": usableVerdictIs(report, "hold-warning"),
    "audit-drift": usableVerdictIs(audit, "warn"),
    "report-trend-mismatch": reportTrendMismatch(trend, report),
  };
  return RELEASE_GOVERNANCE_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids. */
export function buildGovernanceReasons(
  fired: readonly ReleaseGovernanceReasonId[],
): ReleaseGovernanceReason[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_GOVERNANCE_REASON_DETAIL[id].severity,
    detail: RELEASE_GOVERNANCE_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite governance verdict from the three sources under `policy`.
 *
 * Fail-closed precedence: any blocking reason ⇒ `blocked`; else any insufficiency ⇒ `incomplete`; else any
 * advisory ⇒ `watch` (or `blocked` under `--strict-watch`); else `healthy`. When `--strict-watch` escalated an
 * advisory-only posture, `strictWatchEscalated` is set so the summary explains the escalation (the bundle would
 * be `watch` without the flag).
 */
export function computeGovernanceRollup(
  sources: GovernanceSources,
  policy: ReleaseGovernancePolicy,
): { rollup: ReleaseGovernanceRollup; reasons: ReleaseGovernanceReason[] } {
  const firedIds = deriveGovernanceReasons(sources, policy);
  const reasons = buildGovernanceReasons(firedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;

  // `--strict-watch` escalates an ADVISORY-ONLY posture (no blocker, no insufficiency) to a blocking hold.
  const strictWatchEscalated =
    policy.strictWatch && blocking === 0 && insufficiencies === 0 && advisories > 0;

  let verdict: ReleaseGovernanceVerdict;
  if (blocking > 0) verdict = "blocked";
  else if (insufficiencies > 0) verdict = "incomplete";
  else if (advisories > 0) verdict = policy.strictWatch ? "blocked" : "watch";
  else verdict = "healthy";

  const detail = strictWatchEscalated
    ? RELEASE_GOVERNANCE_STRICT_WATCH_ESCALATED_SUMMARY
    : RELEASE_GOVERNANCE_VERDICT_SUMMARY[verdict];

  const rollup: ReleaseGovernanceRollup = {
    verdict,
    exitCode: RELEASE_GOVERNANCE_EXIT_FOR_VERDICT[verdict],
    healthy: verdict === "healthy",
    reasons: firedIds,
    blocking,
    insufficiencies,
    advisories,
    requireReport: policy.requireReport,
    requireAudit: policy.requireAudit,
    strictWatch: policy.strictWatch,
    strictWatchEscalated,
    detail,
  };
  return { rollup, reasons };
}
