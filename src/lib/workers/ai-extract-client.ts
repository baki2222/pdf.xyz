import type { WorkerStatus } from "./status";
import { canRunPdfSecurity, runSecurityJob, type PdfSecurityWorkerOptions, type PdfSecurityWorkerResult } from "./pdf-security-client";
import type { ExtractionField, ExtractionMode } from "@/lib/jobs/ai-extract";

/**
 * Browser-side driver for the secure-worker AI Data Extraction flow (`ai-extract`).
 *
 * It reuses the shared job lifecycle in `./pdf-security-client` (reserve upload →
 * upload → create job → poll → download) — the extraction request (mode + prompt or
 * schema) travels in the job's `options` body. It never fabricates output: when no AI
 * provider is configured, the PDF has no selectable text, or the model does not return
 * valid JSON, the worker returns an honest typed error (not-implemented /
 * unprocessable), which surfaces here unchanged. No extraction is ever invented
 * client-side, and no secret is ever part of the request — the AI key lives only in
 * the worker's environment.
 */

export type AiExtractWorkerResult = PdfSecurityWorkerResult;

export interface AiExtractWorkerInput {
  filename: string;
  bytes: Uint8Array;
  mode: ExtractionMode;
  /** The free-text extraction instruction. Required iff `mode === "prompt"`. */
  prompt?: string;
  /** The typed field list to extract. Required (non-empty) iff `mode === "schema"`. */
  schema?: ExtractionField[];
}

export function runWorkerAiExtract(
  input: AiExtractWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<AiExtractWorkerResult> {
  const jobOptions: Record<string, unknown> = { mode: input.mode };
  if (input.mode === "prompt" && input.prompt !== undefined) jobOptions.prompt = input.prompt;
  if (input.mode === "schema" && input.schema !== undefined) jobOptions.schema = input.schema;
  return runSecurityJob("ai-extract", input.filename, input.bytes, jobOptions, options);
}

/**
 * True when the UI may offer the secure-worker AI Data Extraction flow. Mirrors the
 * summarize/translate gate: the extraction engine lives on the remote worker, so
 * local-dev (whose probes are about native binaries) never advertises it, and
 * staging/production gate on storage + queue + a drainable daemon. Whether an AI
 * provider is actually configured is decided server-side — an unconfigured worker
 * still surfaces the honest not-implemented error rather than a fabricated extraction.
 */
export function canRunAiExtract(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
