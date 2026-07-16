import type { WorkerStatus } from "./status";
import { canRunPdfSecurity, runSecurityJob, type PdfSecurityWorkerOptions, type PdfSecurityWorkerResult } from "./pdf-security-client";
import type { TranslateLanguage, TranslateSourceLanguage } from "@/lib/jobs/translate-pdf";

/**
 * Browser-side driver for the secure-worker Translate PDF flow (`translate-pdf`).
 *
 * It reuses the shared job lifecycle in `./pdf-security-client` (reserve upload →
 * upload → create job → poll → download) — the translation request (target/source
 * language, optional instructions) travels in the job's `options` body. It never
 * fabricates output: when no AI provider is configured, or the PDF has no selectable
 * text, the worker returns an honest typed error (not-implemented / unprocessable),
 * which surfaces here unchanged. No translation is ever invented client-side.
 */

export type TranslateWorkerResult = PdfSecurityWorkerResult;

export interface TranslateWorkerInput {
  filename: string;
  bytes: Uint8Array;
  targetLanguage: TranslateLanguage;
  sourceLanguage: TranslateSourceLanguage;
  /** Optional free-text directive steering the translation. */
  instructions?: string;
}

export function runWorkerTranslate(
  input: TranslateWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<TranslateWorkerResult> {
  const jobOptions: Record<string, unknown> = {
    targetLanguage: input.targetLanguage,
    sourceLanguage: input.sourceLanguage,
  };
  if (input.instructions !== undefined) jobOptions.instructions = input.instructions;
  return runSecurityJob("translate-pdf", input.filename, input.bytes, jobOptions, options);
}

/**
 * True when the UI may offer the secure-worker Translate PDF flow. Mirrors the
 * summarize gate: the translation engine lives on the remote worker, so local-dev
 * (whose probes are about native binaries) never advertises it, and staging/production
 * gate on storage + queue + a drainable daemon. Whether an AI provider is actually
 * configured is decided server-side — an unconfigured worker still surfaces the honest
 * not-implemented error rather than a fabricated translation.
 */
export function canRunTranslate(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
