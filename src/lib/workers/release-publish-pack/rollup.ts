/**
 * Pure, node-free **rollup** for the release evidence publish / handoff pack (Phase 57).
 *
 * Folds the five reduced sources (a `pdfxyz.release-governance/1` PRIMARY summary + optional
 * `pdfxyz.release-archive/1` / `pdfxyz.release-restore-drill/1` / `pdfxyz.release-report/1` /
 * `pdfxyz.release-trend/1`) and the applied policy into the ONE composite {@link ReleasePublishPackVerdict} +
 * DISCLOSURE CLASSIFICATION + exit code a handoff acts on. It first derives the closed set of
 * {@link ReleasePublishPackReasonId} conditions that fired, then resolves the verdict with fail-closed precedence:
 *
 *  - `blocked` (worst) — a BLOCKING reason fired: a supplied document is recognized but self-inconsistent (a
 *    tamper), the governance is `blocked`, the restore drill `restore-failed`, the report `hold-fail`, or the
 *    trend `failing`. A blocker dominates.
 *  - `incomplete` — the evidence is INSUFFICIENT: the PRIMARY governance bundle is absent / unreadable /
 *    `incomplete`, a supplied source was unreadable / indeterminate, or a required document was missing. Checked
 *    after blocking so a real blocker is never masked, but before advisory so an insufficient / governance-absent
 *    posture never masquerades as a mere advisory (and never as a vacuous share-safe pack).
 *  - `review` — no blocker and sufficient evidence, but an ADVISORY reason fired.
 *  - `publishable` (best) — the PRIMARY governance bundle is usable and `healthy`, and every supplied source is
 *    clean.
 *
 * The PRIMARY governance bundle is REQUIRED for the best outcome — an archive / restore-drill / report / trend can
 * only BLOCK or FLAG the handoff, never GRANT a share-safe pack on its own (an absent / unusable governance is
 * `governance-missing` / `governance-unreadable` → insufficient → `incomplete`), exactly like the Phase 54
 * governance bundle requires a trend. Under `--strict`, a `review` OR `incomplete` posture is ESCALATED to
 * `blocked` — a hard "share-safe or do not share" gate. The disclosure classification is a deterministic
 * coarsening of the final verdict. The reasons are emitted in the stable {@link RELEASE_PUBLISH_PACK_REASON_IDS}
 * order — a superset view, so a reviewer sees every condition that applied, not only the winning one.
 */

import {
  RELEASE_PUBLISH_PACK_DISCLOSURE_FOR_VERDICT,
  RELEASE_PUBLISH_PACK_EXIT_FOR_VERDICT,
  RELEASE_PUBLISH_PACK_REASON_DETAIL,
  RELEASE_PUBLISH_PACK_REASON_IDS,
  RELEASE_PUBLISH_PACK_STRICT_ESCALATED_SUMMARY,
  RELEASE_PUBLISH_PACK_VERDICT_SUMMARY,
  type ReleasePublishPackPolicy,
  type ReleasePublishPackReason,
  type ReleasePublishPackReasonId,
  type ReleasePublishPackRollup,
  type ReleasePublishPackSource,
  type ReleasePublishPackVerdict,
} from "./types";

/** The five reduced sources, keyed by id, that the fold reads. */
export interface PublishPackSources {
  readonly governance: ReleasePublishPackSource;
  readonly archive: ReleasePublishPackSource;
  readonly restoreDrill: ReleasePublishPackSource;
  readonly report: ReleasePublishPackSource;
  readonly trend: ReleasePublishPackSource;
}

/** True iff a usable source's own verdict equals `verdict`. */
function usableVerdictIs(source: ReleasePublishPackSource, verdict: string): boolean {
  return source.state === "usable" && source.verdict === verdict;
}

/**
 * Derive the closed set of reason conditions that fired, in canonical {@link RELEASE_PUBLISH_PACK_REASON_IDS}
 * order. Each reduces to a bounded, deterministic predicate over the five sources' already content-free state +
 * verdict (+ the policy); the per-id severity is authored in {@link RELEASE_PUBLISH_PACK_REASON_DETAIL}.
 */
export function derivePublishReasons(
  sources: PublishPackSources,
  policy: ReleasePublishPackPolicy,
): ReleasePublishPackReasonId[] {
  const { governance, archive, restoreDrill, report, trend } = sources;
  const fired: Record<ReleasePublishPackReasonId, boolean> = {
    // Blocking
    "governance-tampered": governance.state === "tampered",
    "governance-blocked": usableVerdictIs(governance, "blocked"),
    "archive-tampered": archive.state === "tampered",
    "archive-blocked": usableVerdictIs(archive, "archive-blocked"),
    "restore-tampered": restoreDrill.state === "tampered",
    "restore-failed": usableVerdictIs(restoreDrill, "restore-failed"),
    "report-tampered": report.state === "tampered",
    "report-hold-fail": usableVerdictIs(report, "hold-fail"),
    "trend-tampered": trend.state === "tampered",
    "trend-failing": usableVerdictIs(trend, "failing"),
    // Insufficient
    "governance-missing": governance.state === "absent",
    "governance-unreadable": governance.state === "unreadable",
    "governance-incomplete": usableVerdictIs(governance, "incomplete"),
    "archive-unreadable": archive.state === "unreadable",
    "archive-incomplete": usableVerdictIs(archive, "archive-incomplete"),
    "archive-missing": policy.requireArchive && archive.state === "absent",
    "restore-unreadable": restoreDrill.state === "unreadable",
    "restore-incomplete": usableVerdictIs(restoreDrill, "restore-incomplete"),
    "restore-missing": policy.requireRestoreDrill && restoreDrill.state === "absent",
    "report-unreadable": report.state === "unreadable",
    "report-needs-evidence": usableVerdictIs(report, "needs-evidence"),
    "trend-unreadable": trend.state === "unreadable",
    "trend-unknown": usableVerdictIs(trend, "unknown"),
    // Advisory
    "governance-watch": usableVerdictIs(governance, "watch"),
    "archive-watch": usableVerdictIs(archive, "archive-watch"),
    "restore-drift": usableVerdictIs(restoreDrill, "restore-drift"),
    "report-hold-warning": usableVerdictIs(report, "hold-warning"),
    "trend-warning": usableVerdictIs(trend, "warning"),
  };
  return RELEASE_PUBLISH_PACK_REASON_IDS.filter((id) => fired[id]);
}

/** Assemble the full reason records (id + severity + authored detail) for the fired ids. */
export function buildPublishReasons(
  fired: readonly ReleasePublishPackReasonId[],
): ReleasePublishPackReason[] {
  return fired.map((id) => ({
    id,
    severity: RELEASE_PUBLISH_PACK_REASON_DETAIL[id].severity,
    detail: RELEASE_PUBLISH_PACK_REASON_DETAIL[id].detail,
  }));
}

/**
 * Compute the composite publish verdict + disclosure classification from the five sources under `policy`.
 *
 * Fail-closed precedence: any blocking reason ⇒ `blocked`; else any insufficiency ⇒ `incomplete`; else any
 * advisory ⇒ `review`; else `publishable`. When `--strict` escalated a `review` or `incomplete` posture,
 * `strictEscalated` is set (and `strictEscalatedFrom` records which) so the summary explains the escalation (the
 * pack would be `review` / `incomplete` without the flag). The disclosure classification is a deterministic
 * coarsening of the FINAL verdict.
 */
export function computePublishRollup(
  sources: PublishPackSources,
  policy: ReleasePublishPackPolicy,
): { rollup: ReleasePublishPackRollup; reasons: ReleasePublishPackReason[] } {
  const firedIds = derivePublishReasons(sources, policy);
  const reasons = buildPublishReasons(firedIds);

  const blocking = reasons.filter((r) => r.severity === "blocking").length;
  const insufficiencies = reasons.filter((r) => r.severity === "insufficient").length;
  const advisories = reasons.filter((r) => r.severity === "advisory").length;

  // The base verdict (before `--strict`), by fail-closed precedence.
  let baseVerdict: ReleasePublishPackVerdict;
  if (blocking > 0) baseVerdict = "blocked";
  else if (insufficiencies > 0) baseVerdict = "incomplete";
  else if (advisories > 0) baseVerdict = "review";
  else baseVerdict = "publishable";

  // `--strict` escalates a REVIEW or INCOMPLETE posture (no blocker) to a blocking hold. A blocked / publishable
  // posture is untouched.
  const strictEscalatedFrom: "review" | "incomplete" | null =
    policy.strict && (baseVerdict === "review" || baseVerdict === "incomplete") ? baseVerdict : null;
  const strictEscalated = strictEscalatedFrom !== null;
  const verdict: ReleasePublishPackVerdict = strictEscalated ? "blocked" : baseVerdict;

  const disclosure = RELEASE_PUBLISH_PACK_DISCLOSURE_FOR_VERDICT[verdict];
  const detail = strictEscalatedFrom
    ? RELEASE_PUBLISH_PACK_STRICT_ESCALATED_SUMMARY[strictEscalatedFrom]
    : RELEASE_PUBLISH_PACK_VERDICT_SUMMARY[verdict];

  const rollup: ReleasePublishPackRollup = {
    verdict,
    exitCode: RELEASE_PUBLISH_PACK_EXIT_FOR_VERDICT[verdict],
    publishable: verdict === "publishable",
    disclosure,
    reasons: firedIds,
    blocking,
    insufficiencies,
    advisories,
    requireArchive: policy.requireArchive,
    requireRestoreDrill: policy.requireRestoreDrill,
    strict: policy.strict,
    strictEscalated,
    strictEscalatedFrom,
    detail,
  };
  return { rollup, reasons };
}
