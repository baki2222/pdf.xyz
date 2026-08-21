import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
import type {
  TranslateLanguage,
  TranslateSourceLanguage,
} from "@/lib/jobs/translate-pdf";

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
  /**
   * Characters of selectable text this document holds, as the BROWSER counted
   * them — the figure the route reserves against.
   *
   * REQUIRED, not optional, and that is the point. The route falls back to
   * reserving a whole per-call ceiling when nothing is declared, which is a
   * correct default and a silent one: a caller that stopped declaring would
   * simply get three jobs a day again, with nothing failing. Making it required
   * means the one caller that can count cannot quietly stop.
   */
  declaredCharacters: number;
}

export function runWorkerTranslate(
  input: TranslateWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<TranslateWorkerResult> {
  const jobOptions: Record<string, unknown> = {
    targetLanguage: input.targetLanguage,
    sourceLanguage: input.sourceLanguage,
  };
  if (input.instructions !== undefined)
    jobOptions.instructions = input.instructions;
  return runSecurityJob(
    "translate-pdf",
    input.filename,
    input.bytes,
    jobOptions,
    options,
    input.declaredCharacters,
  );
}

/**
 * True when the UI may offer the secure-worker Translate PDF flow: a drainable
 * remote pipeline AND a declared AI provider. See `./ai-tool-availability` for why
 * the AI half is checked here rather than left to fail after the upload.
 */
export function canRunTranslate(
  status: WorkerStatus | null | undefined,
): boolean {
  return canRunAiTool(status);
}
