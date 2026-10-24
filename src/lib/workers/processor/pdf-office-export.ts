import type { JobError } from "@/lib/jobs";
import type { JobResults } from "@/lib/jobs/results";
import { parsePdfToWordOptions } from "@/lib/jobs/ocr";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { OCR_REFUSAL_MESSAGES } from "../ocr-engine-errors";

/** The tool slug the OCR processor serves; PDF to Word asks it by name. */
const OCR_TOOL_SLUG = "ocr-pdf";
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

/**
 * What PDF to Word's "Recognise text in scans (OCR)" says when OCR cannot
 * help, in words for THIS panel. The OCR processor's own copy names OCR PDF's
 * controls ("Turn on “Redo existing OCR”"), which this panel does not have.
 */
export const WORD_OCR_MESSAGES = {
  unavailable: `Recognising text in scans needs OCR, which isn't available on this worker. Turn off “${WORD_OCR_LABEL}” to convert the selectable text alone. Nothing was converted.`,
  priorText: `This PDF already has a text layer, and the OCR engine would not add a second one. Turn off “${WORD_OCR_LABEL}” and convert again. Nothing was converted.`,
  noText:
    "OCR ran, but found no text in this PDF to put in a Word document. Check the languages you chose match the page. Nothing was converted.",
} as const;

/** Wiring beyond the export engine: the processors a job may run first. */
export interface PdfOfficeExportChain {
  /**
   * The OCR processor, for PDF to Word's OCR option. The SAME instance the
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

      // PDF to Word's one option: OCR first. Validated for Word only — Excel
      // and PowerPoint take no options and keep ignoring the bag, as before.
      let bytes = file.bytes;
      let ocrResults: JobResults | undefined;
      if (input.tool === PDF_TO_WORD_TOOL) {
        const parsed = parsePdfToWordOptions(input.options);
        if (!parsed.ok)
          return processorFail({
            code: parsed.error.body.error.code,
            message: parsed.error.body.error.message,
            retryable: false,
          });
        if (parsed.value.ocr) {
          const ocr = chain.ocr;
          if (!ocr || !ocr.capability().ready)
            return processorFail({
              code: "not_implemented",
              message: WORD_OCR_MESSAGES.unavailable,
              retryable: false,
            });
          // The OCR processor itself: option validation, the installed-pack
          // check and the refusal mapping are OCR PDF's, not a copy of them.
          const recognised = await ocr.process({
            ...input,
            tool: OCR_TOOL_SLUG,
            options: {
              languages: parsed.value.languages,
              outputMode: "searchable-pdf",
            },
          });
          if (!recognised.ok) {
            // Its refusal copy names OCR PDF's switch; say this panel's.
            const prior =
              recognised.error.message === OCR_REFUSAL_MESSAGES["prior-text"];
            return processorFail(
              prior
                ? { ...recognised.error, message: WORD_OCR_MESSAGES.priorText }
                : recognised.error,
            );
          }
          const pdf = recognised.artifacts.find(
            (a) => a.contentType === "application/pdf",
          );
          if (!pdf)
            return processorFail({
              code: "internal_error",
              message: "The OCR engine produced no searchable PDF.",
              retryable: true,
            });
          bytes = pdf.bytes;
          ocrResults = recognised.results;
        }
      }

      const run = await runPdfOfficeExport(input.tool, bytes, deps);
      if (!run.ok) {
        const error = jobError(run);
        // "Run OCR first" is false advice after OCR has run.
        return processorFail(
          ocrResults && run.kind === "no_text"
            ? { ...error, message: WORD_OCR_MESSAGES.noText }
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
