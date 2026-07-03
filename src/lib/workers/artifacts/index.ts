/**
 * Public surface of the secure-worker **artifact-manifest / provenance gate** and its
 * factory.
 *
 * Every module re-exported here is node-free (pure types, config parsing, and bounded
 * metadata checks — no socket, filesystem, or PDF parser), so this barrel is safe to
 * import from the executor and from tests.
 *
 * {@link resolveWorkerArtifactManifest} is the one call a worker runtime makes: it
 * parses the environment into a policy and returns a ready gate. The gate ships
 * ENABLED by default (the check needs no backend and makes no security claim — it is
 * structural metadata validation only); an operator can disable it via
 * {@link ARTIFACT_ENV.enabled}.
 */

import { createArtifactManifestGate } from "./gate";
import { resolveArtifactPolicy } from "./policy";
import type { ArtifactManifestGate } from "./types";

export * from "./types";
export * from "./policy";
export * from "./manifest";
export * from "./gate";
export * from "./receipt";
export * from "./access";
export * from "./lifecycle";
export * from "./retrieval";
export * from "./delivery";

type EnvSource = Record<string, string | undefined>;

/**
 * Resolve the artifact-manifest gate for an environment: parse the bounded policy and
 * build a gate over it. Deterministic; `env` injectable. With nothing declared the
 * gate is enabled with the conservative default policy (require a non-empty,
 * recognized, producible, retention-classed output); an operator disables it or tunes
 * the knobs via {@link ARTIFACT_ENV}.
 */
export function resolveWorkerArtifactManifest(
  env: EnvSource = process.env,
): ArtifactManifestGate {
  return createArtifactManifestGate(resolveArtifactPolicy(env));
}
