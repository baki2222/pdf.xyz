import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
import type { ChatTurn } from "@/lib/jobs/chat-with-pdf";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { pageTextChunks } from "@/lib/pdf/text";

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
   * Characters of selectable text in the DOCUMENT, as the panel measured it
   * once per file ({@link measureChatDocument}), or `null` when it could not
   * count.
   *
   * **REQUIRED, and `null` has to be said out loud.** Until 2026-09-27 this
   * client sent no count at all, so every question fell to the route's
   * undeclared fallback and reserved a whole call's worth — a third of the
   * day's allowance for a question about one page, and a three-message
   * conversation per day. The fallback is correct and SILENT, so the one
   * caller that can count must not be able to stop counting quietly: a
   * missing field is a compile error here, not a quietly expensive job.
   *
   * This is the whole declaration. Every question re-sends the document, the
   * question and the carried turns, but the question and turns travel in
   * `options`, and the route measures and charges those itself
   * (`optionCharacters` in `jobs/delivery-cap.ts`). A client that added them
   * to the count would have them charged twice. No page count is declared
   * either: a per-call run is bounded in characters, and nothing enforces a
   * page bound on one (`aiReservationFor`).
   */
  documentCharacters: number | null;
}

/** What the panel measured about a PDF before uploading it. */
export interface ChatDocumentCount {
  /**
   * Selectable-text characters, as pdfjs extracted them. Always > 0. The same
   * count `countDeclaredCharacters` takes for Summarize and Extract.
   */
  characters: number;
  /**
   * Pages that carry text. Not declared (see `documentCharacters`); it is what
   * tells a scan with a stray space apart from a document with text.
   */
  textPages: number;
}

export type ChatDocumentMeasurement =
  | { kind: "counted"; count: ChatDocumentCount }
  /** No selectable text: nothing to ask about until it has been OCR'd. */
  | { kind: "no-text" }
  /** The browser could not read the PDF; the job goes undeclared. */
  | { kind: "uncounted" };

/**
 * Count a PDF the way the declaration needs it, once per file.
 *
 * `extract` is injected so the counting can be driven without a browser;
 * the panel passes `extractPdfText`.
 *
 * THREE OUTCOMES, and each is honest in its own direction:
 *  - `counted` — the job declares what this document holds.
 *  - `no-text` — the worker would refuse it anyway (`no_text`), and a zero
 *    cannot be declared (the contract answers 400). The panel says so and
 *    uploads nothing, so nothing is charged.
 *  - `uncounted` — the browser's pdfjs could not parse what the worker's
 *    `pdftotext` may well read. Refusing here would put a browser limitation
 *    in front of a working tool, so the job goes undeclared and pays the
 *    fallback — exactly the pre-declaration behaviour, never worse.
 */
export async function measureChatDocument(
  bytes: Uint8Array,
  extract: (bytes: Uint8Array) => Promise<ExtractedPdfText>,
): Promise<ChatDocumentMeasurement> {
  let extracted: ExtractedPdfText;
  try {
    extracted = await extract(bytes);
  } catch {
    return { kind: "uncounted" };
  }
  // PAGES WITH TEXT, from the same helper translate declares with: blank and
  // image-only pages are dropped by both extractors before anything is sent.
  const textPages = pageTextChunks(extracted.pages).length;
  if (extracted.characterCount <= 0 || textPages === 0) {
    return { kind: "no-text" };
  }
  return {
    kind: "counted",
    count: { characters: extracted.characterCount, textPages },
  };
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

/**
 * What the Chat with PDF panel calls to run a question. An object so a test
 * can swap the driver and put it back. The panel test used to `vi.mock` this
 * module and import the panel AFTER it — which only works if nothing in the
 * same worker imported the panel first. Under `isolate: false` the tool-page
 * guards that walk every panel do exactly that, and the mock then never
 * reached the (already cached) panel: nine tests red, only in a full run.
 */
export const chatWithPdfDeps: { run: typeof runWorkerChatWithPdf } = {
  run: runWorkerChatWithPdf,
};
