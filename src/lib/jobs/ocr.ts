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

/**
 * A supported OCR recognition language (Tesseract / ISO 639-2/T code).
 *
 * Derived from {@link OCR_LANGUAGES} rather than restated, so the list below is the
 * only place a language is declared. When this union was maintained by hand it was a
 * third copy of the same set — after the Dockerfile and the list itself — and adding
 * a language meant remembering all three.
 */
export type OcrLanguage = (typeof OCR_LANGUAGES)[number]["code"];

/** A language plus its human label, for menus and docs. */
export interface OcrLanguageInfo {
  /** Tesseract language code (also the value sent in a job's `options`). */
  code: OcrLanguage;
  label: string;
}

/**
 * OCR language allowlist — the menu the tool page shows and the set the job API
 * accepts. Every entry is a promise: the worker image must ship the matching
 * `tesseract-ocr-<code>` pack, and `src/deploy/ocr-languages.test.ts` fails the
 * build if it does not. Extend the pack and this list in the same change, never
 * this list first.
 *
 * It deliberately mirrors the translation languages in `./translate-pdf`. A user
 * who can translate a Vietnamese PDF should be able to OCR a scanned one; when the
 * two lists drifted, OCR silently lagged translation by seven languages.
 *
 * Choosing the wrong language does not fail — Tesseract matches glyph shapes
 * against the model it was given and returns confident-looking nonsense, so a
 * Bengali page read as English comes back as Latin gibberish. That makes coverage
 * a correctness concern, not a nice-to-have.
 */
export const OCR_LANGUAGES = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "ita", label: "Italian" },
  { code: "por", label: "Portuguese" },
  { code: "nld", label: "Dutch" },
  { code: "rus", label: "Russian" },
  { code: "ukr", label: "Ukrainian" },
  { code: "pol", label: "Polish" },
  { code: "swe", label: "Swedish" },
  { code: "tur", label: "Turkish" },
  { code: "chi_sim", label: "Chinese (Simplified)" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
  { code: "vie", label: "Vietnamese" },
  { code: "ind", label: "Indonesian" },
  { code: "tha", label: "Thai" },
  { code: "ara", label: "Arabic" },
  { code: "hin", label: "Hindi" },
  { code: "ben", label: "Bengali" },
  // `satisfies` (not an annotation) keeps each `code` a literal type so `OcrLanguage`
  // can be derived from it, while still checking the shape of every entry.
] as const satisfies readonly { readonly code: string; readonly label: string }[];

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

/**
 * The closed set of OCR engine FAMILIES a completed job may name to a client. A
 * client-facing engine is ALWAYS one of these families or {@link UNKNOWN_OCR_ENGINE}
 * — never a path, a version, or a stray token — so the field can identify what ran
 * without becoming a leak vector. It mirrors the worker layer's `OCR_ENGINES`
 * (the engines a worker actually shells out to); extend both together when a new
 * engine family genuinely ships.
 */
export const OCR_ENGINE_FAMILIES = ["ocrmypdf", "tesseract"] as const;
export type OcrEngineFamily = (typeof OCR_ENGINE_FAMILIES)[number];

/** The family reported when the engine is not one of the known {@link OCR_ENGINE_FAMILIES}. */
export const UNKNOWN_OCR_ENGINE = "unknown";

const OCR_ENGINE_FAMILY_SET: ReadonlySet<string> = new Set(OCR_ENGINE_FAMILIES);

/**
 * Serializable, bounded metadata a COMPLETED OCR job attaches to its successful
 * result (populated by the secure worker's OCR processor from an ACTUAL run — see
 * `@/lib/workers/ocr-native`). Every field is either a hard fact of the run — which
 * engine family ran, what was produced, the validated language set — or a
 * COUNT/derived number. It NEVER carries recognized text, an input filename, an
 * object key, a temp path, a command path, or any secret, so it is safe to log,
 * persist, and return to a client.
 *
 * Honesty rules the {@link buildOcrResultMeta} builder enforces:
 *  - nullable fields are `null` when the value could not be safely determined — they
 *    are never fabricated (a backend that does not expose confidence reports `null`,
 *    it does not invent a number);
 *  - counts are coerced to bounded, non-negative integers;
 *  - the shape is schema-stable — it does not vary by engine or option.
 */
export interface OcrResultMeta {
  /** OCR engine family that did the work (short name only, e.g. "ocrmypdf"). Never a path or version. */
  engine: string;
  /** Validated, de-duplicated recognition languages (allowlist codes only). */
  languages: OcrLanguage[];
  /** What the job produced. */
  outputMode: OcrOutputMode;
  /** True when a searchable-PDF artifact was produced. */
  producedSearchablePdf: boolean;
  /** True when a plain-text sidecar artifact was produced. */
  producedTextSidecar: boolean;
  /** Page count of the searchable-PDF output when structurally determinable; `null` otherwise. */
  pageCount: number | null;
  /**
   * Character count of the text sidecar when it was produced and measured; `null`
   * otherwise. A COUNT ONLY — never the recognized text itself.
   */
  textCharacters: number | null;
  /**
   * Mean recognition confidence in [0, 1] ONLY when the backend reports it safely;
   * `null` otherwise.
   *
   * Populated for IMAGE inputs, where the runner drives Tesseract directly and can ask
   * it for a per-word TSV. It stays `null` for every PDF input: those go to OCRmyPDF,
   * which owns its own Tesseract sub-invocation and exposes no confidence, and neither
   * scraping its private temp dir nor re-OCRing the page just to score it is a trade
   * worth making. `null` means "not measured" and must be rendered as an absent row,
   * never as a dash or a zero.
   */
  meanConfidence: number | null;
  /**
   * Share of recognized words in [0, 1] scoring below
   * {@link OCR_LOW_CONFIDENCE_WORD_THRESHOLD}; `null` when not measured.
   *
   * Carried alongside the mean because the mean alone is a poor detector: a slightly
   * soft but correct scan lands in a tight cluster at a lower mean, while a run
   * against the wrong language produces a long low tail. The shape separates them;
   * the average hides it.
   */
  lowConfidenceWordRatio: number | null;
  /**
   * How many words the confidence figures were computed over; `null` when not
   * measured. Below a couple of dozen the other two numbers are noise, so a consumer
   * has to be able to tell a confident measurement from a thin one.
   */
  recognizedWords: number | null;
}

/**
 * Per-word confidence below which Tesseract's own output is treated as shaky. 60 (on
 * its native 0-100 scale) is the long-standing convention in the Tesseract ecosystem,
 * not a value derived from this product's corpus — which is exactly why it is used to
 * describe a distribution rather than to pass or fail a job.
 */
export const OCR_LOW_CONFIDENCE_WORD_THRESHOLD = 60;

/**
 * Fewest recognized words for which the confidence figures mean anything. Below this
 * a single misread word swings the average, so consumers must not draw a conclusion.
 */
export const OCR_MIN_WORDS_FOR_CONFIDENCE_ADVICE = 25;

/** Mean below which recognition is described as shaky. Provisional — see below. */
const OCR_LOW_MEAN_CONFIDENCE = 0.7;
/** Low-word share above which recognition is described as shaky. Provisional. */
const OCR_LOW_WORD_RATIO = 0.35;

/**
 * Whether a completed run's own numbers suggest the output is worth a second look.
 *
 * **This is a quality signal, not a language verdict.** It cannot say "this document is
 * Bengali" or "you picked the wrong language" — nothing in the pipeline identifies
 * script, so any such claim would be invention. Low confidence has several ordinary
 * causes: a blurry or skewed scan, low resolution, an unusual typeface. A wrong
 * language is one more.
 *
 * Returns `false` unless there are enough words to mean something, so a five-word
 * receipt never triggers an alarm on the strength of one misread token.
 *
 * The two thresholds are the Tesseract-ecosystem convention, **not** values derived
 * from this product's corpus, which is exactly why they drive a suggestion and never a
 * failure: no job is rejected, retried, or downgraded on this. Once the figures have
 * been observed across real traffic they should be re-derived from that distribution.
 */
export function ocrConfidenceLooksLow(meta: OcrResultMeta): boolean {
  const { meanConfidence, lowConfidenceWordRatio, recognizedWords } = meta;
  if (recognizedWords === null || recognizedWords < OCR_MIN_WORDS_FOR_CONFIDENCE_ADVICE) {
    return false;
  }
  // Either signal alone is enough: the mean catches a uniformly poor read, the ratio
  // catches the long low tail a mean would average away.
  return (
    (meanConfidence !== null && meanConfidence < OCR_LOW_MEAN_CONFIDENCE) ||
    (lowConfidenceWordRatio !== null && lowConfidenceWordRatio > OCR_LOW_WORD_RATIO)
  );
}

/** Upper bound on a reported page count — keeps the metric bounded against pathological input. */
export const OCR_MAX_REPORTED_PAGES = 200_000;
/**
 * Upper bound on a reported character count. A sidecar can never exceed the worker's
 * output byte ceiling, and (for UTF-8) its character count can never exceed its byte
 * count, so this 2 GiB cap is a safe, tangible bound the count can never legitimately
 * pass — it only clamps a pathological/garbage value.
 */
export const OCR_MAX_REPORTED_CHARACTERS = 2 * 1024 * 1024 * 1024;

/** Raw facts a runner observes from an actual OCR run, before bounding/sanitization. */
export interface OcrResultMetaInput {
  /** Engine family name (a short token; sanitized defensively). */
  engine: string;
  languages: readonly OcrLanguage[];
  outputMode: OcrOutputMode;
  producedSearchablePdf: boolean;
  producedTextSidecar: boolean;
  /** Best-effort page count of the produced PDF; null/absent when not determinable. */
  pageCount?: number | null;
  /** Best-effort character count of the produced sidecar; null/absent when not measured. */
  textCharacters?: number | null;
  /** Backend-reported mean confidence in [0, 1]; null/absent when the backend has none. */
  meanConfidence?: number | null;
  /** Share of recognized words below the low-confidence threshold, in [0, 1]. */
  lowConfidenceWordRatio?: number | null;
  /** How many words the confidence figures were computed over. */
  recognizedWords?: number | null;
}

/** Coerce a raw metric to a bounded, non-negative integer in [0, max]; anything else ⇒ null. */
function boundedCount(value: number | null | undefined, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.floor(value), max);
}

/** Reduce an engine name to a short, safe token so a stray path/text can never ride in as "engine". */
function sanitizeOcrEngineName(engine: string): string {
  const token = engine.trim().toLowerCase().replace(/[^a-z0-9_+-]/g, "");
  return token.slice(0, 32) || "unknown";
}

/**
 * Collapse an engine name to the closed client-facing family set: it is reported
 * verbatim ONLY when it is EXACTLY a known {@link OCR_ENGINE_FAMILIES} member, and
 * otherwise becomes {@link UNKNOWN_OCR_ENGINE}. Exact-match (not prefix/substring)
 * so a versioned or decorated value — `ocrmypdf-16.4.0`, `ocrmypdfSECRET` — never
 * launders a fragment through as a "known" family; it honestly reads `unknown`.
 * Used at the client-facing persistence boundary (`sanitizeJobResults`), so the
 * engine a client ever sees can only be `ocrmypdf`, `tesseract`, or `unknown`.
 */
export function normalizeOcrEngineFamily(
  engine: string,
): OcrEngineFamily | typeof UNKNOWN_OCR_ENGINE {
  const token = sanitizeOcrEngineName(engine);
  return OCR_ENGINE_FAMILY_SET.has(token)
    ? (token as OcrEngineFamily)
    : UNKNOWN_OCR_ENGINE;
}

/**
 * Build the bounded, content-free {@link OcrResultMeta} a successful OCR run reports.
 * Pure and schema-stable: it sanitizes the engine name, filters languages to the
 * allowlist, coerces counts to bounded non-negative integers, and keeps a confidence
 * ONLY when it is a real number in [0, 1] — never inventing one. Counts that only make
 * sense for a produced artifact are nulled when that artifact was not produced (no PDF
 * ⇒ null pages; no sidecar ⇒ null characters), so the metadata can never imply an
 * output that does not exist.
 */
export function buildOcrResultMeta(input: OcrResultMetaInput): OcrResultMeta {
  const producedSearchablePdf = input.producedSearchablePdf === true;
  const producedTextSidecar = input.producedTextSidecar === true;

  const languages: OcrLanguage[] = [];
  for (const code of input.languages) {
    if (isOcrLanguage(code) && !languages.includes(code)) languages.push(code);
  }

  // A unit ratio, or null. Anything outside [0, 1] is a units bug — Tesseract reports
  // confidence on 0-100, and a silently-nulled 87.4 would put the field straight back
  // to invisible with no error and no failing test. The parser converts explicitly and
  // `ocr.test.ts` pins that conversion.
  const unitRatio = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : null;

  const meanConfidence = unitRatio(input.meanConfidence);
  const lowConfidenceWordRatio = unitRatio(input.lowConfidenceWordRatio);

  return {
    engine: sanitizeOcrEngineName(input.engine),
    languages: languages.slice(0, MAX_OCR_LANGUAGES),
    outputMode: input.outputMode,
    producedSearchablePdf,
    producedTextSidecar,
    pageCount: producedSearchablePdf
      ? boundedCount(input.pageCount, OCR_MAX_REPORTED_PAGES)
      : null,
    textCharacters: producedTextSidecar
      ? boundedCount(input.textCharacters, OCR_MAX_REPORTED_CHARACTERS)
      : null,
    meanConfidence,
    lowConfidenceWordRatio,
    // Bounded like the other counts. A sidecar cannot hold more words than characters,
    // so the character ceiling is a safe upper bound here too.
    recognizedWords: boundedCount(input.recognizedWords ?? null, OCR_MAX_REPORTED_CHARACTERS),
  };
}
