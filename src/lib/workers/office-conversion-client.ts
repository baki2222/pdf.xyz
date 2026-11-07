import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import {
  ONE_PAGE_PER_SHEET_OPTION,
  type SheetLayout,
} from "./office-conversion/sheet-layout";

export type OfficeConversionWorkerResult = PdfSecurityWorkerResult;

export interface OfficeConversionWorkerInput {
  tool: "word-to-pdf" | "excel-to-pdf" | "powerpoint-to-pdf";
  filename: string;
  bytes: Uint8Array;
  /** Excel to PDF's page layout (`./office-conversion/sheet-layout`). */
  layout?: SheetLayout;
}

/**
 * The job's option bag: empty, as it always was, unless Excel to PDF asked
 * for one page per sheet. Nothing else ever carries the key, so a Word or
 * PowerPoint job is byte-for-byte the request it was.
 */
export function officeJobOptions(
  input: OfficeConversionWorkerInput,
): Record<string, unknown> {
  return input.tool === "excel-to-pdf" && input.layout?.onePagePerSheet
    ? { [ONE_PAGE_PER_SHEET_OPTION]: true }
    : {};
}

export function runWorkerOfficeToPdf(
  input: OfficeConversionWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<OfficeConversionWorkerResult> {
  return runSecurityJob(
    input.tool,
    input.filename,
    input.bytes,
    officeJobOptions(input),
    options,
  );
}

export function canRunOfficeConversion(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
