/**
 * Assemble a {@link SoundnessGate} from a resolved {@link SoundnessPolicy}. The gate
 * is a tiny stateless wrapper: `check` delegates to the pure {@link checkSoundness}
 * evaluation, and `capability` reports the honest, presence-only enabled/disabled
 * state plus the stable policy id/version. Node-free (it only reads config and the
 * static tool catalog), so it composes into the executor and the local-dev adapter
 * and is unit-tested directly — no socket, binary, or filesystem, unlike the
 * scanner's Node-only resolver. The environment resolver the daemon wires,
 * `resolveWorkerSoundness`, lives in the `./index` barrel.
 */

import { checkSoundness } from "./check";
import {
  DEFAULT_SOUNDNESS_POLICY,
  SOUNDNESS_POLICY_ID,
  SOUNDNESS_POLICY_VERSION,
  type SoundnessPolicy,
} from "./policy";
import type {
  SoundnessCapability,
  SoundnessGate,
  SoundnessInput,
  SoundnessResult,
} from "./types";

const ENABLED_DETAIL =
  "The worker file-soundness gate is enabled: a bounded structural + metadata-consistency preflight runs on each input before scanning and processing. This is not malware scanning, PDF sanitization, or a validity guarantee.";
const DISABLED_DETAIL =
  "The worker file-soundness gate is disabled; inputs are not checked (and are never reported as checked).";

/** Build a gate over `policy`. A disabled policy yields a gate that checks nothing. */
export function createSoundnessGate(policy: SoundnessPolicy): SoundnessGate {
  const capability: SoundnessCapability = policy.enabled
    ? {
        active: true,
        mode: "enabled",
        policyId: SOUNDNESS_POLICY_ID,
        policyVersion: SOUNDNESS_POLICY_VERSION,
        detail: ENABLED_DETAIL,
      }
    : {
        active: false,
        mode: "disabled",
        policyId: SOUNDNESS_POLICY_ID,
        policyVersion: SOUNDNESS_POLICY_VERSION,
        detail: DISABLED_DETAIL,
      };
  return {
    check: (input: SoundnessInput): SoundnessResult =>
      checkSoundness(policy, input),
    capability: () => capability,
  };
}

/** A gate with the shipped default policy (enabled; header-required). */
export function defaultSoundnessGate(): SoundnessGate {
  return createSoundnessGate(DEFAULT_SOUNDNESS_POLICY);
}

/** An explicitly-disabled gate (checks nothing, reports `disabled`). */
export function disabledSoundnessGate(): SoundnessGate {
  return createSoundnessGate({ ...DEFAULT_SOUNDNESS_POLICY, enabled: false });
}
