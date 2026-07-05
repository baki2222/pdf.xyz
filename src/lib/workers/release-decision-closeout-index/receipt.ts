/**
 * The content-free **audit receipt** for one release decision closeout index (Phase 65).
 *
 * An index verdict is a thing a SIEM / review record wants to log verbatim: "the closeout index was <verdict> (exit
 * <code>) over <closeoutsUsable> usable of <closeoutsConsidered> considered (<closeoutsSupplied> supplied) closeout(s),
 * verdicts <closed>/<incomplete>/<open>/<blocked>, latest <latest>, class <trendClass>, policy <id>@<version>, at
 * <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id + the run's own stamp
 * + a disclosure statement (index verdict + closeout count + verdict distribution + latest). It carries no ingested
 * prose, no reviewer identity, no path, no locator, and no digest, so it is safe to forward downstream.
 */

import {
  RELEASE_DECISION_CLOSEOUT_INDEX_DISCLOSURE,
  RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_VERSION,
  type ReleaseDecisionCloseoutIndexLedger,
  type ReleaseDecisionCloseoutIndexReceipt,
  type ReleaseDecisionCloseoutIndexRollup,
} from "./types";

/** Flatten the content-free audit receipt from the ledger summary + composite verdict. */
export function buildCloseoutIndexReceipt(
  generatedAt: string,
  ledger: ReleaseDecisionCloseoutIndexLedger,
  rollup: ReleaseDecisionCloseoutIndexRollup,
): ReleaseDecisionCloseoutIndexReceipt {
  return {
    category: "worker-release-decision-closeout-index",
    policyId: RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_CLOSEOUT_INDEX_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    closeoutsSupplied: ledger.closeoutsSupplied,
    closeoutsConsidered: ledger.closeoutsConsidered,
    closeoutsUsable: ledger.closeoutsUsable,
    verdictCounts: ledger.verdictCounts,
    latest: rollup.latest,
    trendClass: ledger.trendClass,
    disclosure: RELEASE_DECISION_CLOSEOUT_INDEX_DISCLOSURE,
  };
}
