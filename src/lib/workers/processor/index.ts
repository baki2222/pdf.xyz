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
import { ProcessorRegistry } from "./registry";
import { createCompressionProcessor } from "./compression";
import { createOcrProcessor, type OcrProcessorDeps } from "./ocr";

export * from "./types";
export * from "./registry";
export * from "./compression";
export * from "./ocr";

/** Dependencies for the standard secure-worker processor set. */
export interface SecureWorkerProcessorDeps {
  /** Compression engine dependencies (native availability + runner). */
  compression?: CompressionDeps;
  /** OCR dependencies (engine availability + runner); none ships by default. */
  ocr?: OcrProcessorDeps;
}

/**
 * Build a registry with the standard processors wired. Compression is registered
 * only when its dependencies are supplied (the executor/adapter pass a live PATH
 * probe); OCR is always registered so its honest `not_implemented` capability is
 * discoverable, and it flips on the moment a runner is provided.
 */
export function createProcessorRegistry(
  deps: SecureWorkerProcessorDeps = {},
): ProcessorRegistry {
  const registry = new ProcessorRegistry();
  if (deps.compression) {
    registry.register(createCompressionProcessor(deps.compression));
  }
  registry.register(createOcrProcessor(deps.ocr ?? {}));
  return registry;
}
