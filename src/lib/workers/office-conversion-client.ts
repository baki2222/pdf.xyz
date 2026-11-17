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
import {
  CSV_CHARSET_OPTION,
  CSV_DELIMITER_OPTION,
  acceptsCsvImport,
  type CsvImportChoice,
} from "./office-conversion/csv-import";

export type OfficeConversionWorkerResult = PdfSecurityWorkerResult;

export interface OfficeConversionWorkerInput {
  tool: "word-to-pdf" | "excel-to-pdf" | "powerpoint-to-pdf";
  filename: string;
  bytes: Uint8Array;
  /** Excel to PDF's page layout (`./office-conversion/sheet-layout`). */
  layout?: SheetLayout;
  /**
   * Excel to PDF's CSV delimiter and character set
   * (`./office-conversion/csv-import`); null on either is Auto.
   */
  csv?: CsvImportChoice;
}

/**
 * The CSV keys: only for a .csv, and only for a choice that is not Auto, so
 * a job left on Auto is the request an older page sent, and an older worker
 * (which ignores the keys) is never sent one it would drop. The panel offers
 * the choices only while the live worker proves `csvImportOptions`.
 */
function csvJobOptions(input: OfficeConversionWorkerInput) {
  const csv = input.csv;
  if (input.tool !== "excel-to-pdf" || !csv) return {};
  if (!acceptsCsvImport(input.filename)) return {};
  return {
    ...(csv.delimiter ? { [CSV_DELIMITER_OPTION]: csv.delimiter } : {}),
    ...(csv.charset ? { [CSV_CHARSET_OPTION]: csv.charset } : {}),
  };
}

/**
 * The job's option bag: empty, as it always was, unless Excel to PDF asked
 * for a layout or a CSV choice ({@link csvJobOptions}). One page per sheet
 * ignores page setup, so with it ticked no page setup is sent; orientation and fit-to-width are sent only for a
 * file whose page setup the worker can rewrite (.xlsx), which is also the
 * only file the panel shows those controls for. Nothing else ever carries
 * these keys, so a Word or PowerPoint job is byte-for-byte the request it
 * was.
 */
export function officeJobOptions(
  input: OfficeConversionWorkerInput,
): Record<string, unknown> {
  const csv = csvJobOptions(input);
  const layout = input.layout;
  if (input.tool !== "excel-to-pdf" || !layout) return csv;
  if (layout.onePagePerSheet)
    return { [ONE_PAGE_PER_SHEET_OPTION]: true, ...csv };
  if (!acceptsPageSetup(input.filename)) return csv;
  return {
    ...csv,
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
