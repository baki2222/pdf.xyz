/**
 * Pure, node-free **reducer** for the release evidence audit (Phase 51).
 *
 * Turns one {@link IngestedBundle} (the trust boundary's output) plus whether a bundle was supplied for
 * that slot into the bounded, content-free {@link AuditBundleSummary} the result records and the diff
 * compares. It adds only derived-but-bounded fields — the posture rank, a one-line authored headline, and
 * safe defaults for a not-usable / not-supplied slot — and never reaches past the already-reduced facts,
 * so there is nowhere for a locator or a byte to enter.
 */

import {
  RELEASE_AUDIT_POSTURE_RANK,
  RELEASE_CI_BUNDLE_CHECK_IDS,
  RELEASE_CI_BUNDLE_STAGE_IDS,
  type AuditBundleSummary,
  type AuditHistorySummary,
  type AuditStageView,
  type IngestedBundle,
} from "./types";
import type {
  ReleaseCiBundleCheckId,
  ReleaseCiBundleCheckStatus,
  ReleaseCiBundleStageId,
} from "../release-ci-bundle/types";

/** Which slot a bundle summary describes — used only to author its bounded headline. */
export type AuditSlot = "baseline" | "current";

/** All stages absent (the default for a not-usable / not-supplied slot). */
function absentStages(): Record<ReleaseCiBundleStageId, AuditStageView> {
  const stages = {} as Record<ReleaseCiBundleStageId, AuditStageView>;
  for (const id of RELEASE_CI_BUNDLE_STAGE_IDS) stages[id] = { present: false, severity: "unknown" };
  return stages;
}

/** All links skipped (the default for a not-usable / not-supplied slot). */
function skippedLinks(): Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus> {
  const links = {} as Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus>;
  for (const id of RELEASE_CI_BUNDLE_CHECK_IDS) links[id] = "skipped";
  return links;
}

/** A one-line, content-free headline authored from the slot + recognized/usable + verdict. */
function summaryDetail(slot: AuditSlot, summary: Omit<AuditBundleSummary, "detail">): string {
  if (!summary.present) return `${slot}: not supplied.`;
  if (!summary.recognized) {
    return `${slot}: supplied, but not a recognized release CI bundle (unreadable — never echoed). No comparable posture.`;
  }
  if (!summary.usable) {
    return `${slot}: recognized, but its recorded rollup does NOT re-derive from its own stages + links (tampered / corrupt — treated as a blocking failure). Claimed verdict: ${summary.verdict ?? "n/a"}.`;
  }
  return `${slot}: ${summary.verdict ?? "n/a"} over ${summary.stagesPresent} stage(s), decision stage ${summary.decisionStage ?? "none"}, ${summary.inconsistencies} inconsistency(ies).`;
}

/**
 * Reduce one ingested bundle to the bounded {@link AuditBundleSummary} for `slot`. `supplied` reflects
 * whether a bundle file was provided for this slot (independent of whether it parsed). A not-usable or
 * not-supplied slot gets safe, bounded defaults so the diff never trusts stale facts.
 */
export function reduceBundle(
  slot: AuditSlot,
  supplied: boolean,
  ingested: IngestedBundle,
): AuditBundleSummary {
  // Trusted detail only from a SUPPLIED + usable bundle; a not-supplied slot never surfaces stale facts,
  // and a recognized-but-tampered slot surfaces only its untrusted claimed verdict (no trusted detail).
  const facts = supplied && ingested.usable ? ingested.facts : null;
  const verdict = supplied ? (ingested.facts?.verdict ?? null) : null;
  const base: Omit<AuditBundleSummary, "detail"> = {
    present: supplied,
    recognized: ingested.recognized,
    usable: ingested.usable,
    verdict,
    postureRank: verdict === null ? null : RELEASE_AUDIT_POSTURE_RANK[verdict],
    exitCode: facts?.exitCode ?? null,
    stagesPresent: facts?.stagesPresent ?? 0,
    chainComplete: facts?.chainComplete ?? false,
    decisionStage: facts?.decisionStage ?? null,
    inconsistencies: facts?.inconsistencies ?? 0,
    warnStages: facts?.warnStages ?? 0,
    warningSignals: facts?.warningSignals ?? 0,
    archiveVerdict: facts?.archiveVerdict ?? null,
    stages: facts?.stages ?? absentStages(),
    links: facts?.links ?? skippedLinks(),
  };
  return { ...base, detail: summaryDetail(slot, base) };
}

/**
 * Reduce a whole history list to the bounded {@link AuditHistorySummary} — a posture distribution at a
 * glance (history mode only). A usable bundle contributes its own verdict; a recognized-but-tampered
 * bundle counts as a `fail` posture (a tamper is a blocking problem); an unrecognized bundle counts as
 * `unreadable`. Content-free: only small integer counts.
 */
export function summarizeHistory(list: readonly IngestedBundle[]): AuditHistorySummary {
  let pass = 0;
  let warn = 0;
  let unknown = 0;
  let fail = 0;
  let unreadable = 0;
  let usable = 0;
  for (const b of list) {
    if (!b.recognized) {
      unreadable++;
      continue;
    }
    if (!b.usable || b.facts === null) {
      fail++; // a recognized-but-tampered bundle is a fail-worthy posture
      continue;
    }
    usable++;
    switch (b.facts.verdict) {
      case "pass":
        pass++;
        break;
      case "warn":
        warn++;
        break;
      case "unknown":
        unknown++;
        break;
      case "fail":
        fail++;
        break;
      default:
        unknown++;
    }
  }
  return { count: list.length, usable, verdictCounts: { pass, warn, unknown, fail, unreadable } };
}
