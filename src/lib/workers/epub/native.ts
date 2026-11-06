import { resolveNativeHtmlRenderConfig } from "../html-render/native-config";
import {
  createNativeChromiumPdfRunner,
  probeChromiumFromConfig,
  type ChromiumSeams,
} from "../html-render/native";
import type { EpubRenderDeps } from "./engine";
import { resolveNativeEpubConfig } from "./native-config";

/**
 * EPUB to PDF's dependencies: the HTML renderer's Chromium — the same binary,
 * kill switch, time bound and output cap (`PDFXYZ_HTML_RENDER_*`) — with this
 * engine's own input ceiling (`./native-config`).
 */
export function nativeEpubRenderDeps(
  env: Record<string, string | undefined> = process.env,
  seams: ChromiumSeams = {},
): EpubRenderDeps {
  const html = resolveNativeHtmlRenderConfig(env);
  const epub = resolveNativeEpubConfig(env);
  const available = probeChromiumFromConfig(html, seams);
  return {
    ...(available
      ? { chromium: createNativeChromiumPdfRunner(html, seams) }
      : {}),
    limits: { maxInputBytes: epub.maxInputBytes, timeoutMs: html.timeoutMs },
  };
}
