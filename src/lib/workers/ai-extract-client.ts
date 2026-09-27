import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
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
  /**
   * Characters of selectable text the panel counted
   * (`countDeclaredCharacters`), or `null` when it could not count.
   *
   * REQUIRED, and nullable rather than optional, for the reason translate's
   * client gives: the route's fallback is correct and silent. An omitted count
   * costs a third of the day's allowance per run, whatever the document holds,
   * and nothing fails — so a caller that stops counting must have to say so.
   */
  declaredCharacters: number | null;
}

export function runWorkerAiExtract(
  input: AiExtractWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<AiExtractWorkerResult> {
  const jobOptions: Record<string, unknown> = { mode: input.mode };
  if (input.mode === "prompt" && input.prompt !== undefined)
    jobOptions.prompt = input.prompt;
  if (input.mode === "schema" && input.schema !== undefined)
    jobOptions.schema = input.schema;
  return runSecurityJob(
    "ai-extract",
    input.filename,
    input.bytes,
    jobOptions,
    options,
    input.declaredCharacters ?? undefined,
  );
}

/**
 * True when the UI may offer the secure-worker AI Data Extraction flow: a drainable
 * remote pipeline AND a declared AI provider. See `./ai-tool-availability` for why
 * the AI half is checked here rather than left to fail after the upload.
 */
export function canRunAiExtract(
  status: WorkerStatus | null | undefined,
): boolean {
  return canRunAiTool(status);
}
