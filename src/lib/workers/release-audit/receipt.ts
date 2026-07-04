/**
 * The content-free **audit receipt** for one release evidence audit (Phase 51).
 *
 * An audit decision is a thing a SIEM / release record wants to log verbatim: "the release audit resolved
 * to <verdict> (exit <code>) in <mode> mode, over a comparable pair (<bool>), with <blocking> blocking and
 * <warning> warning regressions, policy <id>@<version>, at <instant>". The receipt is exactly that —
 * bounded enums + small integers + a stable policy id + the run's own stamp. It carries no ingested prose,
 * no path, no locator, and no digest, so it is safe to forward to any downstream system.
 */

import {
  RELEASE_AUDIT_POLICY_ID,
  RELEASE_AUDIT_POLICY_VERSION,
  type AuditRollup,
  type ReleaseAuditMode,
  type ReleaseAuditReceipt,
} from "./types";

/** Flatten the content-free audit receipt from the composite rollup + the run's mode. */
export function buildAuditReceipt(
  generatedAt: string,
  mode: ReleaseAuditMode,
  rollup: AuditRollup,
): ReleaseAuditReceipt {
  return {
    category: "worker-release-audit",
    policyId: RELEASE_AUDIT_POLICY_ID,
    policyVersion: RELEASE_AUDIT_POLICY_VERSION,
    at: generatedAt,
    mode,
    verdict: rollup.verdict,
    exitCode: rollup.exitCode,
    comparable: rollup.comparable,
    blockingRegressions: rollup.blockingRegressions,
    warningRegressions: rollup.warningRegressions,
  };
}
