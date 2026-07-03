/**
 * Public surface of the secure-worker **file-soundness gate** and its factory.
 *
 * Every module re-exported here is node-free (pure types, config parsing over the
 * static tool catalog, and bounded byte checks — no socket, filesystem, or PDF
 * parser), so this barrel is safe to import from the executor and from tests.
 *
 * {@link resolveWorkerSoundness} is the one call a worker runtime makes: it parses
 * the environment into a policy and returns a ready gate. The gate ships ENABLED by
 * default (the check needs no backend and makes no security claim); an operator can
 * disable it via {@link SOUNDNESS_ENV.enabled}.
 */

import { createSoundnessGate } from "./gate";
import { resolveSoundnessPolicy } from "./policy";
import type { SoundnessGate } from "./types";

export * from "./types";
export * from "./policy";
export * from "./check";
export * from "./gate";
export * from "./receipt";

type EnvSource = Record<string, string | undefined>;

/**
 * Resolve the file-soundness gate for an environment: parse the bounded policy and
 * build a gate over it. Deterministic; `env` injectable. With nothing declared the
 * gate is enabled with the conservative default policy (reject empty bytes and a
 * PDF-expected input that lacks a `%PDF-` header); an operator disables it or tunes
 * the knobs via {@link SOUNDNESS_ENV}.
 */
export function resolveWorkerSoundness(
  env: EnvSource = process.env,
): SoundnessGate {
  return createSoundnessGate(resolveSoundnessPolicy(env));
}
