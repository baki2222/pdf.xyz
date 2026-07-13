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
import { ProcessorRegistry } from "./registry";
import { createCompressionProcessor } from "./compression";
import { createOcrProcessor, type OcrProcessorDeps } from "./ocr";
import { createPdfSecurityProcessor } from "./pdf-security";
import { createPdfStructureProcessor } from "./pdf-structure";

export * from "./types";
export * from "./registry";
export * from "./compression";
export * from "./ocr";
export * from "./pdf-security";
export * from "./pdf-structure";

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
  return registry;
}
