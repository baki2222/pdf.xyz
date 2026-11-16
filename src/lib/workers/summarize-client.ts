import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
import type { SummaryFormat, SummaryLength } from "@/lib/jobs/summarize-pdf";
import type { PageSpan } from "@/lib/pdf/page-spans";
import { extractSelectionOnDemand } from "@/lib/pdf/text-lazy";
import type {
  SummarizeChoice,
  SummarizeMeasure,
  SummarizeReading,
} from "./summarize-measure";

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
   * (`measureSummarizeRun`: the chosen pages' text, or the whole
   * document's), or `null` when it could not count.
   *
   * REQUIRED, and nullable rather than optional, for the reason translate's
   * client gives: the route's fallback is correct and silent. An omitted count
   * costs a third of the day's allowance per run, whatever the document holds,
   * and nothing fails — so a caller that stops counting must have to say so.
   */
  declaredCharacters: number | null;
  /**
   * The canonical spans the person chose (`measureSummarizeRun`), or absent
   * for the whole document. Sent as `options.pages` only when given.
   */
  pages?: PageSpan[];
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
  if (input.pages !== undefined) jobOptions.pages = input.pages;
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

export type { SummarizeChoice, SummarizeMeasure } from "./summarize-measure";

/**
 * The reader a Run measures with. An object rather than a bare import so a
 * test can swap it and put it back: pdfjs needs `DOMMatrix`, which the test
 * DOM lacks, and `vi.mock` of the text module would leave it cached with the
 * stub for every later file in the same worker (see mock-isolation.test).
 * It is THE seam the panel test counts: one call per Run.
 */
export const summarizeRunDeps: {
  read: typeof extractSelectionOnDemand;
} = {
  // The text and selection chunks arrive when Run is pressed, not with the
  // page (`@/lib/pdf/text-lazy`).
  read: (bytes) => extractSelectionOnDemand(bytes),
};

/**
 * Measure one Run, in the browser, BEFORE anything is uploaded or charged —
 * with ONE parse of the PDF (competitor audit summarize-pdf#5).
 *
 * The route reserves the AI allowance when the job is CREATED, so the
 * worker's own "no selectable text" answer arrives after the cost. A scan or
 * a locked PDF has no character count to declare, so it would be priced at
 * the undeclared fallback, a third of the day. A scanned PDF was uploaded,
 * charged, then refused, and a locked one read "could not be read for text
 * extraction". Translate had the same trap and checks locally for the same
 * reason.
 *
 * Refusals carry the shared document-failure codes, which the panel links to
 * the tool that fixes each one (OCR, Unlock, Repair) — never by message text.
 * Only a pdfjs `PasswordException` is called "password-protected"; any other
 * throw is "could not be read", which is true whatever caused it.
 *
 * INVERTED 2026-11-16, history kept: this was `preflightSummarize`, which
 * declared nothing, and the panel then counted with
 * `countDeclaredCharacters` — a SECOND pdfjs parse per Run. Both now read
 * one extraction, and the same verdict carries the declared count and the
 * pages to send (`judgeSummarizeRun`, `./summarize-measure`). The judgement
 * module is fetched IN PARALLEL with the extraction, so the page grammar
 * never rides the page's first load and Run pays one round trip of chunks.
 */

export async function measureSummarizeRun(
  bytes: Uint8Array,
  choice: SummarizeChoice,
  read: typeof extractSelectionOnDemand = (b) => summarizeRunDeps.read(b),
): Promise<SummarizeMeasure> {
  const judging = import("./summarize-measure");
  // Handled here so a failed read does not leave it rejecting unseen.
  judging.catch(() => undefined);
  let reading: SummarizeReading;
  try {
    reading = { ok: true, ...(await read(bytes)) };
  } catch (error) {
    reading = { ok: false, error };
  }
  const { judgeSummarizeRun } = await judging;
  return judgeSummarizeRun(reading, choice);
}
