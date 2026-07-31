/**
 * Production table-extraction deps: positioned text from native `pdftotext`, plus
 * size limits.
 *
 * These deliberately do NOT use `@/lib/pdf/layout`: that extractor is pdfjs-backed
 * and browser-only (pdfjs constructs a `DOMMatrix` at import time), so on the
 * worker it threw before reading a byte and every extract-tables job failed with
 * `internal_error` while the processor still advertised itself as ready. The
 * layout extractor is injected only when the binary is genuinely present.
 */
import { nativeTableExtractDeps } from "@/lib/workers/pdf-text/native";
import type { TableExtractDeps } from "./engine";

export function tableExtractDeps(
  env: Record<string, string | undefined> = process.env,
): TableExtractDeps {
  return nativeTableExtractDeps(env);
}
