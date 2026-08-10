import type { WorkerStatus } from "./status";
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
}

export function runWorkerPdfOfficeExport(
  input: PdfOfficeExportWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfOfficeExportWorkerResult> {
  return runSecurityJob(input.tool, input.filename, input.bytes, {}, options);
}

export function canRunPdfOfficeExport(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
