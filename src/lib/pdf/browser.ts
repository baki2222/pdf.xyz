import JSZip from "jszip";
import type { NamedBytes } from "./types";

/**
 * Browser-only helpers: reading Files into bytes, triggering downloads, and
 * bundling multiple outputs into a ZIP. Kept out of the engine (and the barrel)
 * so server components never pull DOM APIs into their bundle.
 */

// Re-export the pure naming helpers so existing call sites can keep importing
// `baseName` from here; the canonical definitions live in "./files".
export { baseName, outputName, mergedOutputName } from "./files";

/** Read a File into a Uint8Array. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Copy bytes into a standalone ArrayBuffer. This normalizes the buffer type so
 * the value is always a valid BlobPart / JSZip input across TypeScript's newer
 * (buffer-generic) typed-array lib definitions.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke later so the download has time to begin in every browser.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Trigger a browser download for raw bytes. */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime = "application/pdf",
): void {
  downloadBlob(new Blob([toArrayBuffer(bytes)], { type: mime }), filename);
}

export interface ZipOptions {
  /**
   * `DEFLATE` (default) recompresses entries; `STORE` bundles them as-is, which
   * is the right choice for already-compressed media (PNG/JPEG) where DEFLATE
   * burns CPU for a near-zero size gain.
   */
  compression?: "DEFLATE" | "STORE";
}

/** Bundle several named byte blobs into a single ZIP archive. */
export async function zipFiles(
  files: NamedBytes[],
  { compression = "DEFLATE" }: ZipOptions = {},
): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, toArrayBuffer(file.bytes));
  }
  return zip.generateAsync({
    type: "blob",
    compression,
    compressionOptions: compression === "DEFLATE" ? { level: 6 } : undefined,
  });
}

/** Sum the byte length across a set of generated files. */
export function totalBytes(files: NamedBytes[]): number {
  return files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
}
