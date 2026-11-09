import type { WorkerStatus } from "./status";
import {
  runSecurityJob,
  type PdfSecurityWorkerOptions,
  type PdfSecurityWorkerResult,
} from "./pdf-security-client";
import { canRunAiTool } from "./ai-tool-availability";
import {
  OCR_JOB_POLL,
  translateJobPoll,
  type JobPollBudget,
} from "@/lib/jobs/client-wait";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
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

/**
 * What the panel sends: a COUNTED document, or a SCAN with an OCR request.
 *
 * A union, not optional fields, because the two are different contracts. A
 * document with text was counted in the browser, so it declares its size
 * (required, see below). A scan has no text the browser can count — it is
 * recognised on the worker (audit translate-pdf#3) — so it declares nothing
 * and is charged an undeclared run, and the worker caps the RECOGNISED text
 * at that charge. A scan job that declared a count would be a guess, and a
 * counted job that dropped its count would silently cost the maximum.
 */
export type TranslateWorkerInput = TranslateWorkerCommon &
  (TranslateCountedInput | TranslateScanInput);

interface TranslateWorkerCommon {
  filename: string;
  bytes: Uint8Array;
  targetLanguage: TranslateLanguage;
  sourceLanguage: TranslateSourceLanguage;
  /** Optional free-text directive steering the translation. */
  instructions?: string;
}

/** A scan, recognised on the worker before it is translated. */
export interface TranslateScanInput {
  /** The OCR languages, validated by the worker as PDF to Word's switch. */
  ocr: { languages: readonly string[] };
  declaredCharacters?: never;
  declaredTextPages?: never;
}

export interface TranslateCountedInput {
  ocr?: never;
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
  /**
   * Pages of this document that carry text — NOT its page count.
   *
   * The two differ for any document with a blank, whitespace-only or
   * image-only page, and the difference is the whole point: chunking is
   * denominated in the non-empty set, so a bound denominated in the page count
   * would mean a different thing at each end. Both extractors were measured to
   * agree on this set exactly, including for the invisible OCR text layers
   * `ocr-pdf` produces, which is what makes it the bound that needs no margin.
   *
   * Required here for the same reason `declaredCharacters` is: this client CAN
   * count, so a silent fallback would be a regression rather than a default.
   */
  declaredTextPages: number;
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
  if (input.ocr !== undefined) {
    // The worker reads these with PDF to Word's own parser.
    jobOptions.ocr = true;
    jobOptions.languages = [...input.ocr.languages];
  }
  return runSecurityJob(
    "translate-pdf",
    input.filename,
    input.bytes,
    jobOptions,
    options,
    input.declaredCharacters,
    input.declaredTextPages,
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

/**
 * The extractor the Translate panel measures a document with before anything
 * is uploaded. An object so a test can swap it and put it back: pdfjs needs
 * `DOMMatrix`, which the test DOM lacks, and `vi.mock` of the text module
 * would leave it cached with the stub for later files (mock-isolation.test).
 */
export const translateTextDeps: {
  extract: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
} = { extract: extractPdfText };

/**
 * True when the panel may offer to recognise a scan before translating it
 * (audit translate-pdf#3): the live status says an OBSERVED worker proves
 * both the chain (`translateOcr`) and OCR itself. Absent reads as `false`,
 * and the panel then refuses a scan before upload as it always did.
 */
export function canTranslateScans(
  status: WorkerStatus | null | undefined,
): boolean {
  return status?.translateOcr === true;
}

/**
 * Translate PDF with OCR first (audit translate-pdf#3): OCR's own wait, then
 * the translation's, one after the other in the same job. `chunks` is the
 * most provider calls the recognised text can need under the job's cap — the
 * panel cannot count a scan's text, so it passes the cap's worth.
 *
 * Here, in the feature's client, and not in `@/lib/jobs/client-wait`: that
 * module is on every worker page's first load, and a function added there
 * (or a use of its tree-shaken `pollWaitMs`, which is why the arithmetic is
 * inline) cost OCR PDF's page the room its row had left — measured
 * 2026-11-09 at +16 B gz, against a row with 0.01 KB to spare.
 */
export function translateOcrJobPoll(chunks: number): JobPollBudget {
  const translate = translateJobPoll(chunks);
  return {
    intervalMs: translate.intervalMs,
    maxAttempts: Math.ceil(
      (OCR_JOB_POLL.intervalMs * OCR_JOB_POLL.maxAttempts +
        translate.intervalMs * translate.maxAttempts) /
        translate.intervalMs,
    ),
  };
}
