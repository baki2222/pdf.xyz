import type { WorkerStatus } from "./status";
import { canRunPdfSecurity, runSecurityJob, type PdfSecurityWorkerOptions, type PdfSecurityWorkerResult } from "./pdf-security-client";

export type OfficeConversionWorkerResult = PdfSecurityWorkerResult;

export interface OfficeConversionWorkerInput {
  tool: "word-to-pdf" | "excel-to-pdf" | "powerpoint-to-pdf";
  filename: string;
  bytes: Uint8Array;
}

export function runWorkerOfficeToPdf(input: OfficeConversionWorkerInput, options: PdfSecurityWorkerOptions = {}): Promise<OfficeConversionWorkerResult> {
  return runSecurityJob(input.tool, input.filename, input.bytes, {}, options);
}

export function canRunOfficeConversion(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
