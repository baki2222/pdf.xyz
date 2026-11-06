import type { JobError } from "@/lib/jobs";
import { parseEpubRenderOptions } from "@/lib/jobs/epub-render-options";
import {
  EPUB_TO_PDF_TOOL,
  runEpubToPdf,
  type EpubRenderDeps,
  type EpubRenderResultMeta,
  type EpubRun,
} from "../epub/engine";
import { htmlPdfOutputName } from "./html-render";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

type EpubFailure = Extract<EpubRun, { ok: false }>;

function jobError(run: EpubFailure): JobError {
  switch (run.kind) {
    case "unsupported":
      return { code: "not_implemented", message: run.message, retryable: false };
    case "too_large":
      return {
        code: "payload_too_large",
        message: run.message,
        retryable: false,
      };
    // Answers about the BOOK: the same bytes get the same answer every time.
    case "refused":
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

function toProcessorMeta(meta: EpubRenderResultMeta): ProcessorMeta {
  return { ...meta };
}

export function createEpubRenderProcessor(deps: EpubRenderDeps): Processor {
  const ready = deps.chromium != null;
  return {
    id: "epub-render",
    tools: [EPUB_TO_PDF_TOOL],
    supports(tool) {
      return tool === EPUB_TO_PDF_TOOL;
    },
    capability() {
      return {
        id: "epub-render",
        tools: [EPUB_TO_PDF_TOOL],
        ready,
        detail: ready
          ? "EPUB conversion ready: Chromium prints each chapter on an auto-deleting secure worker."
          : "EPUB conversion needs the native Chromium renderer, which isn't installed on this worker.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      const options = parseEpubRenderOptions(input.options);
      if (!options.ok)
        return processorFail({
          code: options.error.body.error.code,
          message: options.error.body.error.message,
          retryable: false,
        });
      const file = input.inputs[0];
      if (input.tool !== EPUB_TO_PDF_TOOL || input.inputs.length !== 1 || !file)
        return processorFail({
          code: "unprocessable_entity",
          message: "EPUB to PDF accepts exactly one EPUB file.",
          retryable: false,
        });
      const run = await runEpubToPdf(
        file.bytes,
        deps,
        options.value,
        input.signal,
      );
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: htmlPdfOutputName(file.filename),
            contentType: "application/pdf",
            bytes: run.output,
          },
        ],
        toProcessorMeta(run.meta),
      );
    },
  };
}
