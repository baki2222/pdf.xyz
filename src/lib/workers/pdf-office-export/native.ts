/**
 * Production PDF→Office export deps.
 *
 * Text comes from the native `pdftotext` extractor (`@/lib/workers/pdf-text/
 * native`), injected only when the binary is genuinely present. They do NOT
 * use `@/lib/pdf/text`, whose pdfjs extractor loads the MAIN build: that one
 * constructs a `DOMMatrix` at import, so on the worker it threw before reading
 * a byte and every pdf-to-word/excel/powerpoint job failed with
 * `internal_error` while the processor still advertised itself as ready.
 *
 * PDF to PowerPoint also gets `scanPages` (`./page-scan`): pdfjs's LEGACY
 * build, which does run under Node, reading each page's pictures, positioned
 * text and drawing. It is injected under the same presence-only rule — when
 * the legacy build and its canvas resolve here — and bounded by the same
 * timeout pdftotext runs under, and the output ceiling.
 */
import { resolveNativePdfTextConfig } from "@/lib/workers/pdf-text/native-config";
import {
  nativePdfOfficeExportDeps,
  type PdfTextSeams,
} from "@/lib/workers/pdf-text/native";
import type { PdfOfficeExportDeps } from "./engine";
import { scanPdfPages } from "./page-scan";
import { nodePdfjsAvailable } from "./pdfjs-node";

export function pdfOfficeExportDeps(
  env: Record<string, string | undefined> = process.env,
  seams: PdfTextSeams & { pdfjsAvailable?: () => boolean } = {},
): PdfOfficeExportDeps {
  const base = nativePdfOfficeExportDeps(env, seams);
  const config = resolveNativePdfTextConfig(env);
  const available = (seams.pdfjsAvailable ?? (() => nodePdfjsAvailable()))();
  return {
    ...base,
    ...(available ? { scanPages: scanPdfPages } : {}),
    limits: { ...base.limits, scanTimeoutMs: config.timeoutMs },
  };
}
