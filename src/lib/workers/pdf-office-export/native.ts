/**
 * Production PDF→Office export deps.
 *
 * These deliberately do NOT use `@/lib/pdf/text`: that extractor is pdfjs-backed
 * and browser-only (pdfjs constructs a `DOMMatrix` at import time), so on the
 * worker it threw before reading a byte and every pdf-to-word/excel/powerpoint
 * job failed with `internal_error` while the processor still advertised itself as
 * ready. The worker uses the native `pdftotext` extractor instead, which is only
 * injected when the binary is genuinely present.
 */
import { nativePdfOfficeExportDeps } from "@/lib/workers/pdf-text/native";
import type { PdfOfficeExportDeps } from "./engine";

export function pdfOfficeExportDeps(
  env: Record<string, string | undefined> = process.env,
): PdfOfficeExportDeps {
  return nativePdfOfficeExportDeps(env);
}
