/**
 * Public surface of the secure-worker processor layer: the {@link Processor}
 * contract, the {@link ProcessorRegistry}, the concrete compression and OCR
 * processors, and a factory that wires a ready-to-use registry.
 *
 * Every module here is node-free (native dependencies are injected), so this
 * barrel is safe to import from the eager worker entry point without pulling a
 * binary probe or a Node built-in into the bundle.
 */

import type { CompressionDeps } from "../compression/engine";
import type { PdfSecurityDeps } from "../pdf-security/engine";
import type { PdfStructureDeps } from "../pdf-structure/engine";
import type { PdfArchiveDeps } from "../pdf-archive/engine";
import type { HtmlRenderDeps } from "../html-render/engine";
import type { OfficeConversionDeps } from "../office-conversion/engine";
import type { PdfOfficeExportDeps } from "../pdf-office-export/engine";
import { ProcessorRegistry } from "./registry";
import { createCompressionProcessor } from "./compression";
import { createOcrProcessor, type OcrProcessorDeps } from "./ocr";
import { createPdfSecurityProcessor } from "./pdf-security";
import { createPdfStructureProcessor } from "./pdf-structure";
import { createPdfArchiveProcessor } from "./pdf-archive";
import { createHtmlRenderProcessor } from "./html-render";
import { createOfficeConversionProcessor } from "./office-conversion";
import { createPdfOfficeExportProcessor } from "./pdf-office-export";

export * from "./types";
export * from "./registry";
export * from "./compression";
export * from "./ocr";
export * from "./pdf-security";
export * from "./pdf-structure";
export * from "./pdf-archive";
export * from "./html-render";
export * from "./office-conversion";
export * from "./pdf-office-export";

/** Dependencies for the standard secure-worker processor set. */
export interface SecureWorkerProcessorDeps {
  /** Compression engine dependencies (native availability + runner). */
  compression?: CompressionDeps;
  /** OCR dependencies (engine availability + runner); none ships by default. */
  ocr?: OcrProcessorDeps;
  /** PDF security (protect/unlock) dependencies — qpdf runner + limits. */
  pdfSecurity?: PdfSecurityDeps;
  /** PDF structure (repair/linearize) dependencies — qpdf runner + limits. */
  pdfStructure?: PdfStructureDeps;
  /** PDF archive/PDF-A dependencies — Ghostscript runner + limits. */
  pdfArchive?: PdfArchiveDeps;
  /** HTML/Webpage rendering dependencies — Chromium runner + limits. */
  htmlRender?: HtmlRenderDeps;
  /** Office document conversion dependencies — LibreOffice runner + limits. */
  officeConversion?: OfficeConversionDeps;
  /** PDF to Office export dependencies — pdfjs text extraction + OpenXML packaging. */
  pdfOfficeExport?: PdfOfficeExportDeps;
}

/**
 * Build a registry with the standard processors wired. Compression and PDF
 * security are registered only when their dependencies are supplied (the
 * executor/adapter pass a live PATH probe; with no qpdf wired, the PDF-security
 * processor is still honestly not-ready and fails as `not_implemented`). OCR is
 * always registered so its honest `not_implemented` capability is discoverable,
 * and it flips on the moment a runner is provided.
 */
export function createProcessorRegistry(
  deps: SecureWorkerProcessorDeps = {},
): ProcessorRegistry {
  const registry = new ProcessorRegistry();
  if (deps.compression) {
    registry.register(createCompressionProcessor(deps.compression));
  }
  registry.register(createOcrProcessor(deps.ocr ?? {}));
  if (deps.pdfSecurity) {
    registry.register(createPdfSecurityProcessor(deps.pdfSecurity));
  }
  if (deps.pdfStructure) {
    registry.register(createPdfStructureProcessor(deps.pdfStructure));
  }
  if (deps.pdfArchive) {
    registry.register(createPdfArchiveProcessor(deps.pdfArchive));
  }
  if (deps.htmlRender) {
    registry.register(createHtmlRenderProcessor(deps.htmlRender));
  }
  if (deps.officeConversion) {
    registry.register(createOfficeConversionProcessor(deps.officeConversion));
  }
  if (deps.pdfOfficeExport) {
    registry.register(createPdfOfficeExportProcessor(deps.pdfOfficeExport));
  }
  return registry;
}
