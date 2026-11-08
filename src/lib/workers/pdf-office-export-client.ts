import type { WorkerStatus } from "./status";
import { OCR_JOB_POLL } from "@/lib/jobs/client-wait";
import { offersOfficeOcr } from "@/lib/jobs/office-export-ocr";
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
   * The exports in `OFFICE_OCR_TOOLS` only: run OCR in the same job first, in
   * these languages. Absent = today's request, with an empty options bag.
   */
  ocr?: {
    languages: readonly string[];
    /** OCR PDF's page choices (audit pdf-to-word#3); sent only when on. */
    rotatePages?: boolean;
    deskew?: boolean;
    redoOcr?: boolean;
  };
  /**
   * PDF to Excel only: one sheet per page. Absent = one sheet. Travels in the
   * same bag as OCR first: the worker reads each with its own parser.
   */
  sheetPerPage?: boolean;
}

export function runWorkerPdfOfficeExport(
  input: PdfOfficeExportWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfOfficeExportWorkerResult> {
  const ocrFirst = offersOfficeOcr(input.tool) && input.ocr !== undefined;
  const jobOptions: Record<string, unknown> = ocrFirst
    ? {
        ocr: true,
        languages: [...input.ocr!.languages],
        ...(input.ocr!.rotatePages ? { rotatePages: true } : {}),
        ...(input.ocr!.deskew ? { deskew: true } : {}),
        ...(input.ocr!.redoOcr ? { redoOcr: true } : {}),
      }
    : {};
  if (input.tool === "pdf-to-excel" && input.sheetPerPage)
    jobOptions.sheetPerPage = true;
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
