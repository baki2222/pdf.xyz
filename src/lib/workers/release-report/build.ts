/**
 * Pure, node-free **composer** for the release evidence operator report result (Phase 52).
 *
 * It takes the ingested sources the trust boundary produced ({@link IngestedSources}), the run's stamp, and
 * the `--strict` flag, and folds them into one stable {@link ReleaseReportResult}: it reduces each source to a
 * bounded summary (`./reduce`), computes the coverage, folds the composite recommendation + rationale
 * (`./rollup`), derives the archive checklist + the ordered next-action checklist from the fired rationale, and
 * flattens the audit receipt (`./receipt`).
 *
 * Determinism: the sources are emitted in canonical order, the rationale / archive items / next actions in
 * canonical order, no field is a raw value from the input, and every fact is a bounded enum / small integer /
 * boolean — so the same ingested state + stamp + strict flag always produce a byte-identical result. Honesty:
 * a source's summary reports its own CLAIM, while the rollup (folded separately) resolves what the operator
 * should do — so a tampered / failed / audit-only input never yields a `promote-ready`.
 */

import { buildReportReceipt } from "./receipt";
import { computeCoverage, reduceAuditSource, reduceBundleSource } from "./reduce";
import { computeReportRecommendation } from "./rollup";
import type { IngestedSources } from "./ingest";
import {
  RELEASE_REPORT_ACTION_DETAIL,
  RELEASE_REPORT_ACTION_IDS,
  RELEASE_REPORT_CAVEATS,
  RELEASE_REPORT_CHECKLIST_IDS,
  RELEASE_REPORT_GUIDANCE,
  RELEASE_REPORT_POLICY_ID,
  RELEASE_REPORT_POLICY_VERSION,
  RELEASE_REPORT_SCHEMA,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
  type ReleaseReportAction,
  type ReleaseReportActionId,
  type ReleaseReportArchiveGuidance,
  type ReleaseReportChecklistId,
  type ReleaseReportMetadata,
  type ReleaseReportRationaleId,
  type ReleaseReportResult,
  type ReleaseReportSource,
} from "./types";

/**
 * Which next-action ids each fired rationale recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_REPORT_ACTION_IDS} order) plus a trailing `archive-report`. A clean
 * `promote-ready` (no rationale) instead recommends `promote-out-of-band` then `archive-report`.
 */
const RATIONALE_ACTIONS: Record<ReleaseReportRationaleId, readonly ReleaseReportActionId[]> = {
  "evidence-tampered": ["recover-evidence"],
  "bundle-failed": ["investigate-blocker"],
  "audit-regressed": ["investigate-blocker"],
  "evidence-unreadable": ["supply-evidence"],
  "bundle-uncertified": ["gate-current-release", "supply-evidence"],
  "audit-inconclusive": ["supply-evidence"],
  "coherence-missing": ["gate-current-release"],
  "bundle-advisory": ["review-advisory"],
  "audit-drift": ["review-advisory", "record-accepted-drift"],
};

/** Assemble the stable identity block (with the pinned upstream document schemas). */
export function buildReportMetadata(): ReleaseReportMetadata {
  return {
    schemaVersion: RELEASE_REPORT_POLICY_VERSION,
    policyId: RELEASE_REPORT_POLICY_ID,
    policyVersion: RELEASE_REPORT_POLICY_VERSION,
    bundleSchema: RELEASE_CI_BUNDLE_SCHEMA,
    auditSchema: RELEASE_AUDIT_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired rationale (or a clean promote path). */
export function buildNextActions(fired: readonly ReleaseReportRationaleId[]): ReleaseReportAction[] {
  const wanted = new Set<ReleaseReportActionId>();
  if (fired.length === 0) {
    // A clean promote-ready: proceed out of band, then archive the record.
    wanted.add("promote-out-of-band");
  } else {
    for (const id of fired) for (const action of RATIONALE_ACTIONS[id]) wanted.add(action);
  }
  wanted.add("archive-report"); // always the last step — keep the content-free record
  return RELEASE_REPORT_ACTION_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_REPORT_ACTION_DETAIL[id],
  }));
}

/** Derive the archive checklist — the recognized supplied documents + always this report. */
export function buildArchive(
  bundle: ReleaseReportSource,
  audit: ReleaseReportSource,
): ReleaseReportArchiveGuidance {
  const present = new Set<ReleaseReportChecklistId>();
  if (bundle.recognized) present.add("release-ci-bundle");
  if (audit.recognized) present.add("release-audit");
  present.add("operator-report"); // always keep the content-free handoff record
  const items = RELEASE_REPORT_CHECKLIST_IDS.filter((id) => present.has(id));
  const extra = items.length > 1;
  return {
    items,
    note: extra
      ? "Archive each recognized document above, plus this report, as CI artifacts — they are the content-free release evidence handoff record for this build. This report never uploads or promotes them."
      : "No release document was recognized, so there is nothing to archive but this report; supply a readable release CI bundle (and, optionally, a release audit) and re-run.",
  };
}

/**
 * Fold the ingested sources + the run stamp + the strict flag into the full {@link ReleaseReportResult}. Pure
 * and deterministic.
 */
export function buildReportResult(
  generatedAt: string,
  ingested: IngestedSources,
  strict: boolean,
): ReleaseReportResult {
  const bundle = reduceBundleSource(ingested.bundle);
  const audit = reduceAuditSource(ingested.audit);
  const coverage = computeCoverage(bundle, audit);
  const { rollup, rationale } = computeReportRecommendation({ bundle, audit }, strict);
  const nextActions = buildNextActions(rollup.rationale);
  const archive = buildArchive(bundle, audit);

  return {
    schema: RELEASE_REPORT_SCHEMA,
    generatedAt,
    metadata: buildReportMetadata(),
    coverage,
    sources: [bundle, audit],
    recommendation: rollup,
    rationale,
    archive,
    nextActions,
    guidance: RELEASE_REPORT_GUIDANCE,
    caveats: RELEASE_REPORT_CAVEATS,
    receipt: buildReportReceipt(generatedAt, coverage, rollup),
  };
}
