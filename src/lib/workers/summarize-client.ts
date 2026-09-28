import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
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
  /**
   * Browser-counted characters of selectable text, from `declareAiRead` —
   * `undefined` only when the browser could not open the PDF to count.
   *
   * A REQUIRED KEY whose value may be `undefined`, and the asymmetry is the
   * point: until 2026-09-28 this client had no such field, so every job it
   * created reserved the route's undeclared fallback (a third of the day)
   * whatever the document held. Required means a caller cannot drop it by
   * omission; it has to write down that it has no count.
   */
  declaredCharacters: number | undefined;
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
  return runSecurityJob(
    "summarize-pdf",
    input.filename,
    input.bytes,
    jobOptions,
    options,
    input.declaredCharacters,
  );
}

/**
 * True when the UI may offer the secure-worker Summarize PDF flow: a drainable
 * remote pipeline AND a declared AI provider. See `./ai-tool-availability` for why
 * the AI half is checked here rather than left to fail after the upload.
 */
export function canRunSummarize(
  status: WorkerStatus | null | undefined,
): boolean {
  return canRunAiTool(status);
}
