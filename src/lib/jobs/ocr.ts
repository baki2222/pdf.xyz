/**
 * OCR job contract — the typed, framework-agnostic options and result shapes for
 * the "OCR PDF" secure-worker tool, plus a strict validator for the free-form
 * `options` bag a job request carries.
 *
 * This is the OCR analogue of the compression options in
 * `@/lib/workers/compression/engine.ts`: pure data plus one pure parser — no
 * Next.js, no storage, no OCR engine. It defines exactly what an OCR request may
 * ask for (which languages, what output) and what a completed OCR job reports
 * back, so the UI, the future worker, and the docs all share one honest source
 * of truth. It depends only on `./responses`, so a client component can import
 * the validator without pulling in the tools catalog or any Node built-in.
 *
 * Honesty rules:
 *  - Nothing here runs OCR or fabricates recognized text. `parseOcrOptions`
 *    validates a request; the result-metadata types describe what a REAL
 *    processor fills in once one is wired behind the adapter contract.
 *  - The language set is a curated allowlist (ISO 639-2/T codes, Tesseract
 *    naming). An unknown code is rejected, never silently dropped.
 */

import { apiError, type ParseResult } from "./responses";

/** A supported OCR recognition language (Tesseract / ISO 639-2/T code). */
export type OcrLanguage =
  | "eng"
  | "spa"
  | "fra"
  | "deu"
  | "ita"
  | "por"
  | "nld"
  | "rus"
  | "chi_sim"
  | "jpn"
  | "kor"
  | "ara"
  | "hin";

/** A language plus its human label, for menus and docs. */
export interface OcrLanguageInfo {
  /** Tesseract language code (also the value sent in a job's `options`). */
  code: OcrLanguage;
  label: string;
}

/**
 * Curated OCR language allowlist. These are the languages a production OCR
 * processor (OCRmyPDF/Tesseract or a managed provider) is expected to ship
 * packs for. Intentionally small and honest — extend it only alongside a
 * processor that genuinely supports the added pack.
 */
export const OCR_LANGUAGES: readonly OcrLanguageInfo[] = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "ita", label: "Italian" },
  { code: "por", label: "Portuguese" },
  { code: "nld", label: "Dutch" },
  { code: "rus", label: "Russian" },
  { code: "chi_sim", label: "Chinese (Simplified)" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
  { code: "ara", label: "Arabic" },
  { code: "hin", label: "Hindi" },
] as const;

/** Every supported language code, in menu order. */
export const OCR_LANGUAGE_CODES: readonly OcrLanguage[] = OCR_LANGUAGES.map(
  (language) => language.code,
);

const OCR_LANGUAGE_SET: ReadonlySet<string> = new Set(OCR_LANGUAGE_CODES);

/** The default recognition language when a request omits `languages`. */
export const DEFAULT_OCR_LANGUAGE: OcrLanguage = "eng";

/** Max language packs one job may combine (each pack adds real processing cost). */
export const MAX_OCR_LANGUAGES = 4;

/** True when `value` is a supported OCR language code. */
export function isOcrLanguage(value: unknown): value is OcrLanguage {
  return typeof value === "string" && OCR_LANGUAGE_SET.has(value);
}

/** Human label for a language code (falls back to the raw code). */
export function describeOcrLanguage(code: OcrLanguage): string {
  return OCR_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

/**
 * What an OCR job should produce:
 *  - `searchable-pdf`: the original pages with an invisible, selectable text
 *    layer added underneath — the scan looks identical, but text is selectable.
 *  - `text`: a plain-text sidecar (`.txt`) of the recognized text only.
 *  - `both`: a searchable PDF plus the text sidecar.
 */
export type OcrOutputMode = "searchable-pdf" | "text" | "both";

/** A mode plus its human copy and the formats it yields, for menus and docs. */
export interface OcrOutputModeInfo {
  id: OcrOutputMode;
  label: string;
  description: string;
  /** Output formats this mode yields. */
  outputs: readonly string[];
}

export const OCR_OUTPUT_MODES: readonly OcrOutputModeInfo[] = [
  {
    id: "searchable-pdf",
    label: "Searchable PDF",
    description:
      "Add an invisible, selectable text layer under the original scan. It looks identical, but the text becomes selectable and searchable.",
    outputs: ["PDF"],
  },
  {
    id: "text",
    label: "Text sidecar",
    description: "Extract the recognized text into a plain .txt file.",
    outputs: ["TXT"],
  },
  {
    id: "both",
    label: "Searchable PDF + text",
    description: "Produce both a searchable PDF and a plain-text sidecar.",
    outputs: ["PDF", "TXT"],
  },
] as const;

const OCR_OUTPUT_MODE_SET: ReadonlySet<string> = new Set(
  OCR_OUTPUT_MODES.map((mode) => mode.id),
);

/** The default output when a request omits `outputMode`. */
export const DEFAULT_OCR_OUTPUT_MODE: OcrOutputMode = "searchable-pdf";

/** True when `value` is a supported output mode. */
export function isOcrOutputMode(value: unknown): value is OcrOutputMode {
  return typeof value === "string" && OCR_OUTPUT_MODE_SET.has(value);
}

/** The output formats a given mode yields. */
export function ocrOutputsForMode(mode: OcrOutputMode): readonly string[] {
  return OCR_OUTPUT_MODES.find((entry) => entry.id === mode)?.outputs ?? ["PDF"];
}

/** Validated, tool-specific OCR options parsed from a job request. */
export interface OcrOptions {
  /**
   * Recognition languages in priority order; between 1 and
   * {@link MAX_OCR_LANGUAGES}, de-duplicated, every entry from the allowlist.
   */
  languages: OcrLanguage[];
  /** What to produce (searchable PDF, text sidecar, or both). */
  outputMode: OcrOutputMode;
  /**
   * Skip pages that already carry a text layer instead of re-recognizing them
   * (OCRmyPDF `--skip-text`). Off by default: the common case is a pure scan.
   */
  skipTextPages: boolean;
}

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

function unprocessable(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("unprocessable_entity", message, [{ field, message }]),
  };
}

/**
 * Parse the free-form `options` bag of an `ocr-pdf` job into typed, validated
 * options. Strict and honest: unknown languages, an empty language list, too
 * many languages, and unknown output modes are rejected with a field error —
 * never coerced or silently dropped. Mirrors `parseCompressionOptions`, and is
 * what the future OCR worker calls before it touches a file.
 */
export function parseOcrOptions(
  options: Record<string, unknown>,
): ParseResult<OcrOptions> {
  // ── languages ── accept a single code or an array; default to the base pack.
  const rawLanguages = options.languages;
  let candidates: unknown[];
  if (rawLanguages === undefined) {
    candidates = [DEFAULT_OCR_LANGUAGE];
  } else if (typeof rawLanguages === "string") {
    candidates = [rawLanguages];
  } else if (Array.isArray(rawLanguages)) {
    candidates = rawLanguages;
  } else {
    return invalid(
      "`options.languages` must be a language code or an array of codes.",
      "options.languages",
    );
  }

  if (candidates.length === 0) {
    return unprocessable(
      "At least one OCR language is required.",
      "options.languages",
    );
  }
  if (candidates.length > MAX_OCR_LANGUAGES) {
    return unprocessable(
      `Too many languages: choose at most ${MAX_OCR_LANGUAGES}.`,
      "options.languages",
    );
  }

  const languages: OcrLanguage[] = [];
  for (const candidate of candidates) {
    if (!isOcrLanguage(candidate)) {
      return unprocessable(
        `Unsupported OCR language: ${
          typeof candidate === "string" ? `"${candidate}"` : "non-string value"
        }.`,
        "options.languages",
      );
    }
    if (!languages.includes(candidate)) languages.push(candidate);
  }

  // ── outputMode ── default to a searchable PDF; reject anything unknown.
  const rawMode = options.outputMode ?? DEFAULT_OCR_OUTPUT_MODE;
  if (!isOcrOutputMode(rawMode)) {
    return invalid(
      '`options.outputMode` must be "searchable-pdf", "text", or "both".',
      "options.outputMode",
    );
  }

  // ── skipTextPages ── optional boolean; never coerce a truthy string.
  const rawSkip = options.skipTextPages;
  let skipTextPages = false;
  if (rawSkip !== undefined) {
    if (typeof rawSkip !== "boolean") {
      return invalid(
        "`options.skipTextPages` must be a boolean.",
        "options.skipTextPages",
      );
    }
    skipTextPages = rawSkip;
  }

  return { ok: true, value: { languages, outputMode: rawMode, skipTextPages } };
}

/**
 * A short, human summary of a validated OCR request, e.g.
 * "English, Spanish → Searchable PDF + text". Pure; used by the tool UI so the
 * "what will happen" copy always matches the options that would be submitted.
 */
export function describeOcrRequest(options: OcrOptions): string {
  const languages = options.languages
    .map((code) => describeOcrLanguage(code))
    .join(", ");
  const mode =
    OCR_OUTPUT_MODES.find((entry) => entry.id === options.outputMode)?.label ??
    options.outputMode;
  return `${languages} → ${mode}`;
}

/** Per-page recognition result a real OCR processor reports (never fabricated here). */
export interface OcrPageResult {
  pageNumber: number;
  /** Characters recognized on the page. */
  characters: number;
  /** Mean per-word confidence, 0–1. */
  meanConfidence: number;
}

/**
 * Serializable metadata a COMPLETED OCR job returns alongside its artifacts.
 * These are type definitions for a real processor's output — this module never
 * produces, estimates, or fakes them. A worker fills them in from actual
 * recognition results.
 */
export interface OcrResultMeta {
  /** OCR engine that did the work (name only, e.g. "ocrmypdf"). */
  engine: string;
  languages: OcrLanguage[];
  outputMode: OcrOutputMode;
  /** Pages the processor ran recognition over. */
  pagesProcessed: number;
  /** Pages skipped because they already had a text layer (`skipTextPages`). */
  pagesSkipped: number;
  /** Total characters recognized across the document. */
  textCharacters: number;
  /** Mean confidence across recognized words, 0–1. */
  meanConfidence: number;
  producedSearchablePdf: boolean;
  producedTextSidecar: boolean;
}
