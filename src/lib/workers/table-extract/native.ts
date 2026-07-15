import { extractPdfLayout } from "@/lib/pdf/layout";
import type { TableExtractDeps } from "./engine";

/** Production table-extraction deps: pdfjs positioned-text layout + size limits. */
export function tableExtractDeps(): TableExtractDeps {
  return { extractLayout: extractPdfLayout, limits: { maxInputBytes: 100 * 1024 * 1024, maxOutputBytes: 100 * 1024 * 1024 } };
}
