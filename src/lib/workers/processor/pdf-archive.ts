import type { JobError } from "@/lib/jobs";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "@/lib/jobs";
import {
  PDF_TO_PDFA_TOOL,
  runPdfToPdfA,
  type PdfArchiveDeps,
  type PdfArchiveResultMeta,
  type PdfArchiveRun,
} from "../pdf-archive/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

const OUTPUT_CONTENT_TYPE = "application/pdf";
const FALLBACK_STEM = "document";
type PdfArchiveFailure = Extract<PdfArchiveRun, { ok: false }>;

function displayBase(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").trim();
  return stem.length > 0 ? stem : FALLBACK_STEM;
}

export function pdfaOutputName(originalName: unknown): string {
  const base = displayBase(sanitizeDisplayFilename(originalName));
  const tail = "-pdfa.pdf";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const trimmed = base.length > budget ? base.slice(0, budget).trim() : base;
  return `${trimmed || FALLBACK_STEM}${tail}`;
}

function jobError(run: PdfArchiveFailure): JobError {
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
    case "invalid_pdf":
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

function toProcessorMeta(meta: PdfArchiveResultMeta): ProcessorMeta {
  return {
    engine: meta.engine,
    standard: meta.standard,
    inputBytes: meta.inputBytes,
    outputBytes: meta.outputBytes,
  };
}

function singleInput(
  input: Parameters<Processor["process"]>[0],
): ProcessorResult | undefined {
  const file = input.inputs[0];
  if (input.inputs.length !== 1 || !file) {
    return processorFail({
      code: "unprocessable_entity",
      message: "PDF/A conversion accepts exactly one PDF input.",
      retryable: false,
    });
  }
  return undefined;
}

export function createPdfArchiveProcessor(deps: PdfArchiveDeps): Processor {
  const ready = deps.ghostscript != null;
  return {
    id: "pdf-archive",
    tools: [PDF_TO_PDFA_TOOL],
    supports(tool) {
      return tool === PDF_TO_PDFA_TOOL;
    },
    capability() {
      return {
        id: "pdf-archive",
        tools: [PDF_TO_PDFA_TOOL],
        ready,
        detail: ready
          ? "PDF/A conversion ready: Ghostscript converts PDFs on an encrypted, auto-deleting secure worker."
          : "PDF/A conversion needs the native Ghostscript engine, which isn't installed on this worker.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (input.tool !== PDF_TO_PDFA_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles PDF/A conversion.",
          retryable: false,
        });
      }
      const inputError = singleInput(input);
      if (inputError) return inputError;
      const file = input.inputs[0]!;
      const run = await runPdfToPdfA(file.bytes, deps);
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: pdfaOutputName(file.filename),
            contentType: OUTPUT_CONTENT_TYPE,
            bytes: run.output,
          },
        ],
        toProcessorMeta(run.meta),
        // Ghostscript deletes what PDF/A cannot represent and exits 0. Its
        // prose is the only evidence that happened, so it travels with the
        // artifact rather than dying in a discarded buffer.
        { pdfa: { hadNotes: run.meta.hadNotes, notes: run.meta.notes } },
      );
    },
  };
}
