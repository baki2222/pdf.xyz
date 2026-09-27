import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
import type { ChatTurn } from "@/lib/jobs/chat-with-pdf";

/**
 * Browser-side driver for the secure-worker Chat with PDF flow (`chat-with-pdf`).
 *
 * It reuses the shared job lifecycle in `./pdf-security-client` (reserve upload →
 * upload → create job → poll → download) — the chat request (question + optional
 * conversation context) travels in the job's `options` body. It never fabricates
 * output: when no AI provider is configured, the PDF has no selectable text, or the
 * model returns an empty answer, the worker returns an honest typed error
 * (not-implemented / unprocessable), which surfaces here unchanged. No answer is ever
 * invented client-side, and no secret is ever part of the request — the AI key lives
 * only in the worker's environment.
 */

export type ChatWithPdfWorkerResult = PdfSecurityWorkerResult;

export interface ChatWithPdfWorkerInput {
  filename: string;
  bytes: Uint8Array;
  /** The user's question about the PDF. Bounded server-side by the job contract. */
  question: string;
  /** Optional prior conversation (complete user/assistant pairs) for a follow-up. */
  context?: ChatTurn[];
  /**
   * Characters of selectable text in the DOCUMENT, counted once per file by
   * the panel (`countDeclaredCharacters`), or `null` when it could not count.
   *
   * This is the whole declaration. Every question re-sends the document, the
   * question and the carried turns, but the question and turns travel in
   * `options`, and the route measures and charges those itself
   * (`optionCharacters` in `jobs/delivery-cap.ts`). Until 2026-09-27 this
   * client added them to the count, which the route trusted, so a caller that
   * left them out sent them free; declared here as well, they would now be
   * charged twice.
   *
   * Required and nullable for the reason translate's client gives: an omitted
   * count silently costs a third of the day per question, which made three
   * questions the whole day's chat.
   */
  documentCharacters: number | null;
}

export function runWorkerChatWithPdf(
  input: ChatWithPdfWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<ChatWithPdfWorkerResult> {
  const jobOptions: Record<string, unknown> = { question: input.question };
  if (input.context !== undefined && input.context.length > 0)
    jobOptions.context = input.context;
  return runSecurityJob(
    "chat-with-pdf",
    input.filename,
    input.bytes,
    jobOptions,
    options,
    input.documentCharacters ?? undefined,
  );
}

/**
 * True when the UI may offer the secure-worker Chat with PDF flow: a drainable
 * remote pipeline AND a declared AI provider. See `./ai-tool-availability` for why
 * the AI half is checked here rather than left to fail after the upload.
 */
export function canRunChatWithPdf(
  status: WorkerStatus | null | undefined,
): boolean {
  return canRunAiTool(status);
}
