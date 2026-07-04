/**
 * The content-free **audit receipt** for one release evidence operator report (Phase 52).
 *
 * A report recommendation is a thing a SIEM / release record wants to log verbatim: "the release report
 * recommended <recommendation> (exit <code>) over <sourcesUsable> usable source(s) (bundle present: <bool>,
 * audit present: <bool>), with <blocking> blocking / <insufficiencies> insufficiency / <advisories> advisory
 * reason(s), policy <id>@<version>, at <instant>". The receipt is exactly that — bounded enums + small
 * integers + a stable policy id + the run's own stamp. It carries no ingested prose, no path, no locator, and
 * no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_REPORT_POLICY_ID,
  RELEASE_REPORT_POLICY_VERSION,
  type ReleaseReportCoverage,
  type ReleaseReportReceipt,
  type ReleaseReportRollup,
} from "./types";

/** Flatten the content-free audit receipt from the coverage + composite recommendation. */
export function buildReportReceipt(
  generatedAt: string,
  coverage: ReleaseReportCoverage,
  rollup: ReleaseReportRollup,
): ReleaseReportReceipt {
  return {
    category: "worker-release-report",
    policyId: RELEASE_REPORT_POLICY_ID,
    policyVersion: RELEASE_REPORT_POLICY_VERSION,
    at: generatedAt,
    recommendation: rollup.recommendation,
    exitCode: rollup.exitCode,
    sourcesUsable: coverage.sourcesUsable,
    hasBundle: coverage.hasBundle,
    hasAudit: coverage.hasAudit,
    blocking: rollup.blocking,
    insufficiencies: rollup.insufficiencies,
    advisories: rollup.advisories,
    strict: rollup.strict,
  };
}
