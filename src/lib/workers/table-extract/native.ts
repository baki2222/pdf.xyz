/**
 * Production table-extraction deps: positioned text from native `pdftotext`, plus
 * size limits.
 *
 * They deliberately do NOT use pdfjs. A pdfjs layout extractor once served this
 * engine; it was browser-only (pdfjs constructs a `DOMMatrix` at import time), so
 * on the worker it threw before reading a byte and every extract-tables job
 * failed with `internal_error` while the processor still advertised itself as
 * ready. It was later left with no importer and was removed on 2026-09-27. The
 * layout extractor is injected only when the binary is genuinely present.
 */
import { nativeTableExtractDeps } from "@/lib/workers/pdf-text/native";
import type { TableExtractDeps } from "./engine";

export function tableExtractDeps(
  env: Record<string, string | undefined> = process.env,
): TableExtractDeps {
  return nativeTableExtractDeps(env);
}
