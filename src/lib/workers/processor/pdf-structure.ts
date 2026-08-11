/**
 * Processor wrapper for qpdf-backed PDF structure tools: Repair PDF and Optimize
 * for Web. The qpdf runner is injected, so this module stays node-free and shares
 * the executor/local-dev processor contract with the other secure-worker tools.
 */

import type { JobError } from "@/lib/jobs";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "@/lib/jobs";
import {
  OPTIMIZE_WEB_TOOL,
  PDF_STRUCTURE_TOOLS,
  REPAIR_TOOL,
  runOptimizeWeb,
  runRepair,
  type PdfStructureDeps,
  type PdfStructureResultMeta,
  type PdfStructureRun,
} from "../pdf-structure/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

const OUTPUT_CONTENT_TYPE = "application/pdf";
const FALLBACK_STEM = "document";

type PdfStructureFailure = Extract<PdfStructureRun, { ok: false }>;

function displayBase(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").trim();
  return stem.length > 0 ? stem : FALLBACK_STEM;
}

function suffixedPdfName(originalName: unknown, suffix: string): string {
  const base = displayBase(sanitizeDisplayFilename(originalName));
  const tail = `${suffix}.pdf`;
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const trimmed = base.length > budget ? base.slice(0, budget).trim() : base;
  return `${trimmed || FALLBACK_STEM}${tail}`;
}

export function repairedOutputName(originalName: unknown): string {
  return suffixedPdfName(originalName, "-repaired");
}

export function webOptimizedOutputName(originalName: unknown): string {
  return suffixedPdfName(originalName, "-web-optimized");
}

export function pdfStructureJobError(run: PdfStructureFailure): JobError {
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

function toProcessorMeta(meta: PdfStructureResultMeta): ProcessorMeta {
  return {
    engine: meta.engine,
    operation: meta.operation,
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
      message: "This tool accepts exactly one PDF input.",
      retryable: false,
    });
  }
  return undefined;
}

export function createPdfStructureProcessor(deps: PdfStructureDeps): Processor {
  const ready = deps.qpdf != null;

  return {
    id: "pdf-structure",
    tools: [...PDF_STRUCTURE_TOOLS],

    supports(tool) {
      return tool === REPAIR_TOOL || tool === OPTIMIZE_WEB_TOOL;
    },

    capability() {
      return {
        id: "pdf-structure",
        tools: [...PDF_STRUCTURE_TOOLS],
        ready,
        detail: ready
          ? "PDF repair and web optimization ready: qpdf rewrites and linearizes PDFs on an encrypted, auto-deleting secure worker."
          : "PDF repair and web optimization need the native qpdf engine, which isn't installed on this worker.",
      };
    },

    async process(input): Promise<ProcessorResult> {
      if (input.tool !== REPAIR_TOOL && input.tool !== OPTIMIZE_WEB_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles PDF repair/web optimization.",
          retryable: false,
        });
      }

      const inputError = singleInput(input);
      if (inputError) return inputError;
      const file = input.inputs[0]!;

      const run =
        input.tool === REPAIR_TOOL
          ? await runRepair(file.bytes, deps)
          : await runOptimizeWeb(file.bytes, deps);
      if (!run.ok) return processorFail(pdfStructureJobError(run));

      return processorOk(
        [
          {
            filename:
              input.tool === REPAIR_TOOL
                ? repairedOutputName(file.filename)
                : webOptimizedOutputName(file.filename),
            contentType: OUTPUT_CONTENT_TYPE,
            bytes: run.output,
          },
        ],
        toProcessorMeta(run.meta),
        // Only repair reports this: optimize-web makes no claim about
        // recovering anything, so a warnings block there would describe a
        // promise the tool never made.
        input.tool === REPAIR_TOOL
          ? {
              repair: {
                recoveredWithWarnings: run.meta.recoveredWithWarnings,
                warnings: run.meta.warnings,
              },
            }
          : undefined,
      );
    },
  };
}
