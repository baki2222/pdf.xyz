/**
 * Translate PDF job contract — the typed, framework-agnostic options and validator
 * for the `translate-pdf` AI tool, plus its deterministic output naming.
 *
 * This is the AI-tool sibling of `@/lib/jobs/summarize-pdf.ts`: pure data plus a
 * pure parser — no Next.js, no storage, no AI SDK. It defines exactly what a
 * translation request may ask for (into which language, from which language, with an
 * optional directive) so the UI, the worker engine, and the docs share one honest
 * source of truth. It depends only on `./responses`, `./filenames`, `./ocr` (PDF to
 * Word's OCR option parser, which the OCR request is validated by) and
 * `./page-spans-option` (the one wire grammar for a page selection), so a client
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
import { parsePdfToWordOptions } from "./ocr";
import { parsePageSpansOption } from "./page-spans-option";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "./filenames";

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
  "bn",
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
  bn: "Bengali",
};

/**
 * The target languages CI makes the BUILT WORKER IMAGE prove it prints as a
 * reflowed PDF: `scripts/worker-translate-pdf-proof.ts` (run by
 * `.github/workflows/container.yml` inside the image) exits 1, and the merge
 * fails, if any of these is not among the image's `translatePdfLanguages`.
 *
 * Added 2026-11-15 (competitor audit #29, slice 2). It replaced the script's
 * local `REQUIRED` (en, es, bn) and was widened to the 17 languages production
 * proved that day (heartbeat + CI run 43730819643). Arabic joined the same
 * day, carried over from main's `REQUIRED` when PR #331 fixed the direction
 * check (live heartbeat: 18 languages, ar among them). Chinese, Japanese and
 * Korean joined with the CJK slice (2026-11-16: Type 3 glyphs judged by their
 * property, Kangxi ToUnicode destinations rewritten per face), which made the
 * gate every target language. The static copy that says
 * which languages get a PDF (`translatePdfCoverage`) reads THIS list, so a
 * language joins the copy only by joining the gate that keeps it true — the
 * Arabic and CJK slices add theirs here, and the "no PDF" list shrinks with
 * them. Never a promise about one job: the panel decides that from the live
 * heartbeat and the artifact.
 */
export const TRANSLATE_PDF_CI_REQUIRED: readonly TranslateLanguage[] = [
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
  "bn",
];

/** The source language, either a supported language or `auto` (let the model detect it). */
export const TRANSLATE_SOURCE_AUTO = "auto" as const;
export type TranslateSourceLanguage =
  typeof TRANSLATE_SOURCE_AUTO | TranslateLanguage;

/** The default source when a request omits it: auto-detect. */
export const DEFAULT_TRANSLATE_SOURCE: TranslateSourceLanguage =
  TRANSLATE_SOURCE_AUTO;

const LANGUAGE_SET: ReadonlySet<string> = new Set(TRANSLATE_LANGUAGES);
const SOURCE_SET: ReadonlySet<string> = new Set<string>([
  TRANSLATE_SOURCE_AUTO,
  ...TRANSLATE_LANGUAGES,
]);

/**
 * The refusal for a request whose source and target are the same language — one
 * sentence shared by the parser and the panel, so the browser blocks the run with the
 * words the API would refuse it with.
 *
 * Added 2026-11-06 (audit #38): the two languages were validated separately and never
 * compared, so "Spanish into Spanish" was accepted, charged up to a third of the daily
 * AI allowance, and returned a copy of the text it was given.
 */
export function translateSameLanguageMessage(
  language: TranslateLanguage,
): string {
  return `The source and target are both ${LANGUAGE_NAMES[language]}. Choose a different language to translate into.`;
}

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
  /**
   * Translate only these pages: canonical 1-based PHYSICAL spans (see
   * `./page-spans-option`, the grammar Summarize's `pages` uses). Absent means
   * the whole document. The route checks only the shape; whether page 15
   * exists is the worker's refusal (`pages_out_of_range`).
   *
   * An image that predates this key ignores it (this parser is lenient to
   * unknown keys) and translates the WHOLE document under a delivery cap sized
   * for the selection, which then withholds most of it. That is why the route
   * admits a request carrying it only while the heartbeat proves
   * `translatePageRange`. Never combined with `ocr` (refused by the parser):
   * a scan is charged undeclared and recognised whole.
   *
   * Spelled out rather than `PageSpan[]` (the same type, `@/lib/pdf/page-spans`)
   * because the /privacy options walk reads each option's type in this file
   * to decide whether it is free text: page numbers are not.
   */
  pages?: (readonly [number, number])[];
}

/**
 * The option keys that belong to an OCR request (audit translate-pdf#3,
 * 2026-11-09), not to the translation: recognise a SCAN's text first. They
 * are validated here by PDF to Word's own parser (`parsePdfToWordOptions`:
 * the OCR allowlist, the four-language cap and the right-to-left refusal,
 * word for word) and are NOT carried on {@link TranslateOptions} — the worker
 * reads them with that same parser in its OCR-first step
 * (`workers/processor/ocr-first.ts`), so there is one reading of them, and
 * nothing about the translation itself changes with them. The worker runs
 * OCR only when the PDF has no selectable text at all.
 */
export const TRANSLATE_OCR_OPTION_KEYS = [
  "ocr",
  "languages",
  "rotatePages",
  "deskew",
  "redoOcr",
] as const;

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
 * validated when given and may not equal the target, and the optional directive is
 * bounded and control-character-free. Mirrors `parseSummarizeOptions`, differing
 * only in that translation cannot proceed without a target — so an options-less
 * request is honestly rejected. (Auto-detect into the document's own language
 * cannot be seen here; the panel warns about it from the extracted text, see
 * `./translate-script`.)
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
    if (
      typeof options.sourceLanguage !== "string" ||
      !SOURCE_SET.has(options.sourceLanguage)
    ) {
      return invalid(
        `\`sourceLanguage\` must be \`auto\` or one of ${TRANSLATE_LANGUAGES.join(", ")}.`,
        "sourceLanguage",
      );
    }
    sourceLanguage = options.sourceLanguage as TranslateSourceLanguage;
  }
  // Translating a document into the language it is already in gives back a copy of it
  // and still spends the allowance, so the pair is refused before a job exists.
  if (sourceLanguage === targetLanguage) {
    return invalid(
      translateSameLanguageMessage(targetLanguage),
      "sourceLanguage",
    );
  }

  const result: TranslateOptions = { targetLanguage, sourceLanguage };

  // THE OCR REQUEST, through PDF to Word's own parser so the two cannot
  // disagree about a language — validated here, before the route charges
  // anything. Read only when one of its keys is present: a bag with none of
  // them is today's request, unchanged.
  if (TRANSLATE_OCR_OPTION_KEYS.some((key) => options[key] !== undefined)) {
    const ocr = parsePdfToWordOptions(options);
    if (!ocr.ok) return ocr;
  }

  if (options.instructions !== undefined) {
    if (typeof options.instructions !== "string") {
      return invalid("`instructions` must be a string.", "instructions");
    }
    const trimmed = options.instructions.trim();
    if (trimmed.length > 0) {
      if (CONTROL_CHAR.test(trimmed)) {
        return invalid(
          "`instructions` cannot contain control characters.",
          "instructions",
        );
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

  // THE PAGE SELECTION (competitor audit #29, slice 6), through the one wire
  // grammar Summarize uses. Refused with OCR: a scan declares no count, is
  // charged undeclared, and OCR-first recognises the whole file, so a
  // selection on it would be a choice nothing honours. Checked here, before
  // the route charges anything.
  if (options.pages !== undefined) {
    if (translateAsksForOcr(options)) {
      return invalid(
        "`pages` cannot be combined with `ocr`. Choose pages only for a PDF with selectable text.",
        "pages",
      );
    }
    const pages = parsePageSpansOption(options.pages, "pages");
    if (!pages.ok) return pages;
    result.pages = pages.value;
  }

  return { ok: true, value: result };
}

/**
 * Does this (already validated) options bag ask for OCR first? `ocr: true` is
 * the switch `parsePdfToWordOptions` reads; anything else is no request.
 */
export function translateAsksForOcr(options: Record<string, unknown>): boolean {
  return options.ocr === true;
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

/** The source's stem, shortened so `stem + tail` fits a display filename. */
function stemWithTail(originalName: unknown, tail: string): string {
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName)
      .replace(/\.[^.]+$/, "")
      .trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}

/** A sensible download name for the translation package, derived from the source PDF. */
export function translationOutputName(originalName: unknown): string {
  return stemWithTail(originalName, "-translation.zip");
}

/**
 * The download name for the reflowed PDF of the same translation: the same
 * stem and the same length budget as {@link translationOutputName}.
 */
export function translatedPdfOutputName(originalName: unknown): string {
  return stemWithTail(originalName, "-translated.pdf");
}
