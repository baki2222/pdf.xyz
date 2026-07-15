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
 * `fetch` is injectable through {@link AnthropicProviderDeps}, so the wiring is
 * unit-testable without a real network call or a real key.
 */

import { createAnthropicProvider, type AnthropicProviderDeps } from "./anthropic";
import { AI_ENV, resolveAiConfig } from "./config";
import type { AiProvider } from "./provider";

type EnvSource = Record<string, string | undefined>;

/**
 * Resolve a live AI provider from the environment, or `null` when AI is not
 * enabled/misconfigured. The returned provider carries the API key only in its
 * closure — the value is never placed on the object, logged, or returned elsewhere.
 */
export function resolveAiProvider(
  env: EnvSource = process.env,
  deps: AnthropicProviderDeps = {},
): AiProvider | null {
  const resolution = resolveAiConfig(env);
  if (!resolution.enabled) return null;

  // The single, deliberate read of the secret value — validated present by the
  // config layer; re-checked defensively so a race can never construct a keyless provider.
  const apiKey = env[AI_ENV.apiKey];
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return null;

  const { config } = resolution;
  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider(
        {
          apiKey: apiKey.trim(),
          model: config.model,
          ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
          timeoutMs: config.timeoutMs,
        },
        deps,
      );
    default:
      return null;
  }
}
