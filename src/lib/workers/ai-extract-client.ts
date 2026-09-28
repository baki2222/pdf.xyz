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
    input.declaredCharacters,
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
