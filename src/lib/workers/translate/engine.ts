import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  LANGUAGE_NAMES,
  TRANSLATE_SOURCE_AUTO,
  type TranslateLanguage,
  type TranslateOptions,
  type TranslateSourceLanguage,
} from "@/lib/jobs/translate-pdf";
import type { AiProvider, AiCompletionResult } from "../ai/provider";

/**
 * Translate PDF engine for the `translate-pdf` AI tool.
 *
 * This is a real, honest AI translation engine — never a fabricated "here is your
 * translation" result. Given a PDF and validated options it:
 *   1. extracts the PDF's SELECTABLE text only (no OCR — a scanned/image-only PDF is
 *      honestly rejected as `no_text` and pointed at the OCR tool), then
 *   2. asks a configured {@link AiProvider} to translate ONLY that text into the
 *      requested language, then
 *   3. packages the model's real translation as a ZIP (translation.md +
 *      translation.txt + manifest.json + README.txt) recording the provider, model,
 *      languages, and honest scope.
 *
 * HONESTY (load-bearing):
 *   - No provider ⇒ `ai_unconfigured` with operator requirements. The engine NEVER
 *     invents a translation when no model is configured.
 *   - No selectable text ⇒ `no_text` (run OCR first). The engine never translates an
 *     empty/scanned document by guessing.
 *   - The system prompt constrains the model to the document text; the translation
 *     that ships is exactly the model's output, unedited and unfabricated.
 *   - The text extractor and AI provider are injected, so this module stays node-free
 *     and unit-testable: production wires the real pdfjs extractor + Anthropic
 *     provider (`./native`), tests wire deterministic fakes.
 *
 * SCOPE NOTE: this produces translated TEXT (Markdown + plain text), not a
 * layout-preserving re-typeset PDF. The package and UI say so plainly rather than
 * implying a pixel-faithful translated PDF the engine does not produce.
 */

export const TRANSLATE_TOOL = "translate-pdf" as const;
export const TRANSLATE_ENGINE = "ai-text-translation" as const;

/** Extract selectable text from a PDF; throws on an unreadable PDF. */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<ExtractedPdfText>;

export interface TranslateLimits {
  maxInputBytes?: number;
  maxOutputBytes?: number;
  /** Max source characters sent to the model; longer input is truncated (never silently). */
  maxInputChars?: number;
  /** Ceiling on the model's generated tokens; the default budget is clamped to it. */
  maxOutputTokens?: number;
}

export interface TranslateDeps {
  extract?: PdfTextExtractor;
  /** A configured AI provider. Absent ⇒ the engine fails honestly as `ai_unconfigured`. */
  provider?: AiProvider;
  /** ISO timestamp source; defaults to the wall clock. Injected for deterministic tests. */
  now?: () => string;
  limits?: TranslateLimits;
}

/** Content-free metrics a successful run reports. Never carries document text. */
export interface TranslateMeta {
  engine: typeof TRANSLATE_ENGINE;
  tool: typeof TRANSLATE_TOOL;
  /** AI provider family id (e.g. "anthropic"). Never a key. */
  provider: string;
  /** Public model id (e.g. "claude-sonnet-5"). Never a secret. */
  model: string;
  /** The requested target language code (e.g. "fr"). */
  targetLanguage: TranslateLanguage;
  /** The source language code or "auto". */
  sourceLanguage: TranslateSourceLanguage;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
  /** Character count of the extracted source text (a COUNT, never the text). */
  sourceCharacters: number;
  /** Character count of the produced translation (a COUNT, never the text). */
  translationCharacters: number;
  /** True when the source exceeded `maxInputChars` and only a prefix was translated. */
  truncated: boolean;
}

export type TranslateFailureKind =
  | "unsupported"
  | "ai_unconfigured"
  | "no_text"
  | "too_large"
  | "rate_limited"
  | "content_filtered"
  | "failed";

export type TranslateRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: TranslateMeta;
    }
  | {
      ok: false;
      kind: TranslateFailureKind;
      limitBytes?: number;
      retryable?: boolean;
      message: string;
    };

/**
 * A generous default generation budget. Translation output is roughly proportional to
 * the input, so unlike summarization there is no per-length plan — the budget is a
 * fixed default the operator's `maxOutputTokens` limit can only lower, never raise.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const DEFAULT_MAX_INPUT_CHARS = 500_000;

/** The honesty-critical system prompt: translate ONLY the provided text; invent nothing. */
function buildSystemPrompt(options: TranslateOptions): string {
  const target = LANGUAGE_NAMES[options.targetLanguage];
  const parts = [
    "You are a precise, faithful document translator for pdf.xyz.",
    `Translate ONLY the document text provided by the user into ${target}.`,
    options.sourceLanguage === TRANSLATE_SOURCE_AUTO
      ? "Detect the source language automatically."
      : `The source language is ${LANGUAGE_NAMES[options.sourceLanguage]}.`,
    "Preserve the document's meaning, structure, headings, lists, and any Markdown formatting.",
    "Do not add, remove, summarize, or explain content — translate what is present, nothing more.",
    "Keep names, numbers, code, and URLs intact unless translation is clearly required.",
    "If a passage is untranslatable or unintelligible, leave it as-is rather than guessing.",
    `Output ONLY the ${target} translation, with no preamble or commentary.`,
  ];
  if (options.instructions) {
    parts.push(`Follow this additional instruction: ${options.instructions}.`);
  }
  return parts.join(" ");
}

/** Map a provider completion failure to an honest, typed run failure. */
function mapProviderFailure(
  result: Extract<AiCompletionResult, { ok: false }>,
): Extract<TranslateRun, { ok: false }> {
  switch (result.kind) {
    case "not_configured":
      return { ok: false, kind: "ai_unconfigured", retryable: false, message: result.message };
    case "rate_limited":
      return { ok: false, kind: "rate_limited", retryable: true, message: result.message };
    case "content_filtered":
      return { ok: false, kind: "content_filtered", retryable: false, message: result.message };
    case "too_long":
      return {
        ok: false,
        kind: "too_large",
        retryable: false,
        message:
          "This document is too large for the AI model's context window. Try a shorter PDF or split it first.",
      };
    case "timeout":
    case "invalid_response":
    case "provider_error":
    default:
      return { ok: false, kind: "failed", retryable: result.retryable, message: result.message };
  }
}

/**
 * Run the translation flow honestly: reject oversized input, fail `unsupported` when
 * no text extractor is wired, `ai_unconfigured` when no provider is configured,
 * `no_text` when the PDF has no selectable text (run OCR first), and map every
 * provider failure to a typed run failure — never a fabricated translation. On
 * success, return a real ZIP package (translation.md + translation.txt +
 * manifest.json + README.txt).
 */
export async function runTranslate(
  input: Uint8Array,
  options: TranslateOptions,
  deps: TranslateDeps,
): Promise<TranslateRun> {
  const { extract, provider } = deps;
  if (!extract) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Translate PDF requires the PDF text extractor, which is not available in this environment.",
    };
  }

  // No provider is the biggest blocker and needs no file work to detect — fail first,
  // honestly, with operator requirements. Never fabricate a translation without a model.
  if (!provider) {
    return {
      ok: false,
      kind: "ai_unconfigured",
      retryable: false,
      message:
        "Translating a PDF requires a configured AI provider (operator setup: PDFXYZ_AI_PROVIDER + PDFXYZ_AI_API_KEY). No provider is configured on this worker, so no translation can be produced. See docs/WORKER_ARCHITECTURE.md.",
    };
  }

  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  }

  const now = deps.now ?? (() => new Date().toISOString());

  let extracted: ExtractedPdfText;
  try {
    extracted = await extract(input);
  } catch {
    return { ok: false, kind: "failed", retryable: false, message: "The PDF could not be read for text extraction." };
  }

  const sourceText = extracted.text.trim();
  if (!extracted.hasText || sourceText.length === 0) {
    return {
      ok: false,
      kind: "no_text",
      retryable: false,
      message:
        "This PDF has no selectable text to translate. It may be a scan or image-only PDF — run OCR PDF first, then translate the result.",
    };
  }

  const maxChars = deps.limits?.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  const truncated = sourceText.length > maxChars;
  const promptText = truncated ? sourceText.slice(0, maxChars) : sourceText;

  const maxOutputTokens = deps.limits?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  const completion = await provider.complete({
    system: buildSystemPrompt(options),
    messages: [
      {
        role: "user",
        content: `Translate the following document.${truncated ? " (Only the first part of a long document is included.)" : ""}\n\n---\n${promptText}\n---`,
      },
    ],
    maxOutputTokens,
    temperature: 0.2,
  });

  if (!completion.ok) return mapProviderFailure(completion);

  const translation = completion.text.trim();
  if (translation.length === 0) {
    return { ok: false, kind: "failed", retryable: true, message: "The AI provider returned an empty translation." };
  }

  const createdAt = now();
  const manifest: TranslationManifest = {
    schema: "pdfxyz.translation/v1",
    tool: TRANSLATE_TOOL,
    engine: TRANSLATE_ENGINE,
    createdAt,
    provider: provider.id,
    model: completion.model,
    options: {
      targetLanguage: options.targetLanguage,
      targetLanguageName: LANGUAGE_NAMES[options.targetLanguage],
      sourceLanguage: options.sourceLanguage,
      ...(options.instructions ? { instructions: options.instructions } : {}),
    },
    source: {
      pageCount: extracted.pageCount,
      characters: sourceText.length,
      truncatedToCharacters: truncated ? maxChars : null,
    },
    translation: { characters: translation.length },
    notice:
      "This translation was generated by an AI model from the SELECTABLE TEXT of the source PDF only. It produces translated text (Markdown + plain text), not a layout-preserving PDF, and may contain errors — verify against the original before relying on it. No content was fabricated beyond the model's translation of the provided text.",
  };

  const output = await buildPackage(translation, manifest);
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return { ok: false, kind: "failed", retryable: false, message: "The translation package exceeds the worker size limit." };
  }

  return {
    ok: true,
    output,
    filenameExt: "zip",
    contentType: "application/zip",
    meta: {
      engine: TRANSLATE_ENGINE,
      tool: TRANSLATE_TOOL,
      provider: provider.id,
      model: completion.model,
      targetLanguage: options.targetLanguage,
      sourceLanguage: options.sourceLanguage,
      pageCount: extracted.pageCount,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      sourceCharacters: sourceText.length,
      translationCharacters: translation.length,
      truncated,
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest / package types + serialization
// ---------------------------------------------------------------------------

interface TranslationManifest {
  schema: string;
  tool: string;
  engine: string;
  createdAt: string;
  provider: string;
  model: string;
  options: {
    targetLanguage: TranslateLanguage;
    targetLanguageName: string;
    sourceLanguage: TranslateSourceLanguage;
    instructions?: string;
  };
  source: { pageCount: number; characters: number; truncatedToCharacters: number | null };
  translation: { characters: number };
  notice: string;
}

/** Render the translation.md with an honest provenance header + the model's translation. */
function renderMarkdown(translation: string, manifest: TranslationManifest): string {
  const lines: string[] = [];
  lines.push(`# Translation — ${manifest.options.targetLanguageName}`);
  lines.push("");
  lines.push(`> Generated by ${manifest.provider} (${manifest.model}) from the selectable text of the source PDF.`);
  lines.push(`> Pages: ${manifest.source.pageCount} · Source characters: ${manifest.source.characters}${manifest.source.truncatedToCharacters !== null ? ` (truncated to ${manifest.source.truncatedToCharacters} for translation)` : ""}`);
  lines.push("");
  lines.push(translation);
  lines.push("");
  lines.push("---");
  lines.push(`_${manifest.notice}_`);
  return lines.join("\n");
}

/** Render a plain-text README describing the package and its honest scope. */
function renderReadme(manifest: TranslationManifest): string {
  const source =
    manifest.options.sourceLanguage === TRANSLATE_SOURCE_AUTO
      ? "auto-detected"
      : manifest.options.sourceLanguage;
  const lines: string[] = [];
  lines.push("pdf.xyz — AI Translation Package");
  lines.push("================================");
  lines.push("");
  lines.push(`Generated: ${manifest.createdAt}`);
  lines.push(`Provider: ${manifest.provider}`);
  lines.push(`Model: ${manifest.model}`);
  lines.push(`Target language: ${manifest.options.targetLanguageName} (${manifest.options.targetLanguage})`);
  lines.push(`Source language: ${source}`);
  if (manifest.options.instructions) lines.push(`Instruction: ${manifest.options.instructions}`);
  lines.push("");
  lines.push("Contents:");
  lines.push("  translation.md   The AI translation (markdown) with a provenance header.");
  lines.push("  translation.txt  The AI translation as plain text.");
  lines.push("  manifest.json    A structured record of the request (provider, model, languages, source stats).");
  lines.push("");
  lines.push("HONEST SCOPE:");
  lines.push("  " + manifest.notice);
  return lines.join("\n");
}

/** Package the translation + manifest + README into a real ZIP. */
async function buildPackage(
  translation: string,
  manifest: TranslationManifest,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("translation.md", renderMarkdown(translation, manifest));
  zip.file("translation.txt", translation);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", renderReadme(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
