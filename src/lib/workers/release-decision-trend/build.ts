/**
 * Pure, node-free **composer** for the release decision index trend summary result (Phase 61).
 *
 * It takes the ingested windows the trust boundary produced (oldest → newest), the run's stamp, and the applied
 * policy, and folds them into one stable {@link ReleaseDecisionTrendResult}: it reduces the history to a bounded point
 * sequence + summary (`./reduce`), folds the composite trend verdict + reasons (`./rollup`), derives the ordered
 * next-action checklist from the fired reasons + verdict, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the points are emitted oldest → newest, the reasons / checklist in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested history +
 * stamp + policy always produce a byte-identical result. Honesty: a point reports its own CLAIM, while the rollup
 * (folded separately) resolves the trend — so a tampered / blocked / thin history never yields a clean pass.
 */

import { buildTrendReceipt } from "./receipt";
import { computeTrendRollup } from "./rollup";
import { reduceTrend } from "./reduce";
import type { IngestedDecisionIndex } from "./ingest";
import {
  RELEASE_DECISION_INDEX_SCHEMA,
  RELEASE_DECISION_TREND_CAVEATS,
  RELEASE_DECISION_TREND_CHECKLIST_DETAIL,
  RELEASE_DECISION_TREND_CHECKLIST_IDS,
  RELEASE_DECISION_TREND_GUIDANCE,
  RELEASE_DECISION_TREND_POLICY_ID,
  RELEASE_DECISION_TREND_POLICY_VERSION,
  RELEASE_DECISION_TREND_SCHEMA,
  type ReleaseDecisionTrendChecklistId,
  type ReleaseDecisionTrendChecklistItem,
  type ReleaseDecisionTrendMetadata,
  type ReleaseDecisionTrendPolicy,
  type ReleaseDecisionTrendReasonId,
  type ReleaseDecisionTrendResult,
  type ReleaseDecisionTrendVerdict,
} from "./types";

/**
 * Which next-action checklist ids each fired reason recommends. The final checklist is the ordered, deduped union of
 * these (in canonical {@link RELEASE_DECISION_TREND_CHECKLIST_IDS} order) plus a trailing `keep-decision-trend`. A
 * clean stable history (no reasons) recommends `continue-indexing-decisions`; an `improving` verdict additionally adds
 * `note-improving-trend`.
 */
const REASON_CHECKLIST: Record<ReleaseDecisionTrendReasonId, readonly ReleaseDecisionTrendChecklistId[]> = {
  "window-unreadable": ["recover-invalid-windows"],
  "window-tampered": ["recover-invalid-windows"],
  "window-blocked": ["review-blocked-windows"],
  "window-invalid": ["review-blocked-windows"],
  "strict-nonclean": ["review-strict-nonclean"],
  "no-usable-windows": ["supply-decision-indexes"],
  "only-insufficient": ["complete-insufficient-windows"],
  "trend-degrading": ["review-degrading-trend"],
  "window-watch": ["review-watch-windows"],
  "window-insufficient": ["complete-insufficient-windows"],
};

/** Assemble the stable identity block (with the pinned upstream decision-index schema). */
export function buildTrendMetadata(): ReleaseDecisionTrendMetadata {
  return {
    schemaVersion: RELEASE_DECISION_TREND_POLICY_VERSION,
    policyId: RELEASE_DECISION_TREND_POLICY_ID,
    policyVersion: RELEASE_DECISION_TREND_POLICY_VERSION,
    indexSchema: RELEASE_DECISION_INDEX_SCHEMA,
  };
}

/** Derive the ordered, deduped next-action checklist from the fired reasons + the resolved verdict. */
export function buildChecklist(
  fired: readonly ReleaseDecisionTrendReasonId[],
  verdict: ReleaseDecisionTrendVerdict,
): ReleaseDecisionTrendChecklistItem[] {
  const wanted = new Set<ReleaseDecisionTrendChecklistId>();
  for (const id of fired) for (const step of REASON_CHECKLIST[id]) wanted.add(step);
  if (verdict === "improving") wanted.add("note-improving-trend");
  if (fired.length === 0) {
    // A clean stable history: keep indexing decisions, then keep the record.
    wanted.add("continue-indexing-decisions");
  }
  wanted.add("keep-decision-trend"); // always the last step — keep the content-free governance review summary
  return RELEASE_DECISION_TREND_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_DECISION_TREND_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested windows (oldest → newest) + the run stamp + the policy into the full
 * {@link ReleaseDecisionTrendResult}. Pure and deterministic.
 */
export function buildTrendResult(
  generatedAt: string,
  windows: readonly IngestedDecisionIndex[],
  policy: ReleaseDecisionTrendPolicy,
): ReleaseDecisionTrendResult {
  const { points, summary } = reduceTrend(windows, policy.maxWindows);
  const { rollup, reasons } = computeTrendRollup(summary, policy);
  const checklist = buildChecklist(rollup.reasons, rollup.verdict);

  return {
    schema: RELEASE_DECISION_TREND_SCHEMA,
    generatedAt,
    metadata: buildTrendMetadata(),
    policy,
    summary,
    points,
    trend: rollup,
    reasons,
    checklist,
    guidance: RELEASE_DECISION_TREND_GUIDANCE,
    caveats: RELEASE_DECISION_TREND_CAVEATS,
    receipt: buildTrendReceipt(generatedAt, summary, rollup),
  };
}
