/**
 * Production AI Data Extraction dependencies: the native pdftotext selectable-text
 * extractor plus a live AI provider resolved from the environment (or none).
 *
 * Both dependencies are conditional, and each absence is honest. The extractor is
 * wired only when the worker actually has `pdftotext` (selectable text only — never
 * OCR); without it the engine reports that it cannot run rather than accepting a job
 * it would always fail. The AI provider
 * is present ONLY when an operator has configured one (`PDFXYZ_AI_PROVIDER` + key);
 * absent, the engine fails honestly as `ai_unconfigured` rather than fabricating an
 * extraction. `fetch` is injectable via {@link AiProviderDeps} so the wiring
 * is testable without a real network call. Mirrors `../translate/native`.
 */

import { resolveNativePdfTextExtractor } from "../pdf-text/native";
import { resolveAiProvider } from "../ai/native";
import type { AiProviderDeps } from "../ai/native";
import type { AiExtractDeps } from "./engine";

type EnvSource = Record<string, string | undefined>;

export function aiExtractDeps(
  env: EnvSource = process.env,
  providerDeps: AiProviderDeps = {},
): AiExtractDeps {
  const provider = resolveAiProvider(env, providerDeps);
  const extract = resolveNativePdfTextExtractor(env);
  return {
    ...(extract ? { extract } : {}),
    ...(provider ? { provider } : {}),
    limits: {
      maxInputBytes: 100 * 1024 * 1024,
      maxOutputBytes: 50 * 1024 * 1024,
      maxInputChars: 500_000,
    },
  };
}
