/**
 * Pure, node-free **composer** for the release evidence governance bundle result (Phase 54).
 *
 * It takes the ingested sources the trust boundary produced ({@link IngestedGovernanceSources}), the run's
 * stamp, and the applied policy, and folds them into one stable {@link ReleaseGovernanceResult}: it reduces each
 * source to a bounded summary (`./reduce`), computes the coverage, folds the composite governance verdict +
 * reasons (`./rollup`), derives the archive checklist + the ordered follow-up assignment list from the fired
 * reasons, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the sources are emitted in canonical order, the reasons / archive items / follow-ups in canonical
 * order, no field is a raw value from the input, and every fact is a bounded enum / small integer / boolean — so
 * the same ingested state + stamp + policy always produce a byte-identical result. Honesty: a source's summary
 * reports its own CLAIM, while the rollup (folded separately) resolves the governance posture — so a tampered /
 * failing / trend-absent input never yields a `healthy`.
 */

import { buildGovernanceReceipt } from "./receipt";
import { computeCoverage, reduceAuditSource, reduceReportSource, reduceTrendSource } from "./reduce";
import { computeGovernanceRollup } from "./rollup";
import type { IngestedGovernanceSources } from "./ingest";
import {
  RELEASE_AUDIT_SCHEMA,
  RELEASE_GOVERNANCE_CAVEATS,
  RELEASE_GOVERNANCE_CHECKLIST_IDS,
  RELEASE_GOVERNANCE_FOLLOWUP_DETAIL,
  RELEASE_GOVERNANCE_FOLLOWUP_IDS,
  RELEASE_GOVERNANCE_GUIDANCE,
  RELEASE_GOVERNANCE_POLICY_ID,
  RELEASE_GOVERNANCE_POLICY_VERSION,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_TREND_SCHEMA,
  type ReleaseGovernanceArchiveGuidance,
  type ReleaseGovernanceChecklistId,
  type ReleaseGovernanceFollowup,
  type ReleaseGovernanceFollowupId,
  type ReleaseGovernanceMetadata,
  type ReleaseGovernancePolicy,
  type ReleaseGovernanceReasonId,
  type ReleaseGovernanceResult,
  type ReleaseGovernanceSource,
} from "./types";

/**
 * Which follow-up assignment ids each fired reason recommends. The final checklist is the ordered, deduped union
 * of these (in canonical {@link RELEASE_GOVERNANCE_FOLLOWUP_IDS} order) plus a trailing `archive-governance-bundle`.
 * A clean `healthy` bundle (no reasons) instead recommends `continue-governance-cadence` then the archive step.
 */
const REASON_FOLLOWUPS: Record<ReleaseGovernanceReasonId, readonly ReleaseGovernanceFollowupId[]> = {
  "trend-tampered": ["recover-tampered-evidence"],
  "trend-failing": ["investigate-blocked-governance"],
  "report-tampered": ["recover-tampered-evidence"],
  "report-hold-fail": ["investigate-blocked-governance"],
  "audit-tampered": ["recover-tampered-evidence"],
  "audit-regressed": ["investigate-blocked-governance"],
  "trend-missing": ["refresh-trend"],
  "trend-unreadable": ["refresh-trend"],
  "trend-unknown": ["refresh-trend"],
  "report-unreadable": ["supply-required-evidence"],
  "report-needs-evidence": ["gate-latest-release"],
  "report-missing": ["supply-required-evidence"],
  "audit-unreadable": ["supply-required-evidence"],
  "audit-inconclusive": ["supply-required-evidence"],
  "audit-missing": ["supply-required-evidence"],
  "trend-warning": ["review-watch-governance"],
  "report-hold-warning": ["review-watch-governance"],
  "audit-drift": ["review-watch-governance"],
  "report-trend-mismatch": ["refresh-trend", "review-watch-governance"],
};

/** Assemble the stable identity block (with the pinned upstream document schemas). */
export function buildGovernanceMetadata(): ReleaseGovernanceMetadata {
  return {
    schemaVersion: RELEASE_GOVERNANCE_POLICY_VERSION,
    policyId: RELEASE_GOVERNANCE_POLICY_ID,
    policyVersion: RELEASE_GOVERNANCE_POLICY_VERSION,
    trendSchema: RELEASE_TREND_SCHEMA,
    reportSchema: RELEASE_REPORT_SCHEMA,
    auditSchema: RELEASE_AUDIT_SCHEMA,
  };
}

/** Derive the ordered, deduped follow-up assignment list from the fired reasons (or a clean healthy path). */
export function buildFollowUps(fired: readonly ReleaseGovernanceReasonId[]): ReleaseGovernanceFollowup[] {
  const wanted = new Set<ReleaseGovernanceFollowupId>();
  if (fired.length === 0) {
    // A clean healthy bundle: keep the cadence, then archive the record.
    wanted.add("continue-governance-cadence");
  } else {
    for (const id of fired) for (const followup of REASON_FOLLOWUPS[id]) wanted.add(followup);
  }
  wanted.add("archive-governance-bundle"); // always the last step — keep the content-free governance record
  return RELEASE_GOVERNANCE_FOLLOWUP_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_GOVERNANCE_FOLLOWUP_DETAIL[id],
  }));
}

/** Derive the archive checklist — the recognized supplied documents + always this bundle. */
export function buildArchive(
  trend: ReleaseGovernanceSource,
  report: ReleaseGovernanceSource,
  audit: ReleaseGovernanceSource,
): ReleaseGovernanceArchiveGuidance {
  const present = new Set<ReleaseGovernanceChecklistId>();
  if (trend.recognized) present.add("release-trend");
  if (report.recognized) present.add("latest-report");
  if (audit.recognized) present.add("latest-audit");
  present.add("governance-bundle"); // always keep the content-free governance record
  const items = RELEASE_GOVERNANCE_CHECKLIST_IDS.filter((id) => present.has(id));
  const extra = items.length > 1;
  return {
    items,
    note: extra
      ? "Archive each recognized document above, plus this bundle, as CI artifacts — they are the content-free release-governance record for this review window. This bundle never uploads or promotes them."
      : "No release document was recognized, so there is nothing to archive but this bundle; supply a readable release trend (and, optionally, the latest report / audit) and re-run.",
  };
}

/**
 * Fold the ingested sources + the run stamp + the policy into the full {@link ReleaseGovernanceResult}. Pure and
 * deterministic.
 */
export function buildGovernanceResult(
  generatedAt: string,
  ingested: IngestedGovernanceSources,
  policy: ReleaseGovernancePolicy,
): ReleaseGovernanceResult {
  const trend = reduceTrendSource(ingested.trend);
  const report = reduceReportSource(ingested.report);
  const audit = reduceAuditSource(ingested.audit);
  const coverage = computeCoverage(trend, report, audit);
  const { rollup, reasons } = computeGovernanceRollup({ trend, report, audit }, policy);
  const followUps = buildFollowUps(rollup.reasons);
  const archive = buildArchive(trend, report, audit);

  return {
    schema: RELEASE_GOVERNANCE_SCHEMA,
    generatedAt,
    metadata: buildGovernanceMetadata(),
    policy,
    coverage,
    sources: [trend, report, audit],
    governance: rollup,
    reasons,
    archive,
    followUps,
    guidance: RELEASE_GOVERNANCE_GUIDANCE,
    caveats: RELEASE_GOVERNANCE_CAVEATS,
    receipt: buildGovernanceReceipt(generatedAt, policy, coverage, rollup),
  };
}
