/**
 * The content-free **audit receipt** for one release decision ledger index (Phase 60).
 *
 * An index verdict is a thing a SIEM / review record wants to log verbatim: "the ledger index was <verdict> (exit
 * <code>) over <recordsUsable> usable of <recordsConsidered> considered (<recordsSupplied> supplied) record(s),
 * decisions <proceed>/<followup>/<hold>/<reject>/<insufficient>/<invalid>, class <trendClass>, policy <id>@<version>,
 * at <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id + the run's own
 * stamp (index verdict + record count + decision counts). It carries no ingested prose, no reviewer identity, no
 * path, no locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_DECISION_INDEX_POLICY_ID,
  RELEASE_DECISION_INDEX_POLICY_VERSION,
  type ReleaseDecisionIndexLedger,
  type ReleaseDecisionIndexReceipt,
  type ReleaseDecisionIndexRollup,
} from "./types";

/** Flatten the content-free audit receipt from the ledger summary + composite verdict. */
export function buildIndexReceipt(
  generatedAt: string,
  ledger: ReleaseDecisionIndexLedger,
  rollup: ReleaseDecisionIndexRollup,
): ReleaseDecisionIndexReceipt {
  return {
    category: "worker-release-decision-index",
    policyId: RELEASE_DECISION_INDEX_POLICY_ID,
    policyVersion: RELEASE_DECISION_INDEX_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    recordsSupplied: ledger.recordsSupplied,
    recordsConsidered: ledger.recordsConsidered,
    recordsUsable: ledger.recordsUsable,
    decisionCounts: ledger.decisionCounts,
    trendClass: ledger.trendClass,
  };
}
