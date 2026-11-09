import { outputName } from "./files";

/**
 * A sensible download name for a signed document, derived from the source.
 *
 * Its own module so the Sign runner, which needs only this, does not import
 * the `signPdf` engine (`./signature`): a module the runner imports is in
 * Sign PDF's first load, and with it every `import()` the engine makes — the
 * handwriting table's included, which became one more async chunk in the
 * webpack runtime EVERY page downloads first (+14 B gzip on every page,
 * measured 2026-11-09). `./signature` re-exports it for its callers.
 */
export function signatureOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "signed");
}
