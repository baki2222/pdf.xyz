import JSZip from "jszip";
import {
  PAGE_JOIN,
  pageTextChunks,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import {
  describeWindow,
  modelTruncationNotice,
  pageStartsFor,
  userTruncationNotice,
  type TruncationWindow,
} from "../ai/truncation";
import {
  LANGUAGE_NAMES,
  TRANSLATE_SOURCE_AUTO,
  type TranslateLanguage,
  type TranslateOptions,
  type TranslateSourceLanguage,
} from "@/lib/jobs/translate-pdf";
import type { AiProvider, AiCompletionResult } from "../ai/provider";
import {
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  translateMaxInputChars,
  translateTooLongMessage,
} from "@/lib/jobs/translate-limits";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";
import type { AiUsageMeta } from "@/lib/jobs/ai-results";

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
  /**
   * The one-line disclosure to show beside the result when `truncated` — e.g.
   * "Only pages 1-131 of 400 could be read, cut mid-page - ...". `null` when the
   * whole document was read. The UI renders THIS, not the model's words.
   */
  truncationNotice: string | null;
  /**
   * What the model actually saw, structurally — the block the job record
   * carries to the browser so the panel can state the bound.
   */
  window: TruncationWindow;
  /**
   * Provider-reported token usage, absent when the provider did not report it.
   * Carried to the job record so an AI run's cost is measurable after the fact.
   */
  usage?: AiUsageMeta;
}

export type TranslateFailureKind =
  | "unsupported"
  | "ai_unconfigured"
  | "no_text"
  | "too_large"
  /**
   * The document has more TEXT than the model may write back. Distinct from
   * `too_large`, which is about bytes: conflating them would tell a user to
   * shrink a file that is already small, when what they need is fewer pages.
   */
  | "too_much_text"
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
      /** Source characters found, on `too_much_text` only. */
      characters?: number;
      /** What this run could have handled, on `too_much_text` only. */
      ceilingCharacters?: number;
      retryable?: boolean;
      message: string;
    };

/**
 * A generous default generation budget. Translation output is roughly proportional to
 * the input, so unlike summarization there is no per-length plan — the budget is a
 * fixed default the operator's `maxOutputTokens` limit can only lower, never raise.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS;
const DEFAULT_MAX_INPUT_CHARS = AI_INPUT_LIMITS.maxInputCharacters;

/** The honesty-critical system prompt: translate ONLY the provided text; invent nothing. */
function buildSystemPrompt(
  options: TranslateOptions,
  window: TruncationWindow,
): string {
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
  // A translator's wrong claim is not a denial and not a mislabelled summary: it
  // is a fifth of a document handed back with nothing marking where it stops —
  // because the instruction a few lines above says "Output ONLY the translation,
  // with no preamble or commentary." That is the instruction this revokes.
  const notice = modelTruncationNotice(
    window,
    (upTo) =>
      `You were given only ${upTo}. Translate all of it, then end with one final line saying the translation covers only the pages you were given (${upTo}).\n` +
      "That closing line is REQUIRED and overrides the instruction to output no commentary. Never present the result as a translation of the whole document.",
  );
  if (notice) parts.push(notice);
  return parts.join(" ");
}

/** Map a provider completion failure to an honest, typed run failure. */
function mapProviderFailure(
  result: Extract<AiCompletionResult, { ok: false }>,
): Extract<TranslateRun, { ok: false }> {
  switch (result.kind) {
    case "not_configured":
      return {
        ok: false,
        kind: "ai_unconfigured",
        retryable: false,
        message: result.message,
      };
    case "rate_limited":
      return {
        ok: false,
        kind: "rate_limited",
        retryable: true,
        message: result.message,
      };
    case "content_filtered":
      return {
        ok: false,
        kind: "content_filtered",
        retryable: false,
        message: result.message,
      };
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
      return {
        ok: false,
        kind: "failed",
        retryable: result.retryable,
        message: result.message,
      };
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
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The PDF could not be read for text extraction.",
    };
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
  // One description of the window, shared by the prompt, the meta and the
  // package, so the model and the user cannot be told different things.
  const window = describeWindow(
    sourceText,
    pageStartsFor(pageTextChunks(extracted.pages), PAGE_JOIN),
    extracted.pageCount,
    maxChars,
  );
  const truncated = window.truncated;
  const promptText = truncated ? sourceText.slice(0, maxChars) : sourceText;

  const maxOutputTokens =
    deps.limits?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  // REFUSE BEFORE PAYING. Translate's binding constraint is the OUTPUT budget,
  // not the input cap it shares with the other AI tools — its output is as long
  // as its input. Measured on production: a 135,280-character document was
  // accepted, scanned, extracted, sent to the provider, billed, and rejected
  // after 49 seconds with "reached its output limit". The ceiling is knowable
  // before any of that, so it is checked before any of that.
  //
  // This is the BACKSTOP. By the time the worker runs, the daily AI allowance
  // has already been spent at job creation, so the panel makes the same check
  // before it uploads. This one saves the provider call and the 49 seconds, and
  // it is what a caller reaching the API directly gets.
  const ceilingCharacters = translateMaxInputChars(maxOutputTokens);
  if (sourceText.length > ceilingCharacters) {
    return {
      ok: false,
      kind: "too_much_text",
      characters: sourceText.length,
      ceilingCharacters,
      message: translateTooLongMessage(sourceText.length, ceilingCharacters),
    };
  }

  const completion = await provider.complete({
    system: buildSystemPrompt(options, window),
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
    return {
      ok: false,
      kind: "failed",
      retryable: true,
      message: "The AI provider returned an empty translation.",
    };
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
      truncationNotice: userTruncationNotice(window) || null,
    },
    translation: { characters: translation.length },
    notice:
      "This translation was generated by an AI model from the SELECTABLE TEXT of the source PDF only. It produces translated text (Markdown + plain text), not a layout-preserving PDF, and may contain errors — verify against the original before relying on it. No content was fabricated beyond the model's translation of the provided text.",
  };

  const output = await buildPackage(translation, manifest);
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The translation package exceeds the worker size limit.",
    };
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
      // Token counts travel to the job record so the per-page cost of an AI run
      // is measurable after the fact. Absent when the provider did not report.
      ...(completion.usage
        ? {
            usage: {
              inputTokens: completion.usage.inputTokens,
              outputTokens: completion.usage.outputTokens,
              ...(completion.usage.cachedInputTokens !== undefined
                ? { cachedInputTokens: completion.usage.cachedInputTokens }
                : {}),
              model: completion.model,
            },
          }
        : {}),
      targetLanguage: options.targetLanguage,
      sourceLanguage: options.sourceLanguage,
      pageCount: extracted.pageCount,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      sourceCharacters: sourceText.length,
      translationCharacters: translation.length,
      truncated,
      truncationNotice: userTruncationNotice(window) || null,
      window,
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
  source: {
    pageCount: number;
    characters: number;
    truncatedToCharacters: number | null;
    /** The page-named disclosure, or null when the whole document was read. */
    truncationNotice: string | null;
  };
  translation: { characters: number };
  notice: string;
}

/** Render the translation.md with an honest provenance header + the model's translation. */
function renderMarkdown(
  translation: string,
  manifest: TranslationManifest,
): string {
  const lines: string[] = [];
  lines.push(`# Translation — ${manifest.options.targetLanguageName}`);
  lines.push("");
  lines.push(
    `> Generated by ${manifest.provider} (${manifest.model}) from the selectable text of the source PDF.`,
  );
  lines.push(
    `> Pages: ${manifest.source.pageCount} · Source characters: ${manifest.source.characters}${manifest.source.truncatedToCharacters !== null ? ` (truncated to ${manifest.source.truncatedToCharacters} for translation)` : ""}`,
  );
  // The header directly above says this came from the source PDF. Without
  // this line it says so over a translation of the first fifth of it.
  if (manifest.source.truncationNotice) {
    lines.push(`>`);
    lines.push(`> **${manifest.source.truncationNotice}**`);
  }
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
  lines.push(
    `Target language: ${manifest.options.targetLanguageName} (${manifest.options.targetLanguage})`,
  );
  lines.push(`Source language: ${source}`);
  if (manifest.options.instructions)
    lines.push(`Instruction: ${manifest.options.instructions}`);
  lines.push("");
  lines.push("Contents:");
  lines.push(
    "  translation.md   The AI translation (markdown) with a provenance header.",
  );
  lines.push("  translation.txt  The AI translation as plain text.");
  lines.push(
    "  manifest.json    A structured record of the request (provider, model, languages, source stats).",
  );
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
