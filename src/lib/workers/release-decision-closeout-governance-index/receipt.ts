/**
 * The content-free **audit receipt** for one release decision closeout governance index (Phase 70).
 *
 * An index verdict is a thing a SIEM / review record wants to log verbatim: "the governance index was <verdict> (exit
 * <code>) over <governanceUsable> usable of <governanceConsidered> considered (<governanceSupplied> supplied) bundle(s),
 * verdicts <closed>/<incomplete>/<open>/<blocked>, latest <latest>, class <trendClass>, policy <id>@<version>, at
 * <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id + the run's own stamp +
 * a disclosure statement (index verdict + bundle count + verdict distribution + latest). It carries no ingested prose,
 * no reviewer identity, no path, no locator, and no digest, so it is safe to forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION,
  type ReleaseDecisionCloseoutGovernanceIndexLedger,
  type ReleaseDecisionCloseoutGovernanceIndexReceipt,
  type ReleaseDecisionCloseoutGovernanceIndexRollup,
} from "./types";

/** Flatten the content-free audit receipt from the ledger summary + composite verdict. */
export function buildGovernanceIndexReceipt(
  generatedAt: string,
  ledger: ReleaseDecisionCloseoutGovernanceIndexLedger,
  rollup: ReleaseDecisionCloseoutGovernanceIndexRollup,
): ReleaseDecisionCloseoutGovernanceIndexReceipt {
  return {
    category: "worker-release-decision-closeout-governance-index",
    policyId: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    governanceSupplied: ledger.governanceSupplied,
    governanceConsidered: ledger.governanceConsidered,
    governanceUsable: ledger.governanceUsable,
    verdictCounts: ledger.verdictCounts,
    latest: rollup.latest,
    trendClass: ledger.trendClass,
    disclosure: RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_DISCLOSURE,
  };
}
