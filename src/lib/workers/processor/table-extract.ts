import type { JobError } from "@/lib/jobs";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "@/lib/jobs";
import {
  EXTRACT_TABLES_TOOL,
  runTableExtract,
  type TableExtractDeps,
  type TableExtractMeta,
  type TableExtractRun,
} from "../table-extract/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

type Failure = Extract<TableExtractRun, { ok: false }>;
const FALLBACK_STEM = "document";

export function tableExtractOutputName(
  originalName: unknown,
  ext: string,
): string {
  const tail = `-tables.${ext}`;
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName)
      .replace(/\.[^.]+$/, "")
      .trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}

function inputError(
  input: Parameters<Processor["process"]>[0],
): ProcessorResult | undefined {
  if (input.inputs.length !== 1 || !input.inputs[0])
    return processorFail({
      code: "unprocessable_entity",
      message: "Table extraction accepts exactly one PDF input.",
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
    case "no_text":
    case "cannot_open":
      // Both are facts about the file: retrying cannot change them.
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "no_tables":
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

function meta(m: TableExtractMeta): ProcessorMeta {
  return {
    engine: m.engine,
    tool: m.tool,
    tableCount: m.tableCount,
    pageCount: m.pageCount,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
  };
}

export function createTableExtractProcessor(deps: TableExtractDeps): Processor {
  const ready = deps.extractLayout != null;
  return {
    id: "table-extract",
    tools: [EXTRACT_TABLES_TOOL],
    supports(tool) {
      return tool === EXTRACT_TABLES_TOOL;
    },
    capability() {
      return {
        id: "table-extract",
        tools: [EXTRACT_TABLES_TOOL],
        ready,
        detail: ready
          ? "Table extraction ready: aligned tables in a PDF's selectable text are detected and exported as CSV + XLSX inside a ZIP on an encrypted, auto-deleting secure worker."
          : "Table extraction needs the PDF layout extractor, which isn't available on this worker.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (input.tool !== EXTRACT_TABLES_TOOL)
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles table extraction.",
          retryable: false,
        });
      const bad = inputError(input);
      if (bad) return bad;
      const file = input.inputs[0]!;
      const run = await runTableExtract(file.bytes, deps);
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: tableExtractOutputName(file.filename, run.filenameExt),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        meta(run.meta),
      );
    },
  };
}
