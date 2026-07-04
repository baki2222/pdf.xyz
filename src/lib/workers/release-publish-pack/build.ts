/**
 * Pure, node-free **composer** for the release evidence publish / handoff pack result (Phase 57).
 *
 * It takes the ingested sources the trust boundary produced ({@link IngestedPublishPackSources}), the run's stamp,
 * and the applied policy, and folds them into one stable {@link ReleasePublishPackResult}: it reduces each source
 * to a bounded summary (`./reduce`), computes the coverage, folds the composite publish verdict + disclosure
 * classification + reasons (`./rollup`), derives the ordered handoff checklist from the verdict + coverage + fired
 * reasons, and flattens the receipt (`./receipt`).
 *
 * Determinism: the sources are emitted in canonical order, the reasons / checklist items in canonical order, no
 * field is a raw value from the input, and every fact is a bounded enum / small integer / boolean — so the same
 * ingested state + stamp + policy always produce a byte-identical result. Honesty: a source's summary reports its
 * own CLAIM, while the rollup (folded separately) resolves the publish posture — so a tampered / blocked / failed /
 * governance-absent input never yields a `publishable`.
 */

import { buildPublishPackReceipt } from "./receipt";
import {
  computeCoverage,
  reduceArchiveSource,
  reduceGovernanceSource,
  reduceReportSource,
  reduceRestoreDrillSource,
  reduceTrendSource,
} from "./reduce";
import { computePublishRollup } from "./rollup";
import type { IngestedPublishPackSources } from "./ingest";
import {
  RELEASE_ARCHIVE_SCHEMA,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_PUBLISH_PACK_CHECKLIST_DETAIL,
  RELEASE_PUBLISH_PACK_CHECKLIST_IDS,
  RELEASE_PUBLISH_PACK_CAVEATS,
  RELEASE_PUBLISH_PACK_DISCLOSURE_NOTE,
  RELEASE_PUBLISH_PACK_GUIDANCE,
  RELEASE_PUBLISH_PACK_POLICY_ID,
  RELEASE_PUBLISH_PACK_POLICY_VERSION,
  RELEASE_PUBLISH_PACK_SCHEMA,
  RELEASE_REPORT_SCHEMA,
  RELEASE_RESTORE_DRILL_SCHEMA,
  RELEASE_TREND_SCHEMA,
  type ReleasePublishPackChecklistId,
  type ReleasePublishPackChecklistItem,
  type ReleasePublishPackCoverage,
  type ReleasePublishPackDisclosureBlock,
  type ReleasePublishPackMetadata,
  type ReleasePublishPackPolicy,
  type ReleasePublishPackResult,
  type ReleasePublishPackRollup,
  type ReleasePublishPackSource,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream document schemas). */
export function buildPublishPackMetadata(): ReleasePublishPackMetadata {
  return {
    schemaVersion: RELEASE_PUBLISH_PACK_POLICY_VERSION,
    policyId: RELEASE_PUBLISH_PACK_POLICY_ID,
    policyVersion: RELEASE_PUBLISH_PACK_POLICY_VERSION,
    governanceSchema: RELEASE_GOVERNANCE_SCHEMA,
    archiveSchema: RELEASE_ARCHIVE_SCHEMA,
    restoreDrillSchema: RELEASE_RESTORE_DRILL_SCHEMA,
    reportSchema: RELEASE_REPORT_SCHEMA,
    trendSchema: RELEASE_TREND_SCHEMA,
  };
}

/** The disclosure block — the coarse sharing classification + its authored note. */
export function buildDisclosure(rollup: ReleasePublishPackRollup): ReleasePublishPackDisclosureBlock {
  return {
    classification: rollup.disclosure,
    note: RELEASE_PUBLISH_PACK_DISCLOSURE_NOTE[rollup.disclosure],
  };
}

/**
 * Derive the ordered handoff checklist from the rollup + coverage. Every predicate is a bounded read over the
 * already content-free rollup / coverage; the checklist is emitted in canonical {@link RELEASE_PUBLISH_PACK_CHECKLIST_IDS}
 * order, deduped. A share-safe pack lists what to include + the hand-off step; a blocked / incomplete / review pack
 * lists what to resolve / complete / mark first.
 */
export function buildChecklist(
  rollup: ReleasePublishPackRollup,
  coverage: ReleasePublishPackCoverage,
  sources: readonly ReleasePublishPackSource[],
): ReleasePublishPackChecklistItem[] {
  const blocked = rollup.verdict === "blocked";
  const anyTampered = sources.some((s) => s.state === "tampered");
  const wanted = new Set<ReleasePublishPackChecklistId>();

  if (blocked) wanted.add("resolve-blockers-before-sharing");
  if (anyTampered) wanted.add("recover-tampered-evidence");
  if (rollup.insufficiencies > 0) wanted.add("complete-missing-evidence");
  if (rollup.disclosure === "internal-review") wanted.add("mark-internal-review-only");

  // What usable evidence to include in a handoff (moot for a blocked pack — you resolve first).
  if (!blocked) {
    if (coverage.hasGovernance) wanted.add("include-governance-summary");
    if (coverage.hasArchive) wanted.add("include-archive-manifest");
    if (coverage.hasRestoreDrill) wanted.add("include-restore-drill");
    if (coverage.hasReport || coverage.hasTrend) wanted.add("include-supporting-evidence");
  }

  if (rollup.verdict === "publishable") wanted.add("hand-off-share-safe-pack");
  wanted.add("keep-publish-pack-record"); // always the last step — keep the content-free handoff record

  return RELEASE_PUBLISH_PACK_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_PUBLISH_PACK_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested sources + the run stamp + the policy into the full {@link ReleasePublishPackResult}. Pure and
 * deterministic.
 */
export function buildPublishPackResult(
  generatedAt: string,
  ingested: IngestedPublishPackSources,
  policy: ReleasePublishPackPolicy,
): ReleasePublishPackResult {
  const governance = reduceGovernanceSource(ingested.governance);
  const archive = reduceArchiveSource(ingested.archive);
  const restoreDrill = reduceRestoreDrillSource(ingested.restoreDrill);
  const report = reduceReportSource(ingested.report);
  const trend = reduceTrendSource(ingested.trend);
  const sources = [governance, archive, restoreDrill, report, trend];
  const coverage = computeCoverage(governance, archive, restoreDrill, report, trend);
  const { rollup, reasons } = computePublishRollup(
    { governance, archive, restoreDrill, report, trend },
    policy,
  );
  const disclosure = buildDisclosure(rollup);
  const checklist = buildChecklist(rollup, coverage, sources);

  return {
    schema: RELEASE_PUBLISH_PACK_SCHEMA,
    generatedAt,
    metadata: buildPublishPackMetadata(),
    policy,
    coverage,
    sources,
    pack: rollup,
    disclosure,
    reasons,
    checklist,
    guidance: RELEASE_PUBLISH_PACK_GUIDANCE,
    caveats: RELEASE_PUBLISH_PACK_CAVEATS,
    receipt: buildPublishPackReceipt(generatedAt, coverage, rollup),
  };
}
