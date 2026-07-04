/**
 * The content-free **audit receipt** for one release evidence trend summary (Phase 53).
 *
 * A trend verdict is a thing a SIEM / governance record wants to log verbatim: "the release trend was <verdict>
 * (exit <code>) over <reportsUsable> usable of <reportsConsidered> considered (<reportsSupplied> supplied)
 * report(s), newest <newest> / oldest <oldest>, with <blocking> blocking / <insufficiencies> insufficiency /
 * <advisories> advisory reason(s), policy <id>@<version>, at <instant>". The receipt is exactly that — bounded
 * enums + small integers + a stable policy id + the run's own stamp. It carries no ingested prose, no path, no
 * locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_TREND_POLICY_ID,
  RELEASE_TREND_POLICY_VERSION,
  type ReleaseTrendHistory,
  type ReleaseTrendPolicy,
  type ReleaseTrendReceipt,
  type ReleaseTrendRollup,
} from "./types";

/** Flatten the content-free audit receipt from the policy + history + composite verdict. */
export function buildTrendReceipt(
  generatedAt: string,
  policy: ReleaseTrendPolicy,
  history: ReleaseTrendHistory,
  rollup: ReleaseTrendRollup,
): ReleaseTrendReceipt {
  return {
    category: "worker-release-trend",
    policyId: RELEASE_TREND_POLICY_ID,
    policyVersion: RELEASE_TREND_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    reportsSupplied: history.reportsSupplied,
    reportsConsidered: history.reportsConsidered,
    reportsUsable: history.reportsUsable,
    newest: history.newest,
    oldest: history.oldest,
    blocking: rollup.blocking,
    insufficiencies: rollup.insufficiencies,
    advisories: rollup.advisories,
    requireLatestReady: policy.requireLatestReady,
  };
}
