/**
 * Production translate dependencies: Translate's own pdftotext extractor (the
 * `-layout` text, plus the `-bbox-layout` flow text it may send instead) plus a
 * live AI provider resolved from the environment (or none).
 *
 * Both dependencies are conditional, and each absence is honest. The extractor is
 * wired only when the worker actually has `pdftotext` (selectable text only — never
 * OCR); without it the engine reports that it cannot run rather than accepting a job
 * it would always fail.
 *
 * THE EXTRACTOR IS TRANSLATE'S OWN, not the shared
 * `resolveNativePdfTextExtractor` that summarize, ai-extract, chat-with-pdf and
 * OCR read (`shared-extractor.test.ts` discovers its call sites and holds this
 * file out of them). It is composed from the same parts, the way
 * `nativePdfOfficeExportDeps` composes PDF to Word's: the `-layout` extractor
 * (collapsed, exactly as before) and the flow extractor under
 * {@link translateFlowConfig}'s deadline, joined by
 * `./reading-order`'s `composeReadingOrderExtractor`. The AI provider
 * is present ONLY when an operator has configured one (`PDFXYZ_AI_PROVIDER` + key);
 * absent, the engine fails honestly as `ai_unconfigured` rather than fabricating a
 * translation. `fetch` is injectable via {@link AiProviderDeps} so the wiring
 * is testable without a real network call. Mirrors `../summarize/native`.
 */

import {
  createNativePdfFlowExtractor,
  createNativePdfTextExtractor,
  probePdfTextFromConfig,
  resolveNativePdfTextReader,
  type PdfTextSeams,
} from "../pdf-text/native";
import {
  resolveNativePdfTextConfig,
  type NativePdfTextConfig,
} from "../pdf-text/native-config";
import {
  composeReadingOrderExtractor,
  type TranslateExtractor,
} from "./reading-order";
import { TRANSLATE_FLOW_TIMEOUT_MS } from "@/lib/jobs/translate-reading-order";
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
import { settledTranslatePageRange } from "./page-range-proved";
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

/**
 * The `pdftotext` config for Translate's SECOND run (`-bbox-layout`): the
 * shared config with its deadline lowered to
 * `min(config.timeoutMs, TRANSLATE_FLOW_TIMEOUT_MS)`. The browser's wait adds
 * exactly `TRANSLATE_FLOW_TIMEOUT_MS` for this run (`@/lib/jobs/client-wait`),
 * so the bound given here may be shorter than that, never longer —
 * `client-wait.test.ts` holds the two together.
 */
export function translateFlowConfig(
  config: NativePdfTextConfig,
): NativePdfTextConfig {
  return {
    ...config,
    timeoutMs: Math.min(config.timeoutMs, TRANSLATE_FLOW_TIMEOUT_MS),
  };
}

/**
 * Translate's extractor for this host, or `undefined` without `pdftotext`:
 * `-layout` first, exactly as the shared extractor reads it, then — for a
 * document with text — the flow run, whose failure (other than an attempt
 * abort) leaves every page on `-layout`. See `./reading-order`.
 */
export function nativeTranslateExtractor(
  env: EnvSource = process.env,
  pdfText: PdfTextSeams = {},
): TranslateExtractor | undefined {
  const config = resolveNativePdfTextConfig(env);
  const binary = probePdfTextFromConfig(config, pdfText);
  if (!binary) return undefined;
  return composeReadingOrderExtractor(
    createNativePdfTextExtractor(binary, config, "collapse", pdfText),
    createNativePdfFlowExtractor(binary, translateFlowConfig(config), pdfText),
  );
}

export function translateDeps(
  env: EnvSource = process.env,
  providerDeps: AiProviderDeps = {},
  seams: ChromiumSeams = {},
  /** `pdftotext`'s seams (a 4th parameter, so no existing call site moves). */
  pdfText: PdfTextSeams = {},
): TranslateDeps {
  const provider = resolveAiProvider(env, providerDeps);
  const extract = nativeTranslateExtractor(env, pdfText);
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
    // This process's own `translatePageRange` verdict (`./page-range-proved`),
    // read at job time: null until the start-up proof settles. The engine
    // offers page choice in a withheld-pages notice only when it is true.
    pageChoice: settledTranslatePageRange,
    limits: {
      maxInputBytes: 100 * 1024 * 1024,
      maxOutputBytes: 50 * 1024 * 1024,
      maxInputChars: AI_INPUT_LIMITS.maxInputCharacters,
    },
  };
}
