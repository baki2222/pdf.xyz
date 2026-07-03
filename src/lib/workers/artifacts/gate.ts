/**
 * Assemble an {@link ArtifactManifestGate} from a resolved
 * {@link ArtifactManifestPolicy}. The gate is a tiny stateless wrapper: `validate`
 * delegates to the pure {@link checkArtifacts} evaluation, and `capability` reports
 * the honest, presence-only enabled/disabled state plus the stable policy id/version.
 * Node-free (it only reads config), so it composes into the executor and the
 * local-dev adapter and is unit-tested directly. The environment resolver a worker
 * runtime wires, `resolveWorkerArtifactManifest`, lives in the `./index` barrel.
 */

import { checkArtifacts } from "./manifest";
import {
  ARTIFACT_POLICY_ID,
  ARTIFACT_POLICY_VERSION,
  DEFAULT_ARTIFACT_POLICY,
  type ArtifactManifestPolicy,
} from "./policy";
import type {
  ArtifactManifestCapability,
  ArtifactManifestGate,
  ArtifactValidation,
  ArtifactValidationInput,
} from "./types";

const ENABLED_DETAIL =
  "The worker artifact-manifest gate is enabled: a bounded structural provenance check runs on each produced output before it is persisted or exposed. This is not malware scanning, sanitization, OCR-correctness proof, or a lifecycle-deletion guarantee.";
const DISABLED_DETAIL =
  "The worker artifact-manifest gate is disabled; outputs are not validated (and are never reported as validated).";

/** Build a gate over `policy`. A disabled policy yields a gate that validates nothing. */
export function createArtifactManifestGate(
  policy: ArtifactManifestPolicy,
): ArtifactManifestGate {
  const capability: ArtifactManifestCapability = policy.enabled
    ? {
        active: true,
        mode: "enabled",
        policyId: ARTIFACT_POLICY_ID,
        policyVersion: ARTIFACT_POLICY_VERSION,
        detail: ENABLED_DETAIL,
      }
    : {
        active: false,
        mode: "disabled",
        policyId: ARTIFACT_POLICY_ID,
        policyVersion: ARTIFACT_POLICY_VERSION,
        detail: DISABLED_DETAIL,
      };
  return {
    validate: (input: ArtifactValidationInput): ArtifactValidation =>
      checkArtifacts(policy, input),
    capability: () => capability,
  };
}

/** A gate with the shipped default policy (enabled; content-type + retention checks on). */
export function defaultArtifactManifestGate(): ArtifactManifestGate {
  return createArtifactManifestGate(DEFAULT_ARTIFACT_POLICY);
}

/** An explicitly-disabled gate (validates nothing, reports `disabled`). */
export function disabledArtifactManifestGate(): ArtifactManifestGate {
  return createArtifactManifestGate({
    ...DEFAULT_ARTIFACT_POLICY,
    enabled: false,
  });
}
