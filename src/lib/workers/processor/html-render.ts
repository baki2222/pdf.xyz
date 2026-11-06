import { domainToUnicode } from "node:url";
import type { JobError } from "@/lib/jobs";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "@/lib/jobs";
import { isSafePublicHttpUrl } from "@/lib/jobs/validation";
import { parseHtmlRenderOptions } from "@/lib/jobs/html-render-options";
import {
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
  runHtmlToPdf,
  runWebpageToPdf,
  type HtmlRenderDeps,
  type HtmlRenderResultMeta,
  type HtmlRenderRun,
} from "../html-render/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

const OUTPUT_CONTENT_TYPE = "application/pdf";
const FALLBACK_STEM = "document";
type HtmlRenderFailure = Extract<HtmlRenderRun, { ok: false }>;

function trimName(stem: string, stripExtension = true): string {
  const tail = ".pdf";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const sanitized = sanitizeDisplayFilename(stem);
  const clean =
    (stripExtension ? sanitized.replace(/\.[^.]+$/, "") : sanitized).trim() ||
    FALLBACK_STEM;
  return `${clean.length > budget ? clean.slice(0, budget).trim() : clean}${tail}`;
}

export function htmlPdfOutputName(originalName: unknown): string {
  return trimName(String(originalName ?? FALLBACK_STEM));
}

/** A path segment as its author wrote it; a malformed escape stays as is. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Host plus path, in the script the user typed: the path is percent-DECODED
 * and the host turned back from punycode before the slug keeps letters,
 * marks and digits of ANY script (audit #48, 2026-11-06 — an ASCII-only
 * allowlist over the encoded form turned "Москва" into "D0-9C-D0-BE-…").
 */
export function webpagePdfOutputName(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const host = domainToUnicode(url.hostname) || url.hostname;
    const path = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeSegment)
      .join("-");
    const slug = `${host}${path ? `-${path}` : ""}`
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const tail = ".pdf";
    const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
    const stem = Array.from(slug || FALLBACK_STEM)
      .slice(0, budget)
      .join("")
      .trim();
    return `${stem || FALLBACK_STEM}${tail}`;
  } catch {
    return `${FALLBACK_STEM}.pdf`;
  }
}

function jobError(run: HtmlRenderFailure): JobError {
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
    case "invalid_url":
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "page_unavailable":
      // The site's doing, not the worker's: never `internal_error`. Retried
      // only when the same request could answer differently (5xx, 429, a
      // dropped connection); a 404 or a bot check answers the same each time.
      return {
        code: run.retryable ? "service_unavailable" : "unprocessable_entity",
        message: run.message,
        retryable: run.retryable,
      };
    case "failed":
    default:
      return { code: "internal_error", message: run.message, retryable: true };
  }
}

function toProcessorMeta(meta: HtmlRenderResultMeta): ProcessorMeta {
  return {
    engine: meta.engine,
    source: meta.source,
    outputBytes: meta.outputBytes,
    ...(meta.inputBytes !== undefined ? { inputBytes: meta.inputBytes } : {}),
  };
}

function requireSingleHtmlInput(
  input: Parameters<Processor["process"]>[0],
): ProcessorResult | undefined {
  const file = input.inputs[0];
  if (input.inputs.length !== 1 || !file) {
    return processorFail({
      code: "unprocessable_entity",
      message: "HTML to PDF accepts exactly one HTML input file.",
      retryable: false,
    });
  }
  return undefined;
}

function readUrl(options: Record<string, unknown>): string | ProcessorResult {
  const url = options.url;
  if (
    typeof url !== "string" ||
    url.trim().length === 0 ||
    !isSafePublicHttpUrl(url)
  ) {
    return processorFail({
      code: "unprocessable_entity",
      message: "Webpage to PDF requires a public http(s) URL.",
      retryable: false,
    });
  }
  return url;
}

export function createHtmlRenderProcessor(deps: HtmlRenderDeps): Processor {
  const ready = deps.chromium != null;
  return {
    id: "html-render",
    tools: [HTML_TO_PDF_TOOL, WEBPAGE_TO_PDF_TOOL],
    supports(tool) {
      return tool === HTML_TO_PDF_TOOL || tool === WEBPAGE_TO_PDF_TOOL;
    },
    capability() {
      return {
        id: "html-render",
        tools: [HTML_TO_PDF_TOOL, WEBPAGE_TO_PDF_TOOL],
        ready,
        detail: ready
          ? "HTML and webpage conversion ready: Chromium renders PDFs on an auto-deleting secure worker."
          : "HTML and webpage conversion need the native Chromium renderer, which isn't installed on this worker.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      // Page size, orientation, margins, one long page, screen width — the
      // same parser the job API refused a bad value with, run again here
      // because a job record is not proof of what the API accepted.
      const layout = parseHtmlRenderOptions(input.options);
      if (!layout.ok)
        return processorFail({
          code: layout.error.body.error.code,
          message: layout.error.body.error.message,
          retryable: false,
        });
      if (input.tool === HTML_TO_PDF_TOOL) {
        const inputError = requireSingleHtmlInput(input);
        if (inputError) return inputError;
        const file = input.inputs[0]!;
        const run = await runHtmlToPdf(
          file.bytes,
          deps,
          layout.value,
          input.signal,
        );
        if (!run.ok) return processorFail(jobError(run));
        return processorOk(
          [
            {
              filename: htmlPdfOutputName(file.filename),
              contentType: OUTPUT_CONTENT_TYPE,
              bytes: run.output,
            },
          ],
          toProcessorMeta(run.meta),
        );
      }
      if (input.tool === WEBPAGE_TO_PDF_TOOL) {
        const url = readUrl(input.options);
        if (typeof url !== "string") return url;
        if (input.inputs.length !== 0) {
          return processorFail({
            code: "unprocessable_entity",
            message: "Webpage to PDF takes a URL, not uploaded files.",
            retryable: false,
          });
        }
        const run = await runWebpageToPdf(
          url,
          deps,
          layout.value,
          input.signal,
        );
        if (!run.ok) return processorFail(jobError(run));
        return processorOk(
          [
            {
              filename: webpagePdfOutputName(url),
              contentType: OUTPUT_CONTENT_TYPE,
              bytes: run.output,
            },
          ],
          toProcessorMeta(run.meta),
        );
      }
      return processorFail({
        code: "not_implemented",
        message: "This processor only handles HTML/Webpage to PDF conversion.",
        retryable: false,
      });
    },
  };
}
