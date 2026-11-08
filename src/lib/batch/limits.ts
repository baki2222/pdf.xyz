import { JOB_LIMITS } from "@/lib/jobs/types";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";

/**
 * How many files, and how many bytes, one batch in the browser takes.
 *
 * Every value is DERIVED from a limit that already binds, never typed: the
 * owner's ruling (2026-11-08) was 20 files and 200 MB, and both numbers are
 * already the product's own.
 *
 *   - `clientMaxFiles` is `JOB_LIMITS.maxInputFiles`, the most files one
 *     upload session to our server takes: one number for "how many files
 *     at once" across the site.
 *   - `clientMaxTotalBytes` is two of the largest PDF a browser tool opens
 *     (`MAX_PDF_BYTES`): the smallest total that still takes two files of
 *     the largest size each tool takes alone, so the batch never refuses a
 *     pair of its own inputs. It is a TOTAL because every output stays in
 *     memory until the ZIP is built, so the sum, not one file's size, is
 *     what a phone has to hold.
 *   - `rasterMaxFiles` is half of `clientMaxFiles`, for the tools that draw
 *     every page as an image or pull every image out (Grayscale PDF, PDF to
 *     JPG and PNG, Extract Images, batch plan P2): one file of theirs
 *     becomes many images, every one of them held until the ZIP is built,
 *     so a batch of them holds far more than its inputs. The per-page pixel
 *     and DPI ceilings still bind each page as they do for one file.
 *
 * `limits.test.ts` binds each to a second, independent bound (CLAUDE.md rule
 * 3: a constant has no relationships to constrain) — the server's own total,
 * and the 20 / 200 MB / 10 raster files the owner ruled.
 *
 * Imported by the batch's own modules, which a runner reaches through
 * `next/dynamic` once two or more files arrive; `lazy-chunks.test.ts` holds
 * the batch view's chunk off every page's first load.
 */
export const BATCH_LIMITS = {
  clientMaxFiles: JOB_LIMITS.maxInputFiles,
  clientMaxTotalBytes: 2 * MAX_PDF_BYTES,
  rasterMaxFiles: Math.floor(JOB_LIMITS.maxInputFiles / 2),
} as const;

/** A file the batch did not take, and the sentence that says why. */
export interface BatchRejection<T> {
  file: T;
  reason: string;
}

const MB = 1024 * 1024;

/** The sentence a file past the count gets, from the count itself. */
export function overCountReason(max: number): string {
  return `A batch takes up to ${max} files at a time; run this one in another batch.`;
}

/** The sentence a file past the byte total gets, from the total itself. */
export function overBytesReason(maxBytes: number): string {
  return `A batch takes up to ${Math.round(maxBytes / MB)} MB in all; this file would take it past that, so run it in another batch.`;
}

/**
 * The files a batch takes, in the order they came, and every file it does
 * not — never dropped silently. A file is kept while it fits under both the
 * count and the byte total; one that would not fit is listed with its reason,
 * and a smaller file after it may still fit.
 */
export function capBatchFiles<T extends { size: number }>(
  files: readonly T[],
  limits: {
    maxFiles: number;
    maxTotalBytes: number;
  } = {
    maxFiles: BATCH_LIMITS.clientMaxFiles,
    maxTotalBytes: BATCH_LIMITS.clientMaxTotalBytes,
  },
): { accepted: T[]; rejected: BatchRejection<T>[] } {
  const accepted: T[] = [];
  const rejected: BatchRejection<T>[] = [];
  let bytes = 0;
  for (const file of files) {
    if (accepted.length >= limits.maxFiles) {
      rejected.push({ file, reason: overCountReason(limits.maxFiles) });
    } else if (bytes + file.size > limits.maxTotalBytes) {
      rejected.push({ file, reason: overBytesReason(limits.maxTotalBytes) });
    } else {
      accepted.push(file);
      bytes += file.size;
    }
  }
  return { accepted, rejected };
}
