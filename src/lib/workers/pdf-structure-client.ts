/** Browser-side driver for qpdf-backed PDF structure tools (repair + web optimize). */

import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";

const REPAIR_TOOL = "repair-pdf";
const OPTIMIZE_WEB_TOOL = "optimize-web";

export type PdfStructureWorkerResult = PdfSecurityWorkerResult;

export interface PdfStructureWorkerInput {
  filename: string;
  bytes: Uint8Array;
}

export async function runWorkerRepairPdf(
  input: PdfStructureWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfStructureWorkerResult> {
  return runSecurityJob(REPAIR_TOOL, input.filename, input.bytes, {}, options);
}

export async function runWorkerOptimizeWeb(
  input: PdfStructureWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfStructureWorkerResult> {
  return runSecurityJob(OPTIMIZE_WEB_TOOL, input.filename, input.bytes, {}, options);
}

/** Same qpdf-backed worker availability as protect/unlock. */
export function canRunPdfStructure(status: WorkerStatus | null | undefined): boolean {
  return canRunPdfSecurity(status);
}
