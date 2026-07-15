import { extractPdfText } from "@/lib/pdf/text";
import type { PdfOfficeExportDeps } from "./engine";

export function pdfOfficeExportDeps(): PdfOfficeExportDeps {
  return { extract: extractPdfText, limits: { maxInputBytes: 100 * 1024 * 1024, maxOutputBytes: 100 * 1024 * 1024 } };
}
