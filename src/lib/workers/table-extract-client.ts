import type { WorkerStatus } from "./status";
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
 * upload → create job → poll → download) — table extraction carries no options, so
 * the option bag is empty. It never fabricates output: when the worker can't run
 * the job it surfaces the server's honest typed error, never a fake ZIP.
 */

export type TableExtractWorkerResult = PdfSecurityWorkerResult;

export interface TableExtractWorkerInput {
  filename: string;
  bytes: Uint8Array;
}

export function runWorkerTableExtract(
  input: TableExtractWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<TableExtractWorkerResult> {
  return runSecurityJob(
    "extract-tables",
    input.filename,
    input.bytes,
    {},
    options,
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
