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
   * **REQUIRED HERE, OPTIONAL ON THE WIRE, and the asymmetry is the design —
   * not one of the two being wrong.** `CreateJobRequest.declaredCharacters` is
   * optional because an API caller legitimately cannot count: it has bytes, not
   * extracted text, and the route's fallback (reserve a whole per-call ceiling)
   * is exactly the behaviour every caller had before this field existed.
   *
   * This client CAN count — the panel extracts the text before it uploads, for
   * the per-call ceiling check — so for it the fallback would be a silent
   * regression rather than a sane default: jobs would quietly cost the maximum
   * again and nothing would fail. Required makes that unrepresentable, and it
   * fails at COMPILE time rather than at assertion time.
   *
   * The type cannot see a property dropped in serialisation between a correct
   * client and a correct parser, which is why `declared-characters.chain.test.ts`
   * drives this path end to end as well.
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
