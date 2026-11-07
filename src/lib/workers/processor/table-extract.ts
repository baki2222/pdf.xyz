import type { JobError } from "@/lib/jobs";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import {
  EXTRACT_TABLES_NO_TABLES_CODE,
  parseExtractTablesOptions,
} from "@/lib/jobs/extract-tables-options";
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
import { ocrFirstMessages, runOcrFirst } from "./ocr-first";
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
    // Properties of the DOCUMENT: a retry returns the same answer, so none of
    // them is retryable, and each carries the shared document-failure code the
    // panel links its next step from (OCR, Unlock, Repair). A locked PDF used
    // to fall through to the retryable `internal_error` below.
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
    // Its own code since 2026-11-08 (audit extract-tables#5): the panel
    // offers PDF to Excel and OCR PDF from it. `unprocessable_entity` linked
    // nothing.
    case "no_tables":
      return {
        code: EXTRACT_TABLES_NO_TABLES_CODE,
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
    combined: m.combined,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
  };
}

/**
 * What "Recognise text in scans (OCR)" says on Extract Tables when OCR cannot
 * help (since 2026-11-08, audit extract-tables#3).
 */
export const TABLE_OCR_MESSAGES = ocrFirstMessages("Extract Tables", "a table");

/** Wiring beyond the table engine: the processor a job may run first. */
export interface TableExtractChain {
  /**
   * The OCR processor: the SAME instance the registry serves `ocr-pdf` with,
   * as the PDF to Office exports are given (`./ocr-first`).
   */
  ocr?: Processor;
}

export function createTableExtractProcessor(
  deps: TableExtractDeps,
  chain: TableExtractChain = {},
): Processor {
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
          ? "Table extraction ready: aligned tables in a PDF's selectable text are detected and exported as CSV + XLSX inside a ZIP on an auto-deleting secure worker."
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
      // "Combine tables into one sheet" (audit extract-tables#2). An empty
      // bag is the request every page sent before it: one sheet per table.
      // Parsed BEFORE OCR first, so a malformed bag is refused at once; it
      // shares the bag with OCR's keys and each parser reads only its own.
      const parsed = parseExtractTablesOptions(input.options);
      if (!parsed.ok)
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      const file = input.inputs[0]!;
      // OCR first, in the same job (2026-11-08, audit
      // extract-tables#3). Until then a scan failed `no_text` and the panel
      // sent the visitor to OCR PDF and back.
      const first = await runOcrFirst(
        input,
        file.bytes,
        chain.ocr,
        TABLE_OCR_MESSAGES,
        deps.limits?.maxInputBytes,
      );
      if (!first.ok) return first.result;
      const ocrResults = first.results;
      const run = await runTableExtract(first.bytes, deps, input.signal, {
        combine: parsed.value.combine,
      });
      if (!run.ok) {
        const error = jobError(run);
        // "Run OCR PDF first" is false advice after OCR has run.
        return processorFail(
          ocrResults && run.kind === "no_text"
            ? { ...error, message: TABLE_OCR_MESSAGES.noText }
            : error,
        );
      }
      return processorOk(
        [
          {
            filename: tableExtractOutputName(file.filename, run.filenameExt),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        { ...meta(run.meta), ocrFirst: ocrResults !== undefined },
        // What was found and where (audit extract-tables#4): the result card
        // says how many tables and which pages gave none. With OCR first,
        // also what OCR did (engine, languages, pages).
        {
          ...(ocrResults?.ocr ? { ocr: ocrResults.ocr } : {}),
          tables: run.findings,
        },
      );
    },
  };
}
