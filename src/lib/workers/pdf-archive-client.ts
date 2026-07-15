import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";

const PDF_TO_PDFA_TOOL = "pdf-to-pdfa";

export type PdfArchiveWorkerResult = PdfSecurityWorkerResult;

export interface PdfArchiveWorkerInput {
  filename: string;
  bytes: Uint8Array;
}

export async function runWorkerPdfToPdfA(
  input: PdfArchiveWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfArchiveWorkerResult> {
  return runSecurityJob(PDF_TO_PDFA_TOOL, input.filename, input.bytes, {}, options);
}

/** Same secure-worker readiness rule as qpdf tools: remote worker binaries are not visible to web. */
export function canRunPdfArchive(status: WorkerStatus | null | undefined): boolean {
  return canRunPdfSecurity(status);
}
