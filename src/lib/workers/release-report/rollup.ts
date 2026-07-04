/**
 * Pure, node-free **rollup** for the release evidence operator report (Phase 52).
 *
 * Folds the two reduced sources (a `pdfxyz.release-ci-bundle/1` coherence signal + a `pdfxyz.release-audit/1`
 * regression signal) into the ONE composite {@link ReleaseReportRecommendation} + exit code an operator/CI
 * acts on. It first derives the closed set of {@link ReleaseReportRationaleId} conditions that fired, then
 * resolves the recommendation with fail-closed precedence:
 *
 *  - `hold-fail` (worst) — a BLOCKING rationale fired: a supplied document is recognized but self-inconsistent
 *    (a tamper), the bundle's coherence verdict FAILED, or the audit reported a blocking regression. A blocking
 *    input dominates.
 *  - `needs-evidence`    — the evidence is INSUFFICIENT to recommend a promotion: a document was unreadable, a
 *    usable document was indeterminate (`unknown`), OR no bundle was supplied at all (an audit-only run — the
 *    release's own coherence is unproven, since a regression check cannot substitute for it). Checked after
 *    blocking so a real blocker is never masked, but before advisory so an uncertifiable / audit-only posture
 *    never masquerades as a mere advisory (and never as a vacuous promote).
 *  - `hold-warning`      — no blocker and sufficient evidence, but a usable document raised an ADVISORY concern
 *    (a bundle warn / a non-blocking audit drift). Under `--strict`, an advisory-only posture is ESCALATED to
 *    `hold-fail` (warnings treated as hold-fail).
 *  - `promote-ready` (best) — the primary coherence evidence (a usable bundle) PASSED and the regression guard
 *    (an audit, if supplied) reported no regression.
 *
 * The rationale is emitted in the stable {@link RELEASE_REPORT_RATIONALE_IDS} order — a superset view, so a
 * reader sees every condition that applied, not only the winning one.
 */

import {
  RELEASE_REPORT_EXIT_FOR_RECOMMENDATION,
  RELEASE_REPORT_RATIONALE_DETAIL,
  RELEASE_REPORT_RATIONALE_IDS,
  RELEASE_REPORT_RECOMMENDATION_SUMMARY,
  RELEASE_REPORT_STRICT_ESCALATED_SUMMARY,
  type ReleaseReportRationale,
  type ReleaseReportRationaleId,
  type ReleaseReportRecommendation,
  type ReleaseReportRollup,
  type ReleaseReportSource,
} from "./types";

/** The bundle + audit sources, discriminated by id, that the fold reads. */
export interface ReportSources {
  readonly bundle: ReleaseReportSource;
  readonly audit: ReleaseReportSource;
}

/** True iff a usable source's own verdict equals `verdict`. */
function usableVerdictIs(source: ReleaseReportSource, verdict: string): boolean {
  return source.state === "usable" && source.verdict === verdict;
}

/**
 * Derive the closed set of rationale conditions that fired, in canonical {@link RELEASE_REPORT_RATIONALE_IDS}
 * order. Each reduces to a bounded, deterministic predicate over the two sources' already content-free state +
 * verdict; the per-id severity is authored in {@link RELEASE_REPORT_RATIONALE_DETAIL}.
 */
export function deriveRationale(sources: ReportSources): ReleaseReportRationaleId[] {
  const { bundle, audit } = sources;
  const fired: Record<ReleaseReportRationaleId, boolean> = {
    "evidence-tampered": bundle.state === "tampered" || audit.state === "tampered",
    "bundle-failed": usableVerdictIs(bundle, "fail"),
    "audit-regressed": usableVerdictIs(audit, "fail"),
    "evidence-unreadable": bundle.state === "unreadable" || audit.state === "unreadable",
    "bundle-uncertified": usableVerdictIs(bundle, "unknown"),
    "audit-inconclusive": usableVerdictIs(audit, "unknown"),
    // No bundle supplied at all ⇒ the release's own coherence is unproven (an audit-only or empty run).
    "coherence-missing": bundle.state === "absent",
    "bundle-advisory": usableVerdictIs(bundle, "warn"),
    "audit-drift": usableVerdictIs(audit, "warn"),
  };
  return RELEASE_REPORT_RATIONALE_IDS.filter((id) => fired[id]);
}

/** Assemble the full rationale records (id + severity + authored detail) for the fired ids. */
export function buildRationale(fired: readonly ReleaseReportRationaleId[]): ReleaseReportRationale[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_REPORT_RATIONALE_DETAIL[id].severity,
    detail: RELEASE_REPORT_RATIONALE_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite recommendation from the two sources under `strict`.
 *
 * Fail-closed precedence: any blocking rationale ⇒ `hold-fail`; else any insufficiency ⇒ `needs-evidence`;
 * else any advisory ⇒ `hold-warning` (or `hold-fail` under `--strict`); else `promote-ready`.
 */
export function computeReportRecommendation(
  sources: ReportSources,
  strict: boolean,
): { rollup: ReleaseReportRollup; rationale: ReleaseReportRationale[] } {
  const firedIds = deriveRationale(sources);
  const rationale = buildRationale(firedIds);

  const blocking = rationale.filter((r) => r.severity === "blocking").length;
  const insufficiencies = rationale.filter((r) => r.severity === "insufficient").length;
  const advisories = rationale.filter((r) => r.severity === "advisory").length;

  // `--strict` escalates an ADVISORY-ONLY posture (no blocker, no insufficiency) to a blocking hold.
  const strictEscalated = strict && blocking === 0 && insufficiencies === 0 && advisories > 0;

  let recommendation: ReleaseReportRecommendation;
  if (blocking > 0) recommendation = "hold-fail";
  else if (insufficiencies > 0) recommendation = "needs-evidence";
  else if (advisories > 0) recommendation = strict ? "hold-fail" : "hold-warning";
  else recommendation = "promote-ready";

  const detail = strictEscalated
    ? RELEASE_REPORT_STRICT_ESCALATED_SUMMARY
    : RELEASE_REPORT_RECOMMENDATION_SUMMARY[recommendation];

  const rollup: ReleaseReportRollup = {
    recommendation,
    exitCode: RELEASE_REPORT_EXIT_FOR_RECOMMENDATION[recommendation],
    ready: recommendation === "promote-ready",
    rationale: firedIds,
    blocking,
    insufficiencies,
    advisories,
    strict,
    strictEscalated,
    detail,
  };
  return { rollup, rationale };
}
