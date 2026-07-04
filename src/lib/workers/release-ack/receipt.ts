/**
 * The content-free **receipt** for one release evidence handoff acknowledgement (Phase 58).
 *
 * An acknowledgement verdict is a thing a SIEM / handoff record wants to log verbatim: "the publish pack was
 * <ackVerdict> (exit <code>), over a <packVerdict> pack (disclosure <classification>) covering <sourcesUsable> usable
 * of <sourcesSupplied> source(s), policy <id>@<version>, at <instant>". The receipt is exactly that — the ack verdict
 * + the source pack's own verdict / disclosure + source counts only, as bounded enums + small integers + a stable
 * policy id + the run's own stamp. It carries no reviewer identity, no ingested prose, no path, no locator, and no
 * digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_ACK_POLICY_ID,
  RELEASE_ACK_POLICY_VERSION,
  type ReleaseAckReceipt,
  type ReleaseAckRollup,
  type ReleaseAckSource,
} from "./types";

/** Flatten the content-free receipt from the pack source + composite ack verdict. */
export function buildAckReceipt(
  generatedAt: string,
  source: ReleaseAckSource,
  rollup: ReleaseAckRollup,
): ReleaseAckReceipt {
  return {
    category: "worker-release-ack",
    policyId: RELEASE_ACK_POLICY_ID,
    policyVersion: RELEASE_ACK_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    packVerdict: source.packVerdict,
    packDisclosure: source.disclosure,
    sourcesSupplied: source.sourcesSupplied,
    sourcesUsable: source.sourcesUsable,
  };
}
