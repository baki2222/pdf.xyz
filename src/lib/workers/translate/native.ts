/**
 * Production translate dependencies: the real pdfjs selectable-text extractor plus a
 * live AI provider resolved from the environment (or none).
 *
 * The extractor is always wired (selectable text only — never OCR). The AI provider
 * is present ONLY when an operator has configured one (`PDFXYZ_AI_PROVIDER` + key);
 * absent, the engine fails honestly as `ai_unconfigured` rather than fabricating a
 * translation. `fetch` is injectable via {@link AnthropicProviderDeps} so the wiring
 * is testable without a real network call. Mirrors `../summarize/native`.
 */

import { extractPdfText } from "@/lib/pdf/text";
import { resolveAiProvider } from "../ai/native";
import type { AnthropicProviderDeps } from "../ai/anthropic";
import type { TranslateDeps } from "./engine";

type EnvSource = Record<string, string | undefined>;

export function translateDeps(
  env: EnvSource = process.env,
  providerDeps: AnthropicProviderDeps = {},
): TranslateDeps {
  const provider = resolveAiProvider(env, providerDeps);
  return {
    extract: extractPdfText,
    ...(provider ? { provider } : {}),
    limits: {
      maxInputBytes: 100 * 1024 * 1024,
      maxOutputBytes: 50 * 1024 * 1024,
      maxInputChars: 500_000,
    },
  };
}
