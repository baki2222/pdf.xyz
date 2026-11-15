/**
 * Production translate dependencies: the native pdftotext selectable-text extractor plus a
 * live AI provider resolved from the environment (or none).
 *
 * Both dependencies are conditional, and each absence is honest. The extractor is
 * wired only when the worker actually has `pdftotext` (selectable text only — never
 * OCR); without it the engine reports that it cannot run rather than accepting a job
 * it would always fail. The AI provider
 * is present ONLY when an operator has configured one (`PDFXYZ_AI_PROVIDER` + key);
 * absent, the engine fails honestly as `ai_unconfigured` rather than fabricating a
 * translation. `fetch` is injectable via {@link AiProviderDeps} so the wiring
 * is testable without a real network call. Mirrors `../summarize/native`.
 */

import {
  resolveNativePdfTextExtractor,
  resolveNativePdfTextReader,
} from "../pdf-text/native";
import { resolveNativeHtmlRenderConfig } from "../html-render/native-config";
import {
  createNativeChromiumPdfRunner,
  probeChromiumFromConfig,
  type ChromiumSeams,
} from "../html-render/native";
import { resolveAiProvider } from "../ai/native";
import type { AiProviderDeps } from "../ai/native";
import type { TranslateDeps, TranslatePdfDeps } from "./engine";
import { renderTranslationPdf } from "./pdf-render";
import { settledTranslatePdfLanguages } from "./pdf-languages";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";
import type { NativeHtmlRenderConfig } from "../html-render/native-config";
import {
  TRANSLATE_PDF_MAX_OUTPUT_BYTES,
  TRANSLATE_PDF_RENDER_TIMEOUT_MS,
} from "@/lib/jobs/translate-pdf-render";

/**
 * The HTML renderer's Chromium config, bounded for Translate PDF's reflowed
 * PDF: the deadline is `min(html.timeoutMs, TRANSLATE_PDF_RENDER_TIMEOUT_MS)`
 * and the output cap `min(html.maxOutputBytes, TRANSLATE_PDF_MAX_OUTPUT_BYTES)`.
 *
 * The render runs after the paid provider calls, and the browser's wait adds
 * exactly `TRANSLATE_PDF_RENDER_TIMEOUT_MS` for it (`@/lib/jobs/client-wait`),
 * so the bound Chromium is given may be shorter than that, never longer —
 * `client-wait.test.ts` holds the two together.
 */
export function translatePdfRenderConfig(
  html: NativeHtmlRenderConfig,
): NativeHtmlRenderConfig {
  return {
    ...html,
    timeoutMs: Math.min(html.timeoutMs, TRANSLATE_PDF_RENDER_TIMEOUT_MS),
    maxOutputBytes: Math.min(
      html.maxOutputBytes,
      TRANSLATE_PDF_MAX_OUTPUT_BYTES,
    ),
  };
}

type EnvSource = Record<string, string | undefined>;

/**
 * The reflowed-PDF renderer this worker's jobs use: the HTML renderer's
 * Chromium — wired exactly as EPUB to PDF wires it (`../epub/native`) — under
 * Translate's bounds, with `pdftotext`'s UTF-8 read-back for the per-job
 * conservation check. Absent when either binary is missing: no renderer, no
 * PDF, and the job returns the ZIP alone.
 */
export function nativeTranslatePdfRender(
  env: EnvSource = process.env,
  seams: ChromiumSeams = {},
): TranslatePdfDeps["render"] | undefined {
  const html = translatePdfRenderConfig(resolveNativeHtmlRenderConfig(env));
  const readBack = resolveNativePdfTextReader(env);
  if (!readBack || !probeChromiumFromConfig(html, seams)) return undefined;
  const chromium = createNativeChromiumPdfRunner(html, seams);
  return ({ input, signal }) =>
    renderTranslationPdf({
      chromium,
      readBack,
      input,
      timeoutMs: html.timeoutMs,
      maxOutputBytes: html.maxOutputBytes,
      ...(signal ? { signal } : {}),
    });
}

export function translateDeps(
  env: EnvSource = process.env,
  providerDeps: AiProviderDeps = {},
  seams: ChromiumSeams = {},
): TranslateDeps {
  const provider = resolveAiProvider(env, providerDeps);
  const extract = resolveNativePdfTextExtractor(env);
  const render = nativeTranslatePdfRender(env, seams);
  return {
    ...(extract ? { extract } : {}),
    ...(provider ? { provider } : {}),
    // The languages are read from the SAME memo the heartbeat publishes
    // (`./pdf-languages`), at job time: null until the start-up proof
    // settles, so no job is printed on a guess.
    ...(render
      ? { pdf: { render, languages: settledTranslatePdfLanguages } }
      : {}),
    limits: {
      maxInputBytes: 100 * 1024 * 1024,
      maxOutputBytes: 50 * 1024 * 1024,
      maxInputChars: AI_INPUT_LIMITS.maxInputCharacters,
    },
  };
}
