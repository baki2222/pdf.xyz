import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import {
  PDF_ARCHIVE_DEFAULT_TIMEOUT_MS,
  PDF_ARCHIVE_PASSWORD_PROBE_TIMEOUT_MS,
} from "./pdf-archive/contract";

const PDF_TO_PDFA_TOOL = "pdf-to-pdfa";
const POLL_INTERVAL_MS = 800;
/** Room for the job to wait its turn on the serial worker and for upload/download. */
const QUEUE_SLACK_MS = 60_000;

/**
 * How many status polls the browser makes before it stops waiting.
 *
 * It WAS the shared security default — 150 × 800 ms = 120 s — which is exactly
 * the worker's Ghostscript timeout with nothing left over: a job that used its
 * full engine budget, or spent a second in the queue, outlived the page that
 * was waiting for it, and the user saw "Stopped waiting for the worker" for a
 * file the worker went on to finish. Derived from the worker's own worst case
 * (engine timeout + the post-failure password probe) plus queue slack, so a
 * change to either budget moves this with it.
 */
export const PDF_ARCHIVE_MAX_POLL_ATTEMPTS = Math.ceil(
  (PDF_ARCHIVE_DEFAULT_TIMEOUT_MS +
    PDF_ARCHIVE_PASSWORD_PROBE_TIMEOUT_MS +
    QUEUE_SLACK_MS) /
    POLL_INTERVAL_MS,
);

export type PdfArchiveWorkerResult = PdfSecurityWorkerResult;

export interface PdfArchiveWorkerInput {
  filename: string;
  bytes: Uint8Array;
}

export async function runWorkerPdfToPdfA(
  input: PdfArchiveWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<PdfArchiveWorkerResult> {
  return runSecurityJob(
    PDF_TO_PDFA_TOOL,
    input.filename,
    input.bytes,
    {},
    {
      pollIntervalMs: POLL_INTERVAL_MS,
      maxPollAttempts: PDF_ARCHIVE_MAX_POLL_ATTEMPTS,
      ...options,
    },
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
