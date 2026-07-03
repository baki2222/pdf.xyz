/**
 * The content-free **audit receipt** for one release-gate run (Phase 46).
 *
 * A promotion decision is a thing a SIEM / release record wants to log verbatim: "the gate resolved
 * to <verdict> (exit <code>) over <n> checks, <p> of which passed, under policy <id>@<version>, at
 * <instant>". The receipt is exactly that — bounded enums + small integers + a stable policy id and
 * the run's own stamp. It carries no check output, no path, no locator, and no secret, so it is safe
 * to forward to any downstream system.
 */

import {
  RELEASE_GATE_POLICY_ID,
  RELEASE_GATE_POLICY_VERSION,
  type ReleaseGateReceipt,
  type ReleaseGateRollup,
} from "./types";

/** Build the receipt from the run's stamp + composite rollup. */
export function buildReceipt(generatedAt: string, rollup: ReleaseGateRollup): ReleaseGateReceipt {
  return {
    category: "worker-release-gate",
    policyId: RELEASE_GATE_POLICY_ID,
    policyVersion: RELEASE_GATE_POLICY_VERSION,
    at: generatedAt,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    includedChecks: rollup.includedChecks,
    passedChecks: rollup.passedChecks,
  };
}
