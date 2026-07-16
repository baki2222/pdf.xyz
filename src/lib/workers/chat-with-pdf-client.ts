import type { WorkerStatus } from "./status";
import { canRunPdfSecurity, runSecurityJob, type PdfSecurityWorkerOptions, type PdfSecurityWorkerResult } from "./pdf-security-client";
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
}

export function runWorkerChatWithPdf(
  input: ChatWithPdfWorkerInput,
  options: PdfSecurityWorkerOptions = {},
): Promise<ChatWithPdfWorkerResult> {
  const jobOptions: Record<string, unknown> = { question: input.question };
  if (input.context !== undefined && input.context.length > 0) jobOptions.context = input.context;
  return runSecurityJob("chat-with-pdf", input.filename, input.bytes, jobOptions, options);
}

/**
 * True when the UI may offer the secure-worker Chat with PDF flow. Mirrors the
 * summarize/translate/ai-extract gate: the chat engine lives on the remote worker, so
 * local-dev (whose probes are about native binaries) never advertises it, and
 * staging/production gate on storage + queue + a drainable daemon. Whether an AI
 * provider is actually configured is decided server-side — an unconfigured worker
 * still surfaces the honest not-implemented error rather than a fabricated answer.
 */
export function canRunChatWithPdf(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return false;
  return canRunPdfSecurity(status);
}
