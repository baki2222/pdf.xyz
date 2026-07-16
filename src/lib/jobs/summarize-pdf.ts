/**
 * Summarize PDF job contract — the typed, framework-agnostic options and validator
 * for the `summarize-pdf` AI tool, plus its deterministic output naming.
 *
 * This is the AI-tool analogue of `@/lib/jobs/request-signatures.ts`: pure data plus
 * a pure parser — no Next.js, no storage, no AI SDK. It defines exactly what a
 * summary request may ask for (how long, in what shape, with an optional focus) so
 * the UI, the worker engine, and the docs share one honest source of truth. It
 * depends only on `./responses` and `./filenames`, so a client component can import
 * the validator without pulling a Node built-in or the AI provider into the bundle.
 *
 * HONEST SCOPE (load-bearing): this contract only *describes* a request. Producing a
 * summary requires a configured AI provider and selectable text in the PDF; the
 * worker engine fails honestly (never a fabricated summary) when either is missing.
 */

import { apiError, type ParseResult } from "./responses";
import { MAX_DISPLAY_FILENAME_LENGTH, sanitizeDisplayFilename } from "./filenames";

/** The neutral stem used when nothing safe survives filename sanitization. */
const FALLBACK_STEM = "document";

/** How long a summary should be. Maps to a token budget + guidance in the engine. */
export const SUMMARY_LENGTHS = ["brief", "standard", "detailed"] as const;
export type SummaryLength = (typeof SUMMARY_LENGTHS)[number];

/** The shape of the summary. Maps to a structural instruction in the engine. */
export const SUMMARY_FORMATS = ["paragraphs", "bullets", "outline"] as const;
export type SummaryFormat = (typeof SUMMARY_FORMATS)[number];

const LENGTH_SET: ReadonlySet<string> = new Set(SUMMARY_LENGTHS);
const FORMAT_SET: ReadonlySet<string> = new Set(SUMMARY_FORMATS);

/** The default length when a request omits it. */
export const DEFAULT_SUMMARY_LENGTH: SummaryLength = "standard";
/** The default format when a request omits it. */
export const DEFAULT_SUMMARY_FORMAT: SummaryFormat = "paragraphs";

/** Max length of the optional free-text focus directive. */
export const MAX_SUMMARY_FOCUS_CHARS = 300;

// C0 control characters (U+0000–U+001F) and DEL — never legitimate in the focus field.
const CONTROL_CHAR = /[\x00-\x1F\x7F]/;

/** Validated options for a `summarize-pdf` job. */
export interface SummarizeOptions {
  length: SummaryLength;
  format: SummaryFormat;
  /**
   * Optional user directive that steers what the summary emphasizes (e.g. "focus on
   * financial risks"). Bounded and control-character-free. It is a prompt directive,
   * never a key/path/log line.
   */
  focus?: string;
}

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the free-form `options` bag of a `summarize-pdf` job into typed, validated
 * options. Strict and honest: unknown lengths/formats are rejected (never coerced),
 * and the optional focus is bounded and control-character-free. Everything defaults
 * sensibly, so an options-less request is valid. Mirrors `parseSignatureRequestOptions`.
 */
export function parseSummarizeOptions(
  options: Record<string, unknown>,
): ParseResult<SummarizeOptions> {
  if (!isObject(options)) {
    return invalid("`options` must be an object.", "options");
  }

  let length: SummaryLength = DEFAULT_SUMMARY_LENGTH;
  if (options.length !== undefined) {
    if (typeof options.length !== "string" || !LENGTH_SET.has(options.length)) {
      return invalid(`\`length\` must be one of ${SUMMARY_LENGTHS.join(", ")}.`, "length");
    }
    length = options.length as SummaryLength;
  }

  let format: SummaryFormat = DEFAULT_SUMMARY_FORMAT;
  if (options.format !== undefined) {
    if (typeof options.format !== "string" || !FORMAT_SET.has(options.format)) {
      return invalid(`\`format\` must be one of ${SUMMARY_FORMATS.join(", ")}.`, "format");
    }
    format = options.format as SummaryFormat;
  }

  const result: SummarizeOptions = { length, format };

  if (options.focus !== undefined) {
    if (typeof options.focus !== "string") {
      return invalid("`focus` must be a string.", "focus");
    }
    const trimmed = options.focus.trim();
    if (trimmed.length > 0) {
      if (CONTROL_CHAR.test(trimmed)) {
        return invalid("`focus` cannot contain control characters.", "focus");
      }
      if (trimmed.length > MAX_SUMMARY_FOCUS_CHARS) {
        return invalid(
          `\`focus\` is too long (max ${MAX_SUMMARY_FOCUS_CHARS} characters).`,
          "focus",
        );
      }
      result.focus = trimmed;
    }
  }

  return { ok: true, value: result };
}

/** A short, human description of a validated summary request, for the UI copy. */
export function describeSummarizeRequest(options: SummarizeOptions): string {
  const length = { brief: "Brief", standard: "Standard", detailed: "Detailed" }[options.length];
  const format = {
    paragraphs: "paragraphs",
    bullets: "bullet points",
    outline: "a section outline",
  }[options.format];
  return `${length} summary as ${format}`;
}

/** A sensible download name for the summary package, derived from the source PDF. */
export function summaryOutputName(originalName: unknown): string {
  const tail = "-summary.zip";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName).replace(/\.[^.]+$/, "").trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}
