/**
 * Pure file helpers: PDF validation and download-file naming. These use only
 * the structural `File` shape (`name`/`type`/`size`) — no DOM or pdf-lib — so
 * they're safe to import anywhere and easy to unit-test with plain objects.
 */

/** Largest file the in-browser tools will attempt to load (100 MB). */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** The minimal file shape our validators/namers need. */
export interface FileLike {
  name: string;
  type: string;
  size: number;
}

/** Strip a trailing file extension: "report.final.pdf" -> "report.final". */
export function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

/** Does this file look like a PDF, by MIME type or extension? */
export function isLikelyPdf(file: Pick<FileLike, "name" | "type">): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export interface FileValidation {
  ok: boolean;
  /** Present when `ok` is false: user-facing reason the file was rejected. */
  reason?: string;
}

/** Format a byte budget as whole megabytes for user-facing copy. */
function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Validate a single file for the in-browser PDF pipeline: it must look like a
 * PDF, be non-empty, and fit under the in-browser size budget. Returns typed,
 * user-facing reasons so runners can surface a clear, specific message.
 */
export function validatePdfFile(
  file: FileLike,
  maxBytes = MAX_PDF_BYTES,
): FileValidation {
  if (!isLikelyPdf(file)) {
    return { ok: false, reason: `"${file.name}" isn't a PDF — choose a .pdf file.` };
  }
  if (file.size <= 0) {
    return { ok: false, reason: `"${file.name}" is empty (0 bytes).` };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `"${file.name}" is too large for in-browser processing (max ${mb(maxBytes)} MB).`,
    };
  }
  return { ok: true };
}

/**
 * Partition a list of files into the PDFs we can process and the ones we can't,
 * each rejection carrying a specific reason. Used by multi-file runners (merge).
 */
export function partitionPdfFiles<T extends FileLike>(
  files: T[],
  maxBytes = MAX_PDF_BYTES,
): { accepted: T[]; rejected: { file: T; reason: string }[] } {
  const accepted: T[] = [];
  const rejected: { file: T; reason: string }[] = [];
  for (const file of files) {
    const result = validatePdfFile(file, maxBytes);
    if (result.ok) accepted.push(file);
    else rejected.push({ file, reason: result.reason ?? "Unsupported file." });
  }
  return { accepted, rejected };
}

/** Remove characters that are illegal in a download filename; keep it readable. */
export function sanitizeSegment(input: string): string {
  const cleaned = input
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "document";
}

/**
 * Build an output filename from a source name and a suffix, e.g.
 * `outputName("report.pdf", "rotated")` -> "report-rotated.pdf".
 */
export function outputName(sourceName: string, suffix: string, ext = "pdf"): string {
  const base = sanitizeSegment(baseName(sourceName));
  return `${base}-${suffix}.${ext}`;
}

/** A sensible name for a merged document, derived from its first input. */
export function mergedOutputName(names: string[]): string {
  const first = names.find((name) => name.trim().length > 0);
  return first ? outputName(first, "merged") : "merged.pdf";
}
