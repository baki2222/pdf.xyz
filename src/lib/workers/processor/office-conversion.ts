import type { JobError } from "@/lib/jobs";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "@/lib/jobs";
import {
  EXCEL_TO_PDF_TOOL,
  OFFICE_TO_PDF_TOOLS,
  POWERPOINT_TO_PDF_TOOL,
  WORD_TO_PDF_TOOL,
  runOfficeToPdf,
  type OfficeConversionDeps,
  type OfficeConversionResultMeta,
  type OfficeConversionRun,
  type OfficeToPdfTool,
} from "../office-conversion/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

const OUTPUT_CONTENT_TYPE = "application/pdf";
const FALLBACK_STEM = "document";
type OfficeFailure = Extract<OfficeConversionRun, { ok: false }>;

export function officePdfOutputName(originalName: unknown): string {
  const tail = ".pdf";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const sanitized = sanitizeDisplayFilename(originalName);
  const stem = sanitized.replace(/\.[^.]+$/, "").trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}

function jobError(run: OfficeFailure): JobError {
  switch (run.kind) {
    case "unsupported":
      // No repository path in a user's error: the reader of this message is
      // on a web page, not in a checkout.
      return {
        code: "not_implemented",
        message: run.message,
        retryable: false,
      };
    case "too_large":
      return {
        code: "payload_too_large",
        message: run.message,
        retryable: false,
      };
    case "invalid_input":
    // The three below are answers about the DOCUMENT: the same bytes get the
    // same answer on every attempt, so none of them is retried. They used to
    // fall through to the retryable `internal_error` — three conversions of a
    // file that could never convert, and three timeouts of one that could not
    // finish.
    case "password_protected":
    case "unreadable":
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

function toProcessorMeta(meta: OfficeConversionResultMeta): ProcessorMeta {
  return {
    engine: meta.engine,
    tool: meta.tool,
    inputBytes: meta.inputBytes,
    outputBytes: meta.outputBytes,
  };
}

function requireSingleInput(
  input: Parameters<Processor["process"]>[0],
): ProcessorResult | undefined {
  const file = input.inputs[0];
  if (input.inputs.length !== 1 || !file) {
    return processorFail({
      code: "unprocessable_entity",
      message: "Office to PDF accepts exactly one Office input file.",
      retryable: false,
    });
  }
  return undefined;
}

function isOfficeTool(tool: string): tool is OfficeToPdfTool {
  return (
    tool === WORD_TO_PDF_TOOL ||
    tool === EXCEL_TO_PDF_TOOL ||
    tool === POWERPOINT_TO_PDF_TOOL
  );
}

export function createOfficeConversionProcessor(
  deps: OfficeConversionDeps,
): Processor {
  const ready = deps.libreoffice != null;
  return {
    id: "office-conversion",
    tools: OFFICE_TO_PDF_TOOLS,
    supports(tool) {
      return isOfficeTool(tool);
    },
    capability() {
      return {
        id: "office-conversion",
        tools: OFFICE_TO_PDF_TOOLS,
        ready,
        detail: ready
          ? "Office conversion ready: LibreOffice renders Word, Excel, and PowerPoint files to PDF on an auto-deleting secure worker."
          : "Office conversion needs the native LibreOffice engine, which isn't installed on this worker.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (!isOfficeTool(input.tool)) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles Office to PDF conversion.",
          retryable: false,
        });
      }
      const inputError = requireSingleInput(input);
      if (inputError) return inputError;
      const file = input.inputs[0]!;
      const run = await runOfficeToPdf(
        input.tool,
        file.bytes,
        file.filename,
        deps,
        input.signal,
      );
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: officePdfOutputName(file.filename),
            contentType: OUTPUT_CONTENT_TYPE,
            bytes: run.output,
          },
        ],
        toProcessorMeta(run.meta),
      );
    },
  };
}
