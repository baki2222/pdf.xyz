import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import {
  DEFAULT_PDFA_LEVEL,
  PDFA_LEVEL_OPTION,
  type PdfALevelId,
} from "./pdf-archive/levels";

const PDF_TO_PDFA_TOOL = "pdf-to-pdfa";

export type PdfArchiveWorkerResult = PdfSecurityWorkerResult;

export interface PdfArchiveWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /** The level picker's choice (`./pdf-archive/levels`); PDF/A-2b if absent. */
  level?: PdfALevelId;
}

/**
 * The job's option bag: empty for PDF/A-2b, exactly the request the tool
 * sent before the level picker, and `{ level }` for any other level.
 */
export function pdfaJobOptions(
  input: PdfArchiveWorkerInput,
): Record<string, unknown> {
  return input.level && input.level !== DEFAULT_PDFA_LEVEL.id
    ? { [PDFA_LEVEL_OPTION]: input.level }
    : {};
}

export async function runWorkerPdfToPdfA(
  input: PdfArchiveWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfArchiveWorkerResult> {
  return runSecurityJob(
    PDF_TO_PDFA_TOOL,
    input.filename,
    input.bytes,
    pdfaJobOptions(input),
    // The wait is jobPollFor("pdf-to-pdfa") — PDF_TO_PDFA_JOB_POLL in
    // `@/lib/jobs/client-wait`, derived from Ghostscript's own budget —
    // unless the caller names one.
    options,
  );
}

/**
 * Honest readiness for PDF/A. Remote worker binaries are not visible to web, so a
 * configured + drainable worker is the best signal we have there.
 *
 * Local dev is always `false`: `pdf-to-pdfa` is not in `LOCAL_DEV_SUPPORTED_TOOLS` and the
 * local adapter never wires the archive processor, so this tool genuinely cannot run in
 * that mode. Deferring to `canRunPdfSecurity` alone would key readiness off the **qpdf**
 * probe — a different binary from the Ghostscript one PDF/A actually needs — and advertise
 * the tool as available on any dev box with qpdf installed, only to reject the job after
 * the user picked a file.
 */
export function canRunPdfArchive(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
