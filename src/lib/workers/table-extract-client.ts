import type { WorkerStatus } from "./status";
import { OCR_JOB_POLL } from "@/lib/jobs/client-wait";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";

/**
 * Browser-side driver for the secure-worker table-extraction flow (`extract-tables`).
 *
 * It reuses the shared job lifecycle in `./pdf-security-client` (create upload →
 * upload → create job → poll → download). Its one option, since 2026-11-08, is
 * OCR first; without it the option bag is empty. It never fabricates output: when the worker can't run
 * the job it surfaces the server's honest typed error, never a fake ZIP.
 */

export type TableExtractWorkerResult = PdfSecurityWorkerResult;

export interface TableExtractWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /**
   * Run OCR in the same job first (2026-11-08, audit extract-tables#3), with
   * the PDF to Office exports' option shape. Absent = an empty options bag.
   */
  ocr?: {
    languages: readonly string[];
    rotatePages?: boolean;
    deskew?: boolean;
    redoOcr?: boolean;
  };
}

export function runWorkerTableExtract(
  input: TableExtractWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<TableExtractWorkerResult> {
  const ocr = input.ocr;
  const jobOptions: Record<string, unknown> = ocr
    ? {
        ocr: true,
        languages: [...ocr.languages],
        ...(ocr.rotatePages ? { rotatePages: true } : {}),
        ...(ocr.deskew ? { deskew: true } : {}),
        ...(ocr.redoOcr ? { redoOcr: true } : {}),
      }
    : {};
  return runSecurityJob(
    "extract-tables",
    input.filename,
    input.bytes,
    jobOptions,
    // OCR runs first in the same job, so the page waits as OCR PDF's does.
    ocr
      ? {
          pollIntervalMs: OCR_JOB_POLL.intervalMs,
          maxPollAttempts: OCR_JOB_POLL.maxAttempts,
          ...options,
        }
      : options,
  );
}

/**
 * True when the UI may offer the secure-worker table-extraction flow. Mirrors the
 * PDF-to-Office export gate: the layout extractor lives on the remote worker, so
 * local-dev (whose probes are about native binaries) never advertises it, and
 * staging/production gate on storage + queue + a drainable daemon.
 */
export function canRunTableExtract(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
