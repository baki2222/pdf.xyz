import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
import type { SummaryFormat, SummaryLength } from "@/lib/jobs/summarize-pdf";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";

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
    input.declaredCharacters ?? undefined,
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

/**
 * Ask the document, in the browser, whether it can be summarized at all —
 * BEFORE anything is uploaded or charged.
 *
 * The route reserves the AI allowance when the job is CREATED, so the
 * worker's own "no selectable text" answer arrives after the cost. A scan or
 * a locked PDF has no character count to declare (`countDeclaredCharacters`
 * returns `null`), so it is priced at the undeclared fallback, a third of the
 * day. A scanned PDF was uploaded, charged, then refused, and a locked one
 * read "could not be read for text extraction". Translate had the same trap
 * and checks locally for the same reason.
 *
 * Refusals carry the shared document-failure codes, which the panel links to
 * the tool that fixes each one (OCR, Unlock, Repair) — never by message text.
 * Only a pdfjs `PasswordException` is called "password-protected"; any other
 * throw is "could not be read", which is true whatever caused it. This check
 * declares nothing: the count the route prices is `declaredCharacters` on
 * {@link SummarizeWorkerInput}, which the panel counts separately.
 */
export type SummarizePreflight =
  { ok: true } | { ok: false; message: string; code: string };

/**
 * The extractor the preflight reads with. An object rather than a bare import
 * so a test can swap it and put it back: pdfjs needs `DOMMatrix`, which the
 * test DOM lacks, and `vi.mock` of the text module would leave it cached with
 * the stub for every later file in the same worker (see mock-isolation.test).
 */
export const summarizePreflightDeps: {
  extract: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
} = { extract: extractPdfText };

export async function preflightSummarize(
  bytes: Uint8Array,
  extract: (bytes: Uint8Array) => Promise<ExtractedPdfText> = (b) =>
    summarizePreflightDeps.extract(b),
): Promise<SummarizePreflight> {
  let extracted: ExtractedPdfText;
  try {
    extracted = await extract(bytes);
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "PasswordException")
      return {
        ok: false,
        code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
        message:
          "This PDF is password-protected. Unlock it with Unlock PDF, then summarize it. Nothing was uploaded.",
      };
    return {
      ok: false,
      code: OFFICE_EXPORT_ERROR_CODES.unreadable,
      message:
        name === "InvalidPDFException"
          ? "This file could not be read as a PDF. If it is one, it may be damaged; Repair PDF can often fix that. Nothing was uploaded."
          : "This PDF could not be read. It may be damaged; Repair PDF can often fix that. Nothing was uploaded.",
    };
  }
  if (!extracted.hasText || extracted.text.trim().length === 0)
    return {
      ok: false,
      code: OFFICE_EXPORT_ERROR_CODES.noText,
      // The worker's own sentence (one owner for both sides of the upload,
      // `@/lib/jobs/ai-no-text`), plus what this refusal before upload adds.
      message: `${NO_SELECTABLE_TEXT_MESSAGE["summarize-pdf"]} Nothing was uploaded.`,
    };
  return { ok: true };
}
