import type { WorkerStatus } from "./status";
import { canRunPdfSecurity, runSecurityJob, type PdfSecurityWorkerOptions, type PdfSecurityWorkerResult } from "./pdf-security-client";
import type { SummaryFormat, SummaryLength } from "@/lib/jobs/summarize-pdf";

/**
 * Browser-side driver for the secure-worker Summarize PDF flow (`summarize-pdf`).
 *
 * It reuses the shared job lifecycle in `./pdf-security-client` (reserve upload →
 * upload → create job → poll → download) — the summary request (length, format,
 * optional focus) travels in the job's `options` body. It never fabricates output:
 * when no AI provider is configured, or the PDF has no selectable text, the worker
 * returns an honest typed error (not-implemented / unprocessable), which surfaces
 * here unchanged. No summary is ever invented client-side.
 */

export type SummarizeWorkerResult = PdfSecurityWorkerResult;

export interface SummarizeWorkerInput {
  filename: string;
  bytes: Uint8Array;
  length: SummaryLength;
  format: SummaryFormat;
  /** Optional free-text directive steering what the summary emphasizes. */
  focus?: string;
}

export function runWorkerSummarize(
  input: SummarizeWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<SummarizeWorkerResult> {
  const jobOptions: Record<string, unknown> = {
    length: input.length,
    format: input.format,
  };
  if (input.focus !== undefined) jobOptions.focus = input.focus;
  return runSecurityJob("summarize-pdf", input.filename, input.bytes, jobOptions, options);
}

/**
 * True when the UI may offer the secure-worker Summarize PDF flow. Mirrors the
 * request-signatures gate: the summarization engine lives on the remote worker, so
 * local-dev (whose probes are about native binaries) never advertises it, and
 * staging/production gate on storage + queue + a drainable daemon. Whether an AI
 * provider is actually configured is decided server-side — an unconfigured worker
 * still surfaces the honest not-implemented error rather than a fabricated summary.
 */
export function canRunSummarize(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
