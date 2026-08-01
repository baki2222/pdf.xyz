/**
 * The Node/server-only seam that turns an environment into a live {@link AiProvider}.
 *
 * This is the ONE place in the codebase that reads the AI API key's VALUE — and it
 * reads it only to hand it to the concrete provider constructor, which captures it
 * in a closure (never an enumerable field). Everything upstream (the node-free
 * `./config`) deals in presence and shape only. `resolveAiProvider` returns `null`
 * when the provider is disabled or misconfigured, so an AI engine that receives a
 * `null` provider fails honestly as not-configured rather than pretending to run.
 *
 * The `switch` below is the only place a provider family becomes a concrete adapter.
 * Adding a family means adding an adapter module and one arm here; the `default`
 * returns `null` so a family that is declared but not yet implemented is honestly
 * not-configured rather than silently mis-dispatched.
 *
 * `fetch` is injectable through {@link AiProviderDeps}, so the wiring is
 * unit-testable without a real network call or a real key.
 */

import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { AI_ENV, resolveAiConfig } from "./config";
import type { AiProvider } from "./provider";

type EnvSource = Record<string, string | undefined>;

/**
 * Injectable seams shared by every provider family. Both concrete adapters take the
 * same shape, so one deps object wires whichever family the environment selects.
 */
export interface AiProviderDeps {
  /** Override the fetch used for the API call (tests inject a fake). */
  fetch?: typeof fetch;
}

/**
 * Resolve a live AI provider from the environment, or `null` when AI is not
 * enabled/misconfigured. The returned provider carries the API key only in its
 * closure — the value is never placed on the object, logged, or returned elsewhere.
 */
export function resolveAiProvider(
  env: EnvSource = process.env,
  deps: AiProviderDeps = {},
): AiProvider | null {
  const resolution = resolveAiConfig(env);
  if (!resolution.enabled) return null;

  // The single, deliberate read of the secret value — validated present by the
  // config layer; re-checked defensively so a race can never construct a keyless provider.
  const apiKey = env[AI_ENV.apiKey];
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return null;

  const { config } = resolution;
  const shared = {
    apiKey: apiKey.trim(),
    model: config.model,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    timeoutMs: config.timeoutMs,
  };

  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider(shared, deps);
    case "openai":
      return createOpenAiProvider(shared, deps);
    default:
      return null;
  }
}
