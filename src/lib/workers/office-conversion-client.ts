import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import {
  FIT_COLUMNS_TO_WIDTH_OPTION,
  ONE_PAGE_PER_SHEET_OPTION,
  ORIENTATION_OPTION,
  acceptsPageSetup,
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
 * for a layout. One page per sheet ignores page setup, so with it ticked
 * nothing else is sent; orientation and fit-to-width are sent only for a
 * file whose page setup the worker can rewrite (.xlsx), which is also the
 * only file the panel shows those controls for. Nothing else ever carries
 * these keys, so a Word or PowerPoint job is byte-for-byte the request it
 * was.
 */
export function officeJobOptions(
  input: OfficeConversionWorkerInput,
): Record<string, unknown> {
  const layout = input.layout;
  if (input.tool !== "excel-to-pdf" || !layout) return {};
  if (layout.onePagePerSheet) return { [ONE_PAGE_PER_SHEET_OPTION]: true };
  if (!acceptsPageSetup(input.filename)) return {};
  return {
    ...(layout.orientation ? { [ORIENTATION_OPTION]: layout.orientation } : {}),
    ...(layout.fitColumnsToWidth
      ? { [FIT_COLUMNS_TO_WIDTH_OPTION]: true }
      : {}),
  };
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
