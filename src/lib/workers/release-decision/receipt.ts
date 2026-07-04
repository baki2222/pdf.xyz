/**
 * The content-free **receipt** for one release decision record (Phase 59).
 *
 * A decision is a thing a SIEM / release ledger wants to log verbatim: "the release DECISION was <decision> (exit
 * <code>), over <sourcesUsable> usable of <sourcesSupplied> composed document(s), cross-check <status>, on an
 * acknowledgement decision of <ackDecision>, policy <id>@<version>, at <instant>". The receipt is exactly that — the
 * final decision + the composed-document count + the cross-check status + the acknowledgement's decision CLASS only, as
 * bounded enums + small integers + a stable policy id + the run's own stamp. It carries no reviewer identity, no
 * ingested prose, no path, no locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_DECISION_POLICY_ID,
  RELEASE_DECISION_POLICY_VERSION,
  type ReleaseDecisionAckSummary,
  type ReleaseDecisionCrossCheck,
  type ReleaseDecisionPackSummary,
  type ReleaseDecisionReceipt,
  type ReleaseDecisionRollup,
} from "./types";

/** Flatten the content-free receipt from the two source summaries + cross-check + composite decision. */
export function buildDecisionReceipt(
  generatedAt: string,
  pack: ReleaseDecisionPackSummary,
  ack: ReleaseDecisionAckSummary,
  crossCheck: ReleaseDecisionCrossCheck,
  rollup: ReleaseDecisionRollup,
): ReleaseDecisionReceipt {
  const sourcesSupplied = (pack.supplied ? 1 : 0) + (ack.supplied ? 1 : 0);
  const sourcesUsable = (pack.usable ? 1 : 0) + (ack.usable ? 1 : 0);
  return {
    category: "worker-release-decision",
    policyId: RELEASE_DECISION_POLICY_ID,
    policyVersion: RELEASE_DECISION_POLICY_VERSION,
    at: generatedAt,
    decision: rollup.decision,
    exitCode: rollup.exitCode,
    crossCheck: crossCheck.status,
    sourcesSupplied,
    sourcesUsable,
    ackDecision: ack.decision,
  };
}
