import type { WorkerStatus } from "./status";
import { OCR_JOB_POLL } from "@/lib/jobs/client-wait";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";

export type PdfOfficeExportWorkerResult = PdfSecurityWorkerResult;

export interface PdfOfficeExportWorkerInput {
  tool: "pdf-to-word" | "pdf-to-excel" | "pdf-to-powerpoint";
  filename: string;
  bytes: Uint8Array;
  /**
   * PDF to Word only: run OCR in the same job first, in these languages.
   * Absent = today's request, with an empty options bag.
   */
  ocr?: { languages: readonly string[] };
}

export function runWorkerPdfOfficeExport(
  input: PdfOfficeExportWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfOfficeExportWorkerResult> {
  const ocrFirst = input.tool === "pdf-to-word" && input.ocr !== undefined;
  const jobOptions: Record<string, unknown> = ocrFirst
    ? { ocr: true, languages: [...input.ocr!.languages] }
    : {};
  return runSecurityJob(
    input.tool,
    input.filename,
    input.bytes,
    jobOptions,
    // OCR runs first in the same job, so the page waits as OCR PDF's does.
    ocrFirst
      ? {
          pollIntervalMs: OCR_JOB_POLL.intervalMs,
          maxPollAttempts: OCR_JOB_POLL.maxAttempts,
          ...options,
        }
      : options,
  );
}

export function canRunPdfOfficeExport(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
