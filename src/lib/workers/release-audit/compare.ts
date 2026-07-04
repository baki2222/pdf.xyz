/**
 * Pure, node-free **diff engine** for the release evidence audit (Phase 51) — the heart of the audit.
 *
 * Given the two reduced bundle summaries (baseline + current) and the applied policy knobs, it evaluates
 * the closed set of {@link ReleaseAuditRegressionId} checks — each a bounded, deterministic comparison over
 * the bundles' already content-free facts — and emits one {@link AuditRegressionFinding} per check, in the
 * stable {@link RELEASE_AUDIT_REGRESSIONS} order, plus the bounded {@link AuditComparisonFacts} deltas.
 *
 * Fail-closed by construction:
 *  - a bundle recognized but not self-consistent (a tamper) fires `bundle-tampered` (BLOCKING), and the
 *    comparison checks are `skipped` — a tampered input is never diffed;
 *  - a bundle that is not recognized at all fires `bundle-unreadable` (INSUFFICIENT), and the comparison
 *    checks are `skipped` — an unreadable input cannot certify "no regression";
 *  - only when BOTH bundles are usable are the six comparison checks evaluated; each reduces to a bounded
 *    diff, and a "did not fire" is honestly `ok`, never assumed.
 */

import {
  RELEASE_AUDIT_POSTURE_RANK,
  RELEASE_AUDIT_REGRESSIONS,
  RELEASE_AUDIT_REGRESSION_DETAIL,
  RELEASE_CI_BUNDLE_CHECK_IDS,
  RELEASE_CI_BUNDLE_STAGE_IDS,
  type AuditBundleSummary,
  type AuditComparisonFacts,
  type AuditPolicy,
  type AuditRegressionFinding,
  type ReleaseAuditFindingStatus,
  type ReleaseAuditRegressionId,
  type ReleaseAuditSeverity,
} from "./types";
import type { ReleaseCiBundleSeverity } from "../release-ci-bundle/types";

/** The rank of a bundle severity on the posture ladder (the four tokens are shared with the verdict ladder). */
function severityRank(severity: ReleaseCiBundleSeverity): number {
  return RELEASE_AUDIT_POSTURE_RANK[severity];
}

/**
 * The archive-decision severity of a usable bundle: the policy stage's severity if present, else the index
 * stage's, else `unknown` (no archive-decision stage certified this release). Mirrors the Phase 50 notion
 * that the policy is the chain's terminal decision, then the index.
 */
function decisionSeverity(summary: AuditBundleSummary): ReleaseCiBundleSeverity {
  const policy = summary.stages.policy;
  const index = summary.stages.index;
  if (policy.present) return policy.severity;
  if (index.present) return index.severity;
  return "unknown";
}

/** How many consistency links went `ok` (baseline) → `mismatch` (current). */
function brokenLinkCount(baseline: AuditBundleSummary, current: AuditBundleSummary): number {
  return RELEASE_CI_BUNDLE_CHECK_IDS.filter(
    (id) => baseline.links[id] === "ok" && current.links[id] === "mismatch",
  ).length;
}

/** How many consistency links went `ok` (baseline) → `skipped` (current). */
function weakenedLinkCount(baseline: AuditBundleSummary, current: AuditBundleSummary): number {
  return RELEASE_CI_BUNDLE_CHECK_IDS.filter(
    (id) => baseline.links[id] === "ok" && current.links[id] === "skipped",
  ).length;
}

/** How many stages present + recognized in the baseline are absent in the current bundle. */
function droppedStageCount(baseline: AuditBundleSummary, current: AuditBundleSummary): number {
  return RELEASE_CI_BUNDLE_STAGE_IDS.filter(
    (id) => baseline.stages[id].present && !current.stages[id].present,
  ).length;
}

/** The result of the diff: the findings (canonical order) + the bounded deltas. */
export interface AuditComparison {
  readonly findings: readonly AuditRegressionFinding[];
  readonly facts: AuditComparisonFacts;
}

/**
 * The trust state across ALL supplied bundles, computed by the caller. In pair mode this is just the
 * baseline + current; in history mode it spans every history member (so a tampered bundle that is NOT the
 * compared pair still fails the audit closed).
 */
export interface AuditTrust {
  /** A supplied bundle was a recognized `pdfxyz.release-ci-bundle/1` whose rollup did not re-derive (a tamper). */
  readonly tampered: boolean;
  /** A supplied bundle was not a recognized release CI bundle at all (unreadable). */
  readonly unreadable: boolean;
}

/** The trust state of one supplied bundle summary (tampered / unreadable), for the caller to fold. */
export function bundleTrust(summary: AuditBundleSummary): AuditTrust {
  return {
    tampered: summary.present && summary.recognized && !summary.usable,
    unreadable: summary.present && !summary.recognized,
  };
}

/** Fold a set of trust states with OR (any tampered / any unreadable). */
export function mergeTrust(states: readonly AuditTrust[]): AuditTrust {
  return {
    tampered: states.some((s) => s.tampered),
    unreadable: states.some((s) => s.unreadable),
  };
}

/**
 * Diff `current` against `baseline` under `policy`, with the caller-supplied `trust` state over all
 * bundles. Deterministic; every finding reduces to a bounded status + severity, and every delta is a small
 * signed integer / boolean.
 */
export function compareBundles(
  baseline: AuditBundleSummary,
  current: AuditBundleSummary,
  policy: AuditPolicy,
  trust: AuditTrust,
): AuditComparison {
  // The trust gates first: a tampered (recognized-but-not-usable) or unreadable (not-recognized) input
  // anywhere in the supplied set; when present these dominate and the comparison checks cannot run.
  const anyTampered = trust.tampered;
  const anyUnreadable = trust.unreadable;
  const comparable = baseline.usable && current.usable;

  const resolved = new Map<ReleaseAuditRegressionId, { status: ReleaseAuditFindingStatus; severity: ReleaseAuditSeverity }>();

  // --- input trust checks (always evaluated) ---
  resolved.set("bundle-tampered", anyTampered ? { status: "regressed", severity: "block" } : { status: "ok", severity: "none" });
  resolved.set("bundle-unreadable", anyUnreadable ? { status: "regressed", severity: "unknown" } : { status: "ok", severity: "none" });

  // --- comparison checks (only over two usable bundles; otherwise skipped) ---
  let facts: AuditComparisonFacts;
  if (!comparable) {
    for (const id of ["verdict-worsened", "consistency-broke", "consistency-weakened", "coverage-dropped", "archive-decision-worsened", "warnings-increased"] as const) {
      resolved.set(id, { status: "skipped", severity: "none" });
    }
    facts = {
      postureRankDelta: null,
      stagesPresentDelta: 0,
      inconsistenciesDelta: 0,
      newWarnings: 0,
      brokenLinks: 0,
      weakenedLinks: 0,
      droppedStages: 0,
      improved: false,
    };
  } else {
    const baseRank = baseline.postureRank ?? 0;
    const curRank = current.postureRank ?? 0;
    const brokenLinks = brokenLinkCount(baseline, current);
    const weakenedLinks = weakenedLinkCount(baseline, current);
    const droppedStages = droppedStageCount(baseline, current);
    const inconsistenciesDelta = current.inconsistencies - baseline.inconsistencies;
    const newWarnings = Math.max(0, current.warningSignals - baseline.warningSignals);

    // verdict-worsened: current posture strictly worse than baseline.
    if (curRank > baseRank) {
      const blocking = current.verdict === "fail" || (current.verdict === "unknown" && policy.failOnUnknown);
      resolved.set("verdict-worsened", { status: "regressed", severity: blocking ? "block" : "warn" });
    } else {
      resolved.set("verdict-worsened", { status: "ok", severity: "none" });
    }

    // consistency-broke: a held link now mismatches, or inconsistencies rose. Blocking.
    resolved.set(
      "consistency-broke",
      brokenLinks > 0 || inconsistenciesDelta > 0
        ? { status: "regressed", severity: "block" }
        : { status: "ok", severity: "none" },
    );

    // consistency-weakened: a held link is now skipped (a stage it needed was dropped). Advisory.
    resolved.set(
      "consistency-weakened",
      weakenedLinks > 0 ? { status: "regressed", severity: "warn" } : { status: "ok", severity: "none" },
    );

    // coverage-dropped: a stage present in the baseline is absent now. Advisory.
    resolved.set(
      "coverage-dropped",
      droppedStages > 0 ? { status: "regressed", severity: "warn" } : { status: "ok", severity: "none" },
    );

    // archive-decision-worsened: the decision stage's severity got worse (or was lost).
    const baseDecision = decisionSeverity(baseline);
    const curDecision = decisionSeverity(current);
    if (severityRank(curDecision) > severityRank(baseDecision)) {
      const blocking = curDecision === "fail" || (curDecision === "unknown" && policy.failOnUnknown);
      resolved.set("archive-decision-worsened", { status: "regressed", severity: blocking ? "block" : "warn" });
    } else {
      resolved.set("archive-decision-worsened", { status: "ok", severity: "none" });
    }

    // warnings-increased: advisory pressure past the baseline + allowance. Advisory.
    resolved.set(
      "warnings-increased",
      newWarnings > policy.maxNewWarnings
        ? { status: "regressed", severity: "warn" }
        : { status: "ok", severity: "none" },
    );

    facts = {
      postureRankDelta: curRank - baseRank,
      stagesPresentDelta: current.stagesPresent - baseline.stagesPresent,
      inconsistenciesDelta,
      newWarnings,
      brokenLinks,
      weakenedLinks,
      droppedStages,
      improved: curRank < baseRank,
    };
  }

  const findings: AuditRegressionFinding[] = RELEASE_AUDIT_REGRESSIONS.map((id) => {
    const r = resolved.get(id)!;
    const detail =
      r.status === "regressed"
        ? RELEASE_AUDIT_REGRESSION_DETAIL[id].regressed
        : r.status === "ok"
          ? RELEASE_AUDIT_REGRESSION_DETAIL[id].ok
          : RELEASE_AUDIT_REGRESSION_DETAIL[id].skipped;
    return { id, status: r.status, severity: r.severity, detail };
  });

  return { findings, facts };
}
