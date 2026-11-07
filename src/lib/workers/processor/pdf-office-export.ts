import type { JobError } from "@/lib/jobs";
import type { JobResults } from "@/lib/jobs/results";
import { OFFICE_OCR_TOOLS } from "@/lib/jobs/office-export-ocr";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { ocrFirstMessages, runOcrFirst } from "./ocr-first";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "@/lib/jobs";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  PDF_TO_EXCEL_TOOL,
  PDF_TO_POWERPOINT_TOOL,
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
  type PdfOfficeExportMeta,
  type PdfOfficeExportRun,
  type PdfOfficeExportTool,
} from "../pdf-office-export/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

type Failure = Extract<PdfOfficeExportRun, { ok: false }>;

/**
 * The exports whose job may run OCR first: the panels that offer the switch
 * (`OFFICE_OCR_TOOLS`), read from the same list so the two cannot part.
 */
const OCR_FIRST_TOOLS: readonly string[] = OFFICE_OCR_TOOLS;
const FALLBACK_STEM = "document";

export function pdfOfficeExportOutputName(
  originalName: unknown,
  ext: string,
): string {
  const tail = `.${ext}`;
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName)
      .replace(/\.[^.]+$/, "")
      .trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}

function isTool(tool: string): tool is PdfOfficeExportTool {
  return (
    tool === PDF_TO_WORD_TOOL ||
    tool === PDF_TO_EXCEL_TOOL ||
    tool === PDF_TO_POWERPOINT_TOOL
  );
}

function inputError(
  input: Parameters<Processor["process"]>[0],
): ProcessorResult | undefined {
  if (input.inputs.length !== 1 || !input.inputs[0])
    return processorFail({
      code: "unprocessable_entity",
      message: "PDF to Office export accepts exactly one PDF input.",
      retryable: false,
    });
  return undefined;
}

function jobError(run: Failure): JobError {
  switch (run.kind) {
    case "unsupported":
      return {
        code: "not_implemented",
        message: `${run.message} See docs/WORKER_ARCHITECTURE.md.`,
        retryable: false,
      };
    case "too_large":
      return {
        code: "payload_too_large",
        message: run.message,
        retryable: false,
      };
    // The three below are properties of the DOCUMENT, so a retry returns the
    // same answer. Each has its own code because each needs its own next step
    // — OCR, Unlock, Repair — and the panel links to it by code, never by
    // matching message text. `password_protected` used to fall through to the
    // retryable `internal_error` below: requeued with backoff, then reported
    // as "could not be exported" with no hint that it was locked.
    case "no_text":
      return {
        code: OFFICE_EXPORT_ERROR_CODES.noText,
        message: run.message,
        retryable: false,
      };
    case "password_protected":
      return {
        code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
        message: run.message,
        retryable: false,
      };
    case "unreadable":
      return {
        code: OFFICE_EXPORT_ERROR_CODES.unreadable,
        message: run.message,
        retryable: false,
      };
    case "incomplete_output":
      // The engine's own inspection refused the file it wrote. Deterministic:
      // the same text through the same writer writes the same file, so a
      // retry would fail the same way twice more.
      return {
        code: "internal_error",
        message: run.message,
        retryable: false,
      };
    // The page scan passed its per-attempt deadline on these bytes, and would
    // again. Until 2026-11-06 (audit #36) it fell through to the retryable
    // branch below: several deadlines, then a message naming no way forward.
    case "timeout":
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "failed":
    default:
      return { code: "internal_error", message: run.message, retryable: true };
  }
}

function meta(m: PdfOfficeExportMeta): ProcessorMeta {
  return {
    engine: m.engine,
    tool: m.tool,
    pageCount: m.pageCount,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
    characterCount: m.characterCount,
  };
}

/** The tool's name as its page and refusals say it. */
const TOOL_NAMES: Record<PdfOfficeExportTool, string> = {
  [PDF_TO_WORD_TOOL]: "PDF to Word",
  [PDF_TO_EXCEL_TOOL]: "PDF to Excel",
  [PDF_TO_POWERPOINT_TOOL]: "PDF to PowerPoint",
};

/** What a conversion that found no words would have had nothing to fill. */
const OUTPUT_NOUNS: Record<PdfOfficeExportTool, string> = {
  [PDF_TO_WORD_TOOL]: "a Word document",
  [PDF_TO_EXCEL_TOOL]: "a spreadsheet",
  [PDF_TO_POWERPOINT_TOOL]: "a slide",
};

/**
 * What "Recognise text in scans (OCR)" says when OCR cannot help, for THIS
 * tool. Since 2026-11-08 (audit pdf-to-excel#2, pdf-to-powerpoint#4) the
 * switch is on all three exports, so the tool name and the file it makes are
 * the tool's, never "PDF to Word" on an Excel job.
 */
export function officeOcrMessages(tool: PdfOfficeExportTool) {
  return ocrFirstMessages(TOOL_NAMES[tool], OUTPUT_NOUNS[tool]);
}

/** Wiring beyond the export engine: the processors a job may run first. */
export interface PdfOfficeExportChain {
  /**
   * The OCR processor, for the exports' OCR option. The SAME instance the
   * registry serves `ocr-pdf` with, so its readiness, installed-language check
   * and refusal handling are OCR PDF's own.
   */
  ocr?: Processor;
}

export function createPdfOfficeExportProcessor(
  deps: PdfOfficeExportDeps,
  chain: PdfOfficeExportChain = {},
): Processor {
  // All three readers, because this processor claims all three tools: Excel
  // reads `extract`, Word reads `extractFlow` and (since 2026-10-17, for its
  // pictures) `scanPages`, and PowerPoint reads `scanPages` after `extract`
  // has opened the file. Wiring one and not the others would advertise a
  // tool that answers every job with `unsupported`.
  const ready =
    deps.extract != null && deps.extractFlow != null && deps.scanPages != null;
  return {
    id: "pdf-office-export",
    tools: PDF_OFFICE_EXPORT_TOOLS,
    supports(tool) {
      return isTool(tool);
    },
    capability() {
      return {
        id: "pdf-office-export",
        tools: PDF_OFFICE_EXPORT_TOOLS,
        ready,
        detail: ready
          ? "PDF to Office export ready: selectable PDF text and its pictures are packaged into DOCX, the text into XLSX, and each page's pictures, text and drawing into PPTX slides, on an auto-deleting secure worker."
          : deps.extract == null || deps.extractFlow == null
            ? "PDF to Office export needs the PDF text extractor, which isn't available on this worker."
            : "PDF to Word and PDF to PowerPoint need the page reader (pdf.js and its canvas), which isn't available on this worker.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (!isTool(input.tool))
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles PDF to Office export.",
          retryable: false,
        });
      const bad = inputError(input);
      if (bad) return bad;
      const file = input.inputs[0]!;

      // The one option: OCR first. PDF to Word's since 2026-10-24; Excel's
      // and PowerPoint's since 2026-11-08 (audit pdf-to-excel#2,
      // pdf-to-powerpoint#4). Until then both ignored their options bag: an
      // Excel scan could only be refused, a PowerPoint one came as pictures.
      let bytes = file.bytes;
      let ocrResults: JobResults | undefined;
      const messages = officeOcrMessages(input.tool);
      if (OCR_FIRST_TOOLS.includes(input.tool)) {
        const first = await runOcrFirst(
          input,
          bytes,
          chain.ocr,
          messages,
          deps.limits?.maxInputBytes,
        );
        if (!first.ok) return first.result;
        bytes = first.bytes;
        ocrResults = first.results;
      }

      const run = await runPdfOfficeExport(
        input.tool,
        bytes,
        deps,
        input.signal,
      );
      if (!run.ok) {
        const error = jobError(run);
        // "Run OCR first" is false advice after OCR has run.
        return processorFail(
          ocrResults && run.kind === "no_text"
            ? { ...error, message: messages.noText }
            : error,
        );
      }
      return processorOk(
        [
          {
            filename: pdfOfficeExportOutputName(file.filename, run.filenameExt),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        { ...meta(run.meta), ocrFirst: ocrResults !== undefined },
        // Which pages had text. Without it a partly scanned PDF "succeeds"
        // with its scanned pages silently missing from the file. With OCR
        // first, also what OCR did (engine, languages, pages).
        {
          ...(ocrResults?.ocr ? { ocr: ocrResults.ocr } : {}),
          officeExport: run.coverage,
        },
      );
    },
  };
}
