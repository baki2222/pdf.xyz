/**
 * Translate PDF job contract — the typed, framework-agnostic options and validator
 * for the `translate-pdf` AI tool, plus its deterministic output naming.
 *
 * This is the AI-tool sibling of `@/lib/jobs/summarize-pdf.ts`: pure data plus a
 * pure parser — no Next.js, no storage, no AI SDK. It defines exactly what a
 * translation request may ask for (into which language, from which language, with an
 * optional directive) so the UI, the worker engine, and the docs share one honest
 * source of truth. It depends only on `./responses` and `./filenames`, so a client
 * component can import the validator without pulling a Node built-in or the AI
 * provider into the bundle.
 *
 * HONEST SCOPE (load-bearing): this contract only *describes* a request. Producing a
 * translation requires a configured AI provider and selectable text in the PDF; the
 * worker engine fails honestly (never a fabricated translation) when either is
 * missing. The target language set is a strict allow-list — an unknown language is
 * rejected, never silently coerced or "best-effort" guessed at.
 */

import { apiError, type ParseResult } from "./responses";
import { MAX_DISPLAY_FILENAME_LENGTH, sanitizeDisplayFilename } from "./filenames";

/** The neutral stem used when nothing safe survives filename sanitization. */
const FALLBACK_STEM = "document";

/**
 * The languages the tool can translate *into*. A strict allow-list so a request is
 * validated (never coerced) and the engine, UI, and manifest agree on one vocabulary.
 * Codes are ISO 639-1 where one exists; each maps to a human name in {@link LANGUAGE_NAMES}.
 */
export const TRANSLATE_LANGUAGES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "ru",
  "uk",
  "pl",
  "sv",
  "tr",
  "ar",
  "hi",
  "zh",
  "ja",
  "ko",
  "vi",
  "id",
  "th",
] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

/** Human display/prompt names for each supported language. Never a secret; UI + prompt copy. */
export const LANGUAGE_NAMES: Record<TranslateLanguage, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ru: "Russian",
  uk: "Ukrainian",
  pl: "Polish",
  sv: "Swedish",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
  id: "Indonesian",
  th: "Thai",
};

/** The source language, either a supported language or `auto` (let the model detect it). */
export const TRANSLATE_SOURCE_AUTO = "auto" as const;
export type TranslateSourceLanguage = typeof TRANSLATE_SOURCE_AUTO | TranslateLanguage;

/** The default source when a request omits it: auto-detect. */
export const DEFAULT_TRANSLATE_SOURCE: TranslateSourceLanguage = TRANSLATE_SOURCE_AUTO;

const LANGUAGE_SET: ReadonlySet<string> = new Set(TRANSLATE_LANGUAGES);
const SOURCE_SET: ReadonlySet<string> = new Set<string>([TRANSLATE_SOURCE_AUTO, ...TRANSLATE_LANGUAGES]);

/** Max length of the optional free-text translation directive. */
export const MAX_TRANSLATE_INSTRUCTIONS_CHARS = 300;

// C0 control characters (U+0000–U+001F) and DEL — never legitimate in the directive.
const CONTROL_CHAR = /[\x00-\x1F\x7F]/;

/** Validated options for a `translate-pdf` job. */
export interface TranslateOptions {
  /** The language to translate the document INTO. Required — never defaulted. */
  targetLanguage: TranslateLanguage;
  /** The document's source language, or `auto` to let the model detect it. */
  sourceLanguage: TranslateSourceLanguage;
  /**
   * Optional user directive that steers the translation (e.g. "keep product names in
   * English", "use a formal register"). Bounded and control-character-free. It is a
   * prompt directive, never a key/path/log line.
   */
  instructions?: string;
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
 * Parse the free-form `options` bag of a `translate-pdf` job into typed, validated
 * options. Strict and honest: a target language is REQUIRED and must be in the
 * allow-list (never coerced), the source language defaults to auto-detect but is
 * validated when given, and the optional directive is bounded and control-character-
 * free. Mirrors `parseSummarizeOptions`, differing only in that translation cannot
 * proceed without a target — so an options-less request is honestly rejected.
 */
export function parseTranslateOptions(
  options: Record<string, unknown>,
): ParseResult<TranslateOptions> {
  if (!isObject(options)) {
    return invalid("`options` must be an object.", "options");
  }

  if (
    options.targetLanguage === undefined ||
    typeof options.targetLanguage !== "string" ||
    !LANGUAGE_SET.has(options.targetLanguage)
  ) {
    return invalid(
      `\`targetLanguage\` is required and must be one of ${TRANSLATE_LANGUAGES.join(", ")}.`,
      "targetLanguage",
    );
  }
  const targetLanguage = options.targetLanguage as TranslateLanguage;

  let sourceLanguage: TranslateSourceLanguage = DEFAULT_TRANSLATE_SOURCE;
  if (options.sourceLanguage !== undefined) {
    if (typeof options.sourceLanguage !== "string" || !SOURCE_SET.has(options.sourceLanguage)) {
      return invalid(
        `\`sourceLanguage\` must be \`auto\` or one of ${TRANSLATE_LANGUAGES.join(", ")}.`,
        "sourceLanguage",
      );
    }
    sourceLanguage = options.sourceLanguage as TranslateSourceLanguage;
  }

  const result: TranslateOptions = { targetLanguage, sourceLanguage };

  if (options.instructions !== undefined) {
    if (typeof options.instructions !== "string") {
      return invalid("`instructions` must be a string.", "instructions");
    }
    const trimmed = options.instructions.trim();
    if (trimmed.length > 0) {
      if (CONTROL_CHAR.test(trimmed)) {
        return invalid("`instructions` cannot contain control characters.", "instructions");
      }
      if (trimmed.length > MAX_TRANSLATE_INSTRUCTIONS_CHARS) {
        return invalid(
          `\`instructions\` is too long (max ${MAX_TRANSLATE_INSTRUCTIONS_CHARS} characters).`,
          "instructions",
        );
      }
      result.instructions = trimmed;
    }
  }

  return { ok: true, value: result };
}

/** A short, human description of a validated translation request, for the UI copy. */
export function describeTranslateRequest(options: TranslateOptions): string {
  const target = LANGUAGE_NAMES[options.targetLanguage];
  const from =
    options.sourceLanguage === TRANSLATE_SOURCE_AUTO
      ? "auto-detect source"
      : `from ${LANGUAGE_NAMES[options.sourceLanguage]}`;
  return `Translate to ${target} (${from})`;
}

/** A sensible download name for the translation package, derived from the source PDF. */
export function translationOutputName(originalName: unknown): string {
  const tail = "-translation.zip";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName).replace(/\.[^.]+$/, "").trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}
