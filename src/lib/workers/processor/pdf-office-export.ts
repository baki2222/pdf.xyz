import type { JobError } from "@/lib/jobs";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
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

export function createPdfOfficeExportProcessor(
  deps: PdfOfficeExportDeps,
): Processor {
  // Both extractors, because this processor claims all three tools: Excel and
  // PowerPoint read `extract`, Word reads `extractFlow`. Wiring one and not the
  // other would advertise a tool that answers every job with `unsupported`.
  const ready = deps.extract != null && deps.extractFlow != null;
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
          ? "PDF to Office export ready: selectable PDF text is packaged into DOCX, XLSX, or PPTX on an auto-deleting secure worker."
          : "PDF to Office export needs the PDF text extractor, which isn't available on this worker.",
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
      const run = await runPdfOfficeExport(input.tool, file.bytes, deps);
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: pdfOfficeExportOutputName(file.filename, run.filenameExt),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        meta(run.meta),
        // Which pages had text. Without it a partly scanned PDF "succeeds"
        // with its scanned pages silently missing from the file.
        { officeExport: run.coverage },
      );
    },
  };
}
